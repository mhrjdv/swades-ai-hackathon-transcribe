# VoiceScribe — Reliable Recording Chunking Pipeline + Speaker-Diarized Transcription

A production-grade audio transcription service that records or accepts uploaded audio (1 minute to 5+ hours), reliably chunks and stores it with zero data loss, transcribes it using Groq's Whisper API, and identifies individual speakers using pyannote.audio — all with a polished real-time UI.

Built for the **Swades AI Hackathon**.

---

## What It Does

1. **Record** audio from your microphone or **upload** any audio file (WAV, MP3, M4A, FLAC, OGG, WebM)
2. Audio is **chunked client-side** (5-second segments) and buffered in the browser's **OPFS** (Origin Private File System) — survives tab crashes, network drops, and browser restarts
3. Chunks are uploaded to **MinIO** (S3-compatible storage) with **SHA-256 checksum verification** — every byte is validated
4. Each chunk is acknowledged in **PostgreSQL** — dual reconciliation ensures bucket and DB are always in sync
5. Once all chunks are uploaded, transcription is **automatically triggered** via a **BullMQ job queue**
6. **Groq Whisper large-v3-turbo** transcribes the audio at 216x real-time speed with word-level timestamps
7. **pyannote.audio 3.1** runs speaker diarization on the full audio — detecting who spoke when
8. Transcription words are **aligned with speaker segments** to produce a speaker-labeled transcript
9. The UI **polls in real-time** and displays the final transcript with color-coded speaker labels

```
Speaker 1 [00:00 - 03:04]
  "Do you think cricket is dying as a sport?"

Speaker 2 [03:04 - 07:39]
  "Not at all. I think amongst the affluent youth... Maybe."

Speaker 3 [07:39 - 17:34]
  "It's still an event to go to. I always used to think that if you watch
   cricket in a stadium, it's not seen anything..."

Speaker 4 [20:20 - 33:66]
  "But you know the experience of watching a game in both Chinnaswamy and
   Vankhede..."

Speaker 5 [33:66 - 41:19]
  "It's a party. Will cricket die? It won't because there are very few
   moments of celebration and Indians love celebrating."
```

---

## Architecture

```
+-----------------------------------------------------------+
|                    BROWSER (Next.js 16)                     |
|                                                             |
|  [Mic Recording]  [File Upload]  [OPFS Buffer]             |
|       |                |              |                     |
|       +-------+--------+              |                     |
|               v                       |                     |
|  [Chunk + SHA-256 checksum]  <--------+                     |
|  [Upload via Hono POST]                                     |
|  [Status via tRPC query] ------> polls every 2s             |
+---------------------------+-------------------------------+
                            |
                            v
+-----------------------------------------------------------+
|              HONO + tRPC SERVER (Bun runtime)               |
|                                                             |
|  Raw Hono routes:          tRPC routes (@hono/trpc):        |
|  - POST /upload/chunk      - session.create / getById       |
|  - POST /upload/file       - chunk.getStatus / ack          |
|  - POST /api/transcribe    - transcript.get / trigger       |
|  - GET  /health            - reconciliation.run             |
|                                                             |
|  [MinIO S3]  [PostgreSQL/Drizzle]  [BullMQ + Redis]         |
+---------------------------+-------------------------------+
                            |
                            v
+-----------------------------------------------------------+
|              TRANSCRIPTION WORKER (BullMQ)                   |
|                                                             |
|  1. Download audio from MinIO                               |
|  2. Send to Groq Whisper API (word-level timestamps)        |
|  3. Send to pyannote sidecar (speaker diarization)          |
|  4. Align words with speakers by timestamp overlap          |
|  5. Store transcript segments in PostgreSQL                  |
+-----------------------------------------------------------+
                            |
                            v
+-----------------------------------------------------------+
|           PYANNOTE DIARIZATION SIDECAR (Python)              |
|                                                             |
|  FastAPI server running pyannote.audio 3.1                  |
|  - Converts audio to 16kHz WAV via ffmpeg                   |
|  - Runs neural speaker diarization                          |
|  - Returns speaker segments with timestamps                 |
+-----------------------------------------------------------+
```

---

