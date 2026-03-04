import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPlaywrightInstallEnv,
  ensureGlobalPlaywrightChromium,
  resetPlaywrightPreflightStateForTests,
} from '../src/capture/screenshot-capture-service.js';
import { AppError } from '../src/utils/app-error.js';

describe('createPlaywrightInstallEnv', () => {
  it('strips npm_config_prefix and PLAYWRIGHT_BROWSERS_PATH=0', () => {
    const env = createPlaywrightInstallEnv({
      ...process.env,
      npm_config_prefix: '/opt/homebrew',
      PLAYWRIGHT_BROWSERS_PATH: '0',
      KEEP_ME: 'yes',
    });

    expect(env.npm_config_prefix).toBeUndefined();
    expect(env.PLAYWRIGHT_BROWSERS_PATH).toBeUndefined();
    expect(env.KEEP_ME).toBe('yes');
  });
});

describe('ensureGlobalPlaywrightChromium', () => {
  beforeEach(() => {
    resetPlaywrightPreflightStateForTests();
  });

  it('does not install when chromium executable already exists', async () => {
    const runCommandSpy = vi.fn(async () => ({
      exitCode: 0,
      stdout: '',
      stderr: '',
    }));

    const accessFn = vi.fn(async () => {});

    await ensureGlobalPlaywrightChromium({
      jobId: 'job_1',
      repoPath: '/tmp/repo',
      attempt: 1,
      resolveExecutablePath: () => '/cache/chromium',
      accessFn,
      runCommandFn: runCommandSpy,
    });

    expect(accessFn).toHaveBeenCalledTimes(1);
    expect(runCommandSpy).not.toHaveBeenCalled();
  });

  it('installs chromium when executable is missing', async () => {
    let installed = false;
    const accessFn = vi.fn(async () => {
      if (!installed) {
        throw new Error('missing');
      }
    });
    const runCommandSpy = vi.fn(async () => {
      installed = true;
      return {
        exitCode: 0,
        stdout: 'installed',
        stderr: '',
      };
    });

    await ensureGlobalPlaywrightChromium({
      jobId: 'job_2',
      repoPath: '/tmp/repo',
      attempt: 1,
      resolveExecutablePath: () => '/cache/chromium',
      accessFn,
      runCommandFn: runCommandSpy,
      baseEnv: {
        ...process.env,
        npm_config_prefix: '/opt/homebrew',
        PLAYWRIGHT_BROWSERS_PATH: '0',
      },
    });

    expect(runCommandSpy).toHaveBeenCalledTimes(1);
    expect(accessFn).toHaveBeenCalledTimes(2);
    const firstCall = runCommandSpy.mock.calls[0] as unknown as
      | [string, string[], { env?: NodeJS.ProcessEnv }]
      | undefined;
    expect(firstCall).toBeDefined();
    expect(firstCall?.[2]?.env?.npm_config_prefix).toBeUndefined();
    expect(firstCall?.[2]?.env?.PLAYWRIGHT_BROWSERS_PATH).toBeUndefined();
  });

  it('runs only one install for concurrent calls', async () => {
    let installed = false;
    const accessFn = vi.fn(async () => {
      if (!installed) {
        throw new Error('missing');
      }
    });
    const runCommandSpy = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      installed = true;
      return {
        exitCode: 0,
        stdout: '',
        stderr: '',
      };
    });

    await Promise.all([
      ensureGlobalPlaywrightChromium({
        jobId: 'job_3a',
        repoPath: '/tmp/repo',
        attempt: 1,
        resolveExecutablePath: () => '/cache/chromium',
        accessFn,
        runCommandFn: runCommandSpy,
      }),
      ensureGlobalPlaywrightChromium({
        jobId: 'job_3b',
        repoPath: '/tmp/repo',
        attempt: 1,
        resolveExecutablePath: () => '/cache/chromium',
        accessFn,
        runCommandFn: runCommandSpy,
      }),
    ]);

    expect(runCommandSpy).toHaveBeenCalledTimes(1);
  });

  it('returns FRONTEND_START_FAILED with playwright_preflight on install failure', async () => {
    const accessFn = vi.fn(async () => {
      throw new Error('missing');
    });
    const runCommandSpy = vi.fn(async () => ({
      exitCode: 1,
      stdout: '',
      stderr: 'install failed',
    }));

    try {
      await ensureGlobalPlaywrightChromium({
        jobId: 'job_4',
        repoPath: '/tmp/repo',
        attempt: 1,
        resolveExecutablePath: () => '/cache/chromium',
        accessFn,
        runCommandFn: runCommandSpy,
      });
      throw new Error('expected preflight failure');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const appError = error as AppError;
      expect(appError.code).toBe('FRONTEND_START_FAILED');
      expect(appError.detail).toMatchObject({
        phase: 'playwright_preflight',
      });
    }
  });
});
