export const env = {
  port: Number(process.env.PORT ?? 8787),
  workspaceBaseDir: process.env.REPO_TO_REMOTION_WORKSPACE_BASE_DIR ?? '/tmp/repo-to-remotion',
  remotionDocsPath:
    process.env.REMOTION_DOCS_PATH ?? 'docs/reference/remotion-pinned.md',
  codexModel: process.env.CODEX_MODEL ?? 'gpt-5.3-codex',
  codexTimeoutMs: Number(process.env.CODEX_TIMEOUT_MS ?? 10 * 60 * 1000),
  stepTimeoutMs: Number(process.env.STEP_TIMEOUT_MS ?? 15 * 60 * 1000),
  googleApiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? '',
};
