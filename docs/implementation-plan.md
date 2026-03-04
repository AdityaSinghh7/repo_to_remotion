# Repo-to-Remotion Demo Agent

## Detailed Implementation Plan (Mastra + Codex-First)

## 1. Document Intent
This document is the decision-complete implementation blueprint for building a service that takes a public GitHub repository URL and produces either:
1. A deterministic early-stop response when no frontend application code is found.
2. A generated guided demo (`Remotion project code + rendered MP4`) when frontend code is present.

This plan intentionally includes both a high-level architecture and an execution-level implementation sequence so it can be handed off directly for development.

## 2. Product Goal
Enable a user to submit any public GitHub repo and receive an automated product demo video representing one coherent use case inferred from the repository’s frontend and overall purpose.

## 3. Scope Definition
### In Scope (v1)
- Public GitHub repos only.
- Asynchronous job API.
- Deterministic frontend detection gate.
- Repo purpose and use-case synthesis via coding-agent backend (Codex first).
- Guided UI tour output style.
- Remotion project generation and MP4 rendering.
- Runtime screenshot capture attempt with static fallback path.
- Persistent job state, step logs, and artifacts.

### Out of Scope (v1)
- Private repository access.
- User auth/billing/multi-tenancy.
- Multi-voice narration and localized voiceover.
- Guaranteed runnable screenshots for every framework.
- Full autonomous debugging loops for broken repos.

## 4. High-Level Architecture
### 4.1 Runtime Flow
1. API receives `repoUrl` and creates `jobId`.
2. Worker pulls job and validates URL + repository visibility.
3. Repo is shallow-cloned into isolated temp workspace.
4. Frontend detector computes confidence + evidence.
5. If no frontend, workflow ends with deterministic stop reason.
6. If frontend exists, analysis engine infers repo purpose and one use case.
7. Capture subsystem tries to run frontend and capture screenshots.
8. On capture failure, fallback scene assets are synthesized.
9. Remotion scene spec is generated and rendered to MP4.
10. Artifacts and report are stored; API exposes final status.

### 4.2 System Components
- API Service: HTTP contract and job lifecycle endpoints.
- Workflow Orchestrator: Mastra-managed step sequencing and retries.
- Ingestion Layer: GitHub validation + clone logic.
- Detection Layer: Frontend presence heuristics.
- Analysis Engine Layer: Codex-first interface for repository understanding.
- Capture Layer: Runtime startup + screenshot extraction.
- Demo Composer Layer: Scene planning and Remotion asset generation.
- Render Layer: Remotion bundling and media output.
- Storage Layer: Job metadata, logs, and artifact paths.
- Observability Layer: Metrics, structured logs, and failure fingerprints.

## 5. Functional Requirements
### 5.1 Input Contract
- Required: `repoUrl`.
- Optional: `ref`, `engine`, `renderMode`, `demoStyle`.
- Default values:
- `engine`: `codex`
- `renderMode`: `code+mp4`
- `demoStyle`: `guided-ui-tour`

### 5.2 Output Contract
- All jobs return machine-readable status transitions.
- No-frontend jobs return exact stop reason and evidence.
- Successful jobs return:
- `report.json`
- `demo-scenes.json`
- generated Remotion project files
- `demo.mp4` (for `code+mp4` mode)

### 5.3 Frontend Gate Rules
Frontend detection is deterministic-first and must not depend on LLM unless ambiguous.

Positive evidence includes:
- Frontend framework dependencies.
- Frontend-specific config files.
- App entrypoint patterns.
- Monorepo workspace indicators with app folders.

Hard-stop condition:
- `hasFrontend = false` AND confidence below threshold AND no positive evidence.

### 5.4 Analysis Requirements
When frontend exists:
- Infer concise repository purpose.
- Infer one demo-worthy user persona/use case.
- Produce 4+ narrative-ready flow steps.
- Suggest likely routes/states for capture.
- Reject low-quality outputs via schema validation rules.

### 5.5 Capture Requirements
Primary path:
- Detect package manager + start command.
- Install/start app in isolated environment.
- Capture landing screen and 2-4 use-case screens.

Fallback path:
- If startup fails, produce scenes from static assets and textual context.
- Continue render pipeline unless render-specific failure occurs.

### 5.6 Video Generation Requirements
- Render profile default: `1920x1080`, `30fps`, `60-90s`.
- Scene transitions: simple and deterministic (`fade`, `slide`, `none`).
- Composition metadata derived from scene durations.
- Final output stored under per-job artifact directory.

