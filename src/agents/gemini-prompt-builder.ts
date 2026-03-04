import { Agent } from '@mastra/core/agent';
import { remotionPromptOutputSchema, type RemotionPromptOutput } from '../types/contracts.js';
import { AppError } from '../utils/app-error.js';
import { extractJsonObject } from '../utils/json.js';
import { log } from '../utils/logger.js';

const SYSTEM_INSTRUCTIONS = `
You generate deterministic, implementation-grade prompts for coding agents.
Output strict JSON only.
`.trim();

const extractResponseText = (response: unknown): string => {
  if (typeof response === 'string') {
    return response;
  }

  if (response && typeof response === 'object') {
    const value = response as Record<string, unknown>;

    if (typeof value.text === 'string') {
      return value.text;
    }

    if (typeof value.response === 'string') {
      return value.response;
    }

    if (Array.isArray(value.content)) {
      const parts = value.content
        .map((part) => {
          if (typeof part === 'string') {
            return part;
          }

          if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
            return (part as { text: string }).text;
          }

          return '';
        })
        .filter(Boolean);

      if (parts.length > 0) {
        return parts.join('\n');
      }
    }
  }

  throw new Error('Unsupported model response format');
};

export class GeminiPromptBuilder {
  private readonly agent: Agent;

  constructor() {
    this.agent = new Agent({
      name: 'Remotion Prompt Builder',
      instructions: SYSTEM_INSTRUCTIONS,
      model: 'google/gemini-3.1-pro-preview' as never,
    });
  }

  public async buildPrompt(input: {
    purposeMarkdown: string;
    bestDemoMarkdown: string;
    remotionDocs: string;
    screenshotNames: string[];
  }): Promise<RemotionPromptOutput> {
    const startedAt = Date.now();

    const prompt = `
Create a very detailed remotion code-writing prompt and screenshot mapping.

Required JSON schema:
{
  "remotionCodegenPrompt": string,
  "screenshotNames": string[]
}

Requirements:
- remotionCodegenPrompt must be highly detailed and implementation-ready.
- Must reference screenshots by exact names from screenshotNames.
- Keep output deterministic and aligned to the listed screenshots.
- Return JSON only.

purpose.md:
${input.purposeMarkdown}

best-demo.md:
${input.bestDemoMarkdown}

Pinned remotion docs:
${input.remotionDocs}

Available screenshotNames:
${JSON.stringify(input.screenshotNames, null, 2)}
`.trim();

    let rawResponse: unknown;

    try {
      log('info', 'Calling Gemini prompt builder', {
        screenshotCount: input.screenshotNames.length,
        purposeChars: input.purposeMarkdown.length,
        bestDemoChars: input.bestDemoMarkdown.length,
      });
      rawResponse = await this.agent.generate(prompt);
    } catch (error) {
      throw new AppError('ANALYSIS_FAILED', 'Gemini prompt builder call failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    }

    const text = extractResponseText(rawResponse);
    log('debug', 'Gemini prompt builder returned text', {
      outputChars: text.length,
      durationMs: Date.now() - startedAt,
    });

    try {
      const parsed = extractJsonObject<unknown>(text);
      const validated = remotionPromptOutputSchema.safeParse(parsed);
      if (!validated.success) {
        throw validated.error;
      }

      log('info', 'Gemini prompt builder output validated', {
        screenshotCount: validated.data.screenshotNames.length,
        durationMs: Date.now() - startedAt,
      });

      return validated.data;
    } catch (error) {
      throw new AppError('ANALYSIS_FAILED', 'Gemini output parsing failed', {
        message: text,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
