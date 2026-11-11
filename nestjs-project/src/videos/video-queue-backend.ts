import { createPostgresBackend, setDefaultBackendFactory } from 'bullmq';

/**
 * `@nestjs/bullmq@11.x` (the CJS-compatible release line) predates the
 * `backendFactory` DI option added in 12.x (ESM-only, incompatible with
 * Jest's CJS test runtime). Overriding the process-wide default backend
 * achieves the same Postgres-instead-of-Redis wiring without that option.
 */
setDefaultBackendFactory(createPostgresBackend);
