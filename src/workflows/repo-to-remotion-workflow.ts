import fs from 'node:fs/promises';
import path from 'node:path';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { GeminiPromptBuilder } from '../agents/gemini-prompt-builder.js';
import { CodexAnalysisService } from '../analysis/codex-analysis-service.js';
import { ScreenshotCaptureService } from '../capture/screenshot-capture-service.js';
import { cloneRepoShallow } from '../ingestion/clone.js';
import { validatePublicGithubRepo } from '../ingestion/github.js';
import { RemotionService } from '../remotion/remotion-service.js';
import { JobStore } from '../storage/job-store.js';
import { writeJobReport } from '../storage/report-store.js';
import {
  artifactManifestSchema,
  capturePlanSchema,
  cloneResultSchema,
  createDemoJobRequestSchema,
  frontendDetectionResultSchema,
  githubRepoMetadataSchema,
  remotionCodegenOutputSchema,
  remotionPromptOutputSchema,
  screenshotManifestSchema,
  workflowResultSchema,
} from '../types/contracts.js';
import { AppError, asAppError } from '../utils/app-error.js';
import { ensureDir, writeJsonFile } from '../utils/fs.js';
import { log } from '../utils/logger.js';
import {
  getBestDemoFilePath,
  getPurposeFilePath,
  getRemotionPromptJsonPath,
} from '../utils/paths.js';

const workflowContextSchema = z.object({
  jobId: z.string(),
  repoUrl: z.string(),
  ref: z.string().optional(),
  status: z.enum(['running', 'stopped_no_frontend']),
  stopReason: z.enum(['NO_FRONTEND_FOUND']).optional(),
  summary: z.string().optional(),
  metadata: githubRepoMetadataSchema.optional(),
  clone: cloneResultSchema.optional(),
  frontend: frontendDetectionResultSchema.optional(),
  purposeMarkdown: z.string().optional(),
  purposePath: z.string().optional(),
  bestDemoMarkdown: z.string().optional(),
  bestDemoPath: z.string().optional(),
  capturePlan: capturePlanSchema.optional(),
  screenshots: screenshotManifestSchema.optional(),
  remotionPrompt: remotionPromptOutputSchema.optional(),
  remotionCodegen: remotionCodegenOutputSchema.optional(),
  remotionProjectPath: z.string().optional(),
  mp4Path: z.string().optional(),
  artifacts: artifactManifestSchema,
});

type WorkflowContext = z.infer<typeof workflowContextSchema>;

type Services = {
  jobStore: JobStore;
  codexAnalysisService: CodexAnalysisService;
  geminiPromptBuilder: GeminiPromptBuilder;
  screenshotCaptureService: ScreenshotCaptureService;
  remotionService: RemotionService;
};

const defaultArtifacts = {
  reportJson: null,
  purposeMd: null,
  bestDemoMd: null,
  screenshotsDir: null,
  remotionPromptJson: null,
  remotionProjectPath: null,
  mp4Path: null,
} as const;

const markSkippedIfStopped = (
  services: Services,
  inputData: WorkflowContext,
  stepName:
    | 'analyzePurposeWithCodex'
    | 'createBestDemoWithCodex'
    | 'planRunAndCaptureWithCodex'
    | 'buildRemotionPromptWithGemini'
    | 'generateRemotionCodeWithCodex'
    | 'renderMp4',
): boolean => {
  if (inputData.status === 'stopped_no_frontend') {
    services.jobStore.markStepSkipped(inputData.jobId, stepName);
    log('info', 'Skipping step because workflow is already stopped_no_frontend', {
      jobId: inputData.jobId,
      stepName,
    });
    return true;
  }

  return false;
};

