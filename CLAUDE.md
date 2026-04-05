# CLAUDE.md - Reliable Recording Chunking Pipeline + Transcription

> **ALWAYS use year 2026 for all searches, docs, and references.**

## Project Overview

Hackathon project: reliable audio recording chunking pipeline with speaker-diarized transcription.
No live transcription — batch processing of recorded/uploaded audio with speaker identification.
Audio can be 1 hour, 5 hours, or longer. Must be scalable, reliable, accurate, lightweight, and fast.

---

## Mandatory Tech Stack (ALL MUST BE USED)

| Layer | Technology | Status | Role |
|-------|-----------|--------|------|
| Monorepo | **Turborepo** | In repo | Build orchestration |
| Frontend | **Next.js 16** (App Router, React 19) | In repo | UI, SSR, routing |
| Backend | **Hono** on **Bun** runtime | In repo | HTTP API server |
| API Layer | **tRPC** + **Zod** | NEEDS ADDING | Type-safe client-server RPC via `@hono/trpc-server` |
| Database | **Drizzle ORM** + **PostgreSQL** | In repo (schema empty) | Persistence, ack tracking |
| Object Storage | **MinIO** (S3-compatible) | NEEDS ADDING | Audio chunk + full file storage |
| UI | **shadcn/ui** + TailwindCSS 4 | In repo | Component library |
| Validation | **Zod 4** | In repo | Schema validation everywhere |

### Additional Stack

| Layer | Technology | Role |
|-------|-----------|------|
| Transcription API | **Groq Whisper large-v3-turbo** ($0.04/hr) | ASR — 216x real-time, word timestamps |
| Speaker Diarization | **pyannote community-1** (pyannote.audio 4.0) | Best open-source diarization 2026, beats 3.1 |
| Fallback ASR | Self-hosted WhisperX (faster-whisper + pyannote) | Offline/cost-free alternative |
| Queue | **BullMQ** v4.11 + **Redis** 7.0 | Job processing for transcription |
| Load Testing | **k6** | 300K request validation at 5K req/s |
| Testing | **Vitest** + **Playwright** | Unit/integration/E2E |
| Code Quality | **Ultracite** (oxlint + oxfmt) | Linting/formatting (per AGENTS.md) |

---

## Transcription Strategy (2026 Research)

### Primary: Groq Whisper API + pyannote community-1

| Aspect | Detail |
|--------|--------|
| ASR Model | Groq `whisper-large-v3-turbo` — 809M params, 216x real-time |
| Cost | $0.04/hour of audio |
| Speed | 60 min audio transcribed in ~17 seconds |
| WER | ~5-8% (comparable to large-v3) |
| Diarization | pyannote `community-1` (pyannote.audio 4.0) — runs locally as Python sidecar |
| Why not Groq diarization? | Groq lists diarization support but docs lack explicit speaker label params — pyannote community-1 is proven, SOTA |
| Long audio (1-5hr) | Split into <=25MB chunks for Groq API (their file size limit), transcribe each, merge with timestamps |
| Speaker continuity | pyannote runs on FULL reconstructed audio from MinIO — speaker IDs consistent across entire recording |

### Fallback: Self-hosted WhisperX

| Aspect | Detail |
|--------|--------|
| Model | faster-whisper large-v3-turbo + pyannote community-1 |
| When to use | If Groq is down, rate-limited, or cost is a concern |
| Infra | Python FastAPI sidecar in Docker, GPU optional (CPU works, slower) |

### Why NOT these alternatives (2026 evaluation)

