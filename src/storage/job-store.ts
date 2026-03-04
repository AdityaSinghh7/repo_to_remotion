import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  type ArtifactManifest,
  type JobStatus,
  type StepStatus,
  type WorkflowStepName,
  stepRecordSchema,
  workflowStepNames,
} from '../types/contracts.js';
import type { ErrorCode } from '../types/errors.js';
import { ensureDir, writeJsonFile } from '../utils/fs.js';
import { log } from '../utils/logger.js';

export type JobRecord = {
  jobId: string;
  repoUrl: string;
  ref?: string;
  status: JobStatus;
  stopReason?: 'NO_FRONTEND_FOUND' | null;
  summary?: string | null;
  steps: Array<ReturnType<typeof stepRecordSchema.parse>>;
  artifacts: ArtifactManifest;
  createdAt: string;
  updatedAt: string;
};

const defaultArtifacts: ArtifactManifest = {
  reportJson: null,
  purposeMd: null,
  bestDemoMd: null,
  screenshotsDir: null,
  remotionPromptJson: null,
  remotionProjectPath: null,
  mp4Path: null,
};

const createDefaultSteps = (): JobRecord['steps'] =>
  workflowStepNames.map((name) =>
    stepRecordSchema.parse({
      name,
      status: 'pending',
      durationMs: null,
      errorCode: null,
      startedAt: null,
      finishedAt: null,
    }),
  );

export class JobStore {
  private readonly dataPath: string;
  private readonly jobs = new Map<string, JobRecord>();
  private readonly idempotency = new Map<string, { jobId: string; payloadHash: string }>();

  constructor(dataPath = '.data/jobs.json') {
    this.dataPath = path.resolve(dataPath);
  }

  public async init(): Promise<void> {
    await ensureDir(path.dirname(this.dataPath));

    try {
      const raw = await fs.readFile(this.dataPath, 'utf-8');
      const parsed = JSON.parse(raw) as {
        jobs?: JobRecord[];
        idempotency?: Array<{ key: string; jobId: string; payloadHash: string }>;
      };

      for (const record of parsed.jobs ?? []) {
        this.jobs.set(record.jobId, record);
      }

      for (const entry of parsed.idempotency ?? []) {
        this.idempotency.set(entry.key, {
          jobId: entry.jobId,
          payloadHash: entry.payloadHash,
        });
      }
    } catch {
      await this.flush();
    }
  }

  public createJob(input: { jobId: string; repoUrl: string; ref?: string }): JobRecord {
    const now = new Date().toISOString();
    const record: JobRecord = {
      jobId: input.jobId,
      repoUrl: input.repoUrl,
      ref: input.ref,
      status: 'queued',
      stopReason: null,
      summary: null,
      steps: createDefaultSteps(),
      artifacts: { ...defaultArtifacts },
      createdAt: now,
      updatedAt: now,
    };

    this.jobs.set(record.jobId, record);
    log('info', 'Job record created', {
      jobId: record.jobId,
      repoUrl: record.repoUrl,
      ref: record.ref ?? null,
    });
    void this.flush();
    return record;
  }

  public getJob(jobId: string): JobRecord | undefined {
    return this.jobs.get(jobId);
  }

  public getJobByIdempotencyKey(_idempotencyKey: string): JobRecord | undefined {
    const mapping = this.idempotency.get(_idempotencyKey);
    if (!mapping) {
      return undefined;
    }
    return this.jobs.get(mapping.jobId);
  }

  public resolveIdempotency(
    idempotencyKey: string,
    payload: { repoUrl: string; ref?: string },
  ): { kind: 'new' } | { kind: 'replay'; job: JobRecord } | { kind: 'conflict' } {
    const payloadHash = this.hashPayload(payload);
    const existing = this.idempotency.get(idempotencyKey);
    if (!existing) {
      return { kind: 'new' };
    }

    if (existing.payloadHash !== payloadHash) {
      return { kind: 'conflict' };
    }

    const job = this.jobs.get(existing.jobId);
    if (!job) {
      return { kind: 'new' };
    }

    return { kind: 'replay', job };
  }

  public registerIdempotency(
    idempotencyKey: string,
    payload: { repoUrl: string; ref?: string },
    jobId: string,
  ): void {
    const payloadHash = this.hashPayload(payload);
    this.idempotency.set(idempotencyKey, { jobId, payloadHash });
    void this.flush();
  }

