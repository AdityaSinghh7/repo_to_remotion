import { AppError } from '../utils/app-error.js';
import type { GithubRepoMetadata } from '../types/contracts.js';

export type GithubUrlParts = {
  owner: string;
  repo: string;
};

const GITHUB_HOST = 'github.com';

export const parseGithubRepoUrl = (repoUrl: string): GithubUrlParts => {
  let url: URL;

  try {
    const candidate = repoUrl.startsWith('http://') || repoUrl.startsWith('https://')
      ? repoUrl
      : `https://${repoUrl}`;
    url = new URL(candidate);
  } catch {
    throw new AppError('INVALID_REPO_URL', 'repoUrl must be a valid URL');
  }

  if (url.hostname !== GITHUB_HOST && url.hostname !== `www.${GITHUB_HOST}`) {
    throw new AppError('INVALID_REPO_URL', 'repoUrl must target github.com');
  }

  const segments = url.pathname
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length < 2) {
    throw new AppError(
      'INVALID_REPO_URL',
      'repoUrl must include owner and repository name',
    );
  }

  const owner = segments[0];
  let repo = segments[1];

  if (repo.endsWith('.git')) {
    repo = repo.slice(0, -4);
  }

  if (!owner || !repo) {
    throw new AppError('INVALID_REPO_URL', 'repoUrl owner/repository segment is invalid');
  }

  return { owner, repo };
};

export const validatePublicGithubRepo = async (
  repoUrl: string,
  ref?: string,
): Promise<GithubRepoMetadata> => {
  const { owner, repo } = parseGithubRepoUrl(repoUrl);

  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'repo-to-remotion-agent',
    },
  });

  if (response.status === 404) {
    throw new AppError('REPO_NOT_FOUND', 'GitHub repository was not found', {
      owner,
      repo,
    });
  }

  if (!response.ok) {
    throw new AppError('INTERNAL_ERROR', 'Failed to validate GitHub repository metadata', {
      status: response.status,
      owner,
      repo,
    });
  }

  const payload = (await response.json()) as {
    private: boolean;
    clone_url: string;
    html_url: string;
    default_branch: string;
  };

  if (payload.private) {
    throw new AppError('REPO_NOT_PUBLIC', 'GitHub repository is private and not supported in v1');
  }

  return {
    owner,
    repo,
    cloneUrl: payload.clone_url,
    htmlUrl: payload.html_url,
    defaultBranch: payload.default_branch,
    isPrivate: payload.private,
    ref: ref ?? payload.default_branch,
  };
};
