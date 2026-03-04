import fs from 'node:fs/promises';
import path from 'node:path';
import type { CloneResult, GithubRepoMetadata } from '../types/contracts.js';
import { AppError } from '../utils/app-error.js';
import { runCommand } from '../utils/command-runner.js';
import { ensureDir } from '../utils/fs.js';
import { getClonedRepoPath, getJobWorkspaceRoot } from '../utils/paths.js';

const sanitizeRepoDirName = (owner: string, repo: string): string =>
  `${owner}__${repo}`.replace(/[^a-zA-Z0-9_.-]/g, '_');

export const cloneRepoShallow = async (
  jobId: string,
  metadata: GithubRepoMetadata,
): Promise<CloneResult> => {
  const workspaceRoot = getJobWorkspaceRoot(jobId);
  const repoDirName = sanitizeRepoDirName(metadata.owner, metadata.repo);
  const repoPath = getClonedRepoPath(jobId, repoDirName);

  await fs.rm(workspaceRoot, { recursive: true, force: true });
  await ensureDir(workspaceRoot);

  const clone = await runCommand(
    'git',
    ['clone', '--depth', '1', metadata.cloneUrl, repoDirName],
    {
      cwd: workspaceRoot,
      timeoutMs: 5 * 60 * 1000,
    },
  );

  if (clone.exitCode !== 0) {
    throw new AppError('CLONE_FAILED', 'Shallow clone failed', {
      stdout: clone.stdout,
      stderr: clone.stderr,
      exitCode: clone.exitCode,
    });
  }

  if (metadata.ref && metadata.ref !== metadata.defaultBranch) {
    const checkout = await runCommand(
      'git',
      ['-C', repoPath, 'checkout', metadata.ref],
      { timeoutMs: 60 * 1000 },
    );

    if (checkout.exitCode !== 0) {
      // Best effort: fetch specific ref then checkout.
      const fetch = await runCommand(
        'git',
        ['-C', repoPath, 'fetch', '--depth', '1', 'origin', metadata.ref],
        { timeoutMs: 60 * 1000 },
      );

      if (fetch.exitCode !== 0) {
        throw new AppError('CLONE_FAILED', 'Failed to checkout requested ref', {
          ref: metadata.ref,
          checkoutStdErr: checkout.stderr,
          fetchStdErr: fetch.stderr,
        });
      }

      const checkoutHead = await runCommand(
        'git',
        ['-C', repoPath, 'checkout', 'FETCH_HEAD'],
        { timeoutMs: 60 * 1000 },
      );

      if (checkoutHead.exitCode !== 0) {
        throw new AppError('CLONE_FAILED', 'Failed to checkout fetched ref', {
          ref: metadata.ref,
          stderr: checkoutHead.stderr,
        });
      }
    }
  }

  const gitDir = path.join(repoPath, '.git');
  try {
    await fs.access(gitDir);
  } catch {
    throw new AppError('CLONE_FAILED', 'Repository clone did not produce a git checkout');
  }

  return {
    workspaceRoot,
    repoPath,
    repoDirName,
    ref: metadata.ref,
  };
};