| Model | Why rejected |
|-------|-------------|
| VibeVoice-ASR (9B params) | Too heavy — needs 14GB+ VRAM, not lightweight |
| Qwen3-ASR (SOTA 5.63% WER) | No built-in diarization, would need separate pyannote anyway |
| Deepgram Nova-3 | $0.46/hr — 11x more expensive than Groq |
| AssemblyAI | Not self-hostable, vendor lock-in |
| NVIDIA Parakeet | No diarization built-in, needs separate pipeline |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    BROWSER (Next.js)                     │
│                                                         │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────┐ │
│  │ Mic Rec  │  │ File Upload  │  │ OPFS Buffer       │ │
│  │ (16kHz)  │  │ (1-5hr WAV)  │  │ (durable chunks)  │ │
│  └────┬─────┘  └──────┬────��──┘  └────────┬──────────┘ │
│       └───────┬────────┘                   │            │
│               ▼                            │            │
│  ┌────────────────────────┐                │            │
│  │ Chunk + SHA-256 hash   │◄───────────────┘            │
│  │ Upload via Hono POST   │  (retry w/ backoff)         │
│  │ Status via tRPC query  │                             │
│  └────────────┬───────────┘                             │
└───────────────┼─────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────┐
│                 HONO + tRPC SERVER (Bun)                 │
│                                                         │
│  Raw Hono routes:          tRPC routes (@hono/trpc):    │
│  ├─ POST /upload/chunk     ├─ session.create            │
│  ├─ POST /upload/file      ├─ session.getStatus         │
│  └─ GET /health            ├─ chunk.getStatus           │
│                            ├─ chunk.ack                 │
│                            ├─ transcript.get            │
│                            ├─ transcript.trigger        │
│                            └─ reconcile.run             │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌────────────────────┐    ���
│  │  MinIO   │  │ Postgres │  │  BullMQ + Redis    │    │
│  │ (chunks) │  │ (Drizzle)│  │  (job queue)       │    │
│  └──────────┘  └──────────┘  └─────────┬──────────┘    │
└────────────────────────────────────────┼────────────────┘
                                         │
                ┌────────────────────────┘
                ▼
┌─────────────────────────────────────────────────────────┐
│              TRANSCRIPTION WORKER (BullMQ)               │
│                                                         │
│  1. Fetch all chunks from MinIO for session             │
│  2. Concatenate into full audio (FFmpeg)                │
│  3. Send to Groq Whisper API (or self-hosted WhisperX)  │
│  4. Run pyannote community-1 on full audio (diarization)│
│  5. Align ASR timestamps with speaker segments          │
│  6. Store transcript segments in Postgres via Drizzle   │
│  7. Update session status → completed                   │
└─────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
apps/
  web/              # Next.js 16 frontend
    src/
      app/
        page.tsx                # Home / dashboard
        recorder/page.tsx       # Mic recording (existing, enhance)
        upload/page.tsx         # NEW: file upload page
        sessions/[id]/page.tsx  # NEW: session detail + transcript
      hooks/
        use-recorder.ts         # Existing: 16kHz WAV chunking
        use-opfs.ts             # NEW: OPFS read/write/manifest
        use-chunk-uploader.ts   # NEW: upload with retry + checksum
        use-reconciliation.ts   # NEW: client-side reconciliation
      components/
        audio-upload.tsx        # NEW: drag-drop file upload
        chunk-status-list.tsx   # NEW: per-chunk upload status
        transcript-view.tsx     # NEW: speaker-labeled transcript
        session-list.tsx        # NEW: all sessions list
      lib/
        trpc.ts                 # NEW: tRPC client setup
  server/             # Hono + tRPC on Bun
    src/
      index.ts                  # Existing: enhance with tRPC mount
      routes/
        upload.ts               # NEW: raw Hono multipart upload routes
      trpc/
        context.ts              # NEW: tRPC context (db, minio, redis)
        router.ts               # NEW: mount all tRPC routers
      services/
        minio.ts                # NEW: MinIO S3 client
        queue.ts                # NEW: BullMQ queue + workers
        transcription.ts        # NEW: Groq API + pyannote orchestration
      workers/
        transcribe.ts           # NEW: BullMQ worker for transcription jobs
    __tests__/                  # NEW: Vitest tests (TDD)
services/
  diarization/        # NEW: Python pyannote community-1 sidecar
    server.py                   # FastAPI with /diarize endpoint
    Dockerfile
    requirements.txt
packages/
  trpc/               # NEW: shared tRPC router + Zod schemas
    src/
      router/
        session.ts              # Session CRUD procedures
        chunk.ts                # Chunk status/ack procedures
        transcript.ts           # Transcript query/trigger procedures
        reconciliation.ts       # Reconciliation procedures
      schemas/
        session.ts              # Zod: session schemas
        chunk.ts                # Zod: chunk schemas
        transcript.ts           # Zod: transcript schemas
      context.ts                # tRPC context type
      index.ts                  # AppRouter type export
  db/                 # Drizzle + Docker
    src/
      schema/
        index.ts                # Re-export all tables
        sessions.ts             # NEW: sessions table
        chunks.ts               # NEW: chunks table
        transcripts.ts          # NEW: transcripts table
        enums.ts                # NEW: status enums
    docker-compose.yml          # MODIFY: add MinIO + Redis
  env/                # MODIFY: add MinIO, Redis, Groq env vars
  ui/                 # Existing shadcn components
  config/             # Existing TypeScript config
