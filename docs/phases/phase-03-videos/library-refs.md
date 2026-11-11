---
libs:
  "@aws-sdk/client-s3":
    version: "^3.1166.0"
    context7_id: "n/a (local node_modules — Context7 MCP unavailable)"
    fetched_at: "2026-11-10T21:25:43-03:00"
  "@aws-sdk/s3-request-presigner":
    version: "^3.1166.0"
    context7_id: "n/a (local node_modules — Context7 MCP unavailable)"
    fetched_at: "2026-11-10T21:25:43-03:00"
  bullmq:
    version: "^6.7.3"
    context7_id: "n/a (local node_modules — Context7 MCP unavailable)"
    fetched_at: "2026-11-10T21:25:43-03:00"
  "@nestjs/bullmq":
    version: "^11.0.5"
    context7_id: "n/a (local node_modules — Context7 MCP unavailable)"
    fetched_at: "2026-11-10T21:25:43-03:00"
  "@uppy/core":
    version: "^6.3.1"
    context7_id: "n/a (local node_modules — Context7 MCP unavailable)"
    fetched_at: "2026-11-10T21:25:43-03:00"
  "@uppy/aws-s3":
    version: "^6.3.1"
    context7_id: "n/a (local node_modules — Context7 MCP unavailable)"
    fetched_at: "2026-11-10T21:25:43-03:00"
sources_mtime:
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-11-10T21:25:38-03:00"
---

# phase-03-videos — Library References

Distilled docs for libraries decided in this slice. **Source:** the installed packages' `README.md` + `.d.ts` type definitions in `nestjs-project/node_modules/` and `next-frontend/node_modules/` (exact installed versions listed in the frontmatter). The Context7 MCP was unavailable when this cache was built, so the `context7_id` fields are marked `n/a`. Re-fetch via Context7 when it is available or when the underlying TD changes.

## @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner

**Maps to:** `phase-03-videos/TD-01` Decision C (MinIO in dev/CI, real S3 later, same SDK) and `phase-03-videos/TD-03` Decision A (S3 multipart upload with presigned part URLs, resumed via `ListParts`). Installed: `3.1166.0` (both packages share the same version line — keep them in lock-step).

### Client construction (MinIO-compatible)

```typescript
import { S3Client } from "@aws-sdk/client-s3";

new S3Client({
  region: config.region,          // any value works for MinIO; required for SigV4
  endpoint: config.endpoint,      // e.g. http://minio:9000 (Compose service name, never localhost)
  forcePathStyle: config.forcePathStyle, // true for MinIO: http://host/bucket/key
  credentials: { accessKeyId, secretAccessKey },
});
```

- `forcePathStyle: true` is what makes MinIO work; real S3 can use virtual-host style (`false`). Moving to S3 is a config change only (TD-01).
- The client is provided once via a DI token (`STORAGE_S3_CLIENT`) in `StorageModule` and injected into `StorageService` — tests swap the token, not the class.
- Every operation is `client.send(new XxxCommand(input))`.

### Multipart commands used by TD-03

| Command | Key input | Output used |
|---|---|---|
| `CreateMultipartUploadCommand` | `Bucket`, `Key` | `UploadId` (may be `undefined` in the types — guard it) |
| `UploadPartCommand` | `Bucket`, `Key`, `UploadId`, `PartNumber` | presigned — never sent by the API |
| `ListPartsCommand` | `Bucket`, `Key`, `UploadId` | `Parts[].{PartNumber, ETag}` — the source of truth for resume |
| `CompleteMultipartUploadCommand` | `Bucket`, `Key`, `UploadId`, `MultipartUpload.Parts[].{PartNumber, ETag}` | — |
| `AbortMultipartUploadCommand` | `Bucket`, `Key`, `UploadId` | — |
| `GetObjectCommand` | `Bucket`, `Key`, optional `ResponseContentDisposition` | `Body` (a Node `Readable` on the server) |
| `PutObjectCommand` | `Bucket`, `Key`, `Body`, optional `ContentType` | — (worker thumbnail upload) |

- S3 rules: parts are numbered `1..10000`, every part except the last must be ≥ 5 MiB. Choose a chunk size so a 10 GB file stays under 10 000 parts.
- `CompleteMultipartUpload` needs the parts in ascending `PartNumber` order with the exact `ETag` values (including the quotes S3 returns).
- Incomplete multipart uploads keep using storage until they are aborted. Call `AbortMultipartUpload`, or set a bucket lifecycle rule, for abandoned sessions.

### Presigning (`getSignedUrl`)

```typescript
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const url = await getSignedUrl(client, new UploadPartCommand({ Bucket, Key, UploadId, PartNumber }), {
  expiresIn: seconds, // default 900; S3's SigV4 maximum is 7 days (604800)
});
```

