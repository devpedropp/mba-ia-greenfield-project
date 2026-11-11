---
kind: phase
name: phase-03-videos
sources_mtime:
  docs/project-plan.md: "2026-11-10T15:21:35-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-11-10T21:25:38-03:00"
  docs/decisions/technical-decisions-next-frontend-config-base.md: "2026-11-10T15:21:35-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-11-10T15:21:35-03:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-11-10T21:26:42-03:00"
  docs/phases/phase-01-configuracao-base/context.md: "2026-11-10T15:21:35-03:00"
  docs/phases/phase-02-auth/context.md: "2026-11-10T15:21:35-03:00"
  docs/phases/phase-02-auth-frontend/context.md: "2026-11-10T15:21:35-03:00"
  .claude/skills/testing-guide-nestjs-project/SKILL.md: "2026-11-10T15:21:35-03:00"
  .claude/skills/testing-guide-next-frontend/SKILL.md: "2026-11-10T15:21:35-03:00"
---

# phase-03-videos — Context

## Scope

**Phase name:** Fase 03 — Upload e Processamento de Vídeos

**Capabilities** (literal, `docs/project-plan.md`):

- Serviço de armazenamento de arquivos (vídeos e thumbnails)
- Serviço de processamento em segundo plano (filas)
- Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance
- Pré-cadastro automático do vídeo como rascunho ao iniciar o upload
- Processamento automático do vídeo após upload (extração de duração e metadados)
- Geração automática de thumbnail a partir de um frame do vídeo
- URL única por vídeo, sem conflito com outros vídeos
- Reprodução via streaming (sem necessidade de download completo)
- Download do vídeo pelo usuário

**Out of scope:** _Not specified in `docs/project-plan.md`._

**Deliverables:** upload de até 10GB funcional, processamento automático do vídeo, streaming funcionando, URLs únicas geradas.

**Affected subprojects:** _Not explicitly listed in `docs/project-plan.md`_ — per the decisions doc (`technical-decisions-phase-03-videos.md`), both `nestjs-project/` (storage client, queue producer, upload-session endpoints, `Video` entity, worker) and `next-frontend/` (direct-to-storage upload client via Uppy, status/detail view) are in scope.

**Deferred subprojects:** _None._

**Sequencing notes:** Depende de: Fase 01, Fase 02 (ambas concluídas).

**Neighbors (for boundary detection only):**

- **Phase 02:** Cadastro, Login e Gerenciamento de Conta (Depende de: Fase 01)
- **Phase 04:** Gerenciamento de Vídeos e Canal (Depende de: Fase 02, Fase 03)

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| phase-03-videos/TD-01 | phase | Cross-layer | Object Storage Backend and SDK | decided | C | @aws-sdk/client-s3, @aws-sdk/s3-request-presigner |
| phase-03-videos/TD-02 | phase | Backend | Background Job Queue Broker and Library | decided | B | bullmq, @nestjs/bullmq |
| phase-03-videos/TD-03 | phase | Cross-layer | Large-File Upload Protocol with Resume-on-Failure | decided | A | — |
| phase-03-videos/TD-04 | phase | Backend | Video Processing Invocation Approach and Job Contract | decided | A | — |
| phase-03-videos/TD-05 | phase | Cross-layer | Unique Video Identifier and URL Strategy | decided | A | — |
| phase-03-videos/TD-06 | phase | Cross-layer | Video Lifecycle / Processing Status State Machine | decided | A | — |
| phase-03-videos/TD-07 | phase | Frontend | Frontend Upload Client Implementation Approach | decided | B | @uppy/core, @uppy/aws-s3 |

_Source files:_

- phase-03-videos — `docs/decisions/technical-decisions-phase-03-videos.md` (scope_type: phase, related_phases: [3])

## Capability Coverage