## Tech Stack — What and Why

### Core (Mandatory)

| Technology | Layer | Why This Choice |
|-----------|-------|-----------------|
| **Next.js 16** (App Router, React 19) | Frontend | Server Components, async params, Turbopack for fast dev, typed routes |
| **Hono** | Backend API | Lightweight (~14KB), Web Standard APIs, runs natively on Bun, 3x faster than Express |
| **Bun** | Runtime | 4x faster startup than Node.js, native TypeScript, built-in test runner, hot reload |
| **tRPC** | API Layer | End-to-end type safety between client and server — no API schema drift, no codegen |
| **Zod 4** | Validation | Runtime + compile-time validation, powers tRPC input schemas, 2x faster than v3 |
| **Drizzle ORM** | Database | Type-safe SQL, zero overhead, `$inferSelect` types, push-based migrations |
| **PostgreSQL** | Database | ACID transactions for chunk ack tracking, reliable under 5K req/s load |
| **MinIO** | Object Storage | S3-compatible, self-hosted, handles multi-GB audio files, Docker-ready |
| **shadcn/ui** | UI Components | Accessible, composable, copy-paste components — not a dependency black box |
| **TailwindCSS 4** | Styling | Utility-first, zero runtime, JIT compilation, dark mode built-in |
| **Turborepo** | Monorepo | Parallel builds, shared packages (db, env, trpc, ui), incremental computation |

### Additional

| Technology | Layer | Why This Choice |
|-----------|-------|-----------------|
| **Groq Whisper large-v3-turbo** | ASR | $0.04/hour, 216x real-time (60min audio in ~17s), 809M params, ~5-8% WER |
| **pyannote.audio 3.1** | Speaker Diarization | Best open-source diarization (DER ~11%), neural speaker change detection, sub-second precision |
| **BullMQ** + **Redis** | Job Queue | Reliable async processing, auto-retry with exponential backoff, job prioritization |
| **OPFS** | Client Buffer | Browser-native file system, survives tab crashes, 100GB+ capacity, no IndexedDB limitations |
| **k6** | Load Testing | Go-based, handles 300K requests, constant-arrival-rate executor, built-in metrics |

### Why NOT These Alternatives

| Rejected | Reason |
|----------|--------|
| Express | 3x slower than Hono on Bun, no Web Standard APIs |
| Prisma | Heavier than Drizzle, slower queries, more abstraction than needed |
| OpenAI Whisper API | $0.006/min ($0.36/hr) — 9x more expensive than Groq |
| Deepgram Nova-3 | $0.46/hr — 11x more expensive than Groq |
| VibeVoice-ASR | 9B params, needs 14GB+ VRAM — not lightweight |
| SpeechBrain (ECAPA-TDNN) | Speaker verification model, not diarization — can't handle rapid speaker turns |
| AssemblyAI | Not self-hostable, vendor lock-in |

---

## External API Dependencies

### 1. Groq API (Required)

**What:** Cloud API for Whisper speech-to-text transcription.

**Why:** Groq runs Whisper large-v3-turbo on custom LPU hardware at 216x real-time speed — a 60-minute audio file is transcribed in ~17 seconds. At $0.04/hour of audio, it's the cheapest production-quality ASR API available.

**How to get:**
1. Go to https://console.groq.com/
2. Sign up (free tier available)
3. Go to https://console.groq.com/keys
4. Create an API key (starts with `gsk_`)
5. Add to `apps/server/.env` as `GROQ_API_KEY=gsk_your_key_here`

**Rate limits:** Free tier allows ~14,400 audio-seconds/day. Paid tier is unlimited.

**Model used:** `whisper-large-v3-turbo` — 809M parameters, supports 99 languages, returns word-level timestamps.

### 2. HuggingFace Token (Required for Speaker Diarization)

**What:** Authentication token for downloading pyannote.audio's gated models.

**Why:** pyannote's speaker diarization models are gated on HuggingFace — you must accept the model license before downloading. This is a one-time setup.

