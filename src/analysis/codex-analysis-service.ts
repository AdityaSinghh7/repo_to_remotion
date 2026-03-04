import {
  capturePlanSchema,
  frontendDetectionResultSchema,
  remotionCodegenOutputSchema,
  type CapturePlan,
  type FrontendDetectionResult,
  type RemotionCodegenOutput,
} from '../types/contracts.js';
import {
  buildBestDemoPrompt,
  buildCapturePlanPrompt,
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
