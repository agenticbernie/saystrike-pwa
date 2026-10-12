# SayStrike implementation notes

## Architecture

- npm workspaces with TypeScript, `packages/shared` Zod schemas, `apps/web` Vite + React PWA, and independently runnable `apps/api` Hono/Node server.
- REST API is versioned under `/api/v1`. SQLite (`better-sqlite3`) persists anonymous guest profiles, battles, challenges, evaluations, valid attempts, and an idempotent XP ledger. The database file defaults to `data/saystrike.sqlite` in the repository root.
- The browser receives an HttpOnly, SameSite=Lax opaque guest cookie; only a hash of the token is stored. Authentication is intentionally anonymous because the brief does not request accounts.
- Evaluations and game transitions are calculated/validated in the API. Transactions guard XP, attacks, and battle updates; evaluation idempotency keys prevent duplicate submissions from applying twice. Each server-created attack has an `attemptId`.
- Recordings are captured locally into mono PCM16 WAV at 24 kHz, submitted only on completion, sent to the evaluator in memory, and never persisted or logged by SayStrike. The evaluation record contains scores/transcript/evidence/feedback. Provider-side retention is governed by provider policies; requests set `store: false`.

## Speech provider

The adapter is provider-independent at its interface and currently targets the verified OpenAI Chat Completions audio input contract with `gpt-audio-1.5`. That model accepts audio input but does not support Structured Outputs; the server requests a JSON object and validates its response with Zod before accepting it. Scores are server-summed from 40/35/25 subscores. The evaluator does not request confidence values, claim phoneme precision, or penalize accent. An output without enough audible evidence becomes `insufficient_evidence`; malformed/unavailable provider responses become `evaluation_error`.

Required secret: `OPENAI_API_KEY`, set only in the API server environment. Optional server settings are `OPENAI_AUDIO_MODEL` (default `gpt-audio-1.5`), `OPENAI_TIMEOUT_MS`, `PORT`, `WEB_ORIGIN`, `DATABASE_PATH`, and `NODE_ENV`. The frontend must not receive the provider key. No production provider call has been made as part of build validation unless separately reported after a credential-backed check.

The prompt-based score is an MVP coaching signal, not a validated language proficiency or accent assessment. Evaluate this instrument with learners before making stronger claims.

## Initial game policy

The brief defines energy losses and debuffs but asks that lower-tier damage be centralized for later playtests. Until a damage multiplier is agreed, all valid nonzero scores use `round(30 × score / 100)`; a score of zero does zero damage. Broken Rhythm and Guard Break are persisted backend flags; the brief defines no numeric combo bonus or further Guard Break penalty, so no extra damage/penalty is applied. Session goal size is five valid distinct challenges, following the brief's “about 5–10” review cadence. Rank labels and initial thresholds (200/500 XP) are centralized in `GAMEPLAY_CONFIG` pending playtest tuning.

Retries on the same battle sentence return the current authoritative battle snapshot but set `attackApplied: false` and `attemptId: null`; they can only earn the single comparable +5 retry reward. They never modify HP, energy, phase, debuffs, or attack count.

## Audio inventory

Run `npm run sync:audio` to inspect all source files with `ffprobe`, write `docs/audio-manifest.json`, and copy only mapped effects into the web public directory. The current source contains 416 Ogg/Vorbis files and no soundtrack. Chosen files are effects only. No provenance or license file was present, so distribution rights need confirmation with the supplier. There are no generated or placeholder music assets. Music controls remain visibly unavailable until real licensed tracks are supplied; the controller's music path supports ducking to 20% linear gain (about −14 dB) when tracks are later configured.

## PWA, browser, and network behavior

The service worker caches the app shell, hashed static assets, fonts, and selected public effects; it does not cache API responses or user audio. Direct navigation falls back to the cached app shell. The app can render offline, while evaluation, battle creation/resolution, and persisted reviews report that the API connection is required. Microphone access requires a secure context (HTTPS or localhost) and browser permission. WAV input avoids dependence on browser-specific WebM/Opus encoders. Ogg playback still depends on the browser's Ogg/Vorbis decoder; effects fail silently if a browser declines playback.

## Verified API and design references

- [OpenAI GPT-Audio-1.5 model](https://developers.openai.com/api/docs/models/gpt-audio-1.5)
- [OpenAI audio in Chat Completions](https://developers.openai.com/api/docs/guides/audio-chat-completions)
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)
- [Hono Node.js guide](https://hono.dev/docs/getting-started/nodejs)
- [Vite guide](https://vite.dev/guide/)
