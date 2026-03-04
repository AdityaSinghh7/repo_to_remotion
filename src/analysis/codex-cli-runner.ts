import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { env } from '../config/env.js';
import { AppError } from '../utils/app-error.js';
import { runCommand } from '../utils/command-runner.js';
import { extractJsonObject } from '../utils/json.js';

export type CodexRunOptions = {
  cwd: string;
  prompt: string;
  allowOutsideGitRepo?: boolean;
  timeoutMs?: number;
};

export class CodexCliRunner {
  public async runText(options: CodexRunOptions): Promise<string> {
    const outputFile = await this.createOutputFile();

    const args = [
      'exec',
      '-m',
      env.codexModel,
      '--json',
      '--output-last-message',
      outputFile,
      ...(options.allowOutsideGitRepo ? ['--skip-git-repo-check'] : []),
      options.prompt,
    ];

    const result = await runCommand('codex', args, {
      cwd: options.cwd,
      timeoutMs: options.timeoutMs ?? env.codexTimeoutMs,
    });

    const message = await fs.readFile(outputFile, 'utf-8').catch(() => '');
    await fs.rm(outputFile, { force: true });

    if (result.exitCode !== 0) {
      throw new AppError('ANALYSIS_FAILED', 'Codex CLI execution failed', {
        exitCode: result.exitCode,
        stderr: result.stderr,
        stdout: result.stdout,
      });
    }

    const trimmed = message.trim();
    if (!trimmed) {
      throw new AppError('ANALYSIS_FAILED', 'Codex CLI returned empty response', {
        stdout: result.stdout,
      });
    }

    return trimmed;
  }

  public async runJson<T extends z.ZodTypeAny>(
    options: CodexRunOptions & { schema: T },
  ): Promise<z.infer<T>> {
    const text = await this.runText(options);

    let parsed: unknown;
    try {
      parsed = extractJsonObject(text);
    } catch (error) {
      throw new AppError('ANALYSIS_FAILED', 'Failed to parse Codex JSON output', {
        message: text,
        parseError: error instanceof Error ? error.message : String(error),
      });
    }

    const validated = options.schema.safeParse(parsed);

    if (!validated.success) {
      throw new AppError('ANALYSIS_FAILED', 'Codex JSON output failed schema validation', {
        issues: validated.error.issues,
      });
    }

    return validated.data;
  }

  private async createOutputFile(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-last-message-'));
    return path.join(dir, 'last-message.txt');
  }
}
