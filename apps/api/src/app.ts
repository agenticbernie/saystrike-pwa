import { randomInt, randomUUID } from 'node:crypto';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { getCookie, setCookie } from 'hono/cookie';
import { Hono } from 'hono';
import { z } from 'zod';
import { apiErrorSchema, battleSchema, challengeSchema, evaluationResultSchema, progressSchema, sessionReviewSchema } from '@saystrike/shared';
import { loadConfig, type ApiConfig } from './config.js';
import { createDatabase, findBrowserSession, issueBrowserSession, type SqliteDatabase } from './db.js';
import { CHALLENGE_PROMPTS, difficultyLabel } from './domain/challenges.js';
import { adjustDifficulty } from './domain/difficulty.js';
import { awardSessionGoal, calculateXp, GAMEPLAY_CONFIG, getBossPhase, getRank, resolveAttack } from './domain/game.js';
import { OpenAiSpeechEvaluator, ProviderConfigurationError, ProviderResponseError, UnconfiguredSpeechEvaluator, type ProviderAssessment, type SpeechEvaluator } from './services/evaluator.js';

interface Dependencies {
  db?: SqliteDatabase;
  config?: ApiConfig;
  evaluator?: SpeechEvaluator;
}

interface ChallengeRow {
  id: string;
  player_id: string;
  session_id: string;
  battle_id: string | null;
  target_id: string;
  target_text: string;
  category: string;
  difficulty: number;
  attack_applied: number;
  retry_bonus_awarded: number;
}

interface BattleRow {
  id: string;
  player_id: string;
  session_id: string;
  status: 'active' | 'victory' | 'defeat';
  boss_hp: number;
  player_energy: number;
  broken_rhythm: number;
  guard_break: number;
  valid_attacks: number;
}

interface StoredPlayer {
  id: string;
  xp: number;
  difficulty: number;
}

const COOKIE_NAME = 'saystrike_guest';
const practiceInputSchema = z.object({}).strict();
const evaluateFormSchema = z.object({
  idempotencyKey: z.string().uuid(),
});

const nullScores = { accuracy: null, clarity: null, fluency: null, total: null } as const;
const nullEvidence = { accuracy: null, clarity: null, fluency: null } as const;
const nullFeedback = { strength: null, priorityIssue: null, actionableTip: null, retryTarget: null } as const;

function apiError(code: string, message: string, retryable = false) {
  return apiErrorSchema.parse({ error: { code, message, retryable } });
}

function emptyResult(id: string, challengeId: string, status: 'audio_error' | 'evaluation_error', reason: string, difficulty: number) {
  return evaluationResultSchema.parse({
    id,
    challengeId,
    status,
    reason,
    scores: nullScores,
    evidence: nullEvidence,
    feedback: nullFeedback,
    retryComparison: null,
    battle: null,
    xpAwarded: 0,
    difficulty,
  });
}

function insufficientResult(id: string, challengeId: string, assessment: Extract<ProviderAssessment, { status: 'insufficient_evidence' }>, difficulty: number) {
  return evaluationResultSchema.parse({
    id,
    challengeId,
    status: 'insufficient_evidence',
    transcript: assessment.transcript,
    reason: assessment.reason,
    scores: { ...nullScores, ...assessment.scores, total: null },
    evidence: { ...nullEvidence, ...assessment.evidence },
    feedback: nullFeedback,
    retryComparison: null,
    battle: null,
    xpAwarded: 0,
    difficulty,
  });
}

function parseWav(buffer: Buffer): { durationSeconds: number } | null {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') return null;
  const format = buffer.readUInt16LE(20);
  const channels = buffer.readUInt16LE(22);
  const sampleRate = buffer.readUInt32LE(24);
  const bitsPerSample = buffer.readUInt16LE(34);
  const dataBytes = buffer.readUInt32LE(40);
  if (format !== 1 || channels !== 1 || sampleRate !== 24_000 || bitsPerSample !== 16 || dataBytes <= 0 || dataBytes > buffer.length - 44) return null;
  const durationSeconds = dataBytes / (sampleRate * channels * bitsPerSample / 8);
  if (durationSeconds < 0.5 || durationSeconds > 10.1) return null;
  return { durationSeconds };
}

