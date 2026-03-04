import {
  capturePlanSchema,
  captureRecoveryPlanSchema,
  frontendDetectionResultSchema,
  remotionCodegenOutputSchema,
  type CaptureAttemptRecord,
  type CapturePlan,
  type CaptureRecoveryPlan,
  type CaptureStartupFailure,
  type FrontendDetectionResult,
  type RemotionCodegenOutput,
} from '../types/contracts.js';
import {
  buildBestDemoPrompt,
  buildCapturePlanPrompt,
  buildCaptureRecoveryPrompt,
  buildFrontendDetectionPrompt,
  buildPurposePrompt,
  buildRemotionCodegenPrompt,
} from './codex-prompts.js';
import { CodexCliRunner } from './codex-cli-runner.js';

export class CodexAnalysisService {
  constructor(private readonly runner: CodexCliRunner) {}

  public async detectFrontend(repoPath: string): Promise<FrontendDetectionResult> {
    return this.runner.runJson({
      cwd: repoPath,
      prompt: buildFrontendDetectionPrompt(),
      schema: frontendDetectionResultSchema,
    });
  }

  public async analyzePurpose(repoPath: string): Promise<string> {
    return this.runner.runText({
      cwd: repoPath,
      prompt: buildPurposePrompt(),
    });
  }

  public async createBestDemo(repoPath: string): Promise<string> {
    return this.runner.runText({
      cwd: repoPath,
      prompt: buildBestDemoPrompt(),
    });
  }

  public async planCapture(repoPath: string): Promise<CapturePlan> {
    return this.runner.runJson({
      cwd: repoPath,
      prompt: buildCapturePlanPrompt(),
      schema: capturePlanSchema,
    });
  }

  public async planCaptureRecovery(input: {
    repoPath: string;
    installCommand: string | null;
    startCommand: string;
    failure: CaptureStartupFailure;
    priorAttempts: CaptureAttemptRecord[];
  }): Promise<CaptureRecoveryPlan> {
    return this.runner.runJson({
      cwd: input.repoPath,
      prompt: buildCaptureRecoveryPrompt({
        installCommand: input.installCommand,
        startCommand: input.startCommand,
        failure: input.failure,
        priorAttempts: input.priorAttempts.map((attempt) => ({
          attempt: attempt.attempt,
          result: attempt.result,
          phase: attempt.failure?.phase,
          message: attempt.failure?.message,
          fixCommandsApplied: attempt.fixCommandsApplied,
        })),
      }),
      schema: captureRecoveryPlanSchema,
    });
  }

  public async generateRemotionCode(
    repoPath: string,
    remotionPrompt: string,
    remotionDocs: string,
  ): Promise<RemotionCodegenOutput> {
    return this.runner.runJson({
      cwd: repoPath,
      prompt: buildRemotionCodegenPrompt({ remotionPrompt, remotionDocs }),
      schema: remotionCodegenOutputSchema,
    });
  }
}
