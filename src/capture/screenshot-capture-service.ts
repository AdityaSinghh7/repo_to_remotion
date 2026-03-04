import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { chromium } from 'playwright';
import { CodexAnalysisService } from '../analysis/codex-analysis-service.js';
import {
  captureStartupFailureSchema,
  type CaptureAttemptRecord,
  type CaptureFailurePhase,
  type CapturePlan,
  type CaptureStartupFailure,
  type ScreenshotManifest,
} from '../types/contracts.js';
import { AppError, asAppError } from '../utils/app-error.js';
import { runCommand } from '../utils/command-runner.js';
import { ensureDir } from '../utils/fs.js';
import { log } from '../utils/logger.js';
import { getScreenshotsDirPath } from '../utils/paths.js';

const MAX_RECOVERY_RETRIES = 3;
const MAX_ATTEMPTS = 1 + MAX_RECOVERY_RETRIES;
const READINESS_TIMEOUT_MS = 120_000;
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const FIX_COMMAND_TIMEOUT_MS = 5 * 60 * 1000;
const PLAYWRIGHT_INSTALL_TIMEOUT_MS = 5 * 60 * 1000;
const OUTPUT_TAIL_LIMIT = 12_000;
const PLAYWRIGHT_INSTALL_COMMAND = 'npx playwright install chromium';

let playwrightInstallPromise: Promise<void> | null = null;

export const DETERMINISTIC_SCREENSHOT_NAMES = [
  '01-landing.png',
  '02-flow-a.png',
  '03-flow-b.png',
  '04-flow-c.png',
] as const;

export const buildDeterministicScreenshotNames = (count: number): string[] => {
  const size = Math.max(1, Math.min(count, DETERMINISTIC_SCREENSHOT_NAMES.length));
  return [...DETERMINISTIC_SCREENSHOT_NAMES.slice(0, size)];
};

const withTrailingSlash = (input: string): string => (input.endsWith('/') ? input : `${input}/`);

const normalizeRoute = (route: string): string => {
  if (!route || route === '/') {
    return '';
  }

  return route.startsWith('/') ? route.slice(1) : route;
};

const truncateTail = (value: string): string => {
  if (!value) {
    return '';
  }

  if (value.length <= OUTPUT_TAIL_LIMIT) {
    return value;
  }

  return value.slice(-OUTPUT_TAIL_LIMIT);
};

const createUrl = (port: number, basePath: string, route: string): string => {
  const base = new URL(`http://127.0.0.1:${port}/`);
  const merged = `${withTrailingSlash(basePath)}${normalizeRoute(route)}`;
  base.pathname = merged.startsWith('/') ? merged : `/${merged}`;
  return base.toString();
};

const createCaptureFailure = (input: {
  phase: CaptureFailurePhase;
  message: string;
  attempt: number;
  command?: string | null;
  exitCode?: number | null;
  stdout?: string | null;
  stderr?: string | null;
}): CaptureStartupFailure => {
  return {
    phase: input.phase,
    message: input.message,
    command: input.command ?? null,
    exitCode: input.exitCode ?? null,
    stdout: truncateTail(input.stdout ?? ''),
    stderr: truncateTail(input.stderr ?? ''),
    attempt: input.attempt,
  };
};

const parseFailureFromError = (
  error: unknown,
): { failure: CaptureStartupFailure; executedCommands?: string[] } | null => {
  if (!(error instanceof AppError)) {
    return null;
  }

  const direct = captureStartupFailureSchema.safeParse(error.detail);
  if (direct.success) {
    return { failure: direct.data };
  }

  if (!error.detail || typeof error.detail !== 'object') {
    return null;
  }

  const detail = error.detail as Record<string, unknown>;
  const nested = captureStartupFailureSchema.safeParse(detail.failure);
  if (!nested.success) {
    return null;
  }

  const commands = Array.isArray(detail.executedCommands)
    ? detail.executedCommands.filter((candidate): candidate is string => typeof candidate === 'string')
    : undefined;

  return {
    failure: nested.data,
    executedCommands: commands,
  };
};

