import 'dotenv/config';
import { serve } from '@hono/node-server';
import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { createDatabase } from './db.js';

const config = loadConfig();
const db = createDatabase(config.databasePath);
const app = createApp({ config, db });
const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.info(`SayStrike API listening on http://localhost:${info.port}`);
  console.info(`Speech evaluation: ${config.openAiApiKey ? 'configured' : 'not configured'}`);
});

const shutdown = () => server.close(() => {
  db.close();
  process.exit(0);
});
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
