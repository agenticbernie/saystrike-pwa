import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { createDatabase, type SqliteDatabase } from '../src/db.js';
import type { ApiConfig } from '../src/config.js';
import type { ProviderAssessment, SpeechEvaluator } from '../src/services/evaluator.js';

const config: ApiConfig = {
  port: 8787,
  webOrigin: 'http://localhost:5173',
  databasePath: ':memory:',
  openAiApiKey: 'test-only',
  openAiAudioModel: 'gpt-audio-1.5',
  openAiTimeoutMs: 10_000,
  maxUploadBytes: 2_000_000,
  environment: 'test',
};

const goodAssessment: ProviderAssessment = {
  status: 'valid',
  transcript: 'We keep learning through practice.',
  scores: { accuracy: 36, clarity: 31, fluency: 21 },
  evidence: { accuracy: 'The key phrase is present.', clarity: 'The words are understandable.', fluency: 'The sentence is continuous.' },
  feedback: { strength: 'The key phrase was clear.', priorityIssue: 'There was a brief pause.', actionableTip: 'Link the final phrase.', retryTarget: 'Say the whole thought smoothly.' },
};

function makeWav(duration = 1) {
  const samples = 24_000 * duration;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(24_000, 24);
  buffer.writeUInt32LE(48_000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  return buffer;
}

function formFor(wav: Buffer, idempotencyKey = randomUUID()) {
  const form = new FormData();
  form.set('idempotencyKey', idempotencyKey);
  form.set('audio', new File([wav], 'utterance.wav', { type: 'audio/wav' }));
  return form;
}

describe('Hono API and authoritative state', () => {
  let db: SqliteDatabase;
  let assessment: ProviderAssessment;
  let evaluator: SpeechEvaluator;
  let app: ReturnType<typeof createApp>;
  let cookie = '';

  async function api(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set('Origin', config.webOrigin);
    if (cookie) headers.set('Cookie', cookie);
    return app.request(path, { ...init, headers });
  }

  async function battleChallenge() {
    const createResponse = await api('/api/v1/battles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const created = await createResponse.json() as { battle: { id: string; sessionId: string } };
    const challengeResponse = await api(`/api/v1/battles/${created.battle.id}/challenges`, { method: 'POST' });
    const challenge = await challengeResponse.json() as { id: string };
    return { battleId: created.battle.id, sessionId: created.battle.sessionId, challengeId: challenge.id };
  }

  beforeEach(async () => {
    db = createDatabase(':memory:');
    assessment = goodAssessment;
    evaluator = {
      provider: 'Test provider',
      model: 'test-model-v1',
      evaluate: vi.fn(async () => assessment),
    };
    app = createApp({ db, config, evaluator });
    const response = await api('/api/v1/session');
    expect(response.status).toBe(200);
    cookie = response.headers.get('set-cookie')!.split(';')[0]!;
  });

  afterEach(() => db.close());

  it('creates a battle, evaluates once, and reconciles an idempotent authoritative attack', async () => {
    const { battleId, challengeId } = await battleChallenge();
    const key = randomUUID();
    const first = await api(`/api/v1/challenges/${challengeId}/evaluate`, { method: 'POST', body: formFor(makeWav(), key) });
    expect(first.status).toBe(200);
    const result = await first.json() as { status: string; scores: { total: number }; battle: { id: string; attemptId: string; attackApplied: boolean; bossHp: number; playerEnergy: number; damage: number; tier: string; xpAwarded: number } };
    expect(result).toMatchObject({ status: 'valid', scores: { total: 88 }, battle: { id: battleId, attackApplied: true, bossHp: 74, playerEnergy: 3, damage: 26, tier: 'strong', xpAwarded: 25 } });
    expect(result.battle.attemptId).toMatch(/^[0-9a-f-]{36}$/i);

    const duplicate = await api(`/api/v1/challenges/${challengeId}/evaluate`, { method: 'POST', body: formFor(makeWav(), key) });
    expect(await duplicate.json()).toEqual(result);
    expect(evaluator.evaluate).toHaveBeenCalledTimes(1);
    const current = await api(`/api/v1/battles/${battleId}`);
    expect((await current.json()).battle).toMatchObject({ bossHp: 74, playerEnergy: 3, validAttacks: 1 });
  });

  it('allows a same-sentence retry for practice, awards improvement XP at most once, and never attacks twice', async () => {
    const { battleId, challengeId } = await battleChallenge();
    await api(`/api/v1/challenges/${challengeId}/evaluate`, { method: 'POST', body: formFor(makeWav()) });
    assessment = { ...goodAssessment, scores: { accuracy: 40, clarity: 35, fluency: 24 } };
    const retry = await api(`/api/v1/challenges/${challengeId}/evaluate`, { method: 'POST', body: formFor(makeWav()) });
    const result = await retry.json() as { battle: { attackApplied: boolean; attemptId: string | null; bossHp: number; playerEnergy: number; damage: number }; xpAwarded: number; retryComparison: { improvedBy: number } };
    expect(result).toMatchObject({ xpAwarded: 5, retryComparison: { improvedBy: 11 }, battle: { attackApplied: false, attemptId: null, bossHp: 74, playerEnergy: 3, damage: 0 } });
    await api(`/api/v1/challenges/${challengeId}/evaluate`, { method: 'POST', body: formFor(makeWav()) });
    const current = await api(`/api/v1/battles/${battleId}`);
    expect((await current.json()).battle).toMatchObject({ bossHp: 74, playerEnergy: 3, validAttacks: 1 });
    const progress = await api('/api/v1/progress');
    expect((await progress.json()).xp).toBe(30);
  });

  it('invalid speech evidence does not change battle state, valid attempts, or XP', async () => {
    const { battleId, challengeId } = await battleChallenge();
    assessment = { status: 'insufficient_evidence', transcript: null, reason: 'No clear speech could be heard.' };
    const response = await api(`/api/v1/challenges/${challengeId}/evaluate`, { method: 'POST', body: formFor(makeWav()) });
    expect(await response.json()).toMatchObject({ status: 'insufficient_evidence', xpAwarded: 0, battle: null });
    const current = await api(`/api/v1/battles/${battleId}`);
    expect((await current.json()).battle).toMatchObject({ bossHp: 100, playerEnergy: 3, validAttacks: 0 });
    expect((await (await api('/api/v1/progress')).json()).validAttempts).toBe(0);
  });

  it('accepts a supported zero score as a miss with no damage but the configured energy cost', async () => {
    const { battleId, challengeId } = await battleChallenge();
    assessment = {
      ...goodAssessment,
      transcript: 'Blue.',
      scores: { accuracy: 0, clarity: 0, fluency: 0 },
      evidence: { accuracy: 'The target words were not spoken.', clarity: 'The audible response was intelligible.', fluency: 'The response was brief but audible.' },
    };
    const response = await api(`/api/v1/challenges/${challengeId}/evaluate`, { method: 'POST', body: formFor(makeWav()) });
    expect(await response.json()).toMatchObject({ status: 'valid', scores: { total: 0 }, xpAwarded: 20, battle: { attackApplied: true, damage: 0, tier: 'miss', bossHp: 100, playerEnergy: 2, guardBreak: true } });
    const current = await api(`/api/v1/battles/${battleId}`);
    expect((await current.json()).battle).toMatchObject({ bossHp: 100, playerEnergy: 2, validAttacks: 1 });
  });

  it('rejects malformed audio as a recoverable error without calling the evaluator', async () => {
    const { challengeId } = await battleChallenge();
    const response = await api(`/api/v1/challenges/${challengeId}/evaluate`, { method: 'POST', body: formFor(Buffer.from('not audio')) });
    expect(await response.json()).toMatchObject({ status: 'audio_error', xpAwarded: 0, scores: { total: null } });
    expect(evaluator.evaluate).not.toHaveBeenCalled();
  });

  it('enforces origin restrictions and does not store raw recordings', async () => {
    const response = await app.request('/api/v1/session', { headers: { Origin: 'https://untrusted.invalid' } });
    expect(response.status).toBe(403);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%audio%'").all()).toEqual([]);
  });
});