load-tests/           # NEW: k6 scripts
  chunk-upload.js               # 300K requests at 5K req/s
  reconciliation.js             # Post-load integrity check
```

---

## Environment Variables

### Server (.env in apps/server/)
```
DATABASE_URL=postgresql://postgres:password@localhost:5432/my-better-t-app
CORS_ORIGIN=http://localhost:3001
NODE_ENV=development

# MinIO
MINIO_ENDPOINT=http://localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=audio-chunks

# Redis + BullMQ
REDIS_URL=redis://localhost:6379

# Transcription
GROQ_API_KEY=gsk_...
DIARIZATION_SIDECAR_URL=http://localhost:8000

# Fallback (self-hosted WhisperX)
ASR_SIDECAR_URL=http://localhost:8001
```

### Web (.env in apps/web/)
```
NEXT_PUBLIC_SERVER_URL=http://localhost:3000
```

---

## Database Schema (Drizzle)

### sessions
```
id              uuid PK default gen_random_uuid()
status          enum: idle | recording | uploading | transcribing | completed | error
sourceType      enum: mic | upload
totalChunks     integer nullable
totalDurationMs bigint nullable
fileName        text nullable (for uploads)
fileSizeBytes   bigint nullable
errorMessage    text nullable
createdAt       timestamp default now()
updatedAt       timestamp default now()
```

### chunks
```
id              uuid PK default gen_random_uuid()
sessionId       uuid FK → sessions.id ON DELETE CASCADE
index           integer NOT NULL
bucketKey       text NOT NULL
durationMs      integer NOT NULL
sizeBytes       integer NOT NULL
checksum        text NOT NULL (SHA-256)
status          enum: pending | uploaded | acked | error
errorMessage    text nullable
createdAt       timestamp default now()

UNIQUE(sessionId, index)
INDEX(sessionId, status)
```

### transcripts
```
id              uuid PK default gen_random_uuid()
sessionId       uuid FK → sessions.id ON DELETE CASCADE
speakerId       integer NOT NULL (Speaker 1, Speaker 2, ...)
startTime       real NOT NULL (seconds)
endTime         real NOT NULL (seconds)
content         text NOT NULL
confidence      real nullable
createdAt       timestamp default now()

