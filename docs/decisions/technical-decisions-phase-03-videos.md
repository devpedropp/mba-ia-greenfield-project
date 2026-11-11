---
scope_type: phase
related_phases: [3]
status: finalized
date: 2026-11-10
scope_description: "Storage, queue, upload protocol, video processing, identifier, and lifecycle-state decisions needed to make 10GB resumable uploads, background processing, and streaming playback work end to end."
---

# Technical Decisions — Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — new `videos` module: storage client, queue producer, upload-session endpoints, `Video` entity/migration, worker process that runs FFmpeg/ffprobe and updates processing status. Covered by TD-01 through TD-06.
- `next-frontend/` — new upload client that talks directly to Object Storage (outside the strict BFF `API_URL` proxy, per the already-decided `next-frontend-config-base/TD-03` constraint) and a video status/detail view that reflects draft/processing/ready states. Covered by TD-03 and TD-06; also a direct consumer of TD-01's storage choice (CORS, direct streaming/download URLs) and TD-05's URL strategy.

**Already decided, not re-litigated here:**
- FFmpeg is the processing engine (fixed by `docs/diagrams/software-arch.mermaid`'s Video Worker container) — TD-04 below only covers *how* Node.js invokes it, not *whether*.
- Streaming/playback delivery mechanism — the architecture diagram already specifies the Frontend reads video bytes directly from Object Storage over HTTPS (HTTP Range requests), not proxied through the API or BFF. This is inherited, not an open decision. Download delivery reuses the same direct-storage-access mechanism (see TD-01), so it is not a separate TD.

---

## TD-01: Object Storage Backend and SDK

**Scope:** Cross-layer

**Capability:** `Transversal — covers: Serviço de armazenamento de arquivos (vídeos e thumbnails); Reprodução via streaming (sem necessidade de download completo); Download do vídeo pelo usuário`

**Context:** No object storage client exists yet (no S3/MinIO SDK installed, no storage container in `compose.yaml`). The architecture diagram labels this container "S3 or MinIO" — an explicitly open choice. Whatever is chosen determines not only how the API/Worker read and write video files, but also the URL shape the Frontend uses to stream and download directly from storage (per the diagram), so this is cross-component rather than a pure backend implementation detail.

**Options:**

### Option A: AWS S3 (managed, in every environment)
- Provision a real S3 bucket and use AWS SDK v3 (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`) from day one, including local dev.
- **Pros:** Fully managed durability/availability, native multipart-upload and presigned-URL APIs, zero infra to operate.
- **Cons:** Introduces a real AWS billing/account dependency even for local dev and CI, where the project currently has zero cloud dependencies (only local Docker services: `nestjs-api`, `db`, `mailpit`); every developer and CI run needs live AWS credentials just to run the app.

### Option B: MinIO (self-hosted, S3-compatible) everywhere
- Run MinIO as another `compose.yaml` service, exactly like the existing `db`/`mailpit` local containers, and speak to it with the same AWS SDK v3 S3 client — confirmed (2026) that AWS SDK v3 needs only `endpoint` + `forcePathStyle: true` to target MinIO, no code fork.
- **Pros:** Zero cloud cost, fully offline/local dev loop consistent with the existing compose convention, identical SDK code path as real S3 (so no rewrite risk later).
- **Cons:** If also used in production, self-hosted MinIO must be operated (backups, upgrades, TLS) by the team instead of a managed provider; a handful of less-common S3 features could differ at the edges.

### Option C: MinIO for dev/test, AWS S3 for staging/prod (same SDK, env-switched)
- Both environments use the identical AWS SDK v3 client; only `storage.config.ts` (following the existing namespaced `registerAs` pattern) differs per environment (endpoint/forcePathStyle for MinIO vs real AWS endpoint for S3).
- **Pros:** Free, fast local dev loop today; managed durability in real environments later; no code fork since the SDK call sites are identical in both cases.
- **Cons:** Slightly larger config/test matrix (must verify MinIO-only flags like `forcePathStyle` never leak into the prod S3 config); production path is untested until that environment actually exists.

**Recommendation:** Option C — the project currently has zero cloud infrastructure and every other service (`db`, `mailpit`) runs as a local `compose.yaml` container, so adding MinIO keeps that convention for dev/CI at no cost, while AWS SDK v3's confirmed drop-in compatibility with MinIO (`endpoint` + `forcePathStyle`) means a later move to real S3 for staging/prod is a config change in `storage.config.ts`, not a rewrite.

**Decision:** C
**Libraries:** @aws-sdk/client-s3, @aws-sdk/s3-request-presigner

---

## TD-02: Background Job Queue Broker and Library

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** The diagram marks the Message Queue container "TBD." No queue library or broker is installed (no `bullmq`, no `ioredis`/`redis`). The current stack has Postgres as its only datastore (`db` service, TypeORM) and no Redis anywhere. This decision only involves the API (producer) and Worker (consumer), both backend-side — the Frontend never talks to the queue directly (it only observes outcomes via TD-06's status field).

**Options:**

### Option A: BullMQ + Redis via `@nestjs/bullmq`
- `@nestjs/bullmq` v12 is confirmed to support NestJS 10/11/12; BullMQ is the actively-developed successor to the now-maintenance-only `Bull` package. Requires adding a new Redis container to `compose.yaml`.
- **Pros:** Mature, the de-facto NestJS-ecosystem standard, best throughput/latency, rich retry/backoff/dead-letter support, official first-party Nest module, dashboards available (Bull Board).
- **Cons:** Introduces a brand-new infra dependency — Redis does not exist anywhere in this stack today (no client lib, no container) — meaning a new service to provision, secure, and operate in every environment for a single phase's workload.

### Option B: BullMQ on its PostgreSQL backend via `@nestjs/bullmq`
- BullMQ v6 (shipped mid/late 2026) made its storage layer pluggable and ships an official PostgreSQL backend alongside Redis, with the same Queue/Worker API and the same `@nestjs/bullmq` Nest integration — only the backend connection string changes.
- **Pros:** Reuses the Postgres instance already running in `compose.yaml` (zero new infra), keeps the same official, actively-maintained NestJS module and retry/backoff semantics as Option A, and a future move to Redis (if volume grows) is a backend swap, not a rewrite.
- **Cons:** The Postgres backend is new (shipped within the last few months as of this writing) and has a materially smaller production track record than Redis-backed BullMQ; BullMQ's own benchmarks put it at roughly 1.5–2x lower throughput than Redis — acceptable for this phase's thumbnail/metadata-extraction volume, but worth flagging as the least battle-tested option here.

### Option C: pg-boss (Postgres-native queue library, no BullMQ)
- A queue library built directly on Postgres `SKIP LOCKED` + `LISTEN/NOTIFY`, with years of standalone production use, predating BullMQ's Postgres backend.
- **Pros:** Reuses existing Postgres, mature and battle-tested on its own terms, simple single-datastore operational model, throughput more than sufficient for video-processing job volumes.
- **Cons:** No official NestJS wrapper (would need a small custom module, unlike BullMQ's first-party integration), different API from BullMQ so there is no straightforward migration path to Redis-backed BullMQ later if needed, smaller tooling/dashboard ecosystem than Bull Board.

**Recommendation:** Option B — it avoids introducing Redis as entirely new infrastructure (nothing in the stack touches Redis today) while keeping the same official, actively-maintained NestJS integration and retry/idempotency primitives used throughout the wider BullMQ ecosystem, leaving a clear backend-swap path to Redis if video volume later justifies it; the newness of the Postgres backend is a known, explicitly-flagged risk rather than a blind spot.

**Decision:** B
**Libraries:** bullmq, @nestjs/bullmq

---

## TD-03: Large-File Upload Protocol with Resume-on-Failure

**Scope:** Cross-layer

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** This is the central cross-layer contract of the phase: the Frontend's upload client and the Backend's session/presigned-URL issuance must agree on the exact same wire protocol. It is further constrained by an existing decision (`next-frontend-config-base/TD-03`) that large video payloads must bypass the strict BFF `API_URL` proxy entirely — the Frontend talks straight to Object Storage, matching the architecture diagram. The chosen protocol must support both the 10GB-without-blocking-the-API requirement and resuming after a dropped connection (pontos de atenção).

**Options:**

### Option A: Native S3/MinIO multipart upload with presigned part URLs
- API creates the `Video` draft row and initiates a multipart upload (`CreateMultipartUpload`), returning presigned `PUT` URLs per part; the Frontend uploads parts directly to Object Storage and calls the API to `CompleteMultipartUpload`. Resume = `ListParts` to find which parts already landed, then only re-upload the missing ones.
- **Pros:** Uses exactly the SDK already selected in TD-01 with no extra server component; multipart's part-boundary resumability natively satisfies the resume-on-failure requirement; matches the architecture diagram exactly (API issues URLs, Frontend talks straight to storage); satisfies the existing BFF-bypass constraint for free.
- **Cons:** The Frontend needs its own chunking/retry orchestration (hand-rolled or via a library like Uppy's S3 plugin); the API must persist upload-session state (upload ID, per-part ETags) somewhere.

### Option B: tus resumable upload protocol (`tus-js-client` + `@tus/server`)
- A dedicated resumable-upload server (`@tus/server`, confirmed actively maintained — latest release within weeks of this writing) handles chunked `PATCH` requests and persists to storage via its own S3-backed store; `tus-js-client` (confirmed actively maintained, tracks the TUS 1.0 spec) runs in the browser and auto-resumes after any interruption.
- **Pros:** Resume logic is fully owned by mature, protocol-purpose-built libraries on both ends — less custom orchestration code than Option A; well-documented client/server contract.
- **Cons:** Adds a brand-new server component the API must run in front of storage; `@tus/server`'s S3 store still uses the AWS SDK's multipart API underneath, so this is an extra abstraction layer over Option A's primitive rather than a genuinely different mechanism; sits as a proxy in front of storage, which is a less direct fit with the diagram's "Frontend talks directly to Object Storage" arrow than Option A.

### Option C: Single-shot API-proxied upload (no resume) — included to be rejected
- The Frontend sends the whole file as one request through the API, which streams it to storage.
- **Pros:** Simplest possible implementation, no new protocol or library.
- **Cons:** Directly violates two hard requirements: the API process would have to carry the full 10GB byte stream (contradicting "sem impacto na performance" and the direct-to-storage architecture), and there is no resumability at all (contradicting the stated pontos de atenção); also conflicts with the already-decided BFF bypass for large payloads.

**Recommendation:** Option A — it reuses the storage SDK already chosen in TD-01 with no additional server component, natively satisfies both the 10GB-without-blocking and resume-on-failure requirements via `ListParts`, and matches the architecture diagram and the pre-existing frontend constraint exactly.

**Decision:** A

---

## TD-04: Video Processing Invocation Approach and Job Contract

**Scope:** Backend

**Capability:** `Transversal — covers: Processamento automático do vídeo após upload (extração de duração e metadados); Geração automática de thumbnail a partir de um frame do vídeo`

**Context:** FFmpeg itself is already fixed by the architecture diagram — this TD is only about (1) how the Worker's Node.js code invokes `ffmpeg`/`ffprobe`, and (2) the job payload and idempotency contract between the API (producer) and Worker (consumer), since both sides must agree on it regardless of which queue library TD-02 lands on. Point (1) matters now because `fluent-ffmpeg` — the long-standing default wrapper — was archived read-only in May 2025, and its own README states it "no longer works properly with recent ffmpeg versions." No currently-installed dependency exists for either axis; this is greenfield.

**Options:**

### Option A: Direct `child_process` invocation of the `ffmpeg`/`ffprobe` binaries (no wrapper library)
- Spawn `ffprobe` for metadata/duration extraction (JSON output), spawn `ffmpeg` with explicit args for single-frame thumbnail extraction, inside a thin NestJS service. Job idempotency: the Worker checks `Video.status` before acting and writes to a deterministic output object key, so a retried job overwrites rather than duplicates.
- **Pros:** Zero dependency risk (no third-party wrapper to go stale again, as just happened with `fluent-ffmpeg`), full control over flags/version compatibility, smallest supply-chain surface for a small, well-scoped CLI surface (probe + one frame extraction).
- **Cons:** More boilerplate for building argument arrays and parsing stdout/stderr than a wrapper would provide; timeouts/cancellation (`SIGKILL`) must be implemented by hand.

### Option B: A newer, actively-maintained TypeScript wrapper over the system binary
- Adopt a currently-maintained fluent-style wrapper (several emerged post-`fluent-ffmpeg` archival in 2025/2026) as a thin layer over `child_process`. Same idempotency pattern as Option A (status check + deterministic keys).
- **Pros:** Nicer call-site ergonomics (builder API instead of raw argv arrays) for the handful of operations needed here.
- **Cons:** Unproven long-term maintenance track record — the exact failure mode that killed `fluent-ffmpeg` (binary API drift outpacing an unmaintained wrapper) could recur with any newer entrant; adds a dependency for something a one-page in-house service already covers; one more layer to debug when `ffmpeg` errors surface.

**Recommendation:** Option A — the only wrapper with a multi-year track record (`fluent-ffmpeg`) is now archived and confirmed broken against current FFmpeg, and no successor has yet earned a comparable maintenance record; since the CLI surface this phase needs (probe metadata + one-frame thumbnail) is small, a thin in-house `child_process` service avoids reintroducing the exact dependency-rot risk this project just watched materialize. Idempotency is enforced via the `Video.status` field the Worker checks before processing, not via queue-level deduplication, keeping the contract simple regardless of which TD-02 queue backend is chosen.

**Decision:** A

---

## TD-05: Unique Video Identifier and URL Strategy

**Scope:** Cross-layer

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** Every existing entity (`User`, `Channel`, `RefreshToken`, `VerificationToken`) uses a UUID primary key. The question is whether this convention alone satisfies "unique URL per video, no conflicts" for both the public video route and the storage object key, or whether a separate short public-facing identifier is warranted. This spans the DB entity, the storage object key format (TD-01), and the Frontend's public route — a genuine cross-component contract.

**Options:**

### Option A: Reuse the UUID PK directly as the public route param and storage key prefix
- E.g. route `/videos/{uuid}`, object key `videos/{uuid}/original.mp4`, following the exact convention every other entity already uses.
- **Pros:** Zero new code or schema; uniqueness already guaranteed by the same PK generation strategy as every other entity; no collision risk; no extra index to maintain.
- **Cons:** UUIDs are long and not especially shareable/pretty in a URL; exposes the internal DB primary key in public URLs (a cosmetic/minor information-exposure consideration, not a security control).

### Option B: Add a separate short public-facing slug/short-code
- Generate a short unique code (e.g., base62, 8–10 chars) at draft-creation time, stored in a unique-indexed column distinct from the UUID PK; used for the public route and optionally the object key, while the UUID PK stays internal.
- **Pros:** Shorter, cleaner public URLs; decouples the public identifier from the internal PK.
- **Cons:** New column + unique index + collision-retry-on-insert logic to build and maintain; introduces a second identifier that must stay in sync everywhere the video is referenced (API responses, storage keys, Frontend routes) — extra surface for bugs to satisfy a requirement ("unique URL, no conflicts") the UUID PK already meets on its own.

**Recommendation:** Option A — it already satisfies the literal requirement with the exact mechanism every existing entity in the project uses, requires zero new code, and the only downside (URL prettiness) is not called out anywhere in the project plan's capability bullets or pontos de atenção; a short-code can be added later as a purely additive change if product needs it.

**Decision:** A

---

## TD-06: Video Lifecycle / Processing Status State Machine

**Scope:** Cross-layer

**Capability:** Pré-cadastro automático do vídeo como rascunho ao iniciar o upload

**Context:** The API (on upload start), the Worker (on processing completion/failure), and the Frontend (displaying progress) all read or write the same piece of state, so this orchestration layer needs its own agreed contract — it sits on top of, but is distinct from, the upload wire-protocol (TD-03) and the worker job contract (TD-04): those decide *how bytes move* and *how FFmpeg runs*, this decides *what state the video is in and who may change it*.

**Options:**

### Option A: Single `status` enum column on the `Video` entity
- States: `draft -> uploading -> processing -> ready` / `failed`. The API creates the row in `draft` the moment the upload session/multipart upload is initiated (before any bytes arrive), flips to `processing` once the job is enqueued, and the Worker flips to `ready` or `failed` on completion. The Frontend polls the video detail (or a lightweight status) endpoint.
- **Pros:** Single source of truth, minimal schema (one column + enum), fits the existing TypeORM entity convention directly, trivially queryable (`status = 'ready'`).
- **Cons:** Polling introduces some latency between actual completion and Frontend awareness — acceptable here since no requirement in this phase calls for real-time push updates.

### Option B: Status column plus a full status-transition history table
- Same enum column as Option A, plus a `video_status_events` table recording every transition with a timestamp and actor.
- **Pros:** Full audit trail, useful for debugging stuck/failed jobs or future SLA reporting.
- **Cons:** No literal requirement in this phase calls for an audit trail; meaningfully more schema and write-path code than Option A for a phase whose stated deliverable is simply "processamento automático funcional" — premature for a greenfield feature.

**Recommendation:** Option A — it is the minimum mechanism that satisfies "pré-cadastro automático como rascunho" and gives the Frontend exactly what it needs to display draft/processing/ready states, without building audit infrastructure that no capability bullet or pontos-de-atenção item in this phase asks for.

**Decision:** A

---

## TD-07: Frontend Upload Client Implementation Approach

**Scope:** Frontend

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** TD-03 fixed the wire protocol (native S3/MinIO multipart upload with presigned part URLs issued by the backend), but left open how the frontend actually drives that protocol in the browser — chunking the file, PUTing each part, tracking progress, retrying failed parts, and persisting enough state to resume after a dropped connection or page reload, as called out explicitly in TD-03's Cons ("needs its own chunking/retry orchestration — hand-rolled or via a library like Uppy's S3 plugin"). The frontend never holds AWS/MinIO credentials — it only ever PUTs to presigned URLs supplied by the backend, which rules out any library that expects to own its own signing/credentials (e.g. `@aws-sdk/lib-storage`'s `Upload` helper does not fit, since it computes its own signed requests rather than driving externally-supplied presigned URLs).

**Options:**

### Option A: Hand-rolled chunking/retry/progress/resume
- Slice the `File` via `File.slice()` into parts matching the backend's part size, PUT each part via `XMLHttpRequest` (needed for `upload.onprogress` — `fetch()` still has no cross-browser way to report upload progress as of 2026), implement retry/backoff per part, and persist the multipart `uploadId` + a `(PartNumber → ETag)` map in IndexedDB so an interrupted upload can resume after a reload by validating file identity (name/size/lastModified) and re-PUTing only the missing parts.
- **Pros:** Zero new dependency; full control over retry policy, concurrency, and the exact resume UX; no third-party event model to learn.
- **Cons:** Rebuilds, in-house, a meaningful amount of logic (progress via XHR, backoff, IndexedDB-backed resume-state, part-identity validation) that is exactly what a purpose-built library already solves and has already hardened against edge cases.

### Option B: Uppy (`@uppy/core` + `@uppy/aws-s3`, `signRequest` mode, headless)
- Uppy 6.x merged `@uppy/aws-s3-multipart` into `@uppy/aws-s3` (`shouldUseMultipart: true`); its `signRequest(file, { method, url, key, uploadId, partNumber })` signing mode calls our own backend per-operation (create MPU, each part, list parts, complete, abort) and returns `{ url, headers? }` — no Uppy Companion proxy server, no AWS credentials in the browser. Uppy 5.0+ supports fully headless usage (`uppy.addFile()` + `uppy.upload()` driven via events/hooks, no UI widget required).
- **Pros:** Actively maintained (patch releases through Nov 2026, 31k GitHub stars); the `signRequest` mode is a direct, currently-supported fit for our exact "presigned-URL-only, no Companion, no credentials" architecture; absorbs progress/retry/chunking/resume plumbing that Option A would otherwise hand-roll.
- **Cons:** New dependency with its own event model to learn; a known 2026 issue (#6548) notes `signRequest` cannot fully forward custom headers some presigned-URL schemes need — must be verified against MinIO's presigned-PUT header requirements during implementation.

### Option C: React-Uploady (`@rpldy/uploady` + `@rpldy/chunked-uploady`)
- A React-specific upload library (latest `@rpldy/uploady` published Nov 2025, actively maintained); its chunking is generic (splits into blobs sent with `Content-Range` headers), not S3-multipart-aware.
- **Pros:** Maintained, React-idiomatic hooks-based API.
- **Cons:** Confirmed (GitHub discussion) to have no built-in support for uploading chunks to a presigned URL in S3-multipart shape — would require reimplementing ETag collection and the `CompleteMultipartUpload` payload via its `useRequestPreSend`/`CHUNK_START` hooks anyway, which is not meaningfully less work than Option A for this specific protocol.

**Recommendation:** Option B — Uppy's `signRequest` mode is a currently-maintained, purpose-built fit for exactly this "presigned-URL-only, no credentials, no Companion" pattern, and running it headless avoids pulling in any UI assumptions incompatible with the project's own upload UI; it saves hand-building and hardening the progress/retry/resume-state machinery that a 10GB resumable upload needs, at the one-time cost of verifying the `signRequest` header-forwarding limitation against MinIO during implementation.

**Decision:** B
**Libraries:** @uppy/core, @uppy/aws-s3

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Cross-layer | Object Storage Backend and SDK | MinIO (dev/CI) + AWS S3 (staging/prod), same AWS SDK v3 client | C |
| TD-02 | Backend | Background Job Queue Broker and Library | BullMQ on its PostgreSQL backend via `@nestjs/bullmq` | B |
| TD-03 | Cross-layer | Large-File Upload Protocol with Resume | Native S3/MinIO multipart upload with presigned part URLs | A |
| TD-04 | Backend | Video Processing Invocation Approach and Job Contract | Direct `child_process` + `ffprobe`, no wrapper library | A |
| TD-05 | Cross-layer | Unique Video Identifier and URL Strategy | Reuse existing UUID PK convention | A |
| TD-06 | Cross-layer | Video Lifecycle / Processing Status State Machine | Single `status` enum column, no history table | A |
| TD-07 | Frontend | Frontend Upload Client Implementation Approach | Uppy (`@uppy/aws-s3`, `signRequest` mode, headless) | B |
