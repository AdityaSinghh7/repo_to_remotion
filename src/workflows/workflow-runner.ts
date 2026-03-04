import { asAppError } from '../utils/app-error.js';
import { log } from '../utils/logger.js';
import { JobStore } from '../storage/job-store.js';
import { writeJobReport } from '../storage/report-store.js';

type StartInput = {
  jobId: string;
  repoUrl: string;
  ref?: string;
};

export class WorkflowRunner {
  private readonly activeRuns = new Map<string, Promise<void>>();

  constructor(
    private readonly workflow: {
      createRun: () => {
        start: (input: { inputData: StartInput }) => Promise<{
          status: 'success' | 'failed' | 'suspended' | 'tripwire' | 'paused';
          error?: Error;
        }>;
      };
    },
    private readonly jobStore: JobStore,
  ) {}

  public start(input: StartInput): void {
    if (this.activeRuns.has(input.jobId)) {
      return;
    }

    const runPromise = this.runInternal(input)
      .catch((error) => {
        const appError = asAppError(error);
        this.jobStore.setJobStatus(input.jobId, 'failed', {
          summary: appError.message,
        });
        log('error', 'Workflow run failed', {
          jobId: input.jobId,
          code: appError.code,
          detail: appError.detail,
        });
      })
      .finally(async () => {
        this.activeRuns.delete(input.jobId);
        const latest = this.jobStore.serializeForApi(input.jobId);
        const reportPath = await writeJobReport(latest);
        this.jobStore.setArtifacts(input.jobId, {
          reportJson: reportPath,
        });
      });

    this.activeRuns.set(input.jobId, runPromise);
  }

  private async runInternal(input: StartInput): Promise<void> {
    this.jobStore.setJobStatus(input.jobId, 'running');

    const run = this.workflow.createRun();
    const result = await run.start({
      inputData: input,
    });

    if (result.status === 'success') {
      return;
    }

    if (result.status === 'failed') {
      throw result.error ?? new Error('Workflow returned failed result status');
    }

    throw new Error(`Workflow ended in unsupported status: ${result.status}`);
  }
}
