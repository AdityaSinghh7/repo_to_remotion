import { describe, expect, it } from 'vitest';
import { frontendDetectionResultSchema } from '../src/types/contracts.js';
import { extractJsonObject } from '../src/utils/json.js';

describe('extractJsonObject', () => {
  it('extracts fenced JSON payload', () => {
    const payload = extractJsonObject<{ hasFrontend: boolean; evidence: string[] }>(`

a prefix

\`\`\`json
{"hasFrontend":true,"evidence":["package.json has react"]}
\`\`\`
`);

    expect(payload.hasFrontend).toBe(true);
    expect(payload.evidence[0]).toContain('react');
  });

  it('throws on invalid payload', () => {
    expect(() => extractJsonObject('not-json')).toThrowError();
  });
});

describe('frontendDetectionResultSchema', () => {
  it('accepts a valid frontend boolean result', () => {
    const result = frontendDetectionResultSchema.parse({
      hasFrontend: false,
      evidence: ['no frontend framework dependencies found'],
    });

    expect(result.hasFrontend).toBe(false);
  });

  it('rejects missing boolean field', () => {
    const parsed = frontendDetectionResultSchema.safeParse({
      evidence: [],
    });

    expect(parsed.success).toBe(false);
  });
});
