---
kind: phase
name: phase-03-videos
test_specs_aware: true
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-11-10T16:53:57-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-11-10T16:41:28-03:00"
  docs/decisions/technical-decisions-next-frontend-config-base.md: "2026-11-10T15:21:35-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-11-10T15:21:35-03:00"
---

# Phase 03 — Upload e Processamento de Vídeos

## Objective

Implementar o upload resumível de vídeos de até 10GB direto para o Object Storage, o pré-cadastro automático do vídeo como rascunho ao iniciar o upload, o processamento automático em segundo plano (extração de duração/metadados e geração de thumbnail via FFmpeg), um identificador único por vídeo sem conflito, e a reprodução via streaming e download direto do Object Storage — entregando um serviço de armazenamento de arquivos (vídeos e thumbnails) e um serviço de processamento em segundo plano (filas) funcionais.

---

## Step Implementations

### SI-03.1 — Criar entidade Video e migração

**Description:** Entidade `Video` (TypeORM) + migração, com o enum de status e a relação com `Channel` — base de dados para todo o resto da fase.

**Technical actions:**

1. Criar migration TypeORM adicionando a tabela `video` com enum `status` (`draft`, `uploading`, `processing`, `ready`, `failed`) (per `phase-03-videos/TD-06`)
2. Criar entidade `Video` (TypeORM) com campos `id`, `channel_id`, `status`, `upload_id`, `duration`, `metadata`, `created_at`, `updated_at` e relação many-to-one com `Channel` (per `phase-03-videos/TD-05`, `phase-03-videos/TD-06`)
3. Registrar `Video` no `VideosModule` via `TypeOrmModule.forFeature`

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `Video` | Integration: constraints, defaults, enum, FK | `video.entity.integration-spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- Inserir um `Video` sem `status` persiste com `status` padrão `draft`
- Inserir um `Video` com `channel_id` inexistente viola a constraint de FK
- Inserir um `Video` com `status` fora do enum `draft`/`uploading`/`processing`/`ready`/`failed` é rejeitado
- `updated_at` é atualizado em cada transição de `status`

---

### SI-03.2 — Cliente de Object Storage (presigned URLs)

**Description:** `StorageService` encapsulando o SDK S3/MinIO — multipart upload, listagem de partes e URLs assinadas de leitura para streaming/download/thumbnail.

**Technical actions:**

1. Instalar `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`; criar `storage.config.ts` namespaced (`registerAs`) com `endpoint`/`forcePathStyle` por ambiente — MinIO em dev/CI, S3 em staging/prod (per `phase-03-videos/TD-01`)
2. Implementar `StorageService.createMultipartUpload(key)` (per `phase-03-videos/TD-03`)
3. Implementar `StorageService.signPartUrl({ uploadId, key, partNumber })` retornando `{ url, headers? }` (per `phase-03-videos/TD-03`, `phase-03-videos/TD-07`)
4. Implementar `StorageService.listParts({ uploadId, key })`, `completeMultipartUpload`, `abortMultipartUpload` (per `phase-03-videos/TD-03`)
5. Implementar `StorageService.getPresignedGetUrl(key, { disposition? })` para streaming/download/thumbnail (per `phase-03-videos/TD-01`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `StorageService` | Unit: branch logic (mock AWS SDK client) | `storage.service.spec.ts` |
| `StorageService` | Integration: contrato real contra MinIO (serviço do `compose.yaml`) | `storage.service.integration-spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- `createMultipartUpload` retorna um `uploadId` válido
- `signPartUrl` retorna uma URL assinada que aceita um `PUT` direto ao MinIO
- `listParts` reflete as partes já enviadas para um `uploadId` em andamento
- `completeMultipartUpload` finaliza o objeto e o torna recuperável via `getPresignedGetUrl`
- a configuração aponta para MinIO em dev/CI e para S3 em staging/prod via `storage.config.ts`

---

### SI-03.3 — Módulo de fila de processamento em segundo plano

