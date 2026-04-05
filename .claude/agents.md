# Agent Configuration — Reliable Chunking Pipeline + Transcription

> **ALWAYS search/reference year 2026.**

## Project Context for All Agents

Turborepo monorepo building a reliable audio recording chunking pipeline with speaker-diarized
transcription. Supports mic recording AND file upload (1-5+ hours). TDD mandatory.

**Mandatory stack:** Next.js 16, Hono on Bun, tRPC (`@hono/trpc-server`) + Zod, Drizzle ORM + Postgres, MinIO, shadcn/ui
**Additional:** Groq Whisper API ($0.04/hr, 216x real-time) + pyannote community-1 sidecar, BullMQ + Redis, k6, Vitest, Playwright

### Key Paths
- `apps/web/src/hooks/use-recorder.ts` — Browser audio recorder (16kHz WAV, 5s chunks)
- `apps/web/src/hooks/use-opfs.ts` — OPFS read/write/manifest
- `apps/web/src/hooks/use-chunk-uploader.ts` — Upload with retry + checksum
- `apps/web/src/lib/trpc.ts` — tRPC client (@trpc/react-query)
- `apps/server/src/index.ts` — Hono + tRPC server entry
- `apps/server/src/routes/upload.ts` — Raw Hono multipart upload (chunks + full files)
- `apps/server/src/services/minio.ts` — MinIO S3 client
- `apps/server/src/services/queue.ts` — BullMQ setup
- `apps/server/src/services/transcription.ts` — Groq API + pyannote orchestration
- `apps/server/src/workers/transcribe.ts` — BullMQ transcription worker
- `packages/trpc/src/` — Shared tRPC router + Zod schemas
- `packages/db/src/schema/` — Drizzle schema (sessions, chunks, transcripts)
- `services/diarization/server.py` — pyannote community-1 FastAPI sidecar
- `load-tests/` — k6 scripts (300K @ 5K req/s)

### Critical Invariants
- OPFS is durable client buffer — chunks cleared ONLY after bucket + DB confirmed
- SHA-256 checksums verified server-side before MinIO storage
- Dual reconciliation: client (OPFS vs acks) + server (DB vs MinIO)
- Groq Whisper large-v3-turbo for ASR (word-level timestamps, verbose_json)
- pyannote community-1 (4.0) runs on FULL reconstructed audio for speaker consistency
- BullMQ jobs with auto-retry (3 attempts, exponential backoff)
- TDD: write tests FIRST → RED → GREEN → REFACTOR, 80%+ coverage

---

## Agent Dispatch Table

### Infrastructure & Schema

| Module | Agent Type | Model |
|--------|-----------|-------|
| Docker Compose (Postgres + MinIO + Redis) | `general-purpose` | haiku |
| Drizzle schema (sessions, chunks, transcripts, enums) | `database-reviewer` | sonnet |
| Environment config (MinIO, Redis, Groq vars) | `typescript-reviewer` | haiku |
| tRPC package scaffolding + Zod schemas | `typescript-reviewer` | sonnet |

### Server (apps/server/)

| Module | Agent Type | Model |
|--------|-----------|-------|
| tRPC router + @hono/trpc-server mount | `tdd-guide` + `typescript-reviewer` | sonnet |
| Raw Hono multipart upload (chunk + full file) | `security-reviewer` + `tdd-guide` | sonnet |
| MinIO S3 client (put/get/head/delete) | `tdd-guide` | sonnet |
| DB ack logic + reconciliation endpoint | `tdd-guide` + `database-reviewer` | sonnet |
| BullMQ queue + worker setup | `architect` + `tdd-guide` | sonnet |
| Groq Whisper API integration | `tdd-guide` | sonnet |
| Transcription orchestration (concat → Groq → pyannote → align → store) | `tdd-guide` | opus |

### Client (apps/web/)

| Module | Agent Type | Model |
|--------|-----------|-------|
| OPFS hooks (read/write/manifest/clear) | `tdd-guide` | sonnet |
| Chunk uploader (retry, backoff, SHA-256) | `tdd-guide` | sonnet |
| Client reconciliation (OPFS vs acks) | `tdd-guide` + `architect` | sonnet |
| tRPC client setup (@trpc/react-query) | `typescript-reviewer` | haiku |
| File upload page + drag-drop component | `typescript-reviewer` | haiku |
| Transcript display (Speaker N [time]: text) | `typescript-reviewer` | haiku |
| Session list + detail pages | `typescript-reviewer` | haiku |

### Diarization Sidecar (services/diarization/)

| Module | Agent Type | Model |
|--------|-----------|-------|
| FastAPI /diarize endpoint (pyannote community-1) | `python-reviewer` | sonnet |
| Dockerfile | `general-purpose` | haiku |

### Testing & Load

| Module | Agent Type | Model |
|--------|-----------|-------|
| k6 load test (300K @ 5K/s chunk uploads) | `general-purpose` | sonnet |
| E2E: record → upload → transcribe → display | `e2e-runner` | sonnet |
| E2E: file upload → transcribe → speaker transcript | `e2e-runner` | sonnet |
| Post-load reconciliation + integrity check | `tdd-guide` | sonnet |

---

## Phase Workflow with Parallel Groups

### Phase 0-1: Foundation (sequential)
```
general-purpose   → Docker Compose (MinIO + Redis)
database-reviewer → Drizzle schema validation
typescript-reviewer → tRPC package + env config
```

### Phase 2-3: Core Pipeline (parallel where possible)
```
PARALLEL GROUP A (server):
  tdd-guide → Upload routes + MinIO service (TDD first)
  tdd-guide → tRPC router procedures (TDD first)

PARALLEL GROUP B (client):
  tdd-guide → OPFS hooks (TDD first)
  tdd-guide → Chunk uploader with retry (TDD first)

SEQUENTIAL (after A+B):
  tdd-guide        → Reconciliation logic (TDD)
  security-reviewer → Upload pipeline audit
  code-reviewer    → Cross-cutting review
```

### Phase 4-5: Transcription + UI (parallel)
```
PARALLEL:
  tdd-guide        → BullMQ + Groq API + transcription worker (TDD)
  python-reviewer  → pyannote community-1 sidecar
  typescript-reviewer → UI pages (upload, sessions, transcript)
```

### Phase 6-7: E2E + Load + Hardening
```
PARALLEL:
  e2e-runner       → Full pipeline E2E tests
  general-purpose  → k6 load test (300K requests)
  security-reviewer → Final security audit

SEQUENTIAL:
  refactor-cleaner → Dead code cleanup
  code-reviewer    → Final review pass
```

---

## Parallel Agent Patterns

### Pattern 1: Client + Server in parallel
Launch two agents simultaneously — one scoped to `apps/web/`, one to `apps/server/`.

### Pattern 2: Multi-perspective review (for upload endpoint)
```
Agent 1: security-reviewer  → File upload vulns, path traversal, size limits
Agent 2: code-reviewer      → Code quality, error handling
Agent 3: database-reviewer  → Ack write correctness, race conditions
```

### Pattern 3: TDD split
Launch tdd-guide first (writes failing tests), then implement to pass tests.
Never skip the RED phase. 80%+ coverage per module.

---

## Model Routing

| Complexity | Model | Use When |
|-----------|-------|----------|
| Config, simple UI, Dockerfiles | haiku | Lightweight tasks |
| Feature implementation, API, tests | sonnet | Core development (default) |
| Transcription orchestration, architecture | opus | Deep reasoning needed |
