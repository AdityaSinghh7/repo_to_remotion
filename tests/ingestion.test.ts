import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { parseGithubRepoUrl, validatePublicGithubRepo } from '../src/ingestion/github.js';
import { AppError } from '../src/utils/app-error.js';

describe('parseGithubRepoUrl', () => {
  it('parses a valid https repo URL', () => {
    expect(parseGithubRepoUrl('https://github.com/openai/openai-node')).toEqual({
      owner: 'openai',
      repo: 'openai-node',
    });
  });

  it('accepts trailing .git suffix', () => {
    expect(parseGithubRepoUrl('https://github.com/openai/openai-node.git')).toEqual({
      owner: 'openai',
      repo: 'openai-node',
    });
  });

  it('rejects non-github hosts', () => {
    expect(() => parseGithubRepoUrl('https://example.com/openai/openai-node')).toThrowError(AppError);
  });
});

describe('validatePublicGithubRepo', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps a public repo response correctly', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            private: false,
            clone_url: 'https://github.com/openai/openai-node.git',
            html_url: 'https://github.com/openai/openai-node',
            default_branch: 'main',
          }),
          { status: 200 },
        ),
      ),
    );

    const result = await validatePublicGithubRepo('https://github.com/openai/openai-node');
    expect(result.owner).toBe('openai');
    expect(result.repo).toBe('openai-node');
    expect(result.ref).toBe('main');
  });

  it('throws REPO_NOT_FOUND on 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));

    await expect(
      validatePublicGithubRepo('https://github.com/openai/missing-repo'),
    ).rejects.toMatchObject({ code: 'REPO_NOT_FOUND' });
  });

  it('throws REPO_NOT_PUBLIC when private', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            private: true,
            clone_url: 'https://github.com/openai/private.git',
            html_url: 'https://github.com/openai/private',
            default_branch: 'main',
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(validatePublicGithubRepo('https://github.com/openai/private')).rejects.toMatchObject({
      code: 'REPO_NOT_PUBLIC',
    });
  });
});