| Capability (from project-plan.md) | Covered by |
|-----------------------------------|------------|
| Serviço de armazenamento de arquivos (vídeos e thumbnails) | phase-03-videos/TD-01 |
| Serviço de processamento em segundo plano (filas) | phase-03-videos/TD-02 |
| Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance | phase-03-videos/TD-03, phase-03-videos/TD-07 |
| Pré-cadastro automático do vídeo como rascunho ao iniciar o upload | phase-03-videos/TD-06 |
| Processamento automático do vídeo após upload (extração de duração e metadados) | phase-03-videos/TD-04 |
| Geração automática de thumbnail a partir de um frame do vídeo | phase-03-videos/TD-04 |
| URL única por vídeo, sem conflito com outros vídeos | phase-03-videos/TD-05 |
| Reprodução via streaming (sem necessidade de download completo) | phase-03-videos/TD-01 |
| Download do vídeo pelo usuário | phase-03-videos/TD-01 |

## Decisions Detail

### phase-03-videos/TD-01

**Recommendation:** the project currently has zero cloud infrastructure and every other service (`db`, `mailpit`) runs as a local `compose.yaml` container, so adding MinIO keeps that convention for dev/CI at no cost, while AWS SDK v3's confirmed drop-in compatibility with MinIO (`endpoint` + `forcePathStyle`) means a later move to real S3 for staging/prod is a config change in `storage.config.ts`, not a rewrite.
**Libraries:** @aws-sdk/client-s3, @aws-sdk/s3-request-presigner

### phase-03-videos/TD-02

**Recommendation:** it avoids introducing Redis as entirely new infrastructure (nothing in the stack touches Redis today) while keeping the same official, actively-maintained NestJS integration and retry/idempotency primitives used throughout the wider BullMQ ecosystem, leaving a clear backend-swap path to Redis if video volume later justifies it; the newness of the Postgres backend is a known, explicitly-flagged risk rather than a blind spot.
**Libraries:** bullmq, @nestjs/bullmq

### phase-03-videos/TD-03

**Recommendation:** it reuses the storage SDK already chosen in TD-01 with no additional server component, natively satisfies both the 10GB-without-blocking and resume-on-failure requirements via `ListParts`, and matches the architecture diagram and the pre-existing frontend constraint exactly.
**Libraries:** —

### phase-03-videos/TD-04

**Recommendation:** the only wrapper with a multi-year track record (`fluent-ffmpeg`) is now archived and confirmed broken against current FFmpeg, and no successor has yet earned a comparable maintenance record; since the CLI surface this phase needs (probe metadata + one-frame thumbnail) is small, a thin in-house `child_process` service avoids reintroducing the exact dependency-rot risk this project just watched materialize. Idempotency is enforced via the `Video.status` field the Worker checks before processing, not via queue-level deduplication, keeping the contract simple regardless of which TD-02 queue backend is chosen.
**Libraries:** —

### phase-03-videos/TD-05

**Recommendation:** it already satisfies the literal requirement with the exact mechanism every existing entity in the project uses, requires zero new code, and the only downside (URL prettiness) is not called out anywhere in the project plan's capability bullets or pontos de atenção; a short-code can be added later as a purely additive change if product needs it.
**Libraries:** —

### phase-03-videos/TD-06

**Recommendation:** it is the minimum mechanism that satisfies "pré-cadastro automático como rascunho" and gives the Frontend exactly what it needs to display draft/processing/ready states, without building audit infrastructure that no capability bullet or pontos-de-atenção item in this phase asks for.
**Libraries:** —

### phase-03-videos/TD-07

**Recommendation:** Uppy's `signRequest` mode is a currently-maintained, purpose-built fit for exactly this "presigned-URL-only, no credentials, no Companion" pattern, and running it headless avoids pulling in any UI assumptions incompatible with the project's own upload UI; it saves hand-building and hardening the progress/retry/resume-state machinery that a 10GB resumable upload needs, at the one-time cost of verifying the `signRequest` header-forwarding limitation against MinIO during implementation.
**Libraries:** @uppy/core, @uppy/aws-s3

## Inherited Decisions Detail

### phase-01-configuracao-base/TD-01

**Recommendation:** Option A (@nestjs/config) — Official, core-team-maintained, guaranteed NestJS 11 compatibility. The `registerAs()` factory pattern solves the TypeORM CLI sharing problem: the factory function can be imported as a plain function by `data-source.ts` while also serving as a DI injection token inside NestJS. Building a custom module recreates solved functionality; third-party packages carry maintenance risk.
**Libraries:** `@nestjs/config@^4.x`