function toBattle(row: BattleRow, xp: number, difficulty: number) {
  return battleSchema.parse({
    id: row.id,
    status: row.status,
    bossName: GAMEPLAY_CONFIG.bossName,
    bossHp: row.boss_hp,
    playerEnergy: row.player_energy,
    phase: getBossPhase(row.boss_hp),
    brokenRhythm: row.broken_rhythm === 1,
    guardBreak: row.guard_break === 1,
    validAttacks: row.valid_attacks,
    playerXp: xp,
    difficulty,
    sessionId: row.session_id,
  });
}

function getPlayer(db: SqliteDatabase, id: string): StoredPlayer {
  const player = db.prepare('SELECT id, xp, difficulty FROM players WHERE id = ?').get(id) as StoredPlayer | undefined;
  if (!player) throw new Error('Guest session does not exist.');
  return player;
}

function getBattleRow(db: SqliteDatabase, id: string, playerId: string): BattleRow | undefined {
  return db.prepare('SELECT * FROM battles WHERE id = ? AND player_id = ?').get(id, playerId) as BattleRow | undefined;
}

function pickPrompt(db: SqliteDatabase, playerId: string, level: number) {
  const candidates = CHALLENGE_PROMPTS.filter((prompt) => prompt.difficulty === level);
  const recent = db.prepare('SELECT target_id FROM challenges WHERE player_id = ? ORDER BY created_at DESC LIMIT 4')
    .all(playerId) as Array<{ target_id: string }>;
  const recentIds = new Set(recent.map((row) => row.target_id));
  const fresh = candidates.filter((prompt) => !recentIds.has(prompt.id));
  const pool = fresh.length ? fresh : candidates;
  return pool[randomInt(pool.length)] ?? CHALLENGE_PROMPTS[0]!;
}

function presentChallenge(row: ChallengeRow, turnNumber: number | null) {
  return challengeSchema.parse({
    id: row.id,
    sessionId: row.session_id,
    battleId: row.battle_id,
    mode: row.battle_id ? 'battle' : 'practice',
    targetId: row.target_id,
    targetText: row.target_text,
    category: row.category,
    difficulty: row.difficulty,
    difficultyLabel: difficultyLabel(row.difficulty),
    turnNumber,
  });
}

function issueXp(db: SqliteDatabase, playerId: string, amount: number, reason: string, sourceId: string, now: string): number {
  if (amount <= 0) return 0;
  const id = randomUUID();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO xp_ledger(id, player_id, idempotency_key, amount, reason, source_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, playerId, `${reason}:${sourceId}`, amount, reason, sourceId, now);
  if (insert.changes) db.prepare('UPDATE players SET xp = xp + ? WHERE id = ?').run(amount, playerId);
  return insert.changes ? amount : 0;
}

function getSkillSummary(rows: Array<{ accuracy: number; clarity: number; fluency: number }>) {
  if (!rows.length) return { strongestSkill: null as string | null, weakestSkill: null as string | null };
  const percent = {
    'Content accuracy': rows.reduce((n, row) => n + row.accuracy / 40, 0) / rows.length,
    'Clarity': rows.reduce((n, row) => n + row.clarity / 35, 0) / rows.length,
    'Fluency': rows.reduce((n, row) => n + row.fluency / 25, 0) / rows.length,
  };
  const sorted = Object.entries(percent).sort((a, b) => b[1] - a[1]);
  return { strongestSkill: sorted[0]?.[0] ?? null, weakestSkill: sorted.at(-1)?.[0] ?? null };
}