## 6. Non-Functional Requirements
### 6.1 Reliability
- Deterministic error taxonomy.
- Safe retries for idempotent steps.
- Timeout budget per step and job.

### 6.2 Security
- Public repos only in v1.
- No host secret injection into target runtime.
- Isolated temporary workspaces per job.
- Restricted command allowlist for runtime execution.

### 6.3 Scalability
- Async jobs with queue abstraction.
- File count/size guardrails for large repos.
- Streaming progress updates and resumable status polling.

### 6.4 Observability
- Structured logs by `jobId` and step.
- Timing metrics per stage.
- Failure fingerprinting and root cause tagging.

## 7. Data Contracts
### 7.1 Core Job States
- `queued`
- `running`
- `stopped_no_frontend`
- `failed`
- `completed`

### 7.2 Core Step States
- `pending`
- `running`
- `success`
- `error`
- `skipped`

### 7.3 Error Taxonomy
- `INVALID_REPO_URL`
- `REPO_NOT_PUBLIC`
- `CLONE_FAILED`
- `NO_FRONTEND_FOUND`
- `ANALYSIS_FAILED`
- `FRONTEND_START_FAILED`
- `RENDER_FAILED`

## 8. Detailed Workstream Plan

## Workstream A: API + Lifecycle Foundation
### Objective
Create stable API contracts and asynchronous job orchestration boundaries.

### Tasks
1. Define request/response schemas and validation rules.
2. Implement `POST /v1/demo-jobs` with idempotency support.
3. Implement `GET /v1/demo-jobs/:id` status endpoint.
4. Implement `GET /v1/demo-jobs/:id/artifacts` endpoint.
5. Persist lifecycle events with timestamps and step payloads.

### Exit Criteria
- API handles valid/invalid requests deterministically.
- Job states transition with no skipped terminal statuses.
- Status endpoint is fully reconstructible from persisted state.

## Workstream B: GitHub Ingestion and Safety Controls
### Objective
Safely fetch public repos with bounded runtime and storage.

### Tasks
1. Parse and normalize GitHub URLs.
2. Verify repository visibility using GitHub API metadata.
3. Shallow clone selected ref into temp workspace.
4. Record repo metadata for analysis context.
5. Enforce max clone size, max file count, and max execution duration.

### Exit Criteria
- Non-public repos are rejected before clone.
- Clone failures map to deterministic error code.
- Temp workspace lifecycle is traceable and cleanable.

## Workstream C: Frontend Detection Gate
### Objective
Decide if demo generation is feasible before expensive analysis/render steps.

### Tasks
1. Scan manifests and lockfiles for frontend frameworks.
2. Scan for frontend config and entrypoint signatures.
3. Scan monorepo/workspace configs for app packages.
4. Compute confidence score and evidence list.
5. Trigger hard stop when frontend evidence is insufficient.
6. For ambiguous cases, invoke one Codex classification pass with strict schema.

### Exit Criteria
- Detector outputs deterministic structured result.
- Backend-only fixtures reliably early-stop.
- Ambiguous repos are resolved or safely stopped.

## Workstream D: Analysis Engine (Codex-first)
### Objective
Infer product purpose and one coherent demo use case without custom context ingestion pipeline.

### Tasks
1. Define analysis-engine interface with Codex and Aider adapters.
2. Implement Codex adapter using non-interactive CLI mode.
3. Enforce JSON-only structured outputs and schema validation.
4. Implement prompts for:
- repository purpose and target persona
- single use-case flow with 4+ steps
- route/state suggestions for capture
5. Persist analysis artifacts and prompt metadata (redacted).
6. Add Aider adapter scaffold for future parity.

### Exit Criteria
- Purpose and use-case output are parse-safe and quality-gated.
- Invalid model output produces deterministic `ANALYSIS_FAILED`.
- Adapter interface permits runtime engine selection.

## Workstream E: Runtime Capture + Fallback
### Objective
Prefer real screenshots, but never block final output when startup fails.

### Tasks
1. Infer package manager and startup command candidates.
2. Execute install/start within isolated process constraints.
3. Detect readiness via port probing and health heuristics.
4. Capture landing + route screenshots tied to use-case steps.
5. If startup/capture fails, synthesize scene assets from static repo artifacts.

### Exit Criteria
- Capture success path provides 3+ visuals.
- Fallback path still produces renderable scene payload.
- Startup failure reason is recorded separately from render failure.

