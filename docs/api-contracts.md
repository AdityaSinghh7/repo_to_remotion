# API Contracts

## 1. API Version and Format
- Base path: `/v1`
- Content type: `application/json`
- All timestamps: ISO 8601 UTC strings.
- All IDs: opaque strings.

## 2. Endpoint: Create Demo Job
### Request
- Method: `POST`
- Path: `/v1/demo-jobs`
- Headers:
- `Content-Type: application/json`
- `Idempotency-Key: <string>` (optional, recommended)

### Request Body
```json
{
  "repoUrl": "https://github.com/owner/repo",
  "ref": "main",
  "engine": "codex",
  "renderMode": "code+mp4",
  "demoStyle": "guided-ui-tour"
}
```

### Field Rules
- `repoUrl`:
- required
- must be valid GitHub repo URL
- public repos only
- `ref`:
- optional
- branch, tag, or commit-ish
- default: repo default branch
- `engine`:
- optional
- allowed: `codex`, `aider`
- default: `codex`
- `renderMode`:
- optional
- allowed: `code+mp4`, `code-only`
- default: `code+mp4`
- `demoStyle`:
- optional
- allowed: `guided-ui-tour`
- default: `guided-ui-tour`

### Success Response
- Status: `202 Accepted`
```json
{
  "jobId": "job_01JXYZ...",
  "status": "queued"
}
```

### Validation Errors
- Status: `400 Bad Request`
```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "repoUrl must be a valid public GitHub repository URL"
  }
}
```

## 3. Endpoint: Get Job Status
### Request
- Method: `GET`
- Path: `/v1/demo-jobs/:jobId`

### Success Response
- Status: `200 OK`
```json
{
  "jobId": "job_01JXYZ...",
  "status": "running",
  "stopReason": null,
  "summary": null,
  "steps": [
    {
      "name": "validateInput",
      "status": "success",
      "durationMs": 12,
      "errorCode": null,
      "startedAt": "2026-03-04T20:10:00.000Z",
      "finishedAt": "2026-03-04T20:10:00.012Z"
    },
    {
      "name": "fetchRepo",
      "status": "running",
      "durationMs": null,
      "errorCode": null,
      "startedAt": "2026-03-04T20:10:00.015Z",
      "finishedAt": null
    }
  ],
  "artifacts": {
    "reportJson": null,
    "demoScenesJson": null,
    "remotionProjectPath": null,
    "mp4Path": null
  },
  "createdAt": "2026-03-04T20:10:00.000Z",
  "updatedAt": "2026-03-04T20:10:03.000Z"
}
```

### No-Frontend Terminal Example
```json
{
  "jobId": "job_01JXYZ...",
  "status": "stopped_no_frontend",
  "stopReason": "NO_FRONTEND_FOUND",
  "summary": "No frontend code found for demo creation.",
  "steps": [
    {"name": "validateInput", "status": "success"},
    {"name": "fetchRepo", "status": "success"},
    {"name": "detectFrontend", "status": "success"},
    {"name": "analyzePurpose", "status": "skipped"},
    {"name": "planUseCase", "status": "skipped"},
    {"name": "captureVisuals", "status": "skipped"},
    {"name": "generateRemotion", "status": "skipped"},
    {"name": "renderVideo", "status": "skipped"},
    {"name": "publishArtifacts", "status": "success"}
  ],
  "artifacts": {
    "reportJson": "artifacts/job_01JXYZ/report.json",
    "demoScenesJson": null,
    "remotionProjectPath": null,
    "mp4Path": null
  }
}
```

### Not Found
- Status: `404 Not Found`
```json
{
  "error": {
    "code": "JOB_NOT_FOUND",
    "message": "No demo job exists for the requested id"
  }
}
```

## 4. Endpoint: Get Job Artifacts
### Request
- Method: `GET`
- Path: `/v1/demo-jobs/:jobId/artifacts`

### Success Response
- Status: `200 OK`
```json
{
  "jobId": "job_01JXYZ...",
  "status": "completed",
  "artifacts": {
    "reportJson": "artifacts/job_01JXYZ/report.json",
    "demoScenesJson": "artifacts/job_01JXYZ/demo-scenes.json",
    "remotionProjectPath": "artifacts/job_01JXYZ/remotion-project",
    "mp4Path": "artifacts/job_01JXYZ/demo.mp4"
  }
}
```

