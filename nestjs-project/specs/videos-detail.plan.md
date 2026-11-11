---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.5
target_file: nestjs-project/test/videos-detail.e2e-spec.ts
---

# Endpoint de detalhe/status do vídeo Test Plan

`GET /videos/:id` é o endpoint que o Frontend consulta para exibir o progresso do vídeo (`draft`/`uploading`/`processing`/`ready`/`failed`, `phase-03-videos/TD-06`) e, uma vez pronto, obter as URLs assinadas de streaming, download e thumbnail direto do Object Storage (`phase-03-videos/TD-01`).

## Test Scenarios

### 1. Detalhe do vídeo por status

**Setup:** `beforeEach` trunca as tabelas `video` e `channel`; bootstrap do módulo via `Test.createTestingModule(...).compile()` reproduzindo a configuração global do `main.ts`; autentica um usuário de teste com canal próprio via helper de auth (per `phase-02-auth`).

#### 1.1. retorna-detalhe-sem-urls-durante-processamento

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-11-10T20:16:53Z

**Steps:**
  1. `GET /videos/:id` para um vídeo em `status: "processing"`
    - expect: `200` com `status: "processing"`
    - expect: `streamUrl`, `downloadUrl` e `thumbnailUrl` ausentes/nulos

#### 1.2. retorna-urls-assinadas-quando-pronto

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-11-10T20:16:53Z

**Steps:**
  1. `GET /videos/:id` para um vídeo em `status: "ready"` com `duration` e `metadata` preenchidos
    - expect: `200` com `status: "ready"`, `duration` preenchido, e `streamUrl`, `downloadUrl`, `thumbnailUrl` preenchidos

---

### 2. Autorização por canal

**Setup:** mesmo setup da seção 1; dois usuários autenticados com canais distintos; `Video` criado pelo canal A.

#### 2.1. nega-acesso-a-video-inexistente-ou-de-outro-canal

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-11-10T20:16:53Z

**Steps:**
  1. `GET /videos/:id` com um `id` inexistente
    - expect: `404` com `errorCode: "VIDEO_NOT_FOUND"`
  2. Usuário autenticado do canal B chama `GET /videos/:id` referenciando o `id` do vídeo do canal A
    - expect: `404` com `errorCode: "VIDEO_NOT_FOUND"`
