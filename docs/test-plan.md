# Test Strategy and Acceptance Plan

## 1. Objective
Define verification strategy for the Repo-to-Remotion Demo Agent so each workflow path is validated with deterministic, reproducible checks.

## 2. Quality Goals
- Correct early-stop behavior for no-frontend repos.
- Stable analysis outputs under schema validation.
- Resilient fallback behavior when runtime capture fails.
- Deterministic artifact contract on success.
- Clear, categorized failure outcomes.

## 3. Test Layers
### 3.1 Unit Tests
Focus:
- Pure functions.
- Schema validators.
- Heuristic scoring.

Target modules:
- GitHub URL parser and normalizer.
- Frontend detector signal evaluation.
- Analysis response parser and quality gates.
- Scene duration and metadata calculators.

### 3.2 Integration Tests
Focus:
- Cross-module behavior without full deployment complexity.

Target workflows:
- Job creation and persistence.
- Ingestion + detection + early-stop.
- Analysis + capture fallback + scene generation.
- Artifact publishing record integrity.

### 3.3 End-to-End Tests
Focus:
- API-level behavior and complete workflow transitions.

Target scenarios:
- Backend-only repo (hard stop).
- Frontend repo (render success).
- Frontend repo with forced startup failure (fallback render path).

### 3.4 Non-Functional Tests
Focus:
- Runtime budgets.
- Cleanup guarantees.
- Idempotency safety.

## 4. Test Environment Strategy
### 4.1 Fixture Repositories
Create static fixtures representing:
- backend-only monolith
- standard React app
- Next.js app
- monorepo with frontend + backend packages
- intentionally broken frontend startup repo

### 4.2 External Dependency Controls
- Stub GitHub API for deterministic metadata tests.
- Mock analysis engine responses for contract validation.
- Mock render layer for fast CI integration checks.
- Reserve full render tests for scheduled or gated runs.

### 4.3 Execution Profiles
- Fast profile: unit + selected integration.
- Full profile: full integration + end-to-end + render path.
- Soak profile: large-repo stress with strict limits.

## 5. Core Scenario Matrix
| Scenario | Input Repo Type | Expected Final Status | Must-Exist Artifacts | Expected Error/Stop Code |
|---|---|---|---|---|
| S1 | Backend-only | `stopped_no_frontend` | `report.json` | `NO_FRONTEND_FOUND` |
| S2 | Runnable frontend | `completed` | `report.json`, `demo-scenes.json`, `demo.mp4` | None |
| S3 | Frontend startup failure | `completed` or `failed` at render step only | fallback scenes, report | `FRONTEND_START_FAILED` only as step outcome |
| S4 | Invalid GitHub URL | `failed` | none | `INVALID_REPO_URL` |
| S5 | Private repo | `failed` | report optional | `REPO_NOT_PUBLIC` |
| S6 | Clone timeout/size overflow | `failed` | report optional | `CLONE_FAILED` |
| S7 | Malformed analysis output | `failed` | report optional | `ANALYSIS_FAILED` |
| S8 | Render crash | `failed` | report + scene spec | `RENDER_FAILED` |

## 6. Acceptance Tests (Must Pass)
### A1: No-Frontend Early Stop
Given a backend-only public repo:
- Create job request succeeds.
- Workflow reaches detector step.
- Job ends with `stopped_no_frontend`.
- Summary equals exactly: `No frontend code found for demo creation.`

### A2: Frontend Successful Output
Given a frontend public repo:
- Workflow proceeds past detector.
- Analysis returns purpose and use case.
- Final status is `completed`.
- Artifacts include `report.json`, `demo-scenes.json`, generated Remotion project, and `demo.mp4`.

### A3: Fallback Path on Startup Failure
Given a frontend repo that fails to start:
- Capture step records startup failure.
- Fallback visuals are generated.
- Render step still executes.
- Terminal failure only allowed if render fails.

### A4: Error Taxonomy Determinism
For each forced failure class:
- API returns mapped error code.
- Workflow step error and terminal status are consistent.
- Unknown exceptions are normalized and not leaked raw.

## 7. Unit Test Cases
### 7.1 URL Parser
- Valid HTTP/HTTPS GitHub URL.
- URL with trailing `.git`.
- URL with `/tree/<branch>` reference.
- Invalid host rejection.
- Missing owner/repo rejection.

### 7.2 Frontend Detector
- React dependency in `package.json` sets positive signal.
- `next.config.js` detected as frontend config signal.
- `src/main.tsx` and `public/` increase confidence.
- Monorepo root with only backend workspace does not false-positive.

### 7.3 Analysis Schema Validator
- Valid structured output passes.
- Missing `flowSteps` fails.
- `flowSteps` shorter than 4 fails quality gate.
- Empty `targetUsers` fails purpose quality gate.

### 7.4 Scene Builder
- Duration is assigned per scene and totals within bounds.
- Missing screenshot path allowed only when fallback mode is active.
- Unsupported transition rejects with validation error.

## 8. Integration Test Cases
### 8.1 Job Lifecycle Persistence
- Job creation stores initial state and timestamps.
- Step transitions append in proper order.
- Terminal state prevents further mutation.

### 8.2 Ingestion + Detection Chain
- Public repo metadata lookup success.
- Clone result path passed to detector.
- Detector evidence serialized to report payload.

### 8.3 Analysis and Route Planning
- Engine adapter invoked with repo path and context.
- Parsed outputs persisted as typed records.
- Invalid output triggers `ANALYSIS_FAILED`.

### 8.4 Capture Fallback Chain
- Startup timeout triggers fallback mode.
- Fallback assets generate valid scene inputs.

### 8.5 Artifact Publishing
- Artifact paths are normalized and stored.
- Status endpoint returns artifact map in final payload.

## 9. End-to-End Test Cases
### E2E-1: Full success
- Submit known React fixture URL.
- Poll status until completion.
- Verify artifact files exist and sizes are non-zero.

### E2E-2: Early stop
- Submit backend-only fixture URL.
- Poll status until terminal stop.
- Verify no render artifacts created.

### E2E-3: Render failure handling
- Submit fixture with intentionally broken composition.
- Verify terminal `failed` with `RENDER_FAILED`.
- Verify report includes failure fingerprint.

## 10. Performance and Reliability Tests
### 10.1 Runtime Budget Test
- Enforce max total runtime per job.
- Ensure timed-out jobs terminate cleanly.

### 10.2 Large Repo Stress Test
- Use high-file-count public repo fixtures.
- Validate file-count and timeout guardrails.

### 10.3 Concurrency Test
- Run N jobs concurrently.
- Verify no cross-job workspace contamination.

### 10.4 Cleanup Test
- After each job, temp workspace removed.
- Child processes are not orphaned.

## 11. Observability Verification
For each scenario validate:
- Step-level logs include `jobId`, `stepName`, `status`, duration.
- Metrics increment as expected.
- Error fingerprints contain normalized category + signature.

## 12. CI Pipeline Recommendation
Stage 1:
- Lint/typecheck/unit tests.

Stage 2:
- Integration tests with mocked analysis/render layers.

Stage 3 (optional nightly):
- Full render E2E tests with real Remotion render path.

## 13. Exit Criteria for Implementation Start
Implementation can be declared "test-ready" when:
- All acceptance tests A1-A4 are automated.
- Scenario matrix S1-S8 has deterministic outcomes.
- Coverage includes all terminal statuses and error codes.
- Flaky test rate is within agreed threshold.

## 14. Documentation-Only Status
This file defines the test plan only.
No code implementation is included in this deliverable.