**How to get:**
1. Create a HuggingFace account at https://huggingface.co/join
2. Go to https://hf.co/settings/tokens and create an access token
3. **Accept the model licenses** (click "Agree" on each page):
   - https://huggingface.co/pyannote/speaker-diarization-3.1
   - https://huggingface.co/pyannote/segmentation-3.0
   - https://huggingface.co/pyannote/speaker-diarization-community-1
4. Set as environment variable when running the diarization sidecar: `HF_TOKEN=hf_your_token_here`

**Models downloaded automatically:**
- `pyannote/speaker-diarization-3.1` (~300MB) — main diarization pipeline
- `pyannote/segmentation-3.0` (~20MB) — voice activity + speaker change detection
- Speaker embedding model (~80MB) — speaker clustering

---

## Prerequisites

Before setup, ensure you have:

| Tool | Version | Check | Install |
|------|---------|-------|---------|
| **Bun** | >= 1.0 | `bun --version` | https://bun.sh |
| **Docker** | >= 20.0 | `docker --version` | https://docs.docker.com/get-docker/ |
| **Docker Compose** | >= 2.0 | `docker compose version` | Included with Docker Desktop |
| **Python** | >= 3.10 | `python3 --version` | https://python.org |
| **ffmpeg** | any | `ffmpeg -version` | `brew install ffmpeg` (macOS) |
| **Git** | any | `git --version` | https://git-scm.com |

---

## Quick Start (One Command Setup)

### 1. Clone and Install

```bash
git clone https://github.com/mhrjdv/swades-ai-hackathon-transcribe.git
cd swades-ai-hackathon-transcribe
bun install
```

### 2. Configure Environment

```bash
# Server environment
cp apps/server/.env.example apps/server/.env
# Edit apps/server/.env and add your GROQ_API_KEY

# Web environment
cp apps/web/.env.example apps/web/.env
```

Edit `apps/server/.env`:
```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/my-better-t-app
CORS_ORIGIN=http://localhost:3001
NODE_ENV=development
MINIO_ENDPOINT=http://localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=audio-chunks
REDIS_URL=redis://localhost:6379
GROQ_API_KEY=gsk_your_actual_key_here      # <-- GET FROM https://console.groq.com/keys
DIARIZATION_SIDECAR_URL=http://localhost:8000
```

### 3. Start Infrastructure (Docker)

```bash
cd packages/db
docker compose up -d
cd ../..
```

This starts:
- **PostgreSQL** on port 5432
- **MinIO** on port 9000 (API) and 9001 (Console)
- **Redis** on port 6379

### 4. Push Database Schema

```bash
bun run db:push
```

### 5. Set Up Diarization Sidecar

```bash
cd services/diarization
python3 -m venv .venv
source .venv/bin/activate    # On Windows: .venv\Scripts\activate
pip install pyannote.audio fastapi uvicorn python-multipart torch
```

### 6. Start Everything

**Terminal 1** — Main app (Next.js + Hono):
```bash
bun run dev
```

**Terminal 2** — Diarization sidecar:
```bash
cd services/diarization
HF_TOKEN=hf_your_token_here .venv/bin/uvicorn server:app --port 8000
```

### 7. Open the App

- **Web UI:** http://localhost:3001
- **API Server:** http://localhost:3000
- **MinIO Console:** http://localhost:9001 (login: minioadmin/minioadmin)
- **Diarization Health:** http://localhost:8000/health

---

## One-Liner Setup (after prerequisites)

```bash
git clone https://github.com/mhrjdv/swades-ai-hackathon-transcribe.git && \
cd swades-ai-hackathon-transcribe && \
bun install && \
cp apps/server/.env.example apps/server/.env && \
cp apps/web/.env.example apps/web/.env && \
echo "GROQ_API_KEY=YOUR_KEY" >> apps/server/.env && \
cd packages/db && docker compose up -d && cd ../.. && \
sleep 5 && bun run db:push && \
cd services/diarization && python3 -m venv .venv && \
source .venv/bin/activate && \
pip install pyannote.audio fastapi uvicorn python-multipart torch && \
cd ../..
```

Then start in two terminals:
```bash
# Terminal 1
bun run dev

# Terminal 2
cd services/diarization && HF_TOKEN=your_hf_token .venv/bin/uvicorn server:app --port 8000
```