### phase-01-configuracao-base/TD-02

**Recommendation:** Option A (Joi) — First-class integration with `@nestjs/config` via `validationSchema`, requiring zero custom wiring. Handles string-to-number coercion natively. Using a different tool for env validation vs. request validation is reasonable — env config is validated once at startup, DTOs are validated per-request. Zod is elegant but adds a third validation paradigm to the project.
**Libraries:** `joi@^17.x`

### phase-01-configuracao-base/TD-03

**Recommendation:** Option B (Namespaced/grouped with registerAs) — The project roadmap explicitly calls for auth, email, and storage in upcoming phases. Namespaced configs provide clear file boundaries per domain, typed injection via `ConfigType<typeof databaseConfig>`, and natural scalability. The `registerAs()` factory is dual-purpose: DI token inside NestJS and plain importable function for `data-source.ts`. Initial files for Phase 01: `src/config/database.config.ts`, `src/config/app.config.ts`.
**Libraries:** —

### phase-01-configuracao-base/TD-04

**Recommendation:** Option A (Shared registerAs factory) — Natural outcome of choosing `@nestjs/config` with `registerAs`. The factory is already callable by design. `data-source.ts` imports it, calls `dotenv.config()`, then calls the factory. Zero duplication, minimal code, no extra abstraction.
**Libraries:** `dotenv` (transitive via `@nestjs/config`)

### phase-02-auth/TD-01

**Recommendation:** Argon2id — For a greenfield project in 2026, Argon2id is the OWASP-recommended choice. The native build dependency is a one-time Docker setup cost. The project has no legacy constraints favoring bcrypt. OWASP minimum: 19MiB memory, 2 iterations.
**Libraries:** `argon2@^0.41.x`

### phase-02-auth/TD-02

**Recommendation:** Option A (@nestjs/passport) — The project plan includes only email/password auth for now, but the plugin architecture costs little and future phases may add social login. Aligns with official NestJS docs, making onboarding and maintenance easier.
**Note:** Decision deliberately diverged from the Recommendation during implementation — custom guards were preferred over `@nestjs/passport` to keep the dependency surface smaller.
**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-03

**Recommendation:** Option A (Refresh Token Rotation) — Provides the strongest security model with automatic theft detection. The DB write overhead is acceptable for a video platform (auth refresh is infrequent vs. video operations). PostgreSQL is already in the stack, so no new infrastructure needed. Race conditions can be mitigated with a short grace period for the old token.
**Libraries:** —

### phase-02-auth/TD-04

**Recommendation:** Option B (Random Opaque Tokens in DB) — Revocability is important: when a user requests a new password reset, previous tokens should be invalidated. The DB table is trivial to implement, and the tokens table can also serve future needs (e.g., API keys). Keeps email tokens decoupled from the JWT auth system.
**Libraries:** —

### phase-02-auth/TD-05

**Recommendation:** Option A (@nestjs-modules/mailer) — Best NestJS integration with minimal boilerplate. Supports SMTP (matching the architecture diagram), works with MailHog/Mailpit for local development without external dependencies, and scales to any SMTP provider in production. Template engine support (Handlebars) simplifies email formatting. No vendor lock-in.
**Libraries:** `@nestjs-modules/mailer@^2.x`, `handlebars@^4.x`

### phase-02-auth/TD-06

**Recommendation:** Option A (class-validator + class-transformer) — This is a backend-only project (no shared schemas with frontend), so Zod's single-source-of-truth advantage is less impactful. class-validator is the documented NestJS approach, and the project already uses decorators extensively (TypeORM entities, NestJS DI). Fewer integration surprises with NestJS 11.
**Libraries:** `class-validator@^0.14.x`, `class-transformer@^0.5.x`

### phase-02-auth/TD-07

**Recommendation:** Option A (Custom Domain Exception Filter) — Provides machine-readable error codes that the Next.js frontend can switch on, without the overhead of RFC 9457's URI-based type system. The project is single-consumer (first-party frontend), so a simple `{ statusCode, error, message }` format with domain codes balances clarity and simplicity. The custom filter cost is low — two small files.
**Libraries:** —

