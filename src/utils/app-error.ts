import type { ErrorCode } from '../types/errors.js';

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly detail?: unknown;

  constructor(code: ErrorCode, message: string, detail?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.detail = detail;
  }
}

export const asAppError = (error: unknown, fallbackMessage = 'Unexpected failure'): AppError => {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    return new AppError('INTERNAL_ERROR', error.message);
  }

  return new AppError('INTERNAL_ERROR', fallbackMessage, error);
};