## Workstream F: Remotion Scene Composition and Rendering
### Objective
Convert analysis and visuals into deterministic, renderable demo output.

### Tasks
1. Build fixed Remotion template for guided tour composition.
2. Generate `demo-scenes.json` from analysis + capture outputs.
3. Inject composition props (`title`, `summary`, `useCaseHeadline`, `scenes`).
4. Use metadata calculation to derive video duration from scenes.
5. Bundle and render MP4 with progress callbacks.
6. Emit output artifacts and render summary.

### Exit Criteria
- Valid scene payload always maps to renderable composition.
- Render progress and failure diagnostics are observable.
- Final artifact set matches contract.

## Workstream G: Storage, Reporting, and Telemetry
### Objective
Make runs auditable and operationally diagnosable.

### Tasks
1. Persist job records and step-level outputs.
2. Write final `report.json` including decision trail.
3. Track metrics for gate rate, analysis success, fallback ratio, render success.
4. Capture failure fingerprints with normalized tags.

### Exit Criteria
- Full job replay possible from persisted records.
- Dashboard-ready metrics emitted per run.
- Report includes explicit stop/failure reasons and artifact links.

## 9. Milestone Plan
### Milestone 1: Intake + Early Stop
- API contracts, repo ingestion, frontend detector, deterministic no-frontend responses.

### Milestone 2: Purpose + Use Case
- Codex adapter and schema-validated analysis outputs.

### Milestone 3: Visual Demo Pipeline
- Capture subsystem, fallback synthesis, Remotion scene generation, MP4 render.

### Milestone 4: Hardening + Optional OSS Engine
- Aider adapter integration, guardrails, observability depth, resilience tuning.

### Milestone 5: Scale Validation
- Large-repo tuning, time/size thresholds, throughput testing.

## 10. Detailed Acceptance Criteria
### 10.1 No-Frontend Path
- Input: backend-only public repo.
- Expected: status `stopped_no_frontend` and summary message exactly:
- `No frontend code found for demo creation.`
- Artifacts: report with detector evidence only; no render artifacts.

### 10.2 Frontend Success Path
- Input: frontend public repo with runnable or fallback-capable assets.
- Expected: status `completed`.
- Artifacts include `report.json`, `demo-scenes.json`, Remotion project folder, and `demo.mp4`.

### 10.3 Capture-Failure Fallback Path
- Input: frontend repo that fails runtime start.
- Expected: fallback scenes generated and render still attempts.
- Failure only if render itself fails.

### 10.4 Deterministic Failure Mapping
- Every terminal failure must map to a known error code.
- Unknown exceptions are normalized to one of defined terminal categories.

## 11. Testing Plan Summary
### Unit Tests
- URL parser validity and normalization.
- Frontend detector across fixture repos.
- Analysis output parser and validator behavior.

### Integration Tests
- End-to-end no-frontend stop path.
- End-to-end frontend with generated artifacts.
- Monorepo app-root selection consistency.
- Fallback path on forced runtime startup failure.

### Non-Functional Tests
- Runtime budget enforcement.
- Temp workspace cleanup verification.
- Retry safety for idempotent steps.

## 12. Risk Register
### Risk: Large repo ingestion exceeds budget
- Mitigation: shallow clone, file-count limits, timeout ceilings.

### Risk: Agent output schema drift
- Mitigation: strict schema validation and rejection loop.

### Risk: Frontend startup instability
- Mitigation: deterministic fallback scene synthesis.

### Risk: Render-time failures from missing assets
- Mitigation: pre-render asset validation and placeholder substitution.

### Risk: Unsafe command execution
- Mitigation: command allowlist + env sanitization + isolated workdir.

## 13. Operational Runbook Notes
### On `NO_FRONTEND_FOUND`
- Verify detector evidence in report.
- Confirm no false negatives in known framework signatures.

### On `ANALYSIS_FAILED`
- Inspect structured-output parse errors.
- Re-run with debug prompts and strict response schema logging.

### On `FRONTEND_START_FAILED`
- Confirm install/start command inference.
- Validate fallback scene generation succeeded.

### On `RENDER_FAILED`
- Inspect scene payload completeness and asset path integrity.
- Confirm composition metadata and duration values are valid.

## 14. Documentation Deliverables
This implementation plan should be accompanied by:
- `docs/architecture.md`
- `docs/api-contracts.md`
- `docs/test-plan.md`

## 15. Implementation Status
Current phase: **Documentation-only**.
No code implementation is included in this deliverable.
