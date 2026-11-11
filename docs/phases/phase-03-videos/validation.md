---
kind: phase
name: phase-03-videos
status: clean
issue_count: 0
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-11-10T21:26:42-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-11-10T21:25:38-03:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-11-10T21:26:42-03:00"
issues:
  - id: AMB-1
    status: resolved
    summary: "'Rascunho' em TD-06 (upload em progresso) pode divergir do 'draft' de Fase 04 (processado, não publicado)"
    resolved_by: clarification
  - id: MD-1
    status: resolved
    summary: "Nenhuma TD Cross-layer/Repo-wide no contexto cobria a estratégia de sync de contrato FE↔BE"
    resolved_by: openapi-docs-nestjs/TD-02
  - id: MD-2
    status: resolved
    summary: "Abordagem de implementação do cliente de upload no frontend (hand-rolled vs Uppy) não decidida"
    resolved_by: phase-03-videos/TD-07
  - id: OQ-1
    status: resolved
    summary: "TD-01 pendente — Object Storage Backend and SDK"
    resolved_by: phase-03-videos/TD-01
  - id: OQ-2
    status: resolved
    summary: "TD-02 pendente — Background Job Queue Broker and Library"
    resolved_by: phase-03-videos/TD-02
  - id: OQ-3
    status: resolved
    summary: "TD-03 pendente — Large-File Upload Protocol with Resume-on-Failure"
    resolved_by: phase-03-videos/TD-03
  - id: OQ-4
    status: resolved
    summary: "TD-04 pendente — Video Processing Invocation Approach and Job Contract"
    resolved_by: phase-03-videos/TD-04
  - id: OQ-5
    status: resolved
    summary: "TD-05 pendente — Unique Video Identifier and URL Strategy"
    resolved_by: phase-03-videos/TD-05
  - id: OQ-6
    status: resolved
    summary: "TD-06 pendente — Video Lifecycle / Processing Status State Machine"
    resolved_by: phase-03-videos/TD-06
---

# phase-03-videos — Validation

## Findings

### Inconsistencies

_None._ _(A `TD-07` (Scope: Frontend) não é órfã: `UI Inventory` está em `logic-only` e `TD-07` não carrega `**Renders in:**` explícito, então o default-by-inference para `logic-only` resolve para `frontend-runtime` — não dispara o check de órfã. Nenhuma TD cita capability fora do `## Scope`.)_

### Ambiguities

_None._ _(AMB-1 resolvida — ver `## Resolved Issues`. Nenhuma outra capability bullet ficou vaga o suficiente para impedir a decomposição em SIs dado o conjunto de 7 TDs decididas.)_

### Missing Decisions

_None._ _(Todas as 9 capabilities do `## Scope` têm cobertura em `## Capability Coverage`. A estratégia de sync de contrato FE↔BE (Decisão #29, aplicável porque `ui_in_scope: logic-only`) é coberta pela TD inerdada `openapi-docs-nestjs/TD-02` — keywords "openapi.json"/"codegen" no Recommendation.)_

### Dependency Gaps

_None._ _(Fase 03 depende de Fase 01 e Fase 02, ambas concluídas per `## Scope` → Sequencing notes.)_

### Inherited Constraint Conflicts

_None._ _(As 7 TDs decididas foram checadas contra `## Inherited Conventions` e `## Inherited Decisions Detail` — nenhuma contradição. `TD-07` (Uppy PUT direto a URLs presigned) não conflita com `next-frontend-config-base/TD-03` — essa TD já previu e aprovou essa exceção ao BFF estrito para payloads grandes de vídeo.)_

### Unresolved Open Questions

_None._ _(As 7 TDs de `phase-03-videos` estão todas decididas; nenhuma pergunta de inventário aplicável — UI Inventory está em `logic-only`.)_

### UI Coverage Gaps

_None._ _(UI Inventory está em modo `logic-only` — este check não se aplica por construção.)_

## Resolved Issues

- **AMB-1** _(resolved_by clarification)_ — "Rascunho" na capability "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload" refere-se exclusivamente ao estado `draft` da state machine de processamento (`phase-03-videos/TD-06`, Option A). O eixo "publicado vs. não publicado" da Fase 04 (`project-plan.md`, "fluxo de rascunho→publicação") é propriedade exclusiva da Fase 04 — a Fase 03 entrega apenas o status de processamento (`draft -> uploading -> processing -> ready/failed`), sem campo de visibilidade/publicação. `TD-06` não foi alterada; nenhuma TD de Fase 04 deve redefini-la para cobrir esse eixo.
- **MD-1** _(resolved_by openapi-docs-nestjs/TD-02)_ — Nenhuma TD Cross-layer/Repo-wide no contexto cobria a estratégia de sync de contrato FE↔BE. Resolvido ao incluir `openapi-docs-nestjs/TD-02` em `## Inherited Decisions Detail`.
- **MD-2** _(resolved_by phase-03-videos/TD-07)_ — Abordagem de implementação do cliente de upload no frontend não estava decidida. Resolvido: TD-07 decide Option B (Uppy — `@uppy/aws-s3`, modo `signRequest`, headless).
- **OQ-1** _(resolved_by phase-03-videos/TD-01)_ — TD-01 pendente — Object Storage Backend and SDK. Decidida: Option C (MinIO dev/CI + AWS S3 staging/prod, mesmo AWS SDK v3).
- **OQ-2** _(resolved_by phase-03-videos/TD-02)_ — TD-02 pendente — Background Job Queue Broker and Library. Decidida: Option B (BullMQ sobre backend PostgreSQL via `@nestjs/bullmq`).
- **OQ-3** _(resolved_by phase-03-videos/TD-03)_ — TD-03 pendente — Large-File Upload Protocol with Resume-on-Failure. Decidida: Option A (multipart upload nativo S3/MinIO com presigned URLs por parte).
- **OQ-4** _(resolved_by phase-03-videos/TD-04)_ — TD-04 pendente — Video Processing Invocation Approach and Job Contract. Decidida: Option A (invocação direta via `child_process`, sem wrapper).
- **OQ-5** _(resolved_by phase-03-videos/TD-05)_ — TD-05 pendente — Unique Video Identifier and URL Strategy. Decidida: Option A (reaproveitar UUID PK existente).
- **OQ-6** _(resolved_by phase-03-videos/TD-06)_ — TD-06 pendente — Video Lifecycle / Processing Status State Machine. Decidida: Option A (coluna `status` enum única, sem tabela de histórico).
