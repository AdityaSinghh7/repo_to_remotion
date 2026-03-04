import { Mastra } from '@mastra/core/mastra';
import { GeminiPromptBuilder } from './agents/gemini-prompt-builder.js';
import { CodexAnalysisService } from './analysis/codex-analysis-service.js';
import { CodexCliRunner } from './analysis/codex-cli-runner.js';
import { ScreenshotCaptureService } from './capture/screenshot-capture-service.js';
import { RemotionService } from './remotion/remotion-service.js';
import { JobStore } from './storage/job-store.js';
import { createRepoToRemotionWorkflow } from './workflows/repo-to-remotion-workflow.js';
import { WorkflowRunner } from './workflows/workflow-runner.js';

export type AppContext = {
  mastra: Mastra;
  jobStore: JobStore;
  workflowRunner: WorkflowRunner;
};

export const createAppContext = async (): Promise<AppContext> => {
  const jobStore = new JobStore();
  await jobStore.init();

  const codexRunner = new CodexCliRunner();
  const codexAnalysisService = new CodexAnalysisService(codexRunner);
  const geminiPromptBuilder = new GeminiPromptBuilder();
  const screenshotCaptureService = new ScreenshotCaptureService();
  const remotionService = new RemotionService();

  const repoToRemotionWorkflow = createRepoToRemotionWorkflow({
    jobStore,
    codexAnalysisService,
    geminiPromptBuilder,
    screenshotCaptureService,
    remotionService,
  });

  const mastra = new Mastra({
    workflows: {
      repoToRemotionWorkflow,
    },
  });

  const workflow = mastra.getWorkflow('repoToRemotionWorkflow');
  const workflowRunner = new WorkflowRunner(workflow, jobStore);

  return {
    mastra,
    jobStore,
    workflowRunner,
  };
};
