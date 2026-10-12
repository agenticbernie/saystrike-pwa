import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ApiConfig {
  port: number;
  webOrigin: string;
  databasePath: string;
  openAiApiKey: string | undefined;
  openAiAudioModel: string;
  openAiTimeoutMs: number;
  maxUploadBytes: number;
  environment: 'development' | 'test' | 'production';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const port = Number(env.PORT ?? 8787);
  const openAiTimeoutMs = Number(env.OPENAI_TIMEOUT_MS ?? 30_000);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('PORT must be a valid TCP port.');
  if (!Number.isInteger(openAiTimeoutMs) || openAiTimeoutMs < 1_000 || openAiTimeoutMs > 120_000) {
    throw new Error('OPENAI_TIMEOUT_MS must be between 1000 and 120000.');
  }

  const environment = env.NODE_ENV === 'production' || env.NODE_ENV === 'test' ? env.NODE_ENV : 'development';
  const configuredDbPath = env.DATABASE_PATH ?? './data/saystrike.sqlite';

  return {
    port,
    webOrigin: env.WEB_ORIGIN ?? 'http://localhost:5173',
    databasePath: configuredDbPath === ':memory:' ? configuredDbPath : resolve(dirname(fileURLToPath(import.meta.url)), '../../..', configuredDbPath),
    openAiApiKey: env.OPENAI_API_KEY || undefined,
    openAiAudioModel: env.OPENAI_AUDIO_MODEL ?? 'gpt-audio-1.5',
    openAiTimeoutMs,
    maxUploadBytes: 2_000_000,
    environment,
  };
}
