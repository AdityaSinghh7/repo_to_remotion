export const errorCodes = [
  'INVALID_REQUEST',
  'IDEMPOTENCY_KEY_CONFLICT',
  'INVALID_REPO_URL',
  'REPO_NOT_FOUND',
  'REPO_NOT_PUBLIC',
  'CLONE_FAILED',
  'NO_FRONTEND_FOUND',
  'ANALYSIS_FAILED',
  'FRONTEND_START_FAILED',
  'RENDER_FAILED',
  'JOB_NOT_FOUND',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof errorCodes)[number];

export type ErrorResponse = {
  error: {
    code: ErrorCode;
    message: string;
    detail?: unknown;
  };
};