- Signature: `getSignedUrl(client, command, options?: RequestPresigningArguments) => Promise<string>`.
- Options worth knowing: `expiresIn`; `signableHeaders` / `unsignableHeaders`; `unhoistableHeaders` / `hoistableHeaders`, which control whether a header goes into the query string or must be sent by the caller.
- Presigned `GetObjectCommand` URLs are how the frontend streams and downloads directly from storage. `ResponseContentDisposition: 'attachment; filename="..."'` turns a stream URL into a download URL.
- The browser `PUT`s the part directly to MinIO/S3. The bucket's CORS config must allow `PUT` from the frontend origin **and expose the `ETag` response header**, or the client cannot read the part ETag.
- The hostname in a presigned URL is the `endpoint` the API was configured with. If the API reaches MinIO via the Compose name (`minio:9000`) but the browser cannot resolve that name, sign with a client whose `endpoint` is the public storage URL. The host is part of the signature, so you cannot rewrite it afterwards.

### Testing notes

- Unit tests: mock the injected `S3Client` (`send` as `jest.fn()`) and assert on the command `input`, e.g. `expect(send.mock.calls[0][0].input).toEqual({...})`. `getSignedUrl` is a module function, so mock `@aws-sdk/s3-request-presigner` with `jest.mock`.
- Integration tests: use the real MinIO container from `compose.yaml`.

## bullmq + @nestjs/bullmq

**Maps to:** `phase-03-videos/TD-02` Decision B (BullMQ on its **PostgreSQL backend**, no Redis). Installed: `bullmq 6.7.3`, `@nestjs/bullmq 11.0.5`. `pg 8.23.1` is the driver the Postgres backend loads.

### Version constraint (important)

- `@nestjs/bullmq@11.x` peer range: `@nestjs/common ^10 || ^11`, `bullmq ^3 || ^4 || ^5 || ^6`.
- `@nestjs/bullmq@12.x` adds a `backendFactory` DI option but is **ESM-only**, which breaks Jest's CJS runtime here. So the project stays on 11.x and selects the Postgres backend **process-wide** instead:

```typescript
// src/videos/video-queue-backend.ts — must be imported before any Queue/Worker is constructed
import { createPostgresBackend, setDefaultBackendFactory } from "bullmq";
setDefaultBackendFactory(createPostgresBackend);
```

- `setDefaultBackendFactory(factory?)` overrides the process-wide default `BackendFactory` for every Queue/Worker/FlowProducer. Calling it with no argument resets to Redis. It changes runtime behaviour only, not the constructor types; `withBackend` keeps the factory's types if you need them.
- `bullmq` declares `ioredis`, `pg` and `bullmq-otel` as **optional** peer dependencies. `pg` is loaded lazily only when the Postgres backend builds its own pool.

### Postgres connection options

`PostgresConnectionOptions = pg.Pool | PostgresPoolConfig | string`, where `PostgresPoolConfig = pg.PoolConfig & { schema?, skipVersionCheck?, migrate?, skipMigrations? }`.

- **Config object**: BullMQ builds and owns the pool and pins `search_path` to `schema`. This is the only form that honours `schema`.
- **Connection string**: always uses the default schema. To pick a schema, wrap it as `{ connectionString, schema }`.
- **Existing `pg.Pool`**: used as-is and **not** closed on `close()`. Always uses the default schema.
- The backend keeps a `pg.Pool` for queries plus one dedicated long-lived `LISTEN` client for blocking "wait for job". Budget one extra DB connection per worker.
- BullMQ runs its own migrations on the queue schema; `migrate` / `skipMigrations` control this. These tables are **not** managed by TypeORM migrations, so do not drop the schema between tests unless you mean to.

In this project the connection is set in `BullModule.forRootAsync` using the `databaseConfig` values (`host`, `port`, `user`, `password`, `database`). The keys follow `pg.PoolConfig` names (`user`, `database`), not the TypeORM names (`username`).

### Nest wiring

```typescript
BullModule.forRootAsync({ inject: [databaseConfig.KEY], useFactory: (db) => ({ connection: { /* pg PoolConfig */ } }) }),
BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE }),
```

- Producer: `@InjectQueue(name) queue: Queue` then `queue.add(jobName, data, opts?)`. Token helper for tests: `getQueueToken(name)`.
- Consumer: `@Processor(name[, workerOptions]) class X extends WorkerHost { async process(job: Job, token?: string) }`. `WorkerHost` exposes `this.worker`.
- Worker events: `@OnWorkerEvent('completed' | 'failed' | 'active' | ...)` on methods of the `@Processor` class (keys of `WorkerListener`).
- Other APIs: `registerQueueAsync`, a named-config `forRootAsync(configKey, ...)`, `@QueueEventsListener` + `@OnQueueEvent`, `@InjectFlowProducer`.

