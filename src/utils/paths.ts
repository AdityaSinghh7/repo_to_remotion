import path from 'node:path';
import { env } from '../config/env.js';

export const getJobWorkspaceRoot = (jobId: string): string =>
  path.join(env.workspaceBaseDir, jobId);

export const getClonedRepoPath = (jobId: string, repoDirName: string): string =>
  path.join(getJobWorkspaceRoot(jobId), repoDirName);

export const getPurposeFilePath = (jobId: string): string =>
  path.join(getJobWorkspaceRoot(jobId), 'purpose.md');

export const getBestDemoFilePath = (jobId: string): string =>
  path.join(getJobWorkspaceRoot(jobId), 'best-demo.md');

export const getScreenshotsDirPath = (jobId: string): string =>
  path.join(getJobWorkspaceRoot(jobId), 'screenshots');

export const getRemotionPromptJsonPath = (jobId: string): string =>
  path.join(getJobWorkspaceRoot(jobId), 'remotion-prompt.json');

export const getRemotionProjectPath = (jobId: string): string =>
  path.join(getJobWorkspaceRoot(jobId), 'remotion-project');

export const getReportJsonPath = (jobId: string): string =>
  path.join(getJobWorkspaceRoot(jobId), 'report.json');

export const getRenderedMp4Path = (jobId: string): string =>
  path.join(getJobWorkspaceRoot(jobId), 'demo.mp4');
