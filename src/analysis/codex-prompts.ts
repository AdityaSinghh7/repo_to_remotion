export const buildFrontendDetectionPrompt = (): string => `
You are validating whether a repository contains a frontend application.

Rules:
- Inspect the full repository.
- Frontend means user-facing web UI code (React/Next/Vue/Svelte/Angular/Astro/Nuxt/Remix or equivalent browser app).
- Backend-only repositories must return false.
- Return strict JSON only, with no markdown.

Required JSON schema:
{
  "hasFrontend": boolean,
  "evidence": string[]
}

Evidence should be concise file/dependency indicators.
`;

export const buildPurposePrompt = (): string => `
Read the full repository and produce a detailed markdown summary describing:
1) What the project does.
2) The main user/problem it solves.
3) The frontend surfaces and user journey.
4) Any constraints that matter for demo creation.

Output markdown only.
`;

export const buildBestDemoPrompt = (): string => `
You have a purpose.md file in the parent directory of this repository.
Read both the repository and purpose.md, then produce one BEST demo workflow.

Output markdown only and include:
- Demo title
- Persona
- Starting state
- Exact step-by-step flow (minimum 6 steps)
- Expected visual checkpoints
- What success looks like
`;

export const buildCapturePlanPrompt = (): string => `
Read the repository and purpose.md + best-demo.md from the parent directory.
Return strict JSON only with deterministic commands and routes for capturing frontend screenshots.

Schema:
{
  "installCommand": string | null,
  "startCommand": string,
  "port": number,
  "basePath": string,
  "screenshotRoutes": string[]
}

Constraints:
- screenshotRoutes length 1-4.
- Prefer stable landing and main flow routes.
- Keep commands compatible with Linux/macOS shells.
`;

export const buildRemotionCodegenPrompt = (input: {
  remotionPrompt: string;
  remotionDocs: string;
}): string => `
Generate Remotion project code from the prompt below.

Prompt:
${input.remotionPrompt}

Pinned Remotion docs:
${input.remotionDocs}

Return strict JSON only with schema:
{
  "files": [{"path": string, "content": string}],
  "compositionId": string,
  "entryFile": string
}

Rules:
- Include all files needed to render.
- Paths must be relative and safe.
- Use TypeScript/JS as needed.
- Do not include markdown or explanation.
`;
