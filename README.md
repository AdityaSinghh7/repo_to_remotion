# Repo to Remotion

Phase 1 implementation of a Mastra workflow that:
- validates and shallow clones a public GitHub repository,
- determines frontend presence with Codex CLI,
- branches to early-stop when no frontend is found,
- generates purpose/demo artifacts with Codex,
- builds a Remotion prompt with Gemini,
- generates Remotion code with Codex,
- renders `demo.mp4`.

## Run

```bash
npm install
npm run dev
```

Service starts on `http://localhost:8787` by default.

## API
- `POST /v1/demo-jobs`
- `GET /v1/demo-jobs/:jobId`
- `GET /v1/demo-jobs/:jobId/artifacts`

## Endpoint Test Script
Run end-to-end API submission + polling against a GitHub URL:

```bash
npm run test:endpoint -- --repo-url https://github.com/psf/requests --start-server --expected-status any
```

## Environment
See `.env.example`.

For detailed server logs during workflow runs, set:

```bash
LOG_LEVEL=debug
```
