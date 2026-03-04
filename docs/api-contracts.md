# API Contracts (Phase 1)

## 1. Version and Content Type
- Base path: `/v1`
- Content type: `application/json`
- Timestamps: ISO 8601 UTC

## 2. Create Demo Job
### Request
- Method: `POST`
- Path: `/v1/demo-jobs`
- Headers:
  - `Content-Type: application/json`
  - `Idempotency-Key: <string>` (optional)

### Body
```json
{
  "repoUrl": "https://github.com/owner/repo",
  "ref": "main"
}
```

Field rules:
- `repoUrl` required; must be valid GitHub repository URL.
- `ref` optional; branch/tag/commit-ish.

### Success
- Status: `202 Accepted`
```json
{
  "jobId": "job_01JXYZ...",
  "status": "queued"
}
```

### Validation/Conflict Errors
- `400` with `INVALID_REQUEST` or `INVALID_REPO_URL`
- `409` with `IDEMPOTENCY_KEY_CONFLICT`

## 3. Get Job Status
### Request
- Method: `GET`
- Path: `/v1/demo-jobs/:jobId`

### Success
- Status: `200 OK`
```json
{
  "jobId": "job_01JXYZ...",
  "status": "running",
  "stopReason": null,
  "summary": null,
  "steps": [
    {
      "name": "validateGithubRepo",
      "status": "success",
      "durationMs": 25,
      "errorCode": null,
      "startedAt": "2026-03-04T20:10:00.000Z",
      "finishedAt": "2026-03-04T20:10:00.025Z"
    }
  ],
  "artifacts": {
    "reportJson": null,
    "purposeMd": null,
    "bestDemoMd": null,
    "screenshotsDir": null,
    "remotionPromptJson": null,
    "remotionProjectPath": null,
    "mp4Path": null
  },
  "createdAt": "2026-03-04T20:10:00.000Z",
  "updatedAt": "2026-03-04T20:10:00.025Z"
}
```

### Not Found
- Status: `404`
```json
{
  "error": {
    "code": "JOB_NOT_FOUND",
    "message": "No demo job exists for the requested id"
  }
}
```

## 4. Get Job Artifacts
### Request
- Method: `GET`
- Path: `/v1/demo-jobs/:jobId/artifacts`

### Success
- Status: `200 OK`
```json
{
  "jobId": "job_01JXYZ...",
  "status": "completed",
  "artifacts": {
    "reportJson": "/tmp/repo-to-remotion/job_01JXYZ/report.json",
    "purposeMd": "/tmp/repo-to-remotion/job_01JXYZ/purpose.md",
    "bestDemoMd": "/tmp/repo-to-remotion/job_01JXYZ/best-demo.md",
    "screenshotsDir": "/tmp/repo-to-remotion/job_01JXYZ/screenshots",
    "remotionPromptJson": "/tmp/repo-to-remotion/job_01JXYZ/remotion-prompt.json",
    "remotionProjectPath": "/tmp/repo-to-remotion/job_01JXYZ/remotion-project",
    "mp4Path": "/tmp/repo-to-remotion/job_01JXYZ/demo.mp4"
  }
}
```

## 5. Status Values
Job statuses:
- `queued`
- `running`
- `stopped_no_frontend`
- `failed`
- `completed`

Step statuses:
- `pending`
- `running`
- `success`
- `error`
- `skipped`

## 6. Required Step Names
1. `validateGithubRepo`
2. `cloneRepoShallow`
3. `detectFrontendWithCodex`
4. `noFrontendStop`
5. `analyzePurposeWithCodex`
6. `createBestDemoWithCodex`
7. `planRunAndCaptureWithCodex`
8. `buildRemotionPromptWithGemini`
9. `generateRemotionCodeWithCodex`
10. `renderMp4`
11. `publishArtifacts`

## 7. Standard Error Codes
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

## 8. Startup Recovery Error Detail
- For `planRunAndCaptureWithCodex` failures, `errorDetail` includes structured retry diagnostics:
  - `attemptCount`
  - `attempts[]` with attempt number, commands used, fix commands applied, and structured failure phase/details
  - `finalFailure`
- Recovery retry budget: initial attempt + up to 3 recovery retries.
- Failure `phase` values currently include:
  - `playwright_preflight`
  - `install`
  - `start_process`
  - `readiness_probe`
  - `screenshot_capture`
  - `recovery_fix`