## 5. Domain Types
### CreateDemoJobRequest
```ts
type CreateDemoJobRequest = {
  repoUrl: string;
  ref?: string;
  engine?: 'codex' | 'aider';
  renderMode?: 'code+mp4' | 'code-only';
  demoStyle?: 'guided-ui-tour';
};
```

### CreateDemoJobResponse
```ts
type CreateDemoJobResponse = {
  jobId: string;
  status: 'queued' | 'running' | 'stopped_no_frontend' | 'failed' | 'completed';
};
```

### DemoJobStatusResponse
```ts
type DemoJobStatusResponse = {
  jobId: string;
  status: 'queued' | 'running' | 'stopped_no_frontend' | 'failed' | 'completed';
  stopReason?: 'NO_FRONTEND_FOUND';
  summary?: string;
  steps: Array<{
    name: string;
    status: 'pending' | 'running' | 'success' | 'error' | 'skipped';
    durationMs?: number;
    errorCode?: string;
    startedAt?: string;
    finishedAt?: string;
  }>;
  artifacts?: {
    reportJson?: string;
    demoScenesJson?: string;
    remotionProjectPath?: string;
    mp4Path?: string;
  };
  createdAt?: string;
  updatedAt?: string;
};
```

## 6. Internal Analysis Schemas
### FrontendDetectionResult
```ts
type FrontendDetectionResult = {
  hasFrontend: boolean;
  confidence: number;
  appRoots: string[];
  framework:
    | 'react'
    | 'next'
    | 'vue'
    | 'svelte'
    | 'angular'
    | 'nuxt'
    | 'astro'
    | 'remix'
    | 'unknown';
  evidence: string[];
};
```

### RepoPurpose
```ts
type RepoPurpose = {
  oneLiner: string;
  targetUsers: string[];
  primaryCapabilities: string[];
};
```

### UseCasePlan
```ts
type UseCasePlan = {
  title: string;
  userPersona: string;
  problem: string;
  flowSteps: string[];
  expectedOutcome: string;
};
```

### DemoSpec
```ts
type DemoScene = {
  id: string;
  screenshotPath?: string;
  caption: string;
  durationInFrames: number;
  transition: 'fade' | 'slide' | 'none';
};

type DemoSpec = {
  videoTitle: string;
  fps: number;
  width: number;
  height: number;
  scenes: DemoScene[];
};
```

## 7. Workflow Step Contract
Each workflow step must produce:
- `status`
- `startedAt`
- `finishedAt`
- `durationMs`
- `payload` (step-specific structured output)
- optional `errorCode` and `errorDetail`

Required step names in order:
1. `validateInput`
2. `fetchRepo`
3. `detectFrontend`
4. `analyzePurpose`
5. `planUseCase`
6. `captureVisuals`
7. `generateRemotion`
8. `renderVideo`
9. `publishArtifacts`

## 8. Error Contract
### Error Object
```json
{
  "error": {
    "code": "RENDER_FAILED",
    "message": "Render process exited with non-zero status",
    "detail": {
      "jobId": "job_01JXYZ...",
      "step": "renderVideo"
    }
  }
}
```

### Standard Error Codes
- `INVALID_REQUEST`
- `INVALID_REPO_URL`
- `REPO_NOT_PUBLIC`
- `CLONE_FAILED`
- `NO_FRONTEND_FOUND`
- `ANALYSIS_FAILED`
- `FRONTEND_START_FAILED`
- `RENDER_FAILED`
- `JOB_NOT_FOUND`
- `INTERNAL_ERROR`

## 9. Idempotency Behavior
- If request includes `Idempotency-Key` and matching payload already exists:
- Return original `jobId` and current status.
- Do not enqueue duplicate job.

- If `Idempotency-Key` is reused with different payload:
- Return `409 Conflict` with `IDEMPOTENCY_KEY_CONFLICT`.

## 10. Backward Compatibility Policy
- Minor additive changes allowed without version bump.
- Breaking response changes require `/v2`.
- Error code semantics are stable once published.
