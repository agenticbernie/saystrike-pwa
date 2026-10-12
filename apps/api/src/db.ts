import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

export type SqliteDatabase = Database.Database;

export function createDatabase(path: string): SqliteDatabase {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('foreign_keys = ON');
  if (path !== ':memory:') db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      xp INTEGER NOT NULL DEFAULT 0,
      difficulty INTEGER NOT NULL DEFAULT 1 CHECK(difficulty BETWEEN 1 AND 5),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS browser_sessions (
      token_hash TEXT PRIMARY KEY,
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS practice_sessions (
      id TEXT PRIMARY KEY,
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      mode TEXT NOT NULL CHECK(mode IN ('practice', 'battle')),
      goal_awarded INTEGER NOT NULL DEFAULT 0,
      valid_challenges INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      ended_at TEXT
    );
    CREATE TABLE IF NOT EXISTS battles (
      id TEXT PRIMARY KEY,
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL UNIQUE REFERENCES practice_sessions(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK(status IN ('active', 'victory', 'defeat')),
      boss_hp INTEGER NOT NULL CHECK(boss_hp BETWEEN 0 AND 100),
      player_energy INTEGER NOT NULL CHECK(player_energy BETWEEN 0 AND 3),
      broken_rhythm INTEGER NOT NULL DEFAULT 0,
      guard_break INTEGER NOT NULL DEFAULT 0,
      valid_attacks INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS challenges (
      id TEXT PRIMARY KEY,
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
      battle_id TEXT REFERENCES battles(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL,
      target_text TEXT NOT NULL,
      category TEXT NOT NULL,
      difficulty INTEGER NOT NULL CHECK(difficulty BETWEEN 1 AND 5),
      created_at TEXT NOT NULL,
      attack_applied INTEGER NOT NULL DEFAULT 0,
      retry_bonus_awarded INTEGER NOT NULL DEFAULT 0,
      skipped INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS challenges_player_recent ON challenges(player_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS evaluations (
      id TEXT PRIMARY KEY,
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
      idempotency_key TEXT NOT NULL,
      status TEXT NOT NULL,
      result_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(player_id, idempotency_key)
    );
    CREATE INDEX IF NOT EXISTS evaluations_challenge ON evaluations(challenge_id, created_at);
    CREATE TABLE IF NOT EXISTS valid_attempts (
      id TEXT PRIMARY KEY,
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
      challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
      evaluation_id TEXT NOT NULL UNIQUE REFERENCES evaluations(id) ON DELETE CASCADE,
      overall INTEGER NOT NULL CHECK(overall BETWEEN 0 AND 100),
      accuracy INTEGER NOT NULL CHECK(accuracy BETWEEN 0 AND 40),
      clarity INTEGER NOT NULL CHECK(clarity BETWEEN 0 AND 35),
      fluency INTEGER NOT NULL CHECK(fluency BETWEEN 0 AND 25),
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS valid_attempts_player_recent ON valid_attempts(player_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS attacks (
      id TEXT PRIMARY KEY,
      battle_id TEXT NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
      challenge_id TEXT NOT NULL UNIQUE REFERENCES challenges(id) ON DELETE CASCADE,
      evaluation_id TEXT NOT NULL UNIQUE REFERENCES evaluations(id) ON DELETE CASCADE,
      damage INTEGER NOT NULL,
      tier TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS xp_ledger (
      id TEXT PRIMARY KEY,
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      idempotency_key TEXT NOT NULL,
      amount INTEGER NOT NULL CHECK(amount >= 0),
      reason TEXT NOT NULL,
      source_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(player_id, idempotency_key),
      UNIQUE(player_id, reason, source_id)
    );
  `);
  return db;
}

export function issueBrowserSession(db: SqliteDatabase): { token: string; playerId: string } {
  const token = randomBytes(32).toString('base64url');
  const playerId = crypto.randomUUID();
  const now = new Date().toISOString();
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365).toISOString();
  const transaction = db.transaction(() => {
    db.prepare('INSERT INTO players(id, created_at) VALUES (?, ?)').run(playerId, now);
    db.prepare('INSERT INTO browser_sessions(token_hash, player_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(tokenHash, playerId, expiresAt, now);
  });
  transaction();
  return { token, playerId };
}

export function findBrowserSession(db: SqliteDatabase, token: string): string | null {
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const row = db.prepare('SELECT player_id FROM browser_sessions WHERE token_hash = ? AND expires_at > ?')
    .get(tokenHash, new Date().toISOString()) as { player_id: string } | undefined;
  return row?.player_id ?? null;
}
