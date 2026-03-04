# Repo-to-Remotion Demo Agent

## Phase 1 Implementation Plan (Implemented)

## 1. Objective
Deliver a runnable Mastra workflow that accepts a public GitHub repo URL and produces either:
1. deterministic early stop (`stopped_no_frontend`) when no frontend is found, or
2. generated Remotion code + rendered MP4 when a frontend is found.

## 2. Scope (Phase 1)
### In Scope
- Public GitHub repositories only.
- Asynchronous workflow execution.
- Deterministic validation + clone + frontend gate.
- Codex CLI (`gpt-5.3-codex`) for repository analysis and code generation.
- One Gemini call (`google/gemini-3.1-pro-preview`) for remotion prompt synthesis.
- Playwright screenshot capture with deterministic placeholder fallback.
- Remotion project generation and MP4 rendering.
- Step-level status tracking and artifact reporting.

### Out of Scope
- Private repositories.
- Non-Codex analysis engines.
- Multiple demo styles.
- `code-only` rendering mode.

## 3. Workflow Steps
Implemented workflow step order:
1. `validateGithubRepo`
2. `cloneRepoShallow`
3. `detectFrontendWithCodex`
4. `noFrontendStop` (false branch only)
5. `analyzePurposeWithCodex`
6. `createBestDemoWithCodex`
7. `planRunAndCaptureWithCodex`
8. `buildRemotionPromptWithGemini`
9. `generateRemotionCodeWithCodex`
10. `renderMp4`
11. `publishArtifacts`

Branch behavior:
- `hasFrontend=false` => execute `noFrontendStop`, mark downstream steps skipped.
- `hasFrontend=true` => continue to analysis/capture/render flow.

## 4. Model and Tooling Decisions
- Codex CLI model: `gpt-5.3-codex`.
- Codex execution mode: fresh non-interactive `codex exec` per task.
- Internal LLM model: `google/gemini-3.1-pro-preview` via Mastra Agent.
- Remotion guidance source: pinned local snapshot at `docs/reference/remotion-pinned.md`.

## 5. Deterministic Workspace Layout
Per job workspace:
- `/tmp/repo-to-remotion/<jobId>/<owner>__<repo>/` (shallow clone)
- `/tmp/repo-to-remotion/<jobId>/purpose.md`
- `/tmp/repo-to-remotion/<jobId>/best-demo.md`
- `/tmp/repo-to-remotion/<jobId>/screenshots/`
- `/tmp/repo-to-remotion/<jobId>/remotion-prompt.json`
- `/tmp/repo-to-remotion/<jobId>/remotion-project/`
- `/tmp/repo-to-remotion/<jobId>/demo.mp4`
- `/tmp/repo-to-remotion/<jobId>/report.json`

## 6. Error Taxonomy (Phase 1)
- `INVALID_REQUEST`
- `IDEMPOTENCY_KEY_CONFLICT`
- `INVALID_REPO_URL`
- `REPO_NOT_FOUND`
- `REPO_NOT_PUBLIC`
- `CLONE_FAILED`
- `NO_FRONTEND_FOUND`
- `ANALYSIS_FAILED`
- `FRONTEND_START_FAILED`
- `RENDER_FAILED`
- `JOB_NOT_FOUND`
- `INTERNAL_ERROR`

## 7. Artifact Contract
- Always expected by terminal state: `reportJson`.
- Frontend success path: includes `purposeMd`, `bestDemoMd`, `screenshotsDir`, `remotionPromptJson`, `remotionProjectPath`, `mp4Path`.

## 8. Implementation Status
This repository now contains a runnable Phase 1 framework implementation under `src/` and initial unit tests under `tests/`.