const makeTrackedStep = <TInput extends z.ZodTypeAny, TOutput extends z.ZodTypeAny>(
  services: Services,
  config: {
    id:
      | 'validateGithubRepo'
      | 'cloneRepoShallow'
      | 'detectFrontendWithCodex'
      | 'noFrontendStop'
      | 'analyzePurposeWithCodex'
      | 'createBestDemoWithCodex'
      | 'planRunAndCaptureWithCodex'
      | 'buildRemotionPromptWithGemini'
      | 'generateRemotionCodeWithCodex'
      | 'renderMp4'
      | 'publishArtifacts';
    inputSchema: TInput;
    outputSchema: TOutput;
    execute: (input: z.infer<TInput>) => Promise<z.infer<TOutput>>;
  },
) =>
  createStep({
    id: config.id,
    inputSchema: config.inputSchema,
    outputSchema: config.outputSchema,
    execute: async ({ inputData }) => {
      const jobId = (inputData as { jobId: string }).jobId;
      const startedAt = Date.now();

      services.jobStore.markStepRunning(jobId, config.id);
      log('info', 'Workflow step started', {
        jobId,
        step: config.id,
      });

      try {
        const output = await config.execute(inputData);
        const statusAfterExecute = services.jobStore.getStepStatus(jobId, config.id);
        if (statusAfterExecute !== 'skipped') {
          services.jobStore.markStepSuccess(jobId, config.id, output);
          log('info', 'Workflow step succeeded', {
            jobId,
            step: config.id,
            durationMs: Date.now() - startedAt,
          });
        } else {
          log('info', 'Workflow step marked skipped', {
            jobId,
            step: config.id,
            durationMs: Date.now() - startedAt,
          });
        }
        return output;
      } catch (error) {
        const appError = asAppError(error);
        services.jobStore.markStepError(jobId, config.id, appError.code, appError.detail ?? appError.message);
        log('error', 'Workflow step failed', {
          jobId,
          step: config.id,
          durationMs: Date.now() - startedAt,
          errorCode: appError.code,
          detail: appError.detail ?? appError.message,
        });
        throw appError;
      }
    },
  });

