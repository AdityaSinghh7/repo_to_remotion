import { asAppError } from '../utils/app-error.js';
import { log } from '../utils/logger.js';
import { JobStore } from '../storage/job-store.js';
import { writeJobReport } from '../storage/report-store.js';

type StartInput = {
  jobId: string;
  repoUrl: string;
  ref?: string;
};

type FailedStep = {
  name: string;
  errorCode?: string | null;
  errorDetail?: unknown;
};

const detailToMessage = (detail: unknown): string | null => {
  if (typeof detail === 'string') {
    return detail;
  }

  if (!detail || typeof detail !== 'object') {
    return null;
  }

  const asRecord = detail as Record<string, unknown>;
  if (typeof asRecord.message === 'string' && asRecord.message.trim()) {
    return asRecord.message;
  }

  if (typeof asRecord.reason === 'string' && asRecord.reason.trim()) {
    return asRecord.reason;
  }

  if (asRecord.failure && typeof asRecord.failure === 'object') {
    const failure = asRecord.failure as Record<string, unknown>;
    if (typeof failure.message === 'string' && failure.message.trim()) {
      return failure.message;
    }
  }

  if (asRecord.finalFailure && typeof asRecord.finalFailure === 'object') {
    const finalFailure = asRecord.finalFailure as Record<string, unknown>;
    if (typeof finalFailure.message === 'string' && finalFailure.message.trim()) {
      return finalFailure.message;
    }
  }

  return null;
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
      createRunAsync?: () => Promise<{
        start: (input: { inputData: StartInput }) => Promise<{
          status: 'success' | 'failed' | 'suspended' | 'tripwire' | 'paused';
          error?: Error;
        }>;
      }>;
    },
    private readonly jobStore: JobStore,
  ) {}

  public start(input: StartInput): void {
    if (this.activeRuns.has(input.jobId)) {
      log('warn', 'Workflow run already active; ignoring duplicate start', {
        jobId: input.jobId,
      });
      return;
    }

    log('info', 'Starting workflow run in background', {
      jobId: input.jobId,
      repoUrl: input.repoUrl,
      ref: input.ref ?? null,
    });

    const runPromise = this.runInternal(input)
      .catch((error) => {
        const appError = asAppError(error);
        const failedStep = this.getLastFailedStep(input.jobId);
        const summary =
          detailToMessage(failedStep?.errorDetail) ??
          (failedStep?.errorCode
            ? `Step ${failedStep.name} failed with ${failedStep.errorCode}`
            : appError.message);

        this.jobStore.setJobStatus(input.jobId, 'failed', {
          summary,
        });
        log('error', 'Workflow run failed', {
          jobId: input.jobId,
          code: failedStep?.errorCode ?? appError.code,
          detail: failedStep?.errorDetail ?? appError.detail,
        });
      })
      .finally(async () => {
        this.activeRuns.delete(input.jobId);
        log('info', 'Finalizing workflow run and writing report', {
          jobId: input.jobId,
        });
        const latest = this.jobStore.serializeForApi(input.jobId);
        const reportPath = await writeJobReport(latest);
        this.jobStore.setArtifacts(input.jobId, {
          reportJson: reportPath,
        });
        log('info', 'Workflow report written', {
          jobId: input.jobId,
          reportPath,
          status: latest.status,
        });
      });

    this.activeRuns.set(input.jobId, runPromise);
  }

  private async runInternal(input: StartInput): Promise<void> {
    this.jobStore.setJobStatus(input.jobId, 'running');
    log('info', 'Workflow run status set to running', {
      jobId: input.jobId,
    });

    const run = this.workflow.createRunAsync
      ? await this.workflow.createRunAsync()
      : this.workflow.createRun();
    log('debug', 'Workflow run instance created', {
      jobId: input.jobId,
      mode: this.workflow.createRunAsync ? 'createRunAsync' : 'createRun',
    });

    const result = await run.start({
      inputData: input,
    });

    log('info', 'Workflow run returned result', {
      jobId: input.jobId,
      status: result.status,
    });

    if (result.status === 'success') {
      return;
    }

    if (result.status === 'failed') {
      throw result.error ?? new Error('Workflow returned failed result status');
    }

    throw new Error(`Workflow ended in unsupported status: ${result.status}`);
  }

  private getLastFailedStep(jobId: string): FailedStep | null {
    const job = this.jobStore.getJob(jobId);
    if (!job) {
      return null;
    }

    for (let index = job.steps.length - 1; index >= 0; index -= 1) {
      const step = job.steps[index];
      if (step.status !== 'error') {
        continue;
      }

      return {
        name: step.name,
        errorCode: step.errorCode,
        errorDetail: step.errorDetail,
      };
    }

    return null;
  }
}