---

## Project Structure

```
swades-ai-hackathon-transcribe/
|
+-- apps/
|   +-- web/                          # Next.js 16 Frontend
|   |   +-- src/
|   |   |   +-- app/
|   |   |   |   +-- page.tsx              # Home — dashboard, recent sessions
|   |   |   |   +-- recorder/page.tsx     # Mic recording with live waveform
|   |   |   |   +-- upload/page.tsx       # File upload (drag-and-drop)
|   |   |   |   +-- sessions/page.tsx     # All sessions list
|   |   |   |   +-- sessions/[id]/page.tsx # Session detail + transcript
|   |   |   +-- hooks/
|   |   |   |   +-- use-recorder.ts       # Audio capture (16kHz WAV, 5s chunks)
|   |   |   |   +-- use-opfs.ts           # OPFS read/write/manifest
|   |   |   |   +-- use-chunk-uploader.ts # Upload with retry + SHA-256
|   |   |   |   +-- use-reconciliation.ts # OPFS vs server ack sync
|   |   |   +-- components/
|   |   |   |   +-- transcript-view.tsx   # Speaker-labeled transcript display
|   |   |   |   +-- audio-upload.tsx      # Drag-drop upload zone
|   |   |   |   +-- chunk-status-list.tsx # Per-chunk upload progress
|   |   |   |   +-- session-card.tsx      # Session list card
|   |   |   |   +-- header.tsx            # Navigation bar
|   |   |   +-- lib/
|   |   |       +-- trpc.ts              # tRPC client
|   |   |       +-- trpc-provider.tsx     # tRPC + TanStack Query provider
|   |   |       +-- checksum.ts           # SHA-256 via SubtleCrypto
|   |   +-- .env.example
|   |
|   +-- server/                       # Hono + tRPC API on Bun
|       +-- src/
|       |   +-- index.ts                  # Server entry — mounts tRPC + upload routes
|       |   +-- routes/
|       |   |   +-- upload.ts             # Raw Hono multipart upload (chunk + file)
|       |   +-- services/
|       |   |   +-- minio.ts              # MinIO S3 client (put/get/head/list/delete)
|       |   |   +-- queue.ts              # BullMQ queue + worker factory
|       |   |   +-- transcription.ts      # Groq Whisper API + pyannote + alignment
|       |   +-- workers/
|       |       +-- transcribe.ts         # BullMQ worker: download -> transcribe -> diarize -> store
|       +-- .env.example
|
+-- packages/
|   +-- trpc/                         # Shared tRPC Router + Zod Schemas
|   |   +-- src/
|   |   |   +-- router.ts                # initTRPC with superjson
|   |   |   +-- appRouter.ts             # Merged router (session, chunk, transcript, reconciliation)
|   |   |   +-- router/
|   |   |   |   +-- session.ts            # CRUD: create, getById, getAll, updateStatus, delete
|   |   |   |   +-- chunk.ts              # getStatus, getBatchStatus, ack
|   |   |   |   +-- transcript.ts         # get, trigger (enqueues BullMQ job)
|   |   |   |   +-- reconciliation.ts     # runServerSide, getClientStatus
|   |   |   +-- schemas/                  # Zod validation schemas
|   |   +-- package.json
|   |
|   +-- db/                           # Drizzle ORM + PostgreSQL
|   |   +-- src/
|   |   |   +-- schema/
|   |   |   |   +-- enums.ts              # session_status, source_type, chunk_status
|   |   |   |   +-- sessions.ts           # Sessions table (id, status, sourceType, ...)
|   |   |   |   +-- chunks.ts             # Chunks table (sessionId, index, checksum, ...)
|   |   |   |   +-- transcripts.ts        # Transcripts table (speakerId, startTime, content, ...)
|   |   |   +-- index.ts                  # Drizzle client factory
|   |   +-- docker-compose.yml            # PostgreSQL + MinIO + Redis
|   |   +-- drizzle.config.ts
|   |
|   +-- env/                          # Type-safe Environment Config
|   |   +-- src/
|   |       +-- server.ts                 # Server env (DB, MinIO, Redis, Groq, Diarization)
|   |       +-- web.ts                    # Client env (NEXT_PUBLIC_SERVER_URL)
|   |
|   +-- ui/                           # Shared shadcn/ui Components
|   |   +-- src/components/               # Button, Card, Input, Skeleton, etc.
|   |
|   +-- config/                       # Shared TypeScript Config
|
+-- services/
|   +-- diarization/                  # Python Speaker Diarization Sidecar
|       +-- server.py                     # FastAPI + pyannote.audio 3.1
|       +-- requirements.txt
|       +-- Dockerfile
|
+-- load-tests/                       # k6 Load Testing Scripts
|   +-- chunk-upload.js                   # 300K requests @ 5K req/s
|   +-- reconciliation.js                # Post-load integrity check
|
+-- CLAUDE.md                         # AI assistant project context
+-- .claude/agents.md                 # Agent dispatch configuration
+-- turbo.json                        # Turborepo build config
```

