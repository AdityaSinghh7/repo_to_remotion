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

## Environment
See `.env.example`.
