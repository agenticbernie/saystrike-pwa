# Deployment outline

1. Run `npm ci`, provide `OPENAI_API_KEY` as an API-only runtime secret, and run `npm run build`.
2. Serve `apps/web/dist` from an HTTPS static host with SPA navigation fallback to `/index.html`.
3. Run `npm run start --workspace @saystrike/api` on Node 22.12 or newer. Point `DATABASE_PATH` to a persistent writable disk; the default is `data/saystrike.sqlite` in the repository root.
4. Prefer a same-origin reverse proxy for `/api/*` to the Hono server. Set `WEB_ORIGIN` to the exact public frontend origin. If the API is hosted separately, set `VITE_API_BASE_URL` when building the frontend and use same-site HTTPS origins so the guest cookie can be sent with credentialed CORS.
5. Monitor `GET /health` and `GET /api/v1/health`. The latter reports evaluator configuration but never returns credentials.

The current SQLite adapter is designed for one API instance with a persistent volume. Do not run multiple replicas against separate local SQLite files and expect shared player state. Before public launch, configure database backups, provider usage controls, and a retention/deletion policy for anonymous evaluation history. No public account or delete-data flow is included because the product brief does not specify either.

The frontend does not include any provider credential. Search the production `apps/web/dist` output if adding environment tooling or changing the build pipeline.
