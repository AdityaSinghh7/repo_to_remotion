import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import type { CapturePlan, ScreenshotManifest } from '../types/contracts.js';
import { AppError } from '../utils/app-error.js';
import { runCommand } from '../utils/command-runner.js';
import { ensureDir } from '../utils/fs.js';
import { getScreenshotsDirPath } from '../utils/paths.js';

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

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9VE3Fo0AAAAASUVORK5CYII=';

const withTrailingSlash = (input: string): string => (input.endsWith('/') ? input : `${input}/`);

const normalizeRoute = (route: string): string => {
  if (!route || route === '/') {
    return '';
  }

  return route.startsWith('/') ? route.slice(1) : route;
};

const createUrl = (port: number, basePath: string, route: string): string => {
  const base = new URL(`http://127.0.0.1:${port}/`);
  const merged = `${withTrailingSlash(basePath)}${normalizeRoute(route)}`;
  base.pathname = merged.startsWith('/') ? merged : `/${merged}`;
  return base.toString();
};

const waitForServerReadiness = async (port: number, basePath: string, timeoutMs = 120_000): Promise<void> => {
  const start = Date.now();
  const url = createUrl(port, basePath, '/');

  while (Date.now() - start < timeoutMs) {
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

  throw new AppError('FRONTEND_START_FAILED', 'Frontend server did not become ready in time', {
    port,
    basePath,
  });
};

const writePlaceholderScreenshots = async (
  screenshotDir: string,
  count: number,
): Promise<string[]> => {
  await ensureDir(screenshotDir);

  const names = buildDeterministicScreenshotNames(count);
  const tinyPng = Buffer.from(TINY_PNG_BASE64, 'base64');

  for (const name of names) {
    await fs.writeFile(path.join(screenshotDir, name), tinyPng);
  }

  return [...names];
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

export class ScreenshotCaptureService {
  public async runPlan(input: {
    jobId: string;
    repoPath: string;
    capturePlan: CapturePlan;
  }): Promise<ScreenshotManifest> {
    const screenshotDir = getScreenshotsDirPath(input.jobId);
    await ensureDir(screenshotDir);

    if (input.capturePlan.installCommand) {
      const install = await runCommand('bash', ['-lc', input.capturePlan.installCommand], {
        cwd: input.repoPath,
        timeoutMs: 10 * 60 * 1000,
      });

      if (install.exitCode !== 0) {
        throw new AppError('FRONTEND_START_FAILED', 'Install command failed for frontend repo', {
          command: input.capturePlan.installCommand,
          stderr: install.stderr,
        });
      }
    }

    const startProcess = spawn('bash', ['-lc', input.capturePlan.startCommand], {
      cwd: input.repoPath,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let startupFailureReason: string | null = null;
    let screenshotNames: string[] = [];

    try {
      await waitForServerReadiness(input.capturePlan.port, input.capturePlan.basePath);

      screenshotNames = await takeScreenshots({
        port: input.capturePlan.port,
        basePath: input.capturePlan.basePath,
        routes: input.capturePlan.screenshotRoutes,
        screenshotDir,
      });
    } catch (error) {
      startupFailureReason = error instanceof Error ? error.message : String(error);
      screenshotNames = await writePlaceholderScreenshots(
        screenshotDir,
        input.capturePlan.screenshotRoutes.length || 1,
      );
    } finally {
      startProcess.kill('SIGTERM');
    }

    return {
      screenshotDir,
      screenshotNames,
      startupFailed: Boolean(startupFailureReason),
      startupFailureReason,
    };
  }
}
