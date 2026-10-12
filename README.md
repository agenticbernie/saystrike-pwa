# SayStrike

Mobile-first English speaking practice as a dark synthwave arcade game. The API owns speech-result validation, progression, battle state, damage, and XP; the web client displays reconciled server results.

## Requirements

- Node.js 22.12 or newer (verified in this workspace with Node 24.21.0)
- npm 10 or newer
- `ffprobe` for regenerating the verified audio manifest
- Optional `OPENAI_API_KEY` in the API environment for real speech evaluation

## Local demo

```sh
npm ci
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
npm run dev
```

Open <http://localhost:5173>. The API starts separately at <http://localhost:8787>. Practice and battle creation work without provider credentials; recording evaluation clearly reports that server configuration is needed. Set `OPENAI_API_KEY` in `apps/api/.env` to enable the real evaluator. Never put that key in `apps/web/.env` or a `VITE_*` variable.

The app creates its SQLite database at `data/saystrike.sqlite`; raw audio is not retained. To run each service independently, use `npm run dev:web` or `npm run dev:api` in separate terminals. See each workspace `package.json` for `start`, `build`, and `typecheck` commands.

## Quality checks

```sh
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```

`npm run test:e2e` runs the four viewport checks at 360×800, 390×844, 430×932, and 1280×900 using Chromium. Set `CHROMIUM_PATH` if the system Chromium executable is elsewhere. The build synchronizes verified sound effects and creates the service worker/PWA assets.

## Configuration

API settings are documented in `apps/api/.env.example`. `WEB_ORIGIN` must be the exact browser origin for credentialed API requests. `DATABASE_PATH` is resolved relative to the repository root (or may be an absolute path); production must mount a persistent writable volume. `OPENAI_AUDIO_MODEL` defaults to the verified `gpt-audio-1.5` model. Frontend `VITE_API_BASE_URL` is a public API origin only, or empty for same-origin `/api/v1` (with a Vite development proxy).

## Assets and design

The existing Stitch design project and implementation mapping are documented in `docs/stitch-handoff.md`. Audio source files remain untouched in `audio/`; `docs/audio-manifest.json` records verified metadata, usage mappings, and the missing-license note. The supplied collection contains sound effects but no soundtrack, so music stays silent until licensed Suno tracks are added.

## Product and deployment notes

`docs/product-brief.md` is canonical. `docs/implementation-notes.md` records the score/provider policy, centralized game assumptions, persistence, PWA behavior, and constraints. The evaluator is an MVP coaching signal, not a scientifically validated speaking assessment. Evaluation and battle resolution need the API; offline mode can load the cached application shell and static resources only.