export const createRepoToRemotionWorkflow = (services: Services) => {
  const validateGithubRepoStep = makeTrackedStep(services, {
    id: 'validateGithubRepo',
    inputSchema: createDemoJobRequestSchema.extend({
      jobId: z.string(),
    }),
    outputSchema: workflowContextSchema,
    execute: async (inputData) => {
      const metadata = await validatePublicGithubRepo(inputData.repoUrl, inputData.ref);
      log('info', 'Validated public GitHub repository metadata', {
        jobId: inputData.jobId,
        repoUrl: inputData.repoUrl,
        owner: metadata.owner,
        repo: metadata.repo,
        defaultBranch: metadata.defaultBranch,
        requestedRef: inputData.ref ?? null,
      });

      services.jobStore.setJobStatus(inputData.jobId, 'running');

      return {
        jobId: inputData.jobId,
        repoUrl: inputData.repoUrl,
        ref: inputData.ref,
        status: 'running' as const,
        metadata,
        artifacts: { ...defaultArtifacts },
      };
    },
  });

  const cloneRepoShallowStep = makeTrackedStep(services, {
    id: 'cloneRepoShallow',
    inputSchema: workflowContextSchema,
    outputSchema: workflowContextSchema,
    execute: async (inputData) => {
      if (!inputData.metadata) {
        throw new AppError('CLONE_FAILED', 'Missing metadata for clone step');
      }

      const clone = await cloneRepoShallow(inputData.jobId, inputData.metadata);
      log('info', 'Repository clone complete', {
        jobId: inputData.jobId,
        repoPath: clone.repoPath,
        ref: clone.ref,
      });

      return {
        ...inputData,
        clone,
      };
    },
  });

  const detectFrontendWithCodexStep = makeTrackedStep(services, {
    id: 'detectFrontendWithCodex',
    inputSchema: workflowContextSchema,
    outputSchema: workflowContextSchema,
    execute: async (inputData) => {
      if (!inputData.clone) {
        throw new AppError('ANALYSIS_FAILED', 'Missing cloned repository path');
      }

      const frontend = await services.codexAnalysisService.detectFrontend(inputData.clone.repoPath);
      log('info', 'Frontend detection completed', {
        jobId: inputData.jobId,
        hasFrontend: frontend.hasFrontend,
        evidenceCount: frontend.evidence.length,
      });

      return {
        ...inputData,
        frontend,
      };
    },
  });

  const noFrontendStopStep = makeTrackedStep(services, {
    id: 'noFrontendStop',
    inputSchema: workflowContextSchema,
    outputSchema: workflowContextSchema,
    execute: async (inputData) => {
      const summary = 'No frontend code found for demo creation.';
      log('info', 'No frontend detected, entering early-stop branch', {
        jobId: inputData.jobId,
      });

      services.jobStore.setJobStatus(inputData.jobId, 'stopped_no_frontend', {
        stopReason: 'NO_FRONTEND_FOUND',
        summary,
      });

      return {
        ...inputData,
        status: 'stopped_no_frontend' as const,
        stopReason: 'NO_FRONTEND_FOUND' as const,
        summary,
      };
    },
  });

  const frontendContinueStep = createStep({
    id: 'frontendContinue',
    inputSchema: workflowContextSchema,
    outputSchema: workflowContextSchema,
    execute: async ({ inputData }) => inputData,
  });

  const analyzePurposeWithCodexStep = makeTrackedStep(services, {
    id: 'analyzePurposeWithCodex',
    inputSchema: workflowContextSchema,
    outputSchema: workflowContextSchema,
    execute: async (inputData) => {
      if (markSkippedIfStopped(services, inputData, 'analyzePurposeWithCodex')) {
        return inputData;
      }

      if (!inputData.clone) {
        throw new AppError('ANALYSIS_FAILED', 'Missing clone data for purpose analysis');
      }

      const purposeMarkdown = await services.codexAnalysisService.analyzePurpose(inputData.clone.repoPath);
      const purposePath = getPurposeFilePath(inputData.jobId);
      await ensureDir(path.dirname(purposePath));
      await fs.writeFile(purposePath, `${purposeMarkdown.trim()}\n`, 'utf-8');
      log('info', 'Purpose analysis written', {
        jobId: inputData.jobId,
        purposePath,
      });

      services.jobStore.setArtifacts(inputData.jobId, {
        purposeMd: purposePath,
      });

      return {
        ...inputData,
        purposeMarkdown,
        purposePath,
        artifacts: {
          ...inputData.artifacts,
          purposeMd: purposePath,
        },
      };
    },
  });

  const createBestDemoWithCodexStep = makeTrackedStep(services, {
    id: 'createBestDemoWithCodex',
    inputSchema: workflowContextSchema,
    outputSchema: workflowContextSchema,
    execute: async (inputData) => {
      if (markSkippedIfStopped(services, inputData, 'createBestDemoWithCodex')) {
        return inputData;
      }

      if (!inputData.clone) {
        throw new AppError('ANALYSIS_FAILED', 'Missing clone data for best demo generation');
      }

      const bestDemoMarkdown = await services.codexAnalysisService.createBestDemo(inputData.clone.repoPath);
      const bestDemoPath = getBestDemoFilePath(inputData.jobId);
      await ensureDir(path.dirname(bestDemoPath));
      await fs.writeFile(bestDemoPath, `${bestDemoMarkdown.trim()}\n`, 'utf-8');
      log('info', 'Best demo markdown written', {
        jobId: inputData.jobId,
        bestDemoPath,
      });

      services.jobStore.setArtifacts(inputData.jobId, {
        bestDemoMd: bestDemoPath,
      });

      return {
        ...inputData,
        bestDemoMarkdown,
        bestDemoPath,
        artifacts: {
          ...inputData.artifacts,
          bestDemoMd: bestDemoPath,
        },
      };
    },
  });

  const planRunAndCaptureWithCodexStep = makeTrackedStep(services, {
    id: 'planRunAndCaptureWithCodex',
    inputSchema: workflowContextSchema,
    outputSchema: workflowContextSchema,
    execute: async (inputData) => {
      if (markSkippedIfStopped(services, inputData, 'planRunAndCaptureWithCodex')) {
        return inputData;
      }

      if (!inputData.clone) {
        throw new AppError('ANALYSIS_FAILED', 'Missing clone data for capture planning');
      }

      const capturePlan = await services.codexAnalysisService.planCapture(inputData.clone.repoPath);
      log('info', 'Capture plan generated', {
        jobId: inputData.jobId,
        port: capturePlan.port,
        screenshotRoutes: capturePlan.screenshotRoutes,
        hasInstallCommand: Boolean(capturePlan.installCommand),
      });

      const screenshots = await services.screenshotCaptureService.runPlan({
        jobId: inputData.jobId,
        repoPath: inputData.clone.repoPath,
        capturePlan,
      });
      log('info', 'Screenshot capture completed', {
        jobId: inputData.jobId,
        screenshotCount: screenshots.screenshotNames.length,
        attemptCount: screenshots.attemptCount,
        screenshotDir: screenshots.screenshotDir,
      });

      services.jobStore.setArtifacts(inputData.jobId, {
        screenshotsDir: screenshots.screenshotDir,
      });

      return {
        ...inputData,
        capturePlan,
        screenshots,
        artifacts: {
          ...inputData.artifacts,
          screenshotsDir: screenshots.screenshotDir,
        },
      };
    },
  });

  const buildRemotionPromptWithGeminiStep = makeTrackedStep(services, {
    id: 'buildRemotionPromptWithGemini',
    inputSchema: workflowContextSchema,
    outputSchema: workflowContextSchema,
    execute: async (inputData) => {
      if (markSkippedIfStopped(services, inputData, 'buildRemotionPromptWithGemini')) {
        return inputData;
      }

      if (!inputData.screenshots || !inputData.purposeMarkdown || !inputData.bestDemoMarkdown) {
        throw new AppError('ANALYSIS_FAILED', 'Missing context for remotion prompt building');
      }

      const remotionDocs = await services.remotionService.readPinnedDocs();
      const remotionPrompt = await services.geminiPromptBuilder.buildPrompt({
        purposeMarkdown: inputData.purposeMarkdown,
        bestDemoMarkdown: inputData.bestDemoMarkdown,
        remotionDocs,
        screenshotNames: inputData.screenshots.screenshotNames,
      });
      log('info', 'Gemini remotion prompt built', {
        jobId: inputData.jobId,
        screenshotCount: remotionPrompt.screenshotNames.length,
      });

      const remotionPromptPath = getRemotionPromptJsonPath(inputData.jobId);
      await writeJsonFile(remotionPromptPath, remotionPrompt);
      log('info', 'Remotion prompt JSON written', {
        jobId: inputData.jobId,
        remotionPromptPath,
      });

      services.jobStore.setArtifacts(inputData.jobId, {
        remotionPromptJson: remotionPromptPath,
      });

      return {
        ...inputData,
        remotionPrompt,
        artifacts: {
          ...inputData.artifacts,
          remotionPromptJson: remotionPromptPath,
        },
      };
    },
  });

  const generateRemotionCodeWithCodexStep = makeTrackedStep(services, {
    id: 'generateRemotionCodeWithCodex',
    inputSchema: workflowContextSchema,
    outputSchema: workflowContextSchema,
    execute: async (inputData) => {
      if (markSkippedIfStopped(services, inputData, 'generateRemotionCodeWithCodex')) {
        return inputData;
      }

      if (!inputData.clone || !inputData.remotionPrompt) {
        throw new AppError('ANALYSIS_FAILED', 'Missing context for remotion code generation');
      }

      const remotionDocs = await services.remotionService.readPinnedDocs();
      const remotionCodegen = await services.codexAnalysisService.generateRemotionCode(
        inputData.clone.repoPath,
        inputData.remotionPrompt.remotionCodegenPrompt,
        remotionDocs,
      );
      log('info', 'Codex remotion codegen completed', {
        jobId: inputData.jobId,
        fileCount: remotionCodegen.files.length,
        compositionId: remotionCodegen.compositionId,
        entryFile: remotionCodegen.entryFile,
      });

      const { projectPath } = await services.remotionService.materializeProject(
        inputData.jobId,
        remotionCodegen,
      );
      log('info', 'Remotion project materialized', {
        jobId: inputData.jobId,
        projectPath,
      });

      services.jobStore.setArtifacts(inputData.jobId, {
        remotionProjectPath: projectPath,
      });

      return {
        ...inputData,
        remotionCodegen,
        remotionProjectPath: projectPath,
        artifacts: {
          ...inputData.artifacts,
          remotionProjectPath: projectPath,
        },
      };
    },
  });

  const renderMp4Step = makeTrackedStep(services, {
    id: 'renderMp4',
    inputSchema: workflowContextSchema,
    outputSchema: workflowContextSchema,
    execute: async (inputData) => {
      if (markSkippedIfStopped(services, inputData, 'renderMp4')) {
        return inputData;
      }

      if (!inputData.remotionProjectPath || !inputData.remotionCodegen) {
        throw new AppError('RENDER_FAILED', 'Missing remotion project for render');
      }

      const mp4Path = await services.remotionService.render(inputData.jobId, {
        projectPath: inputData.remotionProjectPath,
        entryFile: inputData.remotionCodegen.entryFile,
        compositionId: inputData.remotionCodegen.compositionId,
      });
      log('info', 'Remotion render completed', {
        jobId: inputData.jobId,
        mp4Path,
      });

      services.jobStore.setArtifacts(inputData.jobId, {
        mp4Path,
      });

      return {
        ...inputData,
        mp4Path,
        artifacts: {
          ...inputData.artifacts,
          mp4Path,
        },
      };
    },
  });

  const publishArtifactsStep = makeTrackedStep(services, {
    id: 'publishArtifacts',
    inputSchema: workflowContextSchema,
    outputSchema: workflowResultSchema,
    execute: async (inputData) => {
      const terminalStatus = inputData.status === 'stopped_no_frontend' ? 'stopped_no_frontend' : 'completed';

      services.jobStore.setJobStatus(inputData.jobId, terminalStatus, {
        stopReason: inputData.stopReason,
        summary:
          inputData.summary ??
          (terminalStatus === 'completed' ? 'Demo generated successfully.' : 'No frontend code found for demo creation.'),
      });

      const latest = services.jobStore.serializeForApi(inputData.jobId);
      const reportPath = await writeJobReport(latest);
      log('info', 'PublishArtifacts generated report', {
        jobId: inputData.jobId,
        reportPath,
      });

      services.jobStore.setArtifacts(inputData.jobId, {
        ...inputData.artifacts,
        reportJson: reportPath,
      });

      const finalRecord = services.jobStore.serializeForApi(inputData.jobId);

      return {
        status: finalRecord.status,
        stopReason: finalRecord.stopReason ?? null,
        summary: finalRecord.summary ?? null,
        artifacts: finalRecord.artifacts,
      };
    },
  });

  return createWorkflow({
    id: 'repo-to-remotion-workflow',
    inputSchema: createDemoJobRequestSchema.extend({
      jobId: z.string(),
    }),
    outputSchema: workflowResultSchema,
  })
    .then(validateGithubRepoStep)
    .then(cloneRepoShallowStep)
    .then(detectFrontendWithCodexStep)
    .branch([
      [async ({ inputData }) => !inputData.frontend?.hasFrontend, noFrontendStopStep],
      [async ({ inputData }) => Boolean(inputData.frontend?.hasFrontend), frontendContinueStep],
    ])
    .map(async ({ getStepResult }) => {
      const continued = getStepResult(frontendContinueStep) as WorkflowContext | undefined;
      if (continued) {
        log('info', 'Workflow branch selected: frontendContinue', {
          jobId: continued.jobId,
        });
        return continued;
      }

      const stopped = getStepResult(noFrontendStopStep) as WorkflowContext | undefined;
      if (stopped) {
        log('info', 'Workflow branch selected: noFrontendStop', {
          jobId: stopped.jobId,
        });
        return stopped;
      }

      throw new AppError('INTERNAL_ERROR', 'Branch did not produce a result');
    })
    .then(analyzePurposeWithCodexStep)
    .then(createBestDemoWithCodexStep)
    .then(planRunAndCaptureWithCodexStep)
    .then(buildRemotionPromptWithGeminiStep)
    .then(generateRemotionCodeWithCodexStep)
    .then(renderMp4Step)
    .then(publishArtifactsStep)
    .commit();
};