  public setJobStatus(
    jobId: string,
    status: JobStatus,
    options?: { stopReason?: 'NO_FRONTEND_FOUND'; summary?: string | null },
  ): void {
    const job = this.mustGet(jobId);
    job.status = status;

    if (options?.stopReason) {
      job.stopReason = options.stopReason;
    }

    if (options?.summary !== undefined) {
      job.summary = options.summary;
    }

    log('info', 'Job status updated', {
      jobId,
      status,
      stopReason: options?.stopReason ?? null,
      summary: options?.summary ?? null,
    });
    job.updatedAt = new Date().toISOString();
    void this.flush();
  }

  public markStepRunning(jobId: string, stepName: WorkflowStepName): void {
    const step = this.mustGetStep(jobId, stepName);
    step.status = 'running';
    step.startedAt = new Date().toISOString();
    step.finishedAt = null;
    step.durationMs = null;
    step.errorCode = null;
    step.errorDetail = undefined;
    log('debug', 'Step marked running', {
      jobId,
      stepName,
    });
    this.bump(jobId);
  }

  public markStepSuccess(
    jobId: string,
    stepName: WorkflowStepName,
    payload?: unknown,
    options?: { summary?: string | null },
  ): void {
    const step = this.mustGetStep(jobId, stepName);
    step.status = 'success';
    step.finishedAt = new Date().toISOString();
    step.durationMs = this.computeDuration(step.startedAt, step.finishedAt);
    step.payload = payload;

    if (options?.summary !== undefined) {
      const job = this.mustGet(jobId);
      job.summary = options.summary;
    }

    log('debug', 'Step marked success', {
      jobId,
      stepName,
      durationMs: step.durationMs,
    });
    this.bump(jobId);
  }

  public markStepError(
    jobId: string,
    stepName: WorkflowStepName,
    errorCode: ErrorCode,
    errorDetail?: unknown,
  ): void {
    const step = this.mustGetStep(jobId, stepName);
    step.status = 'error';
    step.errorCode = errorCode;
    step.errorDetail = errorDetail;
    step.finishedAt = new Date().toISOString();
    step.durationMs = this.computeDuration(step.startedAt, step.finishedAt);
    log('warn', 'Step marked error', {
      jobId,
      stepName,
      errorCode,
      durationMs: step.durationMs,
    });
    this.bump(jobId);
  }

  public markStepSkipped(jobId: string, stepName: WorkflowStepName): void {
    const step = this.mustGetStep(jobId, stepName);
    step.status = 'skipped';
    step.startedAt = step.startedAt ?? new Date().toISOString();
    step.finishedAt = new Date().toISOString();
    step.durationMs = this.computeDuration(step.startedAt, step.finishedAt);
    log('debug', 'Step marked skipped', {
      jobId,
      stepName,
    });
    this.bump(jobId);
  }

  public getStepStatus(jobId: string, stepName: WorkflowStepName): StepStatus {
    const step = this.mustGetStep(jobId, stepName);
    return step.status;
  }

  public setArtifacts(jobId: string, patch: Partial<ArtifactManifest>): void {
    const job = this.mustGet(jobId);
    job.artifacts = {
      ...job.artifacts,
      ...patch,
    };
    log('debug', 'Job artifacts updated', {
      jobId,
      patch,
    });
    this.bump(jobId);
  }

  public serializeForApi(jobId: string): JobRecord {
    return this.mustGet(jobId);
  }

  private mustGet(jobId: string): JobRecord {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Unknown job: ${jobId}`);
    }
    return job;
  }

  private mustGetStep(jobId: string, stepName: WorkflowStepName) {
    const job = this.mustGet(jobId);
    const step = job.steps.find((candidate) => candidate.name === stepName);
    if (!step) {
      throw new Error(`Unknown step ${stepName} for job ${jobId}`);
    }
    return step;
  }

  private bump(jobId: string): void {
    const job = this.mustGet(jobId);
    job.updatedAt = new Date().toISOString();
    void this.flush();
  }

  private computeDuration(startedAt?: string | null, finishedAt?: string | null): number | null {
    if (!startedAt || !finishedAt) {
      return null;
    }

    return Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime());
  }

  private async flush(): Promise<void> {
    const records = {
      jobs: Array.from(this.jobs.values()),
      idempotency: Array.from(this.idempotency.entries()).map(([key, value]) => ({
        key,
        ...value,
      })),
    };
    await writeJsonFile(this.dataPath, records);
  }

  private hashPayload(payload: { repoUrl: string; ref?: string }): string {
    const canonical = JSON.stringify({
      repoUrl: payload.repoUrl,
      ref: payload.ref ?? null,
    });
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }
}