const takeScreenshots = async (input: {
  port: number;
  basePath: string;
  routes: string[];
  screenshotDir: string;
}): Promise<string[]> => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const screenshotNames: string[] = [];

  try {
    const routes = input.routes.slice(0, DETERMINISTIC_SCREENSHOT_NAMES.length);

    for (let index = 0; index < routes.length; index += 1) {
      const route = routes[index];
      const name = DETERMINISTIC_SCREENSHOT_NAMES[index];
      const target = createUrl(input.port, input.basePath, route);
      await page.goto(target, { waitUntil: 'networkidle', timeout: 30_000 });
      await page.screenshot({ path: path.join(input.screenshotDir, name), fullPage: true });
      screenshotNames.push(name);
    }
  } finally {
    await page.close();
    await browser.close();
  }

  return screenshotNames;
};

const normalizeCwdToken = (token: string): string => token.trim().replace(/^["']|["']$/g, '');

export const getUnsafeRecoveryCommandReason = (
  command: string,
  repoPath: string,
): string | null => {
  const trimmed = command.trim();
  if (!trimmed) {
    return 'empty command is not allowed';
  }

  if (/\bsudo\b/i.test(trimmed)) {
    return 'sudo is not allowed';
  }

  if (trimmed.includes('../') || trimmed.includes('..\\')) {
    return 'repo-escaping parent paths are not allowed';
  }

  if (/\brm\s+-rf\s+\/($|\s)/i.test(trimmed) || /\brm\s+-rf\s+~($|\s|\/)/i.test(trimmed)) {
    return 'destructive host-level remove commands are not allowed';
  }

  if (/\bmkfs\b/i.test(trimmed) || /\bdd\s+if=/i.test(trimmed)) {
    return 'destructive disk commands are not allowed';
  }

  const normalizedRepoPath = path.resolve(repoPath);
  const cdTargets = trimmed.matchAll(/(?:^|[;&|]{1,2})\s*cd\s+(".*?"|'.*?'|[^\s;&|]+)/g);

  for (const match of cdTargets) {
    const rawTarget = match[1];
    if (!rawTarget) {
      continue;
    }

    const target = normalizeCwdToken(rawTarget);
    if (target.startsWith('~')) {
      return 'home-directory cd targets are not allowed';
    }
    if (target.includes('..')) {
      return 'repo-escaping cd targets are not allowed';
    }

    if (path.isAbsolute(target)) {
      const resolvedTarget = path.resolve(target);
      if (
        resolvedTarget !== normalizedRepoPath &&
        !resolvedTarget.startsWith(`${normalizedRepoPath}${path.sep}`)
      ) {
        return 'absolute cd target escapes repository scope';
      }
    }
  }

  return null;
};

type PlaywrightPreflightOptions = {
  jobId: string;
  repoPath: string;
  attempt: number;
  accessFn?: (targetPath: string) => Promise<void>;
  resolveExecutablePath?: () => string;
  runCommandFn?: typeof runCommand;
  baseEnv?: NodeJS.ProcessEnv;
};

export const resetPlaywrightPreflightStateForTests = (): void => {
  playwrightInstallPromise = null;
};

export const createPlaywrightInstallEnv = (baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const nextEnv: NodeJS.ProcessEnv = { ...baseEnv };
  delete nextEnv.npm_config_prefix;

  if (nextEnv.PLAYWRIGHT_BROWSERS_PATH === '0') {
    delete nextEnv.PLAYWRIGHT_BROWSERS_PATH;
  }

  return nextEnv;
};

const createPlaywrightPreflightFailure = (input: {
  attempt: number;
  message: string;
  command?: string | null;
  exitCode?: number | null;
  stdout?: string | null;
  stderr?: string | null;
}): CaptureStartupFailure =>
  createCaptureFailure({
    phase: 'playwright_preflight',
    attempt: input.attempt,
    message: input.message,
    command: input.command ?? PLAYWRIGHT_INSTALL_COMMAND,
    exitCode: input.exitCode,
    stdout: input.stdout,
    stderr: input.stderr,
  });

const asPlaywrightPreflightError = (input: {
  error: unknown;
  attempt: number;
  command?: string | null;
}): AppError => {
  const parsed = parseFailureFromError(input.error);
  if (parsed) {
    return new AppError('FRONTEND_START_FAILED', parsed.failure.message, parsed.failure);
  }

  const appError = asAppError(input.error);
  const detail =
    appError.detail && typeof appError.detail === 'object'
      ? (appError.detail as Record<string, unknown>)
      : null;

  const failure = createPlaywrightPreflightFailure({
    attempt: input.attempt,
    message: appError.message,
    command: input.command,
    exitCode: typeof detail?.exitCode === 'number' ? detail.exitCode : null,
    stdout: typeof detail?.stdout === 'string' ? detail.stdout : null,
    stderr: typeof detail?.stderr === 'string' ? detail.stderr : null,
  });

  return new AppError('FRONTEND_START_FAILED', failure.message, failure);
};

export const ensureGlobalPlaywrightChromium = async (
  input: PlaywrightPreflightOptions,
): Promise<void> => {
  const accessFn = input.accessFn ?? (async (targetPath: string) => fs.access(targetPath));
  const resolveExecutablePath = input.resolveExecutablePath ?? (() => chromium.executablePath());
  const runCommandFn = input.runCommandFn ?? runCommand;

  log('info', 'playwright_preflight_started', {
    jobId: input.jobId,
    attempt: input.attempt,
  });

  const executablePath = resolveExecutablePath();
  if (executablePath) {
    try {
      await accessFn(executablePath);
      log('info', 'playwright_preflight_browser_present', {
        jobId: input.jobId,
        attempt: input.attempt,
        executablePath,
      });
      return;
    } catch {
      // Browser binary is missing; install globally.
    }
  }

  if (!playwrightInstallPromise) {
    playwrightInstallPromise = (async () => {
      log('info', 'playwright_preflight_install_started', {
        jobId: input.jobId,
        attempt: input.attempt,
        command: PLAYWRIGHT_INSTALL_COMMAND,
      });

      const install = await runCommandFn('npx', ['playwright', 'install', 'chromium'], {
        cwd: input.repoPath,
        timeoutMs: PLAYWRIGHT_INSTALL_TIMEOUT_MS,
        env: createPlaywrightInstallEnv(input.baseEnv ?? process.env),
      });

      if (install.exitCode !== 0) {
        const failure = createPlaywrightPreflightFailure({
          attempt: input.attempt,
          message: 'Playwright chromium install command failed',
          command: PLAYWRIGHT_INSTALL_COMMAND,
          exitCode: install.exitCode,
          stdout: install.stdout,
          stderr: install.stderr,
        });
        throw new AppError('FRONTEND_START_FAILED', failure.message, failure);
      }

      const resolvedPath = resolveExecutablePath();
      if (resolvedPath) {
        try {
          await accessFn(resolvedPath);
        } catch {
          const failure = createPlaywrightPreflightFailure({
            attempt: input.attempt,
            message: 'Playwright chromium executable is still missing after install',
            command: PLAYWRIGHT_INSTALL_COMMAND,
          });
          throw new AppError('FRONTEND_START_FAILED', failure.message, failure);
        }
      }

      log('info', 'playwright_preflight_install_completed', {
        jobId: input.jobId,
        attempt: input.attempt,
      });
    })()
      .catch((error) => {
        throw asPlaywrightPreflightError({
          error,
          attempt: input.attempt,
          command: PLAYWRIGHT_INSTALL_COMMAND,
        });
      })
      .finally(() => {
        playwrightInstallPromise = null;
      });
  } else {
    log('info', 'playwright_preflight_waiting_for_install', {
      jobId: input.jobId,
      attempt: input.attempt,
    });
  }

  await playwrightInstallPromise;
};

export class ScreenshotCaptureService {
  constructor(private readonly codexAnalysisService: CodexAnalysisService) {}

  public async runPlan(input: {
    jobId: string;
    repoPath: string;
    capturePlan: CapturePlan;
  }): Promise<ScreenshotManifest> {
    const startedAt = Date.now();
    const screenshotDir = getScreenshotsDirPath(input.jobId);
    await ensureDir(screenshotDir);

    let installCommand = input.capturePlan.installCommand ?? null;
    let startCommand = input.capturePlan.startCommand;
    let latestFailure: CaptureStartupFailure | null = null;
    const attempts: CaptureAttemptRecord[] = [];

    log('info', 'Starting screenshot capture plan', {
      jobId: input.jobId,
      repoPath: input.repoPath,
      port: input.capturePlan.port,
      basePath: input.capturePlan.basePath,
      routes: input.capturePlan.screenshotRoutes,
      hasInstallCommand: Boolean(installCommand),
      screenshotDir,
    });

    await ensureGlobalPlaywrightChromium({
      jobId: input.jobId,
      repoPath: input.repoPath,
      attempt: 1,
    });

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const attemptRecord: CaptureAttemptRecord = {
        attempt,
        installCommand,
        startCommand,
        result: 'failed',
        fixCommandsApplied: [],
      };

      log('info', 'capture_attempt_started', {
        jobId: input.jobId,
        attempt,
        maxAttempts: MAX_ATTEMPTS,
        installCommand,
        startCommand,
      });

      if (attempt > 1) {
        if (!latestFailure) {
          throw new AppError('INTERNAL_ERROR', 'Capture recovery attempted without prior failure context');
        }

        try {
          const recoveryPlan = await this.codexAnalysisService.planCaptureRecovery({
            repoPath: input.repoPath,
            installCommand,
            startCommand,
            failure: latestFailure,
            priorAttempts: attempts,
          });

          log('info', 'capture_recovery_plan_received', {
            jobId: input.jobId,
            attempt,
            fixCommandsCount: recoveryPlan.fixCommands.length,
            hasUpdatedInstallCommand: recoveryPlan.updatedInstallCommand !== undefined,
            hasUpdatedStartCommand: recoveryPlan.updatedStartCommand !== undefined,
          });

          if (recoveryPlan.updatedInstallCommand !== undefined) {
            installCommand = recoveryPlan.updatedInstallCommand ?? null;
          }

          if (recoveryPlan.updatedStartCommand !== undefined) {
            startCommand = recoveryPlan.updatedStartCommand;
          }

          attemptRecord.installCommand = installCommand;
          attemptRecord.startCommand = startCommand;

          attemptRecord.fixCommandsApplied = await this.applyFixCommands({
            jobId: input.jobId,
            attempt,
            repoPath: input.repoPath,
            commands: recoveryPlan.fixCommands,
          });
        } catch (error) {
          const parsed = parseFailureFromError(error);
          const recoveryFailure =
            parsed?.failure ??
            createCaptureFailure({
              phase: 'recovery_fix',
              message: asAppError(error).message,
              command: null,
              attempt,
            });

          attemptRecord.fixCommandsApplied = parsed?.executedCommands ?? attemptRecord.fixCommandsApplied;
          attemptRecord.failure = recoveryFailure;
          attempts.push(attemptRecord);
          latestFailure = recoveryFailure;

          log('warn', 'capture_attempt_failed', {
            jobId: input.jobId,
            attempt,
            phase: recoveryFailure.phase,
            message: recoveryFailure.message,
            command: recoveryFailure.command ?? null,
            exitCode: recoveryFailure.exitCode ?? null,
          });

          if (attempt === MAX_ATTEMPTS) {
            break;
          }

          continue;
        }
      }

      try {
        const screenshotNames = await this.executeCaptureAttempt({
          jobId: input.jobId,
          attempt,
          repoPath: input.repoPath,
          installCommand,
          startCommand,
          port: input.capturePlan.port,
          basePath: input.capturePlan.basePath,
          routes: input.capturePlan.screenshotRoutes,
          screenshotDir,
        });

        attemptRecord.result = 'success';
        attempts.push(attemptRecord);

        log('info', 'capture_attempt_succeeded', {
          jobId: input.jobId,
          attempt,
          screenshotCount: screenshotNames.length,
        });

        log('info', 'Screenshot capture plan finished', {
          jobId: input.jobId,
          screenshotCount: screenshotNames.length,
          attemptCount: attempts.length,
          durationMs: Date.now() - startedAt,
        });

        return {
          screenshotDir,
          screenshotNames,
          attemptCount: attempts.length,
          attempts,
        };
      } catch (error) {
        const parsed = parseFailureFromError(error);
        const failure =
          parsed?.failure ??
          createCaptureFailure({
            phase: 'screenshot_capture',
            message: asAppError(error).message,
            command: startCommand,
            attempt,
          });

        attemptRecord.failure = failure;
        attempts.push(attemptRecord);
        latestFailure = failure;

        log('warn', 'capture_attempt_failed', {
          jobId: input.jobId,
          attempt,
          phase: failure.phase,
          message: failure.message,
          command: failure.command ?? null,
          exitCode: failure.exitCode ?? null,
        });

        if (attempt === MAX_ATTEMPTS) {
          break;
        }
      }
    }

    log('error', 'capture_retries_exhausted', {
      jobId: input.jobId,
      attempts: attempts.length,
      finalFailure: latestFailure ?? null,
    });

    throw new AppError('FRONTEND_START_FAILED', 'Unable to start frontend after recovery retries', {
      attemptCount: attempts.length,
      attempts,
      finalFailure: latestFailure,
    });
  }

  private async applyFixCommands(input: {
    jobId: string;
    attempt: number;
    repoPath: string;
    commands: string[];
  }): Promise<string[]> {
    const executedCommands: string[] = [];

    for (const command of input.commands) {
      const unsafeReason = getUnsafeRecoveryCommandReason(command, input.repoPath);
      if (unsafeReason) {
        const failure = createCaptureFailure({
          phase: 'recovery_fix',
          message: `Rejected unsafe recovery command: ${unsafeReason}`,
          command,
          attempt: input.attempt,
        });

        throw new AppError('FRONTEND_START_FAILED', 'Unsafe recovery command rejected', {
          failure,
          executedCommands,
        });
      }

      log('info', 'capture_fix_command_started', {
        jobId: input.jobId,
        attempt: input.attempt,
        command,
      });

      try {
        const result = await runCommand('bash', ['-lc', command], {
          cwd: input.repoPath,
          timeoutMs: FIX_COMMAND_TIMEOUT_MS,
        });

        if (result.exitCode !== 0) {
          const failure = createCaptureFailure({
            phase: 'recovery_fix',
            message: 'Recovery fix command failed',
            command,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            attempt: input.attempt,
          });

          throw new AppError('FRONTEND_START_FAILED', 'Recovery fix command failed', {
            failure,
            executedCommands,
          });
        }
      } catch (error) {
        const parsed = parseFailureFromError(error);
        if (parsed) {
          throw new AppError('FRONTEND_START_FAILED', parsed.failure.message, {
            failure: parsed.failure,
            executedCommands: parsed.executedCommands ?? executedCommands,
          });
        }

        const appError = asAppError(error);
        const failure = createCaptureFailure({
          phase: 'recovery_fix',
          message: appError.message,
          command,
          attempt: input.attempt,
        });

        throw new AppError('FRONTEND_START_FAILED', 'Recovery fix command failed', {
          failure,
          executedCommands,
        });
      }

      executedCommands.push(command);
      log('info', 'capture_fix_command_completed', {
        jobId: input.jobId,
        attempt: input.attempt,
        command,
      });
    }

    return executedCommands;
  }

  private async executeCaptureAttempt(input: {
    jobId: string;
    attempt: number;
    repoPath: string;
    installCommand: string | null;
    startCommand: string;
    port: number;
    basePath: string;
    routes: string[];
    screenshotDir: string;
  }): Promise<string[]> {
    if (input.installCommand) {
      log('info', 'Running frontend install command', {
        jobId: input.jobId,
        attempt: input.attempt,
      });

      let installStdout = '';
      let installStderr = '';

      try {
        const install = await runCommand('bash', ['-lc', input.installCommand], {
          cwd: input.repoPath,
          timeoutMs: INSTALL_TIMEOUT_MS,
        });
        installStdout = install.stdout;
        installStderr = install.stderr;

        if (install.exitCode !== 0) {
          const failure = createCaptureFailure({
            phase: 'install',
            message: 'Install command failed for frontend repo',
            command: input.installCommand,
            exitCode: install.exitCode,
            stdout: install.stdout,
            stderr: install.stderr,
            attempt: input.attempt,
          });
          throw new AppError('FRONTEND_START_FAILED', failure.message, failure);
        }
      } catch (error) {
        const parsed = parseFailureFromError(error);
        if (parsed) {
          throw new AppError('FRONTEND_START_FAILED', parsed.failure.message, parsed.failure);
        }

        const appError = asAppError(error);
        const failure = createCaptureFailure({
          phase: 'install',
          message: appError.message,
          command: input.installCommand,
          stdout: installStdout,
          stderr: installStderr,
          attempt: input.attempt,
        });

        throw new AppError('FRONTEND_START_FAILED', failure.message, failure);
      }
    }

    const startProcess = spawn('bash', ['-lc', input.startCommand], {
      cwd: input.repoPath,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let processStdout = '';
    let processStderr = '';
    let processExited = false;
    let processExitCode: number | null = null;

    startProcess.stdout.setEncoding('utf-8');
    startProcess.stderr.setEncoding('utf-8');

    startProcess.stdout.on('data', (chunk: string) => {
      processStdout = truncateTail(`${processStdout}${chunk}`);
    });
    startProcess.stderr.on('data', (chunk: string) => {
      processStderr = truncateTail(`${processStderr}${chunk}`);
    });
    startProcess.on('close', (code) => {
      processExited = true;
      processExitCode = code ?? -1;
    });

    try {
      await this.waitForServerReadiness({
        attempt: input.attempt,
        port: input.port,
        basePath: input.basePath,
        startCommand: input.startCommand,
        getProcessState: () => ({
          exited: processExited,
          exitCode: processExitCode,
          stdout: processStdout,
          stderr: processStderr,
        }),
      });

      const screenshotNames = await takeScreenshots({
        port: input.port,
        basePath: input.basePath,
        routes: input.routes,
        screenshotDir: input.screenshotDir,
      });

      if (screenshotNames.length === 0) {
        const failure = createCaptureFailure({
          phase: 'screenshot_capture',
          message: 'No screenshots were captured from planned routes',
          command: input.startCommand,
          stdout: processStdout,
          stderr: processStderr,
          attempt: input.attempt,
        });
        throw new AppError('FRONTEND_START_FAILED', failure.message, failure);
      }

      return screenshotNames;
    } catch (error) {
      const parsed = parseFailureFromError(error);
      if (parsed) {
        throw new AppError('FRONTEND_START_FAILED', parsed.failure.message, parsed.failure);
      }

      const appError = asAppError(error);
      const failure = createCaptureFailure({
        phase: 'screenshot_capture',
        message: appError.message,
        command: input.startCommand,
        stdout: processStdout,
        stderr: processStderr,
        attempt: input.attempt,
      });
      throw new AppError('FRONTEND_START_FAILED', failure.message, failure);
    } finally {
      await this.stopProcess(startProcess, input.jobId, input.attempt);
    }
  }

  private async waitForServerReadiness(input: {
    attempt: number;
    port: number;
    basePath: string;
    startCommand: string;
    getProcessState: () => {
      exited: boolean;
      exitCode: number | null;
      stdout: string;
      stderr: string;
    };
  }): Promise<void> {
    const startedAt = Date.now();
    const url = createUrl(input.port, input.basePath, '/');

    while (Date.now() - startedAt < READINESS_TIMEOUT_MS) {
      const processState = input.getProcessState();
      if (processState.exited) {
        const failure = createCaptureFailure({
          phase: 'start_process',
          message: 'Frontend start command exited before server became ready',
          command: input.startCommand,
          exitCode: processState.exitCode,
          stdout: processState.stdout,
          stderr: processState.stderr,
          attempt: input.attempt,
        });
        throw new AppError('FRONTEND_START_FAILED', failure.message, failure);
      }

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2_500);
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (response.status >= 200 && response.status < 500) {
          return;
        }
      } catch {
        // Ignore and retry.
      }

      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }

    const processState = input.getProcessState();
    const failure = createCaptureFailure({
      phase: 'readiness_probe',
      message: 'Frontend server did not become ready in time',
      command: input.startCommand,
      exitCode: processState.exitCode,
      stdout: processState.stdout,
      stderr: processState.stderr,
      attempt: input.attempt,
    });
    throw new AppError('FRONTEND_START_FAILED', failure.message, failure);
  }

  private async stopProcess(
    process: ChildProcess,
    jobId: string,
    attempt: number,
  ): Promise<void> {
    if (process.exitCode !== null || process.signalCode !== null) {
      return;
    }

    process.kill('SIGTERM');
    log('debug', 'Frontend process termination signal sent', {
      jobId,
      attempt,
    });

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (process.exitCode === null && process.signalCode === null) {
          process.kill('SIGKILL');
        }
        resolve();
      }, 2_500);

      process.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}