---

## Database Schema

### sessions
| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | Auto-generated |
| status | ENUM | idle, recording, uploading, transcribing, completed, error |
| sourceType | ENUM | mic, upload |
| totalChunks | INTEGER | Number of audio chunks |
| totalDurationMs | BIGINT | Total audio duration in milliseconds |
| fileName | TEXT | Original file name (uploads only) |
| fileSizeBytes | BIGINT | File size in bytes |
| errorMessage | TEXT | Error details if status is error |
| createdAt | TIMESTAMP | Auto-set |
| updatedAt | TIMESTAMP | Auto-updated |

### chunks
| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | Auto-generated |
| sessionId | UUID (FK) | References sessions.id (CASCADE DELETE) |
| index | INTEGER | Chunk sequence number |
| bucketKey | TEXT | MinIO object key |
| durationMs | INTEGER | Chunk duration |
| sizeBytes | INTEGER | Chunk size |
| checksum | TEXT | SHA-256 hex digest |
| status | ENUM | pending, uploaded, acked, error |
| **UNIQUE** | | (sessionId, index) — prevents duplicate chunks |

### transcripts
| Column | Type | Description |
|--------|------|-------------|
| id | UUID (PK) | Auto-generated |
| sessionId | UUID (FK) | References sessions.id (CASCADE DELETE) |
| speakerId | INTEGER | Speaker number (0, 1, 2, ...) |
| startTime | REAL | Segment start in seconds |
| endTime | REAL | Segment end in seconds |
| content | TEXT | Transcribed text |
| confidence | REAL | Confidence score (nullable) |

---

## Data Flow — Step by Step

### Recording Flow
1. User clicks **Record** on `/recorder`
2. `useRecorder` hook captures audio at 16kHz mono, chunks every 5 seconds
3. Each chunk is written to **OPFS** (`/{sessionId}/{chunkIndex}.wav`)
4. **SHA-256 checksum** is computed via `crypto.subtle.digest`
5. Chunk is uploaded via `POST /upload/chunk` (multipart: sessionId, chunkIndex, checksum, file)
6. Server **verifies checksum**, uploads to **MinIO**, writes **ack to Postgres**
7. Client marks chunk as acked in OPFS manifest
8. When recording stops, all chunks are verified uploaded
9. **Transcription auto-triggers** via tRPC `transcript.trigger` (enqueues BullMQ job)
10. UI redirects to `/sessions/{id}` which **polls every 2 seconds**

### Upload Flow
1. User drags audio file onto `/upload` page
2. File is uploaded via `POST /upload/file` (multipart: file, fileName)
3. Server stores file in MinIO as `{sessionId}/original.{ext}`
4. **Transcription auto-triggers** immediately after upload
5. UI redirects to session page with real-time polling

### Transcription Worker Flow
1. BullMQ worker picks up job
2. Downloads audio from MinIO (chunks are concatenated, uploads used directly)
3. Sends to **Groq Whisper API** with `response_format: verbose_json` and `timestamp_granularities: [word, segment]`
4. Sends same audio to **pyannote sidecar** for speaker diarization
5. **Aligns** each transcribed word to a speaker by matching word midpoint to diarization segments
6. Groups consecutive same-speaker words into transcript segments
7. Stores segments in PostgreSQL
8. Updates session status to `completed`