### phase-02-auth/TD-08

**Recommendation:** Option A (@nestjs/throttler) — Native NestJS integration is decisive: the guard system allows scoping rate limiting to `AuthModule` only via module-level `APP_GUARD`, with `@SkipThrottle()` for exemptions. The project is single-instance with no distributed requirements, so in-memory storage is sufficient. Using express-rate-limit would bypass NestJS's DI and guard lifecycle for no clear benefit.
**Libraries:** `@nestjs/throttler@^6.x`

### phase-02-auth/TD-09

**Recommendation:** Option B (Opaque) — Since DB lookup is mandatory (TD-03), JWT signature adds no security value. Opaque tokens are shorter, leak no data, and are simpler to generate.
**Note:** Decision deliberately diverged from the Recommendation — JWT was kept to reuse the access-token signing/verification infrastructure (`@nestjs/jwt`).
**Libraries:** `@nestjs/jwt@^11.0.0`

### phase-02-auth/TD-10

**Recommendation:** Option A — The platform is a video sharing service with URL-based channel handles. A strict `[a-z0-9_]` allowlist is the simplest and most portable choice: no extra dependencies, no edge cases around hyphen positioning, and the `user_<random>` fallback provides a valid handle even for extreme email prefixes. Hyphens can always be added in a future iteration if user feedback justifies it.
**Libraries:** —

### phase-02-auth-frontend/TD-01

**Recommendation:** Custom BFF cookie-based session — the strict-BFF model already nominates the Route Handler as the only NestJS caller; cookie-based sessions are the natural match, and a full auth framework adds layers between the BFF and the cookie that buy nothing because the backend is the auth authority. Smaller blast radius and better compatibility with Next.js 16 / React 19 than a framework tracking majors with a lag.
**Libraries:** —

### phase-02-auth-frontend/TD-02

**Recommendation:** `iron-session` encrypted cookie — defense in depth on the cookie content (httpOnly blocks JS, encryption blocks accidental log/proxy inspection), a single cookie to manage simplifies logout, and room to carry minimal user metadata lets RSC layouts render authenticated chrome without a per-render `/auth/me` round-trip.
**Libraries:** iron-session

### phase-02-auth-frontend/TD-03

**Recommendation:** Transparent BFF refresh on 401, single-flight — tested by MSW with a "two concurrent intercepted upstream calls; one refresh expected" assertion. Client-driven and pre-emptive-timer alternatives were rejected for added complexity without replacing the server-side refresh RSC still needs.
**Libraries:** —

### phase-02-auth-frontend/TD-04

**Recommendation:** react-hook-form + `@hookform/resolvers/zod` — decoupled from the mutation-submission-pathway decision, aligned with the project's shadcn form primitive, and reuses the Zod-first ergonomics already chosen for env validation. Explicitly shapes every form in Phases 03–07, including the video upload metadata form.
**Libraries:** react-hook-form, @hookform/resolvers

### phase-02-auth-frontend/TD-05

**Recommendation:** Route Handler POST + client fetch — keeps every mutation visible under `app/api/**`, reuses the existing BFF test scaffold, and sets a uniform mutation surface for Phases 03–07.
**Libraries:** —

### phase-02-auth-frontend/TD-06

**Recommendation:** Server-rendered session + React Context in RSC layout — no first-render flicker and no round-trip, since the session is delivered in the same response as the page HTML and the Client Provider hydrates with the correct initial state.
**Libraries:** —

### phase-02-auth-frontend/TD-07

**Recommendation:** RSC processes the email-link token server-side — first-paint-correct with a single integration pattern shared across the confirmation and reset-password flows ("RSC owns the token, Client Component owns the input").
**Libraries:** —

### next-frontend-config-base/TD-01

**Recommendation:** Zod 4 — type-inference matches the FE's strict-TS culture, aligns with Next.js/React 19 ecosystem gravity (Server Actions, form resolvers), and directly enables TD-02's `@t3-oss/env-nextjs`. Backend parity with Joi is not load-bearing since env schemas are not shared FE↔BE.
**Libraries:** zod