### Job options relevant to processing reliability (`BaseJobOptions`)

- `attempts` (total tries) + `backoff: number | { type: 'fixed' | 'exponential', delay }`.
- `jobId`: a custom unique id. Adding a job whose id already exists is ignored, so this gives queue-level deduplication if ever needed. TD-04 instead enforces idempotency via `Video.status`.
- `removeOnComplete` / `removeOnFail`: `boolean | number | KeepJobs`. Set these to stop the queue tables growing without limit.
- Throw `UnrecoverableError` from `process()` to fail immediately without retrying (e.g. the source file is corrupt or missing). Any other thrown error uses up an attempt.

### Testing notes

- Unit: provide `{ provide: getQueueToken(VIDEO_PROCESSING_QUEUE), useValue: { add: jest.fn() } }`. Unit-test the worker by calling `worker.process(fakeJob)` directly. No backend is needed.
- Integration: import `video-queue-backend.ts` first, use the real Postgres `db` service, and `close()` queues/workers in `afterAll` (the `LISTEN` client keeps the process alive otherwise). E2E runs `--runInBand` because of shared queue state.

## @uppy/core + @uppy/aws-s3

**Maps to:** `phase-03-videos/TD-07` Decision B (headless Uppy in `signRequest` mode, no Companion, no credentials in the browser). Installed: `6.3.1` for both.

### Setup

```typescript
import Uppy from "@uppy/core";
import AwsS3 from "@uppy/aws-s3";

const uppy = new Uppy().use(AwsS3, {
  shouldUseMultipart: true,            // default: multipart only for files > 100 MB
  signRequest: (request) => signUploadRequest(request),
  // getChunkSize?: ({ size }) => number,  // keep parts ≥ 5 MiB and ≤ 10 000 parts
  // limit?: number,                       // concurrent files (default 6); parts of one file go sequentially
});
```

`AwsS3Options` takes **exactly one** signing mode: `signRequest`, `getCredentials` + `s3Endpoint` (STS temporary credentials), or `companionEndpoint`. The project uses only `signRequest`.

### `signRequest` contract

`SignRequestFn = (request: PresignableRequest) => Promisable<PresignedResponse>`

`PresignableRequest` is a union discriminated by `method` and fields:

| Operation | Shape |
|---|---|
| PutObject (non-multipart) | `{ method: 'PUT', key }` |
| CreateMultipartUpload | `{ method: 'POST', key }` (no `uploadId`) |
| UploadPart | `{ method: 'PUT', key, uploadId, partNumber }` |
| ListParts | `{ method: 'GET', key, uploadId }` |
| CompleteMultipartUpload | `{ method: 'POST', key, uploadId }` |
| AbortMultipartUpload | `{ method: 'DELETE', key, uploadId }` |

`PresignedResponse = { url, key?, headers?, fields? }`:
- `key` overrides the object key; it is only honoured on PutObject and CreateMultipartUpload.
- `headers` are the headers the URL was signed with, and they are sent on the request. Each one must be in the bucket CORS `AllowedHeaders`. Never include browser-forbidden headers (`Host`, `Content-Length`, `Date`).
- `fields` is for the POST-policy form upload. It only applies to PutObject, not to multipart.

**Project deviation (by design):** the API creates the multipart upload during `POST /videos` and runs `CompleteMultipartUpload` itself during `POST /videos/:id/complete`. `signUploadRequest` therefore signs only `UploadPart`. Every other operation throws `UnsupportedMultipartOperationError`, and `complete-upload.ts` catches the "complete" rejection from `upload-error` and calls the backend with the collected parts. Uppy needs the upload's `{ uploadId, key }` up front. Its resume state is stored as `file.s3Multipart: { uploadId, key }`, the same field Golden Retriever persists.

### Events used

- `s3-multipart:part-uploaded` → `(file, { PartNumber, ETag })`. The project collects parts per `file.id` from this event.
- `upload-progress` → `(file, progress)`. Drives the progress UI.
- `upload-success` → `(file, response)`. `AwsBody` is `{ location, key }`.
- `upload-error` → `(file, error, response?)`.

### Testing notes

- Unit-test `signUploadRequest` (one request shape per row of the table above) and `wireUploadCompletion`. Test the second with a fake emitter or a real `new Uppy()` and `uppy.emit(...)`. Mock `/api/videos/:id/parts/sign` with MSW, as `next-frontend-msw-foundation` does.
- `create-uppy.ts` builds a module-level singleton. Import it lazily in tests, or use `jest.isolateModules`, so state does not leak between tests.