### Reconciliation
- **Client-side**: On page load, checks OPFS for un-acked chunks, re-uploads if server says missing
- **Server-side**: For each acked chunk in DB, verifies object exists in MinIO via HeadObject

---

## Load Testing

Target: **300,000 requests** at **5,000 req/s** for 60 seconds.

### Install k6

```bash
brew install k6          # macOS
# or: https://k6.io/docs/get-started/installation/
```

### Run Load Test

```bash
k6 run load-tests/chunk-upload.js
```

### What's Validated
- No data loss (every ack in DB has matching chunk in MinIO)
- Throughput sustained at 5K req/s
- p99 latency under 500ms
- 99%+ success rate

### Post-Load Integrity Check

```bash
k6 run load-tests/reconciliation.js
```

---

## Available Scripts

| Script | Description |
|--------|-------------|
| `bun run dev` | Start all apps (web + server) in development mode |
| `bun run dev:web` | Start only Next.js (port 3001) |
| `bun run dev:server` | Start only Hono/Bun server (port 3000) |
| `bun run build` | Build all apps for production |
| `bun run check-types` | TypeScript type checking across all packages |
| `bun run db:push` | Push Drizzle schema to PostgreSQL |
| `bun run db:studio` | Open Drizzle Studio (database GUI) |
| `bun run db:start` | Start Docker containers (Postgres, MinIO, Redis) |
| `bun run db:stop` | Stop Docker containers |

---

## API Endpoints

### Raw Hono Routes (multipart uploads)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Health check — returns "OK" |
| POST | `/upload/chunk` | Upload audio chunk (multipart: sessionId, chunkIndex, checksum, file) |
| POST | `/upload/file` | Upload full audio file (multipart: file, fileName) |
| POST | `/api/transcribe` | Trigger transcription (JSON: { sessionId }) |

### tRPC Routes (type-safe RPC)

All mounted at `/trpc/*`:

| Procedure | Type | Description |
|-----------|------|-------------|
| `session.create` | Mutation | Create new session |
| `session.getById` | Query | Get session by ID |
| `session.getAll` | Query | List all sessions |
| `session.updateStatus` | Mutation | Update session status |
| `session.delete` | Mutation | Delete session (cascade deletes chunks + transcripts) |
| `chunk.getStatus` | Query | Get single chunk status |
| `chunk.getBatchStatus` | Query | Get all chunks for a session |
| `chunk.ack` | Mutation | Acknowledge chunk upload |
| `transcript.get` | Query | Get transcript segments for session |
| `transcript.trigger` | Mutation | Enqueue transcription job |

### Diarization Sidecar

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check + model loaded status |
| POST | `/diarize` | Speaker diarization (multipart: audio file) |

---

## Troubleshooting

### "Model not loaded" from diarization sidecar
- Ensure you accepted all three HuggingFace model licenses (links in Prerequisites)
- Check your `HF_TOKEN` is valid
- First load downloads ~400MB of model weights — wait 1-2 minutes

### Transcription stuck at "transcribing"
- Check Redis is running: `docker ps | grep redis`
- Check server logs for BullMQ worker errors
- Verify Groq API key is valid: `curl -H "Authorization: Bearer $GROQ_API_KEY" https://api.groq.com/openai/v1/models`

### Chunks not uploading
- Check MinIO is running: `curl http://localhost:9000/minio/health/live`
- Check browser console for CORS errors
- Verify `CORS_ORIGIN` in server .env matches your web URL

### Docker containers won't start
- Ensure Docker Desktop is running
- Check port conflicts: `lsof -i :5432 -i :9000 -i :6379`

---

## Performance Characteristics

| Metric | Value |
|--------|-------|
| ASR Speed | 216x real-time (60min audio in ~17s) |
| ASR Cost | $0.04/hour of audio |
| Diarization | ~30-60s for 1min audio on CPU |
| Chunk Upload | 5K req/s sustained (Hono + Bun) |
| Client Buffer | OPFS — survives crashes, 100GB+ capacity |
| Checksum | SHA-256 per chunk — zero data corruption |

---

## License

MIT
