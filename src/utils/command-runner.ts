import { spawn } from 'node:child_process';
import { AppError } from './app-error.js';
import { log } from './logger.js';

export type CommandRunnerOptions = {
  cwd?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  shell?: boolean;
};

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export const runCommand = (
  command: string,
  args: string[],
  options: CommandRunnerOptions = {},
): Promise<CommandResult> => {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    log('info', 'Executing command', {
      command,
      args,
      cwd: options.cwd ?? process.cwd(),
      timeoutMs: options.timeoutMs ?? null,
      shell: options.shell ?? false,
    });

    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: options.shell ?? false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');

    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    const timeoutMs = options.timeoutMs ?? 0;
    const timeout =
      timeoutMs > 0
        ? setTimeout(() => {
            child.kill('SIGKILL');
            log('error', 'Command timed out', {
              command,
              args,
              cwd: options.cwd ?? process.cwd(),
              timeoutMs,
            });
            reject(
              new AppError('INTERNAL_ERROR', `Command timed out after ${timeoutMs}ms`, {
                command,
                args,
              }),
            );
          }, timeoutMs)
        : undefined;

    child.on('error', (error) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      log('error', 'Command failed to start', {
        command,
        args,
        cwd: options.cwd ?? process.cwd(),
        error: error.message,
      });
      reject(error);
    });

    child.on('close', (code) => {
      if (timeout) {
        clearTimeout(timeout);
      }

      const durationMs = Date.now() - startedAt;
      log(code === 0 ? 'info' : 'warn', 'Command completed', {
        command,
        args,
        cwd: options.cwd ?? process.cwd(),
        exitCode: code ?? -1,
        durationMs,
      });

      resolve({
        exitCode: code ?? -1,
        stdout,
        stderr,
      });
    });
  });
};