### next-frontend-config-base/TD-02

**Recommendation:** `@t3-oss/env-nextjs` — the only option combining type-level `NEXT_PUBLIC_` prefix enforcement, runtime Proxy-based leak detection, and single-file/single-import-path consumer ergonomics, at a marginal ~3KB cost over a hand-rolled two-module split.
**Libraries:** @t3-oss/env-nextjs

### next-frontend-config-base/TD-03

**Recommendation:** Strict BFF — single server-only `API_URL`. Aligned with the BFF testing strategy already documented in `next-frontend/CLAUDE.md` (Route Handlers as the only NestJS caller). Eliminates CORS and public exposure of the backend URL. Explicitly notes that large payloads (videos, Phase 03+) will need a separate mechanism — object-storage presigned URLs, not the backend `API_URL` — which `phase-03-videos/TD-01`, `TD-03`, and `TD-07` satisfy.
**Libraries:** —

### openapi-docs-nestjs/TD-01

**Recommendation:** `@nestjs/swagger` + CLI plugin — the only option that preserves the previously decided validation stack (`class-validator` in `phase-02-auth/TD-06`) without a re-platform; the CLI plugin with `classValidatorShim: true` leverages the existing `class-validator` decorators to infer schemas, keeping boilerplate low. Nestia has real technical merit but its migration cost to `typia` is incompatible with the already-implemented Phase 02 validation stack.
**Libraries:** @nestjs/swagger
**Revisions:**
- 2026-05-12 — Clarifies that the CLI plugin (`classValidatorShim: true`) only covers DTO schema inference from `class-validator`; operation docs, per-status-code typed responses, error contracts (aligned with `phase-02-auth/TD-07`'s envelope), and examples still require explicit decorators (`@ApiOperation`, `@ApiResponse`, `@ApiBody`, `@ApiParam`, `@ApiQuery`, `@ApiExtraModels`). Rationale: the current bootstrap's generated `openapi.json` is generic (no param/response/error detail) because it relied only on automatic introspection; this revision fixes that explicit-decorator enrichment is in scope for the chosen Option A, not out-of-scope follow-up.

### openapi-docs-nestjs/TD-02

**Recommendation:** Both (Runtime UI + exported `openapi.json`) — the marginal cost over runtime-only is a single ~15-line npm script, and the benefit is a correct foundation for future FE integration (offline codegen) without losing the interactive UI devs/QA use. Runtime-only alone would block offline FE codegen; file-only alone would hurt the local dev experience. Combining dominates either alone.
**Libraries:** —

### openapi-docs-nestjs/TD-03

**Recommendation:** Dev/staging only via env flag — aligns with the defensive posture already established in Phase 02 (rate limiting) without blocking legitimate consumers, since the committed `openapi.json` (TD-02) already serves as the "spec consultable outside the UI" for anyone who needs it. Re-opening as always-exposed or Basic-Auth-protected is trivial later if a public-API use case appears.
**Libraries:** —

## Inherited Conventions

- Backend config uses `@nestjs/config` with namespaced `registerAs(name, () => ({...}))` factories — one file per domain in `src/config/`. _(from phase 02)_
- Env variables are validated by a Joi schema in `src/config/env.validation.ts`, passed to `ConfigModule.forRoot({ validationSchema, validationOptions: ... })`. _(from phase 02)_
- Config is injected into modules via `ConfigType<typeof xxxConfig>` and `@Inject(xxxConfig.KEY)`; the same factory is importable as a plain function for `data-source.ts`. _(from phase 02)_
- `data-source.ts` loads `.env` via `import 'dotenv/config'` at the top, then imports the relevant config factory and calls it as a plain function. _(from phase 02)_
- Database/service connection parameters are sourced from a single namespaced config factory — never duplicated between `AppModule` and `data-source.ts`. _(from phase 02)_
- `TypeOrmModule.forRootAsync` is used (not `forRoot`), with `imports: [ConfigModule]`, `inject: [databaseConfig.KEY]`, `useFactory` returning options injected via config. _(from phase 02)_

## Inherited Deferred Capabilities

| Capability | Status | Origin phase | Rationale |
|-----------|--------|--------------|-----------|
| Telas de frontend | deferred | phase-01-configuracao-base | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| Telas de cadastro, login, confirmação de conta e recuperação de senha | deferred | phase-02-auth | `next-frontend/` is not initialized in this phase; UI surfaces start in a later phase. |
| "Confirmação de conta via e-mail com link de ativação" | deferred | phase-02-auth-frontend | deferred_to_next_phase — UI landing screen de-scoped 2026-05-14; FE confirmation flow (TD-07) picked up by a future phase. BE side unchanged in `phase-02-auth`. |
| "Logout" | deferred | phase-02-auth-frontend | deferred_to_next_phase — logout button lives inside authenticated chrome (typically Phase 04). Phase 02 still implements POST `/api/auth/logout` (BFF route handler + `session.destroy()`) so the contract is ready when the chrome lands. |
| "Recuperação de senha (destination screen / set-new-password)" | deferred | phase-02-auth-frontend | deferred_to_next_phase — `/forgot-password` ships this phase sending the e-mail; the reset-password destination screen is absent from Figma → link destination remains a 404 until a later phase delivers the screen via `/screen-inventory` extension run. |
| "Telas de cadastro, login, confirmação de conta e recuperação de senha" | deferred | phase-02-auth-frontend | the umbrella bullet's full coverage requires the confirmação and reset-password destination screens; both are deferred per rows above. The 3 ship-this-phase telas (signup, login, forgot-password) are inventoried and covered by their own verbs; the umbrella bullet itself is deferred to the phase that lands the missing screens. |

## UI Inventory

_Frontend-runtime only — no screen inventory needed for this phase.
Run /screen-inventory <arg> if a UI surface is added in a future revision._

## Non-UI / Deferred Capabilities

_None._

## Testing Requirements

### nestjs-project

| Artifact created | Required tests |
|---|---|
| Entity (`*.entity.ts`) | Integration: constraints, defaults, `select: false` |
| Service with branching + DB | Unit: branch logic (mock repo) + Integration: DB contract |
| Service with DB only (no branching) | Integration: DB contract |
| Service with configured lib (JWT, cache) | Unit: real lib with test config |
| Service with side-effect dep (email, storage) | Integration: real capture service (Mailpit) or local adapter |
| Module with configured imports | Unit: compilation test |
| Controller | E2E only — do NOT write unit tests |
| DTO | E2E: one validation wiring test per endpoint |
| Guard (delegates to service for business logic) | E2E + Unit if complex internal logic |
| Guard (simple, delegates to Passport) | E2E only |
| Strategy (Passport) | E2E via guard |
| Pipe (custom transformation/validation) | Unit |
| Interceptor (response transform, logging) | Unit and/or E2E |
| Exception Filter | Unit + E2E |
| Middleware | E2E |

### next-frontend

| Artifact created | Required tests |
|---|---|
| Page — sync RSC, static, no logic | None at component level; cover only if part of a critical flow → `*.e2e-spec.ts` |
| Page — sync RSC composing client children | Test client children directly; cover rendered page via `*.e2e-spec.ts` |
| Page — async RSC (`async function Page()` with `await`) | `*.e2e-spec.ts` only — Vitest cannot render it |
| Layout (`layout.tsx`) | None unless it adds logic (auth gate, conditional render); else via E2E |
| Client component (`"use client"`) with state/handlers | `*.test.tsx` — RTL + `jsdom` docblock, mock `next/navigation`, MSW for fetch |
| Feature component (server, composes primitives) | Skip unit; cover via the page's E2E |
| shadcn UI primitive (`components/ui/*`) | None — trust the library; cover via consumers |
| Icon (`components/icons/*`) | None |
| `lib/` utility / boundary module with branching or shape assumptions | `*.test.ts` |
| Custom hook (`hooks/*`) | `*.test.ts(x)` with `renderHook`, `jsdom` docblock |
| Route handler (`app/api/**/route.ts`) — proxy or with branching | `*.integration.test.ts` with MSW (+ `*.test.ts` for extracted pure logic) |
| Server action / middleware / error-loading-not-found / metadata | See `artifacts/future-types.md` — depends on type |
