import fs from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
import type { RemotionCodegenOutput } from '../types/contracts.js';
import { AppError } from '../utils/app-error.js';
import { runCommand } from '../utils/command-runner.js';
import { ensureDir } from '../utils/fs.js';
import { log } from '../utils/logger.js';
import { getRenderedMp4Path, getRemotionProjectPath } from '../utils/paths.js';

const resolveSafeRelativePath = (root: string, relative: string): string => {
  if (path.isAbsolute(relative)) {
    throw new AppError('RENDER_FAILED', 'Generated file path cannot be absolute', { relative });
  }

  const normalized = path.normalize(relative);
  if (normalized.startsWith('..')) {
    throw new AppError('RENDER_FAILED', 'Generated file path cannot escape project directory', {
      relative,
    });
  }

  return path.join(root, normalized);
};

export class RemotionService {
  public async readPinnedDocs(): Promise<string> {
    const docsPath = path.resolve(env.remotionDocsPath);
    log('debug', 'Reading pinned Remotion docs', {
      docsPath,
    });

    try {
      const docs = await fs.readFile(docsPath, 'utf-8');
      log('debug', 'Pinned Remotion docs loaded', {
        docsPath,
        chars: docs.length,
      });
      return docs;
    } catch {
      throw new AppError('INTERNAL_ERROR', 'Pinned Remotion docs file not found', {
        docsPath,
      });
    }
  }

  public async materializeProject(
    jobId: string,
    codegenOutput: RemotionCodegenOutput,
  ): Promise<{ projectPath: string; entryFile: string; compositionId: string }> {
    const startedAt = Date.now();
    const projectPath = getRemotionProjectPath(jobId);
    log('info', 'Materializing Remotion project files', {
      jobId,
      projectPath,
      fileCount: codegenOutput.files.length,
      entryFile: codegenOutput.entryFile,
      compositionId: codegenOutput.compositionId,
    });

    await fs.rm(projectPath, { recursive: true, force: true });
    await ensureDir(projectPath);

    for (const file of codegenOutput.files) {
      const target = resolveSafeRelativePath(projectPath, file.path);
      await ensureDir(path.dirname(target));
      await fs.writeFile(target, file.content, 'utf-8');
    }

    const entryPath = resolveSafeRelativePath(projectPath, codegenOutput.entryFile);
    try {
      await fs.access(entryPath);
    } catch {
      throw new AppError('RENDER_FAILED', 'Generated Remotion entry file does not exist', {
        entryFile: codegenOutput.entryFile,
      });
    }

    log('info', 'Remotion project materialization complete', {
      jobId,
      projectPath,
      durationMs: Date.now() - startedAt,
    });

    return {
      projectPath,
      entryFile: codegenOutput.entryFile,
      compositionId: codegenOutput.compositionId,
    };
  }

  public async render(jobId: string, input: {
    projectPath: string;
    entryFile: string;
    compositionId: string;
  }): Promise<string> {
    const startedAt = Date.now();
    const outputPath = getRenderedMp4Path(jobId);
    log('info', 'Starting Remotion render', {
      jobId,
      projectPath: input.projectPath,
      entryFile: input.entryFile,
      compositionId: input.compositionId,
      outputPath,
    });

    const render = await runCommand(
      'npx',
      ['remotion', 'render', input.entryFile, input.compositionId, outputPath],
      {
        cwd: input.projectPath,
        timeoutMs: 30 * 60 * 1000,
      },
    );

    if (render.exitCode !== 0) {
      throw new AppError('RENDER_FAILED', 'Remotion render failed', {
        stderr: render.stderr,
        stdout: render.stdout,
      });
    }

    try {
      const stat = await fs.stat(outputPath);
      if (stat.size <= 0) {
        throw new Error('Rendered output is empty');
      }
    } catch (error) {
      throw new AppError('RENDER_FAILED', 'Rendered mp4 output was not produced', {
        outputPath,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    log('info', 'Remotion render finished', {
      jobId,
      outputPath,
      durationMs: Date.now() - startedAt,
    });

    return outputPath;
  }
}
