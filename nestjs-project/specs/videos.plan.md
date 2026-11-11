---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.4
target_file: nestjs-project/test/videos.e2e-spec.ts
---

# Endpoints de sessão de upload Test Plan

Os endpoints de sessão de upload (`POST /videos`, `POST /videos/:id/parts/sign`, `GET /videos/:id/parts`, `POST /videos/:id/complete`, `POST /videos/:id/abort`) implementam o protocolo de upload multipart resumível de até 10GB (`phase-03-videos/TD-03`): a API cria o draft do `Video` e inicia o multipart upload, assina cada parte para o Frontend enviar direto ao Object Storage, lista as partes já enviadas para suportar retomada, e completa/aborta a sessão ao final.

## Test Scenarios

### 1. Criação de sessão de upload

**Setup:** `beforeEach` trunca as tabelas `video` e `channel`; bootstrap do módulo via `Test.createTestingModule(...).compile()` reproduzindo a configuração global do `main.ts` (`ValidationPipe`, filtro de exceção); autentica um usuário de teste com canal próprio via helper de auth (per `phase-02-auth`).

#### 1.1. cria-draft-e-inicia-multipart-upload

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-11-10T20:16:53Z

**Steps:**
  1. `POST /videos` com o usuário autenticado, sem corpo
    - expect: `201` com `id` (uuid), `status: "draft"`, `uploadId` e `key` no formato `videos/{id}/original.mp4`

---

### 2. Assinatura e listagem de partes

**Setup:** mesmo setup da seção 1; adicionalmente cria um `Video` em `status: "uploading"` com `uploadId` via fixture de `StorageService` mockado.

#### 2.1. assina-url-para-parte-valida

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-11-10T20:16:53Z

**Steps:**
  1. `POST /videos/:id/parts/sign` com `{ method: "PUT", uploadId, partNumber: 1 }` para um vídeo em `status: "uploading"`
    - expect: `200` com `url` (string) presente

#### 2.2. rejeita-assinatura-fora-do-estado-uploading

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-11-10T20:16:53Z

**Steps:**
  1. `POST /videos/:id/parts/sign` para um vídeo em `status: "ready"`
    - expect: `409` com `errorCode: "INVALID_UPLOAD_STATE"`

#### 2.3. lista-partes-ja-enviadas

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-11-10T20:16:53Z

**Steps:**
  1. `GET /videos/:id/parts?uploadId=<uploadId>` para um vídeo em `status: "uploading"` com 2 partes já enviadas ao storage (mock)
    - expect: `200` com `parts` contendo os 2 `{ partNumber, ETag }`

---

### 3. Conclusão e cancelamento da sessão

**Setup:** mesmo setup da seção 1; `Video` em `status: "uploading"` com `uploadId` e partes previamente assinadas.

#### 3.1. completa-upload-e-enfileira-processamento

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-11-10T20:16:53Z

**Steps:**
  1. `POST /videos/:id/complete` com `{ uploadId, parts: [{ partNumber: 1, ETag: "etag-1" }] }`
    - expect: `200` com `status: "processing"`
    - expect: job `video.process` enfileirado na fila `video-processing` com `{ videoId: id }`

#### 3.2. aborta-sessao-de-upload

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-11-10T20:16:53Z

**Steps:**
  1. `POST /videos/:id/abort` com `{ uploadId }` para um vídeo em `status: "uploading"`
    - expect: `204` sem corpo

---

### 4. Autorização por canal

**Setup:** mesmo setup da seção 1; dois usuários autenticados com canais distintos; `Video` criado pelo canal A.

#### 4.1. nega-acesso-a-video-de-outro-canal

**Covers AC:** #7
**Source:** auto
**Last sync:** 2026-11-10T20:16:53Z

**Steps:**
  1. Usuário autenticado do canal B chama `POST /videos/:id/parts/sign` referenciando o `id` do vídeo do canal A
    - expect: `404` com `errorCode: "VIDEO_NOT_FOUND"`
