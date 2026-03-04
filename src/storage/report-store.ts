import fs from 'node:fs/promises';
import path from 'node:path';
import type { JobRecord } from './job-store.js';
import { getReportJsonPath } from '../utils/paths.js';
import { ensureDir, writeJsonFile } from '../utils/fs.js';

export const writeJobReport = async (job: JobRecord): Promise<string> => {
  const reportPath = getReportJsonPath(job.jobId);
  await ensureDir(path.dirname(reportPath));

  await writeJsonFile(reportPath, {
    jobId: job.jobId,
    status: job.status,
    stopReason: job.stopReason ?? null,
    summary: job.summary ?? null,
    steps: job.steps,
    artifacts: job.artifacts,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  });

  return reportPath;
};

export const reportExists = async (reportPath: string): Promise<boolean> => {
  try {
    await fs.access(reportPath);
    return true;
  } catch {
    return false;
  }
};
