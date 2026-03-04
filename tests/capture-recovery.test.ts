import { describe, expect, it } from 'vitest';
import {
  captureRecoveryPlanSchema,
  captureStartupFailureSchema,
} from '../src/types/contracts.js';
import { getUnsafeRecoveryCommandReason } from '../src/capture/screenshot-capture-service.js';

describe('captureRecoveryPlanSchema', () => {
  it('accepts fix commands with command revisions', () => {
    const parsed = captureRecoveryPlanSchema.parse({
      fixCommands: ['npm install --include=optional'],
      updatedInstallCommand: 'cd apps/web && npm install',
      updatedStartCommand: 'cd apps/web && npm run dev -- --port 3000',
    });

    expect(parsed.fixCommands).toHaveLength(1);
  });

  it('rejects empty plans', () => {
    const parsed = captureRecoveryPlanSchema.safeParse({
      fixCommands: [],
    });

    expect(parsed.success).toBe(false);
  });
});

describe('captureStartupFailureSchema', () => {
  it('accepts known failure phases', () => {
    const value = captureStartupFailureSchema.parse({
      phase: 'install',
      message: 'npm ci failed',
      command: 'cd apps/web && npm ci',
      attempt: 1,
    });

    expect(value.phase).toBe('install');
  });

  it('accepts playwright preflight phase', () => {
    const value = captureStartupFailureSchema.parse({
      phase: 'playwright_preflight',
      message: 'missing playwright browser',
      command: 'npx playwright install chromium',
      attempt: 1,
    });

    expect(value.phase).toBe('playwright_preflight');
  });
});

describe('getUnsafeRecoveryCommandReason', () => {
  const repoPath = '/tmp/repo-to-remotion/job_abc/owner__repo';

  it('rejects sudo usage', () => {
    expect(getUnsafeRecoveryCommandReason('sudo npm install', repoPath)).toContain('sudo');
  });

  it('rejects repo escape via parent path', () => {
    expect(getUnsafeRecoveryCommandReason('cd ../ && npm install', repoPath)).toContain(
      'repo-escaping',
    );
  });

  it('accepts scoped install command', () => {
    expect(getUnsafeRecoveryCommandReason('cd apps/web && npm install', repoPath)).toBeNull();
  });
});
