import 'dotenv/config';
import { spawn } from 'node:child_process';

type Args = {
  baseUrl: string;
  repoUrl: string;
  ref?: string;
  timeoutSeconds: number;
  pollIntervalMs: number;
  startServer: boolean;
  expectedStatus: 'completed' | 'stopped_no_frontend' | 'any';
};

type CreateJobResponse = {
  jobId: string;
  status: string;
};

type JobStatusResponse = {
  jobId: string;
  status: 'queued' | 'running' | 'stopped_no_frontend' | 'failed' | 'completed';
  stopReason?: string | null;
  summary?: string | null;
  steps?: Array<{
    name: string;
    status: string;
    durationMs?: number | null;
    errorCode?: string | null;
  }>;
  artifacts?: Record<string, string | null | undefined>;
};

const TERMINAL_STATUSES = new Set<JobStatusResponse['status']>([
  'completed',
  'failed',
  'stopped_no_frontend',
]);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const parseArgs = (): Args => {
  const argv = process.argv.slice(2);
  const map = new Map<string, string>();

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      continue;
    }

    const key = token.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : 'true';
    map.set(key, value);

    if (value !== 'true') {
      i += 1;
    }
  }

  const repoUrl = map.get('repo-url') ?? '';
  if (!repoUrl) {
    throw new Error('Missing required argument: --repo-url <github-url>');
  }

  const expectedStatusArg = map.get('expected-status') ?? 'any';
  if (expectedStatusArg !== 'completed' && expectedStatusArg !== 'stopped_no_frontend' && expectedStatusArg !== 'any') {
    throw new Error('Invalid --expected-status value. Use one of: completed, stopped_no_frontend, any');
  }

  return {
    baseUrl: (map.get('base-url') ?? 'http://127.0.0.1:8787').replace(/\/$/, ''),
    repoUrl,
    ref: map.get('ref') || undefined,
    timeoutSeconds: Number(map.get('timeout-seconds') ?? 1800),
    pollIntervalMs: Number(map.get('poll-interval-ms') ?? 5000),
    startServer: map.get('start-server') === 'true',
    expectedStatus: expectedStatusArg,
  };
};

const waitForHealth = async (baseUrl: string, timeoutMs = 60_000): Promise<void> => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling.
    }

    await sleep(1000);
  }

  throw new Error(`Timed out waiting for ${baseUrl}/health`);
};

const startServerIfRequested = async (
  shouldStart: boolean,
): Promise<{ process?: ReturnType<typeof spawn>; stop: () => Promise<void> }> => {
  if (!shouldStart) {
    return {
      stop: async () => {},
    };
  }

  const child = spawn('npm', ['run', 'dev'], {
    stdio: 'inherit',
    env: process.env,
    shell: false,
  });

  const stop = async () => {
    if (!child.killed) {
      child.kill('SIGTERM');
      await sleep(1500);
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    }
  };

  return { process: child, stop };
};

const printSteps = (steps: JobStatusResponse['steps']): void => {
  if (!steps || steps.length === 0) {
    console.log('No steps returned yet.');
    return;
  }

  console.log('Step status:');
  for (const step of steps) {
    const duration = step.durationMs == null ? '-' : `${step.durationMs}ms`;
    const error = step.errorCode ? ` error=${step.errorCode}` : '';
    console.log(`- ${step.name}: ${step.status} (${duration})${error}`);
  }
};

const run = async () => {
  const args = parseArgs();

  const server = await startServerIfRequested(args.startServer);
  const startedAt = Date.now();

  try {
    if (args.startServer) {
      console.log(`Starting server and waiting for ${args.baseUrl}/health ...`);
      await waitForHealth(args.baseUrl);
      console.log('Server is healthy.');
    }

    console.log(`Submitting job for repo: ${args.repoUrl}`);
    const createResponse = await fetch(`${args.baseUrl}/v1/demo-jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        repoUrl: args.repoUrl,
        ...(args.ref ? { ref: args.ref } : {}),
      }),
    });

    if (!createResponse.ok) {
      const body = await createResponse.text();
      throw new Error(`POST /v1/demo-jobs failed: ${createResponse.status} ${body}`);
    }

    const createPayload = (await createResponse.json()) as CreateJobResponse;
    console.log(`Job created: ${createPayload.jobId} (initial status=${createPayload.status})`);

    let latest: JobStatusResponse | null = null;

    while (Date.now() - startedAt < args.timeoutSeconds * 1000) {
      const statusResponse = await fetch(`${args.baseUrl}/v1/demo-jobs/${createPayload.jobId}`);
      if (!statusResponse.ok) {
        const body = await statusResponse.text();
        throw new Error(`GET /v1/demo-jobs/:id failed: ${statusResponse.status} ${body}`);
      }

      latest = (await statusResponse.json()) as JobStatusResponse;
      console.log(`Current job status: ${latest.status}`);

      if (TERMINAL_STATUSES.has(latest.status)) {
        break;
      }

      await sleep(args.pollIntervalMs);
    }

    if (!latest) {
      throw new Error('No status response received.');
    }

    if (!TERMINAL_STATUSES.has(latest.status)) {
      throw new Error(`Timed out before reaching terminal status. Last status=${latest.status}`);
    }

    console.log('Terminal status reached.');
    printSteps(latest.steps);

    const artifactsResponse = await fetch(`${args.baseUrl}/v1/demo-jobs/${latest.jobId}/artifacts`);
    if (!artifactsResponse.ok) {
      const body = await artifactsResponse.text();
      throw new Error(`GET /v1/demo-jobs/:id/artifacts failed: ${artifactsResponse.status} ${body}`);
    }

    const artifactsPayload = await artifactsResponse.json();
    console.log('Artifacts response:');
    console.log(JSON.stringify(artifactsPayload, null, 2));

    if (args.expectedStatus !== 'any' && latest.status !== args.expectedStatus) {
      throw new Error(`Expected final status=${args.expectedStatus}, got ${latest.status}`);
    }

    if (latest.status === 'failed') {
      throw new Error(`Job failed. Summary: ${latest.summary ?? 'No summary provided.'}`);
    }

    console.log(`Job completed with status=${latest.status}.`);
  } finally {
    await server.stop();
  }
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
