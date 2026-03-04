# Test Strategy (Phase 1)

## 1. Objective
Validate deterministic behavior for ingestion, frontend gating, structured parsing, and artifact naming while establishing the first executable workflow test foundation.

## 2. Current Automated Coverage
### Unit Tests Implemented
1. GitHub URL parser
- Valid URL parsing.
- `.git` suffix normalization.
- non-GitHub host rejection.

2. GitHub visibility mapping
- public repo metadata mapping.
- `404` mapped to `REPO_NOT_FOUND`.
- private repo mapped to `REPO_NOT_PUBLIC`.

3. Codex JSON extraction + schema validation
- fenced JSON extraction.
- invalid payload rejection.
- frontend detection schema acceptance/rejection paths.

4. Deterministic screenshot naming
- minimum output name.
- max cap behavior.
- zero-count fallback behavior.

## 3. Planned Integration Tests
- No-frontend branch returns `stopped_no_frontend` and writes report.
- Frontend path reaches render with full artifact manifest.
- Frontend startup failure preserves flow with placeholders and render attempt.
- Gemini malformed output maps to `ANALYSIS_FAILED` deterministically.

## 4. Planned End-to-End Tests
- Backend-only public repo fixture.
- Runnable frontend fixture.
- Broken-startup frontend fixture.
- Invalid/non-existent GitHub repo fixture.
- private repo fixture.

## 5. Acceptance Criteria (Phase 1)
- API lifecycle endpoints return deterministic machine-readable state.
- Workflow step transitions are persisted with start/finish timing.
- False frontend branch skips downstream computational steps.
- Success branch publishes `report.json` and `demo.mp4` paths.
- Error codes map to documented taxonomy without raw exception leaks.