INDEX(sessionId, startTime)
```

---

## Implementation Plan (8 Phases, TDD Throughout)

### Phase 0: Infrastructure Setup [Size: M]

**Files to create/modify:**
- `packages/db/docker-compose.yml` — add MinIO + Redis services
- `packages/env/src/server.ts` — add MinIO, Redis, Groq env vars
- `packages/trpc/package.json` — new package
- `packages/trpc/tsconfig.json`
- Root `package.json` — add workspace reference
- `turbo.json` — add trpc build task

**TDD:** None (infra only). Validate with `docker compose up` + connectivity checks.

**Dependencies:** None. Do this first.

---

### Phase 1: Database Schema [Size: S]

**Files to create:**
- `packages/db/src/schema/enums.ts` — status enums (pgEnum)
- `packages/db/src/schema/sessions.ts` — sessions table
- `packages/db/src/schema/chunks.ts` — chunks table
- `packages/db/src/schema/transcripts.ts` — transcripts table
- `packages/db/src/schema/index.ts` — re-export all

**TDD:**
- Test: schema compiles, `db:push` succeeds, CRUD operations work
- Test: unique constraint on (sessionId, index) rejects duplicates
- Test: FK cascade deletes chunks when session deleted
- **Target: 100% schema coverage**

**Dependencies:** Phase 0

---

### Phase 2: tRPC Package + Server Integration [Size: L]

**Files to create:**
- `packages/trpc/src/schemas/session.ts` — Zod schemas
- `packages/trpc/src/schemas/chunk.ts`
- `packages/trpc/src/schemas/transcript.ts`
- `packages/trpc/src/router/session.ts` — session procedures
- `packages/trpc/src/router/chunk.ts` — chunk procedures
- `packages/trpc/src/router/transcript.ts` — transcript procedures
- `packages/trpc/src/router/reconciliation.ts`
- `packages/trpc/src/context.ts` — context type
- `packages/trpc/src/index.ts` — AppRouter export

**Files to modify:**
- `apps/server/src/index.ts` — mount `@hono/trpc-server` middleware
- `apps/server/package.json` — add tRPC + Hono adapter deps

**Files to create (server):**
- `apps/server/src/trpc/context.ts` — create context from Hono req
- `apps/server/src/trpc/router.ts` — import + merge routers
- `apps/server/src/services/minio.ts` — S3 client for MinIO

**TDD:**
- Test: tRPC router compiles with correct types
- Test: each procedure validates input with Zod (invalid → error)
- Test: session.create returns valid session
- Test: chunk.getStatus returns correct status
- **Target: 90% router coverage**

**Dependencies:** Phase 1

---

### Phase 3: Core Chunking Pipeline — Server [Size: L]

**Files to create:**
- `apps/server/src/routes/upload.ts` — raw Hono: `POST /upload/chunk` (multipart), `POST /upload/file` (multipart, large files)
- `apps/server/src/services/minio.ts` — putObject, getObject, headObject, deleteObject
- `apps/server/src/__tests__/upload.test.ts`
- `apps/server/src/__tests__/minio.test.ts`
- `apps/server/src/__tests__/reconciliation.test.ts`

**Upload flow:**
1. Receive multipart chunk (sessionId, chunkIndex, checksum, file)
2. Compute SHA-256, verify matches provided checksum
3. Upload to MinIO: `{sessionId}/{chunkIndex}.wav`
4. Insert chunk record in Postgres via Drizzle (status: acked)
5. Return `{ success, chunkId, bucketKey }`

**Large file upload flow (1-5hr):**
1. `POST /upload/file` — stream large file directly to MinIO using multipart upload
2. Create session with sourceType: upload
3. Server-side splits into logical chunks (or stores as single object)
4. Triggers transcription immediately after upload complete

**Reconciliation:**
- Server-side: for each acked chunk in DB, HeadObject in MinIO. Missing → mark needs_reupload
- Client-side: query chunk statuses, re-upload from OPFS if needed

**TDD (write these FIRST):**
- Test: upload with valid checksum → 200 + acked in DB + exists in MinIO
- Test: upload with bad checksum → 400 + not stored
- Test: duplicate (sessionId, index) → idempotent (upsert or reject)
- Test: reconciliation detects missing MinIO object
- Test: reconciliation detects un-acked chunk
- Test: large file upload streams without OOM
- **Target: 85% coverage**

**Dependencies:** Phase 2

---

### Phase 4: Core Chunking Pipeline — Client [Size: L]

**Files to create:**
- `apps/web/src/hooks/use-opfs.ts` — OPFS read/write/manifest/clear
- `apps/web/src/hooks/use-chunk-uploader.ts` — upload with retry, backoff, checksum
- `apps/web/src/hooks/use-reconciliation.ts` — OPFS vs server ack comparison
- `apps/web/src/lib/trpc.ts` — tRPC client with TanStack Query
- `apps/web/src/lib/checksum.ts` — SHA-256 via SubtleCrypto

**Files to modify:**
- `apps/web/src/hooks/use-recorder.ts` — integrate OPFS writes (chunk → OPFS → upload)
- `apps/web/package.json` — add @trpc/react-query, @tanstack/react-query

**OPFS flow:**
1. On each chunk from recorder → write to OPFS: `{sessionId}/{chunkIndex}.wav`
2. Update manifest.json in OPFS
3. Upload chunk to server
4. On server ack → mark in manifest, clear from OPFS only after confirmed

**TDD:**
- Test: OPFS write/read roundtrip preserves audio data
- Test: manifest tracks all chunks correctly
- Test: uploader retries on network failure (mock fetch)
- Test: uploader stops after max retries
- Test: SHA-256 checksum matches server expectation
- Test: reconciliation re-uploads missing chunks
- Test: OPFS cleared only after both bucket + DB confirmed
- **Target: 80% coverage**

**Dependencies:** Phase 3 (needs server endpoints to upload to)

---

### Phase 5: Transcription Pipeline [Size: L]

**Files to create:**
- `apps/server/src/services/queue.ts` — BullMQ queue setup
- `apps/server/src/services/transcription.ts` — Groq API client + pyannote client
- `apps/server/src/workers/transcribe.ts` — BullMQ worker
- `apps/server/src/__tests__/transcription.test.ts`
- `services/diarization/server.py` — FastAPI pyannote sidecar
- `services/diarization/Dockerfile`
- `services/diarization/requirements.txt`

**Transcription flow:**
1. tRPC `transcript.trigger` → enqueue BullMQ job
2. Worker picks up job:
   a. Verify all chunks acked for session
   b. Download all chunks from MinIO in order
   c. Concatenate WAV files (use FFmpeg or raw PCM concat)
   d. For long audio (>25MB): split into <=25MB segments for Groq API
   e. Send each segment to Groq `whisper-large-v3-turbo` → get word-level timestamps
   f. Send FULL audio to pyannote community-1 sidecar → get speaker segments
   g. Align: match each transcribed word to a speaker based on timestamp overlap
   h. Store aligned transcript segments in Postgres
   i. Update session status → completed
3. On failure → retry (BullMQ auto-retry, 3 attempts, exponential backoff)

**Groq API call pattern:**
```
POST https://api.groq.com/openai/v1/audio/transcriptions
model: whisper-large-v3-turbo
response_format: verbose_json
timestamp_granularities: [word, segment]
```

**TDD:**
- Test: job enqueues correctly with session ID
- Test: worker fetches all chunks in correct order
- Test: concatenation produces valid WAV
- Test: Groq API response parsed correctly (mock API)
- Test: pyannote diarization response parsed correctly (mock sidecar)
- Test: timestamp alignment assigns correct speaker to each segment
- Test: failed job retries and eventually marks session as error
- Test: long audio (>25MB) split correctly for Groq
- **Target: 80% coverage**

**Dependencies:** Phase 3 (needs MinIO chunks stored)

---

### Phase 6: UI [Size: M]

**Files to create:**
- `apps/web/src/app/upload/page.tsx` — file upload page (drag-drop, progress)
- `apps/web/src/app/sessions/page.tsx` — sessions list
- `apps/web/src/app/sessions/[id]/page.tsx` — session detail + transcript
- `apps/web/src/components/audio-upload.tsx` — shadcn drag-drop upload
- `apps/web/src/components/chunk-status-list.tsx` — per-chunk status display
- `apps/web/src/components/transcript-view.tsx` — speaker-labeled transcript
- `apps/web/src/components/session-list.tsx` — all sessions with status badges
- `apps/web/src/components/session-card.tsx` — single session card

**Files to modify:**
- `apps/web/src/app/recorder/page.tsx` — add chunk status display, link to session
- `apps/web/src/components/header.tsx` — add Upload + Sessions nav links
- `apps/web/src/app/page.tsx` — dashboard with recent sessions

**Transcript display format:**
```
Speaker 1 [0:00 - 0:15]: "Hello, welcome to the meeting..."
Speaker 2 [0:15 - 0:32]: "Thanks for having me. I wanted to discuss..."
Speaker 1 [0:32 - 0:45]: "Sure, let's start with..."
```

**TDD:**
- Test: upload component accepts audio files only (wav, mp3, m4a, ogg, webm)
- Test: upload component shows progress bar
- Test: transcript view renders speaker segments correctly
- Test: session list shows correct status badges
- **Target: 70% coverage (UI is harder to unit test)**

**Dependencies:** Phase 4 + 5

---

### Phase 7: E2E + Load Testing [Size: L]

**Files to create:**
- `load-tests/chunk-upload.js` — k6: 300K requests at 5K req/s
- `load-tests/reconciliation.js` — post-load integrity verification
- `e2e/recording-flow.spec.ts` — Playwright: record → upload → transcript
- `e2e/file-upload-flow.spec.ts` — Playwright: upload file → transcript
- `e2e/reconciliation.spec.ts` — Playwright: simulate failure → recovery

**k6 load test (300K target):**
```js
export const options = {
  scenarios: {
    chunk_uploads: {
      executor: 'constant-arrival-rate',
      rate: 5000,
      timeUnit: '1s',
      duration: '1m',        // → 300K requests in 60s
      preAllocatedVUs: 500,
      maxVUs: 1000,
    },
  },
};
```

**What to validate:**
- No data loss: every ack in DB has matching chunk in MinIO
- OPFS recovery: chunks survive client disconnects
- Throughput: sustained 5K req/s without drops
- Consistency: reconciliation catches all mismatches
- Latency: p99 < 500ms for chunk upload

**E2E flows:**
1. Record 30s audio → verify chunks in OPFS → verify uploads → trigger transcription → verify speaker-labeled transcript
2. Upload 10min audio file → verify stored in MinIO → trigger transcription → verify transcript
3. Simulate network failure mid-upload → verify OPFS retains chunks → resume → verify completion

**Dependencies:** Phase 6

---

### Phase 8: Hardening [Size: S]

- Security audit: file upload size limits, content-type validation, path traversal prevention
- Performance: connection pooling (Drizzle), MinIO multipart upload for large files
- Cleanup: run Ultracite (`npm exec -- ultracite fix`), remove dead code
- Documentation: update README with setup instructions

**Dependencies:** Phase 7

---

## Cursor Plan Review — Issues Found

The cursor plan (`plan-by-cursor.md`) has several gaps:

| Issue | Cursor Plan | This Plan |
|-------|------------|-----------|
| **tRPC missing** | No mention of tRPC | tRPC is mandatory — `@hono/trpc-server` for typed API |
| **VibeVoice-ASR** | Suggests 9B param model | Too heavy. Use Groq Whisper API ($0.04/hr) + pyannote community-1 |
| **No job queue** | Transcription called synchronously | BullMQ + Redis for reliable async job processing |
| **No large file support** | Only handles 5s mic chunks | Supports 1-5hr file uploads via streaming multipart |
| **pyannote version** | Uses pyannote 3.1 | community-1 (4.0) is significantly better (2026) |
| **No Groq option** | Self-hosted only | Groq API: 216x real-time, $0.04/hr — dramatically faster |
| **Missing file upload UI** | Only mic recording | Both mic recording AND file upload pages |
| **No TDD plan** | Testing not mentioned | TDD-first with 80%+ coverage per phase |

---

## Key Constants

```typescript
const AUDIO_SAMPLE_RATE = 16_000;       // 16kHz
const AUDIO_CHANNELS = 1;               // Mono
const CHUNK_DURATION_SECONDS = 5;       // Client-side recording chunks
const CHUNK_MAX_RETRIES = 3;            // Upload retry attempts
const CHUNK_RETRY_BASE_MS = 1000;       // Exponential backoff base
const GROQ_MAX_FILE_SIZE = 25_000_000;  // 25MB Groq API limit
const LOAD_TEST_TARGET_RPS = 5000;      // 5K requests per second
const LOAD_TEST_DURATION = '1m';        // 60 seconds → 300K total
const COVERAGE_TARGET = 0.80;           // 80% minimum
```

## Audio Format

- Sample rate: 16kHz mono
- Format: WAV (PCM) for mic recording, any format accepted for upload (converted server-side)
- Chunk duration: ~5 seconds (client recording), variable for upload
- Full audio reconstructed from chunks in MinIO for transcription

## Conventions

### Code Style
- Immutable data patterns — never mutate, always return new objects
- Small files (200-400 lines, 800 max), functions under 50 lines
- Zod schemas for ALL API boundaries (tRPC + raw Hono routes)
- Run `npm exec -- ultracite fix` before committing

### Database
- UUIDs for all primary keys
- `UNIQUE(sessionId, index)` on chunks — no duplicates
- Status enums for state machines
- Drizzle `$inferSelect` / `$inferInsert` for type inference

### Naming
- Files: kebab-case (`use-recorder.ts`)
- Components: PascalCase
- Functions/variables: camelCase
- Database tables/columns: snake_case
- tRPC procedures: camelCase (`session.create`, `chunk.getStatus`)

### Git
- Conventional commits: `feat:`, `fix:`, `refactor:`, `test:`, `chore:`
- Feature branches off main

### Testing (TDD — MANDATORY)
- **RED**: Write failing test first
- **GREEN**: Minimal implementation to pass
- **REFACTOR**: Clean up, keep tests green
- 80%+ coverage target per phase
- Unit: Vitest | Integration: Vitest + test server | E2E: Playwright | Load: k6