function mostCommonIssue(db: SqliteDatabase, playerId: string, sessionId?: string) {
  const rows = sessionId
    ? db.prepare(`SELECT e.result_json FROM evaluations e JOIN valid_attempts v ON v.evaluation_id = e.id WHERE v.player_id = ? AND v.session_id = ? ORDER BY v.created_at DESC`)
      .all(playerId, sessionId) as Array<{ result_json: string | null }>
    : db.prepare(`SELECT e.result_json FROM evaluations e JOIN valid_attempts v ON v.evaluation_id = e.id WHERE v.player_id = ? ORDER BY v.created_at DESC LIMIT 20`)
      .all(playerId) as Array<{ result_json: string | null }>;
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.result_json) continue;
    try {
      const result = JSON.parse(row.result_json) as { feedback?: { priorityIssue?: string | null } };
      const issue = result.feedback?.priorityIssue?.trim();
      if (issue) counts.set(issue, (counts.get(issue) ?? 0) + 1);
    } catch {
      continue;
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export function createApp(dependencies: Dependencies = {}) {
  const config = dependencies.config ?? loadConfig();
  const db = dependencies.db ?? createDatabase(config.databasePath);
  const evaluator = dependencies.evaluator ?? (config.openAiApiKey
    ? new OpenAiSpeechEvaluator(config.openAiApiKey, config.openAiAudioModel, config.openAiTimeoutMs)
    : new UnconfiguredSpeechEvaluator());
  const app = new Hono<{ Variables: { playerId: string } }>();

  app.use('/api/v1/*', cors({
    origin: config.webOrigin,
    credentials: true,
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
    maxAge: 600,
  }));
  app.use('/api/v1/*', async (c, next) => {
    const origin = c.req.header('Origin');
    if (origin && origin !== config.webOrigin) return c.json(apiError('origin_not_allowed', 'This web origin is not allowed.', false), 403);
    let playerId = findBrowserSession(db, getCookie(c, COOKIE_NAME) ?? '');
    if (!playerId) {
      const issued = issueBrowserSession(db);
      playerId = issued.playerId;
      setCookie(c, COOKIE_NAME, issued.token, {
        httpOnly: true,
        secure: config.environment === 'production',
        sameSite: 'Lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
      });
    }
    c.set('playerId', playerId);
    await next();
  });
  app.use('/api/v1/challenges/*/evaluate', bodyLimit({ maxSize: config.maxUploadBytes + 16_384 }));

  app.get('/health', (c) => c.json({ status: 'ok' }));
  app.get('/api/v1/health', (c) => c.json({
    status: 'ok',
    evaluationReady: Boolean(config.openAiApiKey),
    provider: config.openAiApiKey ? 'OpenAI' : null,
    database: 'sqlite',
  }));

  app.get('/api/v1/session', (c) => {
    const player = getPlayer(db, c.get('playerId'));
    const validAttempts = db.prepare('SELECT COUNT(*) as count FROM valid_attempts WHERE player_id = ?')
      .get(player.id) as { count: number };
    return c.json({
      player: { xp: player.xp, difficulty: player.difficulty, validAttempts: validAttempts.count },
      evaluationReady: Boolean(config.openAiApiKey),
    });
  });

  app.post('/api/v1/practice-sessions', async (c) => {
    const input = practiceInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json(apiError('invalid_request', 'The practice session request is invalid.'), 400);
    const player = getPlayer(db, c.get('playerId'));
    const id = randomUUID();
    db.prepare('INSERT INTO practice_sessions(id, player_id, mode, created_at) VALUES (?, ?, ?, ?)')
      .run(id, player.id, 'practice', new Date().toISOString());
    return c.json({ id, mode: 'practice' as const }, 201);
  });

  app.post('/api/v1/practice-sessions/:id/challenges', (c) => {
    const player = getPlayer(db, c.get('playerId'));
    const sessionId = c.req.param('id');
    const session = db.prepare('SELECT id FROM practice_sessions WHERE id = ? AND player_id = ? AND mode = ? AND ended_at IS NULL')
      .get(sessionId, player.id, 'practice');
    if (!session) return c.json(apiError('session_not_found', 'Practice session was not found.'), 404);
    const latest = db.prepare('SELECT * FROM challenges WHERE session_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(sessionId) as ChallengeRow | undefined;
    if (latest) {
      const hasValid = db.prepare("SELECT 1 FROM valid_attempts WHERE challenge_id = ? LIMIT 1").get(latest.id);
      const skipped = db.prepare('SELECT skipped FROM challenges WHERE id = ?').get(latest.id) as { skipped: number };
      if (!hasValid && !skipped.skipped) return c.json(presentChallenge(latest, null));
    }
    const prompt = pickPrompt(db, player.id, player.difficulty);
    const row: ChallengeRow = {
      id: randomUUID(), player_id: player.id, session_id: sessionId, battle_id: null,
      target_id: prompt.id, target_text: prompt.text, category: prompt.category,
      difficulty: prompt.difficulty, attack_applied: 0, retry_bonus_awarded: 0,
    };
    db.prepare(`INSERT INTO challenges(id, player_id, session_id, target_id, target_text, category, difficulty, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(row.id, row.player_id, row.session_id, row.target_id, row.target_text, row.category, row.difficulty, new Date().toISOString());
    return c.json(presentChallenge(row, null), 201);
  });

  app.post('/api/v1/practice-sessions/:id/challenges/:challengeId/skip', (c) => {
    const player = getPlayer(db, c.get('playerId'));
    const sessionId = c.req.param('id');
    const challengeId = c.req.param('challengeId');
    const challenge = db.prepare('SELECT id FROM challenges WHERE id = ? AND session_id = ? AND player_id = ? AND battle_id IS NULL')
      .get(challengeId, sessionId, player.id);
    if (!challenge) return c.json(apiError('challenge_not_found', 'Challenge was not found.'), 404);
    const hasValid = db.prepare('SELECT 1 FROM valid_attempts WHERE challenge_id = ? LIMIT 1').get(challengeId);
    if (hasValid) return c.json(apiError('challenge_already_completed', 'A completed challenge cannot be skipped.'), 409);
    db.prepare('UPDATE challenges SET skipped = 1 WHERE id = ?').run(challengeId);
    return c.json({ skipped: true });
  });

  app.post('/api/v1/battles', async (c) => {
    const input = practiceInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json(apiError('invalid_request', 'The battle request is invalid.'), 400);
    const player = getPlayer(db, c.get('playerId'));
    const id = randomUUID();
    const sessionId = randomUUID();
    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      db.prepare('INSERT INTO practice_sessions(id, player_id, mode, created_at) VALUES (?, ?, ?, ?)')
        .run(sessionId, player.id, 'battle', now);
      db.prepare(`INSERT INTO battles(id, player_id, session_id, status, boss_hp, player_energy, created_at, updated_at)
        VALUES (?, ?, ?, 'active', ?, ?, ?, ?)`)
        .run(id, player.id, sessionId, GAMEPLAY_CONFIG.bossHp, GAMEPLAY_CONFIG.playerEnergy, now, now);
    });
    tx();
    const row = getBattleRow(db, id, player.id)!;
    return c.json({ battle: toBattle(row, player.xp, player.difficulty) }, 201);
  });

  app.get('/api/v1/battles/:id', (c) => {
    const player = getPlayer(db, c.get('playerId'));
    const row = getBattleRow(db, c.req.param('id'), player.id);
    if (!row) return c.json(apiError('battle_not_found', 'Battle was not found.'), 404);
    return c.json({ battle: toBattle(row, player.xp, player.difficulty) });
  });

  app.post('/api/v1/battles/:id/challenges', (c) => {
    const player = getPlayer(db, c.get('playerId'));
    const battle = getBattleRow(db, c.req.param('id'), player.id);
    if (!battle) return c.json(apiError('battle_not_found', 'Battle was not found.'), 404);
    if (battle.status !== 'active') return c.json(apiError('battle_finished', 'This battle has already ended.'), 409);
    const latest = db.prepare('SELECT * FROM challenges WHERE battle_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(battle.id) as ChallengeRow | undefined;
    if (latest && latest.attack_applied === 0) return c.json(presentChallenge(latest, battle.valid_attacks + 1));
    const prompt = pickPrompt(db, player.id, player.difficulty);
    const row: ChallengeRow = {
      id: randomUUID(), player_id: player.id, session_id: battle.session_id, battle_id: battle.id,
      target_id: prompt.id, target_text: prompt.text, category: prompt.category,
      difficulty: prompt.difficulty, attack_applied: 0, retry_bonus_awarded: 0,
    };
    db.prepare(`INSERT INTO challenges(id, player_id, session_id, battle_id, target_id, target_text, category, difficulty, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(row.id, row.player_id, row.session_id, row.battle_id, row.target_id, row.target_text, row.category, row.difficulty, new Date().toISOString());
    return c.json(presentChallenge(row, battle.valid_attacks + 1), 201);
  });

  app.post('/api/v1/challenges/:id/evaluate', async (c) => {
    const player = getPlayer(db, c.get('playerId'));
    const challenge = db.prepare('SELECT * FROM challenges WHERE id = ? AND player_id = ?')
      .get(c.req.param('id'), player.id) as ChallengeRow | undefined;
    if (!challenge) return c.json(apiError('challenge_not_found', 'Challenge was not found.'), 404);

    let form: Record<string, string | File | string[] | File[]>;
    try {
      form = await c.req.parseBody({ all: true });
    } catch {
      return c.json(apiError('invalid_audio_request', 'The audio upload could not be read.'), 400);
    }
    const parsedForm = evaluateFormSchema.safeParse({ idempotencyKey: form.idempotencyKey });
    const file = form.audio;
    if (!parsedForm.success || !(file instanceof File)) return c.json(apiError('invalid_audio_request', 'An audio recording and idempotency key are required.'), 400);
    if (file.size > config.maxUploadBytes || !['audio/wav', 'audio/x-wav', 'audio/wave'].includes(file.type)) {
      const id = randomUUID();
      return c.json(emptyResult(id, challenge.id, 'audio_error', 'This recording format or size is not supported. Please record again.', player.difficulty));
    }

    const idempotencyKey = parsedForm.data.idempotencyKey;
    const priorRequest = db.prepare('SELECT id, challenge_id, status, result_json FROM evaluations WHERE player_id = ? AND idempotency_key = ?')
      .get(player.id, idempotencyKey) as { id: string; challenge_id: string; status: string; result_json: string | null } | undefined;
    if (priorRequest) {
      if (priorRequest.challenge_id !== challenge.id) return c.json(apiError('idempotency_conflict', 'This request key belongs to a different challenge.', false), 409);
      if (priorRequest.result_json) return c.json(JSON.parse(priorRequest.result_json));
      return c.json(apiError('attempt_processing', 'This recording is still being evaluated.', true), 409);
    }

    const evaluationId = randomUUID();
    const now = new Date().toISOString();
    try {
      db.prepare(`INSERT INTO evaluations(id, player_id, challenge_id, idempotency_key, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'processing', ?, ?)`)
        .run(evaluationId, player.id, challenge.id, idempotencyKey, now, now);
    } catch {
      return c.json(apiError('attempt_processing', 'This recording is already being evaluated.', true), 409);
    }

    const wav = Buffer.from(await file.arrayBuffer());
    const wavInfo = parseWav(wav);
    if (!wavInfo) {
      const result = emptyResult(evaluationId, challenge.id, 'audio_error', 'The recording was too short or could not be decoded. Please try again.', player.difficulty);
      db.prepare("UPDATE evaluations SET status = ?, result_json = ?, updated_at = ? WHERE id = ?")
        .run(result.status, JSON.stringify(result), new Date().toISOString(), evaluationId);
      return c.json(result);
    }

    let assessment: ProviderAssessment;
    try {
      assessment = await evaluator.evaluate({ wav, targetText: challenge.target_text, signal: c.req.raw.signal });
    } catch (error) {
      const message = error instanceof ProviderConfigurationError
        ? 'Speech evaluation is not configured. Ask the site operator to add the server provider key.'
        : error instanceof ProviderResponseError
          ? error.message
          : 'Speech evaluation failed. Your turn was not counted. Please retry.';
      const result = emptyResult(evaluationId, challenge.id, 'evaluation_error', message, player.difficulty);
      db.prepare("UPDATE evaluations SET status = ?, result_json = ?, updated_at = ? WHERE id = ?")
        .run(result.status, JSON.stringify(result), new Date().toISOString(), evaluationId);
      return c.json(result);
    }

    if (assessment.status === 'insufficient_evidence') {
      const result = insufficientResult(evaluationId, challenge.id, assessment, player.difficulty);
      db.prepare("UPDATE evaluations SET status = ?, result_json = ?, updated_at = ? WHERE id = ?")
        .run(result.status, JSON.stringify(result), new Date().toISOString(), evaluationId);
      return c.json(result);
    }

    const total = assessment.scores.accuracy + assessment.scores.clarity + assessment.scores.fluency;
    const transaction = db.transaction(() => {
      const existingValid = db.prepare('SELECT overall, provider, model FROM valid_attempts WHERE challenge_id = ? ORDER BY created_at DESC LIMIT 1')
        .get(challenge.id) as { overall: number; provider: string; model: string } | undefined;
      const firstValid = !existingValid;
      const retryComparison = existingValid && existingValid.provider === evaluator.provider && existingValid.model === evaluator.model
        ? { previousScore: existingValid.overall, improvedBy: total - existingValid.overall }
        : null;
      const retryBonusAvailable = challenge.retry_bonus_awarded === 0;
      const retryBonus = Boolean(retryComparison && retryComparison.improvedBy >= GAMEPLAY_CONFIG.xp.retryImprovement && retryBonusAvailable);
      const completedAt = new Date().toISOString();
      const result = {
        id: evaluationId,
        challengeId: challenge.id,
        status: 'valid' as const,
        transcript: assessment.transcript,
        scores: { ...assessment.scores, total },
        evidence: assessment.evidence,
        feedback: assessment.feedback,
        retryComparison,
        battle: null as null | Record<string, unknown>,
        xpAwarded: 0,
        difficulty: player.difficulty,
      };

      db.prepare(`UPDATE evaluations SET status = 'valid', result_json = ?, updated_at = ? WHERE id = ?`)
        .run('{}', completedAt, evaluationId);
      db.prepare(`INSERT INTO valid_attempts(id, player_id, session_id, challenge_id, evaluation_id, overall, accuracy, clarity, fluency, provider, model, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(randomUUID(), player.id, challenge.session_id, challenge.id, evaluationId, total, assessment.scores.accuracy,
          assessment.scores.clarity, assessment.scores.fluency, evaluator.provider, evaluator.model, completedAt);

      let xpAwarded = 0;
      if (firstValid) {
        const firstChallengeReward = calculateXp(total, true, false);
        xpAwarded += issueXp(db, player.id, GAMEPLAY_CONFIG.xp.challengeComplete, 'challenge-complete', challenge.id, completedAt);
        const highScoreReward = firstChallengeReward - GAMEPLAY_CONFIG.xp.challengeComplete;
        if (highScoreReward > 0) xpAwarded += issueXp(db, player.id, highScoreReward, 'high-score', challenge.id, completedAt);
        db.prepare('UPDATE practice_sessions SET valid_challenges = valid_challenges + 1 WHERE id = ?').run(challenge.session_id);
      } else if (retryBonus) {
        xpAwarded += issueXp(db, player.id, calculateXp(total, false, true), 'retry-improvement', challenge.id, completedAt);
        db.prepare('UPDATE challenges SET retry_bonus_awarded = 1 WHERE id = ?').run(challenge.id);
      }

      const session = db.prepare('SELECT valid_challenges, goal_awarded FROM practice_sessions WHERE id = ?')
        .get(challenge.session_id) as { valid_challenges: number; goal_awarded: number };
      const sessionGoalReward = awardSessionGoal(session.valid_challenges, session.goal_awarded === 1);
      const goalXp = sessionGoalReward > 0
        ? issueXp(db, player.id, sessionGoalReward, 'session-goal', challenge.session_id, completedAt)
        : 0;
      xpAwarded += goalXp;
      if (goalXp) db.prepare('UPDATE practice_sessions SET goal_awarded = 1 WHERE id = ?').run(challenge.session_id);

      const validScores = (db.prepare('SELECT overall FROM valid_attempts WHERE player_id = ? ORDER BY created_at DESC LIMIT 10')
        .all(player.id) as Array<{ overall: number }>).map((row) => row.overall).reverse();
      const decision = adjustDifficulty(player.difficulty, validScores);
      if (decision.next !== player.difficulty) db.prepare('UPDATE players SET difficulty = ? WHERE id = ?').run(decision.next, player.id);
      result.difficulty = decision.next;

      let currentXp = getPlayer(db, player.id).xp;
      if (challenge.battle_id && challenge.attack_applied === 0) {
        const battle = getBattleRow(db, challenge.battle_id, player.id);
        if (battle && battle.status === 'active') {
          const resolution = resolveAttack({
            bossHp: battle.boss_hp,
            playerEnergy: battle.player_energy,
            status: battle.status,
            brokenRhythm: battle.broken_rhythm === 1,
            guardBreak: battle.guard_break === 1,
            validAttacks: battle.valid_attacks,
          }, total);
          const attackId = randomUUID();
          const attackResponse = {
            id: battle.id,
            attemptId: attackId,
            attackApplied: true,
            status: resolution.state.status,
            bossHp: resolution.state.bossHp,
            playerEnergy: resolution.state.playerEnergy,
            phase: resolution.phase,
            damage: resolution.damage,
            tier: resolution.tier,
            brokenRhythm: resolution.state.brokenRhythm,
            guardBreak: resolution.state.guardBreak,
            validAttacks: resolution.state.validAttacks,
            xpAwarded,
          };
          db.prepare(`UPDATE battles SET status = ?, boss_hp = ?, player_energy = ?, broken_rhythm = ?, guard_break = ?, valid_attacks = ?, updated_at = ? WHERE id = ?`)
            .run(resolution.state.status, resolution.state.bossHp, resolution.state.playerEnergy, Number(resolution.state.brokenRhythm),
              Number(resolution.state.guardBreak), resolution.state.validAttacks, completedAt, battle.id);
          db.prepare('UPDATE challenges SET attack_applied = 1 WHERE id = ?').run(challenge.id);
          db.prepare(`INSERT INTO attacks(id, battle_id, challenge_id, evaluation_id, damage, tier, response_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(attackId, battle.id, challenge.id, evaluationId, resolution.damage, resolution.tier, JSON.stringify(attackResponse), completedAt);
          const updatedBattle = getBattleRow(db, battle.id, player.id)!;
          result.battle = toBattle(updatedBattle, currentXp, decision.next) as unknown as Record<string, unknown>;
          result.battle.attemptId = attackId;
          result.battle.attackApplied = true;
          result.battle.damage = resolution.damage;
          result.battle.tier = resolution.tier;
          result.battle.xpAwarded = xpAwarded;
        }
      }
      if (challenge.battle_id && !result.battle) {
        const currentBattle = getBattleRow(db, challenge.battle_id, player.id);
        if (currentBattle) {
          result.battle = {
            ...toBattle(currentBattle, currentXp, decision.next),
            attemptId: null,
            attackApplied: false,
            damage: 0,
            tier: null,
            xpAwarded,
          };
        }
      }
      currentXp = getPlayer(db, player.id).xp;
      result.xpAwarded = xpAwarded;
      if (result.battle) result.battle.playerXp = currentXp;

      const parsedResult = evaluationResultSchema.parse(result);
      db.prepare('UPDATE evaluations SET result_json = ? WHERE id = ?').run(JSON.stringify(parsedResult), evaluationId);
      return parsedResult;
    });

    try {
      const result = transaction();
      return c.json(result);
    } catch {
      const result = emptyResult(evaluationId, challenge.id, 'evaluation_error', 'The result could not be saved. No game state was changed. Please record again.', player.difficulty);
      try {
        db.prepare('UPDATE evaluations SET status = ?, result_json = ?, updated_at = ? WHERE id = ?')
          .run(result.status, JSON.stringify(result), new Date().toISOString(), evaluationId);
        return c.json(result);
      } catch {
        return c.json(apiError('evaluation_commit_failed', 'The result could not be saved. No game state was changed. Please record again.', true), 503);
      }
    }
  });

  app.get('/api/v1/progress', (c) => {
    const player = getPlayer(db, c.get('playerId'));
    const attempts = db.prepare('SELECT overall, accuracy, clarity, fluency, created_at FROM valid_attempts WHERE player_id = ? ORDER BY created_at DESC')
      .all(player.id) as Array<{ overall: number; accuracy: number; clarity: number; fluency: number; created_at: string }>;
    const skills = getSkillSummary(attempts);
    const lastBattle = db.prepare("SELECT status, created_at, valid_attacks FROM battles WHERE player_id = ? AND status != 'active' ORDER BY updated_at DESC LIMIT 1")
      .get(player.id) as { status: 'victory' | 'defeat'; created_at: string; valid_attacks: number } | undefined;
    const recentScores = attempts.slice(0, 7).reverse().map((row) => ({ score: row.overall, createdAt: row.created_at }));
    const result = progressSchema.parse({
      xp: player.xp,
      rank: getRank(player.xp),
      difficulty: player.difficulty,
      validAttempts: attempts.length,
      averageScore: attempts.length ? attempts.reduce((sum, row) => sum + row.overall, 0) / attempts.length : null,
      strongestSkill: skills.strongestSkill,
      recurringIssue: mostCommonIssue(db, player.id),
      recentScores,
      lastBattle: lastBattle ? { status: lastBattle.status, createdAt: lastBattle.created_at, validAttacks: lastBattle.valid_attacks } : null,
    });
    return c.json(result);
  });

  app.get('/api/v1/sessions/:id/review', (c) => {
    const player = getPlayer(db, c.get('playerId'));
    const sessionId = c.req.param('id');
    const session = db.prepare('SELECT id, mode, valid_challenges FROM practice_sessions WHERE id = ? AND player_id = ?')
      .get(sessionId, player.id) as { id: string; mode: 'practice' | 'battle'; valid_challenges: number } | undefined;
    if (!session) return c.json(apiError('session_not_found', 'Session was not found.'), 404);
    const attempts = db.prepare('SELECT overall, accuracy, clarity, fluency, created_at FROM valid_attempts WHERE player_id = ? AND session_id = ? ORDER BY created_at')
      .all(player.id, sessionId) as Array<{ overall: number; accuracy: number; clarity: number; fluency: number; created_at: string }>;
    const scores = attempts.map((row) => row.overall);
    const half = Math.floor(scores.length / 2);
    const early = scores.slice(0, half);
    const late = scores.slice(half);
    const delta = early.length && late.length
      ? late.reduce((sum, score) => sum + score, 0) / late.length - early.reduce((sum, score) => sum + score, 0) / early.length
      : 0;
    const skills = getSkillSummary(attempts);
    const xp = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM xp_ledger
      WHERE player_id = ? AND (source_id = ? OR source_id IN (SELECT id FROM challenges WHERE session_id = ?))`)
      .get(player.id, sessionId, sessionId) as { total: number };
    const goal = session.valid_challenges >= GAMEPLAY_CONFIG.sessionGoalValidChallenges
      ? 'Continue with the next practice session.'
      : 'Complete five valid challenges to finish this session goal.';
    return c.json(sessionReviewSchema.parse({
      id: session.id,
      mode: session.mode,
      validChallenges: session.valid_challenges,
      averageScore: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null,
      bestScore: scores.length ? Math.max(...scores) : null,
      trend: scores.length < 2 ? 'not_enough_data' : delta >= 3 ? 'up' : delta <= -3 ? 'down' : 'steady',
      strongestSkill: skills.strongestSkill,
      recurringIssue: mostCommonIssue(db, player.id, sessionId),
      nextGoal: goal,
      xpAwarded: xp.total,
    }));
  });

  app.notFound((c) => c.json(apiError('not_found', 'The requested SayStrike API route was not found.'), 404));
  app.onError((error, c) => {
    if (error.name === 'BodyLimitError') return c.json(apiError('upload_too_large', 'Recording exceeds the upload limit.', false), 413);
    console.error(`[api] ${c.req.method} ${c.req.path}: ${error.name}`);
    return c.json(apiError('internal_error', 'The server could not complete the request.', true), 500);
  });
  return app;
}