**Description:** Fila BullMQ sobre o backend PostgreSQL e o producer que enfileira o job de processamento de vídeo.

**Technical actions:**

1. Instalar `@nestjs/bullmq` configurado com o backend PostgreSQL do BullMQ (per `phase-03-videos/TD-02`)
2. Registrar `BullModule` em `VideosModule`, definindo a fila `video-processing`
3. Implementar `VideoQueueProducer.enqueueProcessing(videoId)` publicando o job `video.process` com payload `{ videoId }` (per `phase-03-videos/TD-02`, `phase-03-videos/TD-04`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoQueueProducer` | Unit: branch logic (mock Queue) | `video-queue.producer.spec.ts` |
| `VideosModule` | Unit: compilation test | `videos.module.spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- `enqueueProcessing` publica um job na fila `video-processing` com `{ videoId }`
- O módulo compila com o backend PostgreSQL do BullMQ configurado, sem exigir Redis

---

### SI-03.4 — Endpoints de sessão de upload

**Description:** `POST /videos`, `POST /videos/:id/parts/sign`, `GET /videos/:id/parts`, `POST /videos/:id/complete` e `POST /videos/:id/abort` — o contrato de wire do upload multipart resumível.
**Route:** POST /videos _(demais rotas da sessão de upload: `POST /videos/:id/parts/sign`, `GET /videos/:id/parts`, `POST /videos/:id/complete`, `POST /videos/:id/abort` — ver `### API Contracts`)_
**Test Specs:** see `nestjs-project/specs/videos.plan.md`

**Technical actions:**

1. Criar `UploadSessionService` (cria o draft + `CreateMultipartUpload`, assina partes, lista partes, completa e aborta) (per `phase-03-videos/TD-01`, `phase-03-videos/TD-03`, `phase-03-videos/TD-05`)
2. Criar `VideosController` com os 5 endpoints HTTP de sessão de upload (per `phase-03-videos/TD-03`, `phase-03-videos/TD-07`)
3. Criar DTOs de request/response (`SignPartDto`, `CompleteUploadDto`, `AbortUploadDto`)
4. Restringir os endpoints ao canal do usuário autenticado (owner-only)
5. Ao completar o upload, chamar `VideoQueueProducer.enqueueProcessing` e transicionar `status` para `processing` (per `phase-03-videos/TD-02`, `phase-03-videos/TD-06`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `UploadSessionService` | Unit: branch logic (mock repo + mock `StorageService`) | `upload-session.service.spec.ts` |
| `UploadSessionService` | Integration: contrato com DB | `upload-session.service.integration-spec.ts` |

_(E2E do `VideosController` autorado externamente via `/plan-test-specs` — ver `**Test Specs:**` acima.)_

**Dependencies:** SI-03.1, SI-03.2, SI-03.3

**Acceptance criteria:**

- `POST /videos` retorna `201` com `id`, `status: "draft"`, `uploadId` e `key`
- `POST /videos/:id/parts/sign` com `partNumber` válido retorna `200` com `url`
- `POST /videos/:id/parts/sign` quando `Video.status` não é `uploading` retorna `409` com `errorCode: "INVALID_UPLOAD_STATE"`
- `GET /videos/:id/parts` retorna a lista de partes já enviadas para o `uploadId`
- `POST /videos/:id/complete` com partes válidas transiciona `status` para `processing` e enfileira o job de processamento
- `POST /videos/:id/abort` aborta a sessão de upload em andamento
- operações referenciando um vídeo de outro canal retornam `404` com `errorCode: "VIDEO_NOT_FOUND"`

---

### SI-03.5 — Endpoint de detalhe/status do vídeo

**Description:** `GET /videos/:id` — o endpoint que o Frontend consulta para exibir o progresso (draft/uploading/processing/ready/failed) e obter as URLs de streaming/download/thumbnail quando pronto.
**Route:** GET /videos/:id
**Test Specs:** see `nestjs-project/specs/videos-detail.plan.md`

**Technical actions:**

1. Adicionar o método `GET /videos/:id` ao `VideosController` (per `phase-03-videos/TD-06`)
2. Implementar a montagem condicional de `streamUrl`/`downloadUrl`/`thumbnailUrl` via `StorageService.getPresignedGetUrl`, apenas quando `status` é `ready` (per `phase-03-videos/TD-01`)

**Tests:** _(empty — E2E do `VideosController` autorado externamente via `/plan-test-specs`; ver `**Test Specs:**` acima)_

**Dependencies:** SI-03.1, SI-03.2

**Acceptance criteria:**

- `GET /videos/:id` com `status` em `draft`/`uploading`/`processing` retorna `200` sem `streamUrl`/`downloadUrl`/`thumbnailUrl`
- `GET /videos/:id` com `status: "ready"` retorna `200` com `streamUrl`, `downloadUrl` e `thumbnailUrl` preenchidos
- `GET /videos/:id` para um vídeo inexistente ou de outro canal retorna `404` com `errorCode: "VIDEO_NOT_FOUND"`

---

### SI-03.6 — Worker de processamento de vídeo

**Description:** Consumidor BullMQ que extrai duração/metadados via `ffprobe` e gera a thumbnail via `ffmpeg`, atualizando o `status` do vídeo ao final.

**Technical actions:**

1. Criar o `VideoProcessingWorker` (processor BullMQ) consumindo o job `video.process` (per `phase-03-videos/TD-02`, `phase-03-videos/TD-04`)
2. Implementar extração de duração/metadados via `child_process` (`ffprobe`, saída JSON) (per `phase-03-videos/TD-04`)
3. Implementar geração de thumbnail de um frame via `child_process` (`ffmpeg`), gravando em `videos/{id}/thumbnail.jpg` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-04`, `phase-03-videos/TD-05`)
4. Persistir `duration`/`metadata` e transicionar `status` para `ready` ao final (per `phase-03-videos/TD-06`)
5. Checar `Video.status` antes de processar (idempotência) e transicionar para `failed` em caso de erro (per `phase-03-videos/TD-04`, `phase-03-videos/TD-06`)

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoProcessingWorker` | Unit: branch logic (mock `child_process`, mock repo) | `video-processing.worker.spec.ts` |
| `VideoProcessingWorker` | Integration: fluxo real com `ffmpeg`/`ffprobe` contra um fixture de vídeo pequeno | `video-processing.worker.integration-spec.ts` |

**Dependencies:** SI-03.1, SI-03.3

**Acceptance criteria:**

- Job com vídeo válido extrai `duration` e `metadata` e transiciona `status` para `ready`
- Job com vídeo corrompido/erro de `ffmpeg` transiciona `status` para `failed`
- Reexecutar o mesmo job sobre um vídeo já `ready` não duplica efeitos (checagem de `Video.status`)
- A thumbnail é gravada em `videos/{id}/thumbnail.jpg`

---

### SI-03.7 — Cliente de upload Uppy headless (Setup)

**Frontend Runtime spec:** see `## Technical Specifications` → `### Frontend Runtime` → `#### phase-03-videos/TD-07 — Frontend Upload Client Implementation Approach`

**Technical actions:**

1. Instalar `@uppy/core` + `@uppy/aws-s3` no `next-frontend` (per `phase-03-videos/TD-07`)
2. Implementar `next-frontend/lib/upload/create-uppy.ts` com o snippet canônico de wiring (`shouldUseMultipart: true` + `signRequest`) byte-verbatim conforme `### Frontend Runtime` (per `phase-03-videos/TD-07`)
3. Implementar `signUploadRequest` chamando `POST /videos/:id/parts/sign` com `{ method, url, key, uploadId, partNumber }` e retornando `{ url, headers? }` (per `phase-03-videos/TD-07`)

**Dependencies:** —

**Tests:** _(empty — Setup SI; behavior tests live in SI-03.8 Verification)_

**Acceptance criteria:**

- `@uppy/core` e `@uppy/aws-s3` instalados e registrados no `package.json` do `next-frontend`
- `create-uppy.ts` exporta uma instância Uppy configurada com `shouldUseMultipart: true` e `signRequest` apontando para `signUploadRequest`
- A aplicação next-frontend compila sem erro de runtime relacionado ao novo módulo

---

### SI-03.8 — Cliente de upload Uppy headless (Verification)

**Frontend Runtime spec:** see `## Technical Specifications` → `### Frontend Runtime` → `#### phase-03-videos/TD-07 — Frontend Upload Client Implementation Approach` → Verificação

**Technical actions:**

1. Escrever teste unitário de `signUploadRequest` (per `phase-03-videos/TD-07`)
2. Escrever teste de integração do fluxo multipart headless do Uppy com partes mockadas via MSW, encerrando em `POST /videos/:id/complete`

**Dependencies:** SI-03.7

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `signUploadRequest` | Unit | `sign-upload-request.test.ts` |
| `create-uppy` (fluxo multipart) | Integration (MSW) | `create-uppy.integration.test.ts` |

**Acceptance criteria:**

- `signUploadRequest` chama `POST /videos/:id/parts/sign` com os campos `{ method, url, key, uploadId, partNumber }` e retorna `{ url, headers? }`
- O fluxo multipart simulado aciona `POST /videos/:id/complete` com a lista de partes `{ partNumber, ETag }` coletada

---

## Technical Specifications

### Data Model

#### Video

| Field | Type | Constraints |
|-------|------|-------------|
| id | uuid | PK, generated |
| channel_id | uuid | FK → Channel.id, not null |
| status | enum (`draft`, `uploading`, `processing`, `ready`, `failed`) | not null, default `draft` |
| upload_id | varchar | nullable — multipart `uploadId` (per `phase-03-videos/TD-03`, `phase-03-videos/TD-07`) |
| duration | integer | nullable, seconds — populated by the Worker after metadata extraction (per `phase-03-videos/TD-04`) |
| metadata | jsonb | nullable — raw `ffprobe` metadata output (per `phase-03-videos/TD-04`) |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | updated on every status transition |

**Relations:** `Video` belongs to `Channel` (many-to-one, `channel_id`)
**Indexes:** index on `channel_id`; index on `status`

**Object storage keys** (derived from `id`, never persisted as columns — per `phase-03-videos/TD-05` Option A's `videos/{uuid}/...` convention):
- Original file: `videos/{id}/original.mp4`
- Thumbnail: `videos/{id}/thumbnail.jpg`

### API Contracts

#### POST /videos (SI-03.4)

**Request headers:**
- Content-Type: application/json

**Request body:** _(none — o draft é criado para o canal do usuário autenticado)_

**Response 201:**
- id: string (uuid)
- status: string — `draft` (per `phase-03-videos/TD-06`)
- uploadId: string — ID do multipart upload (per `phase-03-videos/TD-03`, `phase-03-videos/TD-07`)
- key: string — chave no object storage, `videos/{id}/original.mp4` (per `phase-03-videos/TD-05`)

**Error responses:**
- 400 validation error: quando o corpo da requisição falha na validação do schema

---

#### POST /videos/:id/parts/sign (SI-03.4)

**Request body:**
- method: string, required (per `phase-03-videos/TD-07`)
- uploadId: string, required (per `phase-03-videos/TD-07`)
- partNumber: integer, required (per `phase-03-videos/TD-07`)

**Response 200:**
- url: string — URL assinada para o PUT da parte (per `phase-03-videos/TD-07`)
- headers: object, optional (per `phase-03-videos/TD-07`)

**Error responses:**
- 404 VIDEO_NOT_FOUND: quando `id` não existe ou não pertence ao canal do usuário autenticado
- 409 INVALID_UPLOAD_STATE: quando `Video.status` não é `uploading`
- 400 validation error

---

#### GET /videos/:id/parts (SI-03.4)

**Request query parameters:**
- uploadId: string, required (per `phase-03-videos/TD-03`, `phase-03-videos/TD-07`)

**Response 200:**
- parts: array of `{ partNumber: integer, ETag: string }` — proxy do `ListParts` (per `phase-03-videos/TD-03`)

**Error responses:**
- 404 VIDEO_NOT_FOUND
- 409 INVALID_UPLOAD_STATE
- 400 validation error

---

#### POST /videos/:id/complete (SI-03.4)

**Request body:**
- uploadId: string, required (per `phase-03-videos/TD-07`)
- parts: array of `{ partNumber: integer, ETag: string }`, required (per `phase-03-videos/TD-03`)

**Response 200:**
- id: string (uuid)
- status: string — `processing` (per `phase-03-videos/TD-06`)

**Error responses:**
- 404 VIDEO_NOT_FOUND
- 409 INVALID_UPLOAD_STATE
- 400 validation error

---

#### POST /videos/:id/abort (SI-03.4)

**Request body:**
- uploadId: string, required (per `phase-03-videos/TD-07`)

**Response 204:** No content.

**Error responses:**
- 404 VIDEO_NOT_FOUND
- 409 INVALID_UPLOAD_STATE
- 400 validation error

---

#### GET /videos/:id (SI-03.5)

**Response 200:**
- id: string (uuid)
- status: string — um de `draft`, `uploading`, `processing`, `ready`, `failed` (per `phase-03-videos/TD-06`)
- duration: integer, nullable — segundos (per `phase-03-videos/TD-04`)
- streamUrl: string, nullable — URL assinada (GET) para o arquivo original; presente apenas quando `status` é `ready` (per `phase-03-videos/TD-01`)
- downloadUrl: string, nullable — URL assinada (GET) com disposição de anexo; presente apenas quando `status` é `ready` (per `phase-03-videos/TD-01`)
- thumbnailUrl: string, nullable — URL assinada (GET) para a thumbnail; presente apenas quando `status` é `ready` (per `phase-03-videos/TD-01`)

**Error responses:**
- 404 VIDEO_NOT_FOUND

---

#### Validation Rules — upload session

- `partNumber`: required, integer ≥ 1
- `uploadId`: required, string
- `parts`: required, non-empty array quando presente em `/complete`

### Authorization Matrix

| Endpoint | Anonymous | Authenticated | Owner |
|----------|-----------|----------------|-------|
| POST /videos | ✗ | ✗ | ✓ |
| POST /videos/:id/parts/sign | ✗ | ✗ | ✓ |
| GET /videos/:id/parts | ✗ | ✗ | ✓ |
| POST /videos/:id/complete | ✗ | ✗ | ✓ |
| POST /videos/:id/abort | ✗ | ✗ | ✓ |
| GET /videos/:id | ✗ | ✗ | ✓ |

### Error Catalog

| errorCode | HTTP | Trigger |
|-----------|------|---------|
| VIDEO_NOT_FOUND | 404 | Operação referenciando um `id` de vídeo que não existe ou não pertence ao canal do usuário autenticado |
| INVALID_UPLOAD_STATE | 409 | Requisitar parte, listar partes, completar ou abortar upload quando `Video.status` não é `uploading` |

_Formato de resposta de erro (`{ statusCode, error, message }`) herdado de `phase-02-auth/TD-07` — os `errorCode`s acima populam o campo `error` desse envelope; não é redefinido nesta fase._

### Events/Messages

#### video.process

**Payload:**

```json
{ "videoId": "uuid" }
```

**Producer:** `UploadSessionService` (per `phase-03-videos/TD-02`, `phase-03-videos/TD-06`)
**Consumer:** `VideoProcessingWorker` (per `phase-03-videos/TD-02`, `phase-03-videos/TD-04`)
**Trigger:** enfileirado imediatamente após o `CompleteMultipartUpload` suceder, quando `Video.status` passa de `uploading` para `processing` (per `phase-03-videos/TD-06`)
**Delivery semantics:** at-least-once (padrão do BullMQ); idempotência garantida pela checagem de `Video.status` pelo Worker antes de processar, não por deduplicação em nível de fila (per `phase-03-videos/TD-04`)

### Frontend Runtime

#### phase-03-videos/TD-07 — Frontend Upload Client Implementation Approach

**Pattern:** Uppy's `signRequest` mode is a currently-maintained, purpose-built fit for exactly this "presigned-URL-only, no credentials, no Companion" pattern, and running it headless avoids pulling in any UI assumptions incompatible with the project's own upload UI; it saves hand-building and hardening the progress/retry/resume-state machinery that a 10GB resumable upload needs, at the one-time cost of verifying the `signRequest` header-forwarding limitation against MinIO during implementation.

**Setup:**

```ts
// next-frontend/lib/upload/create-uppy.ts
const uppy = new Uppy().use(AwsS3, {
  shouldUseMultipart: true,
  signRequest: (file, { method, url, key, uploadId, partNumber }) =>
    signUploadRequest({ method, url, key, uploadId, partNumber }),
});
```

**Aplicação:** `ui_in_scope: logic-only` — nenhuma tela de upload existe nesta fase. O padrão se aplica a todo futuro componente de upload que consumir os endpoints de `### API Contracts` (`POST /videos`, `POST /videos/:id/parts/sign`, `GET /videos/:id/parts`, `POST /videos/:id/complete`, `POST /videos/:id/abort`) — a tela concreta de upload é entregue por uma fase futura de UI, que herdará esta decisão via `## Inherited Decisions Detail`.

**Migração:** _No existing files require refactor — Setup SI is the only application of this pattern in the current phase._

**Verificação:**

- **Unit:** `signUploadRequest` chama `POST /videos/:id/parts/sign` com `{ method, url, key, uploadId, partNumber }` e retorna `{ url, headers? }` conforme o contrato de `phase-03-videos/TD-07`.
- **Integration:** o cliente Uppy headless, configurado com `shouldUseMultipart: true`, completa um upload multipart simulado (partes mockadas) e aciona `POST /videos/:id/complete` com a lista de `{ partNumber, ETag }` coletada.
- **E2E:** _not applicable in this phase — no UI surface exists; deferred to the phase that adds the upload screen._
- **Regression guards:** _none — greenfield, no pre-existing upload flow._

---

## Dependency Map

```
SI-03.1 (root)
SI-03.2 (root)
SI-03.3 (root)
SI-03.4 — depende de SI-03.1, SI-03.2, SI-03.3 (entidade + storage client + fila)
SI-03.5 — depende de SI-03.1, SI-03.2 (entidade + storage client)
SI-03.6 — depende de SI-03.1, SI-03.3 (entidade + fila)
SI-03.7 (root)
└── SI-03.8 — depende de SI-03.7 (Setup do cliente Uppy)
```

---

## Deliverables

- [ ] SI-03.1 — Criar entidade Video e migração
- [ ] SI-03.2 — Cliente de Object Storage (presigned URLs)
- [ ] SI-03.3 — Módulo de fila de processamento em segundo plano
- [ ] SI-03.4 — Endpoints de sessão de upload
- [ ] SI-03.5 — Endpoint de detalhe/status do vídeo
- [ ] SI-03.6 — Worker de processamento de vídeo
- [ ] SI-03.7 — Cliente de upload Uppy headless (Setup)
- [ ] SI-03.8 — Cliente de upload Uppy headless (Verification)

**Full test suites:**

- [ ] Backend tests pass (`docker compose exec nestjs-api npm test -- --runInBand`)
- [ ] Backend E2E tests pass (`docker compose exec nestjs-api npm run test:e2e`)
- [ ] Backend type-check passes (`docker compose exec nestjs-api npx tsc --noEmit`)
- [ ] Backend lint passes (`docker compose exec nestjs-api npm run lint`)
- [ ] Frontend tests pass (`docker compose exec next-frontend npm test`)
- [ ] Frontend type-check passes (`docker compose exec next-frontend npx tsc --noEmit`)
- [ ] Frontend lint passes (`docker compose exec next-frontend npm run lint`)
