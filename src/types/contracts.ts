import { z } from 'zod';
import { errorCodes } from './errors.js';

export const jobStatuses = [
  'queued',
  'running',
  'stopped_no_frontend',
  'failed',
  'completed',
] as const;

export const stepStatuses = ['pending', 'running', 'success', 'error', 'skipped'] as const;

export const workflowStepNames = [
  'validateGithubRepo',
  'cloneRepoShallow',
  'detectFrontendWithCodex',
  'noFrontendStop',
  'analyzePurposeWithCodex',
  'createBestDemoWithCodex',
  'planRunAndCaptureWithCodex',
  'buildRemotionPromptWithGemini',
  'generateRemotionCodeWithCodex',
  'renderMp4',
  'publishArtifacts',
] as const;

export type JobStatus = (typeof jobStatuses)[number];
export type StepStatus = (typeof stepStatuses)[number];
export type WorkflowStepName = (typeof workflowStepNames)[number];

export const createDemoJobRequestSchema = z.object({
  repoUrl: z.string().min(1),
  ref: z.string().min(1).optional(),
});

export type CreateDemoJobRequest = z.infer<typeof createDemoJobRequestSchema>;

export const createDemoJobResponseSchema = z.object({
  jobId: z.string(),
  status: z.enum(jobStatuses),
});

export type CreateDemoJobResponse = z.infer<typeof createDemoJobResponseSchema>;

export const stepRecordSchema = z.object({
  name: z.enum(workflowStepNames),
  status: z.enum(stepStatuses),
  durationMs: z.number().int().nonnegative().nullable().optional(),
  errorCode: z.enum(errorCodes).nullable().optional(),
  startedAt: z.string().datetime().nullable().optional(),
  finishedAt: z.string().datetime().nullable().optional(),
  payload: z.unknown().optional(),
  errorDetail: z.unknown().optional(),
});

export const artifactManifestSchema = z.object({
  reportJson: z.string().nullable().optional(),
  purposeMd: z.string().nullable().optional(),
  bestDemoMd: z.string().nullable().optional(),
  screenshotsDir: z.string().nullable().optional(),
  remotionPromptJson: z.string().nullable().optional(),
  remotionProjectPath: z.string().nullable().optional(),
  mp4Path: z.string().nullable().optional(),
});

export type ArtifactManifest = z.infer<typeof artifactManifestSchema>;

export const demoJobStatusResponseSchema = z.object({
  jobId: z.string(),
  status: z.enum(jobStatuses),
  stopReason: z.enum(['NO_FRONTEND_FOUND']).nullable().optional(),
  summary: z.string().nullable().optional(),
  steps: z.array(stepRecordSchema),
  artifacts: artifactManifestSchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type DemoJobStatusResponse = z.infer<typeof demoJobStatusResponseSchema>;

export const workflowInputSchema = z.object({
  jobId: z.string(),
  repoUrl: z.string(),
  ref: z.string().optional(),
});

export type WorkflowInput = z.infer<typeof workflowInputSchema>;

export const githubRepoMetadataSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  cloneUrl: z.string().url(),
  htmlUrl: z.string().url(),
  defaultBranch: z.string(),
  isPrivate: z.boolean(),
  ref: z.string(),
});

export type GithubRepoMetadata = z.infer<typeof githubRepoMetadataSchema>;

export const cloneResultSchema = z.object({
  workspaceRoot: z.string(),
  repoPath: z.string(),
  repoDirName: z.string(),
  ref: z.string(),
});

export type CloneResult = z.infer<typeof cloneResultSchema>;

export const frontendDetectionResultSchema = z.object({
  hasFrontend: z.boolean(),
  evidence: z.array(z.string()).default([]),
});

export type FrontendDetectionResult = z.infer<typeof frontendDetectionResultSchema>;

export const capturePlanSchema = z.object({
  installCommand: z.string().nullable().optional(),
  startCommand: z.string(),
  port: z.number().int().min(1).max(65535),
  basePath: z.string().default('/'),
  screenshotRoutes: z.array(z.string()).min(1).max(4),
});

export type CapturePlan = z.infer<typeof capturePlanSchema>;

export const captureFailurePhaseSchema = z.enum([
  'install',
  'start_process',
  'readiness_probe',
  'screenshot_capture',
  'recovery_fix',
]);

export type CaptureFailurePhase = z.infer<typeof captureFailurePhaseSchema>;

export const captureStartupFailureSchema = z.object({
  phase: captureFailurePhaseSchema,
  message: z.string().min(1),
  command: z.string().nullable().optional(),
  exitCode: z.number().int().nullable().optional(),
  stdout: z.string().nullable().optional(),
  stderr: z.string().nullable().optional(),
  attempt: z.number().int().min(1),
});

export type CaptureStartupFailure = z.infer<typeof captureStartupFailureSchema>;

export const captureRecoveryPlanSchema = z
  .object({
    fixCommands: z.array(z.string().min(1)).max(12),
    updatedInstallCommand: z.string().nullable().optional(),
    updatedStartCommand: z.string().min(1).optional(),
  })
  .refine(
    (value) =>
      value.fixCommands.length > 0 ||
      value.updatedInstallCommand !== undefined ||
      value.updatedStartCommand !== undefined,
    {
      message: 'Recovery plan must include fixCommands or command revisions',
    },
  );

export type CaptureRecoveryPlan = z.infer<typeof captureRecoveryPlanSchema>;

export const captureAttemptRecordSchema = z.object({
  attempt: z.number().int().min(1),
  installCommand: z.string().nullable(),
  startCommand: z.string(),
  result: z.enum(['success', 'failed']),
  failure: captureStartupFailureSchema.optional(),
  fixCommandsApplied: z.array(z.string()).default([]),
});

export type CaptureAttemptRecord = z.infer<typeof captureAttemptRecordSchema>;

export const screenshotManifestSchema = z.object({
  screenshotDir: z.string(),
  screenshotNames: z.array(z.string()).min(1),
  attemptCount: z.number().int().min(1),
  attempts: z.array(captureAttemptRecordSchema).min(1),
});

export type ScreenshotManifest = z.infer<typeof screenshotManifestSchema>;

export const remotionPromptOutputSchema = z.object({
  remotionCodegenPrompt: z.string().min(1),
  screenshotNames: z.array(z.string().min(1)).min(1),
});

export type RemotionPromptOutput = z.infer<typeof remotionPromptOutputSchema>;

export const remotionCodegenOutputSchema = z.object({
  files: z.array(
    z.object({
      path: z.string().min(1),
      content: z.string(),
    }),
  ),
  compositionId: z.string().min(1),
  entryFile: z.string().min(1),
});

export type RemotionCodegenOutput = z.infer<typeof remotionCodegenOutputSchema>;

export const workflowResultSchema = z.object({
  status: z.enum(jobStatuses),
  stopReason: z.enum(['NO_FRONTEND_FOUND']).nullable().optional(),
  summary: z.string().nullable().optional(),
  artifacts: artifactManifestSchema,
});

export type WorkflowResult = z.infer<typeof workflowResultSchema>;
