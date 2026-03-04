import express from 'express';
import { nanoid } from 'nanoid';
import type { AppContext } from '../mastra.js';
import { createDemoJobRequestSchema } from '../types/contracts.js';
import type { ErrorResponse } from '../types/errors.js';
import { AppError, asAppError } from '../utils/app-error.js';
import { log } from '../utils/logger.js';

const toErrorResponse = (error: AppError): ErrorResponse => ({
  error: {
    code: error.code,
    message: error.message,
    detail: error.detail,
  },
});

export const createServer = (context: AppContext) => {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_request, response) => {
    response.status(200).json({ ok: true });
  });

  app.post('/v1/demo-jobs', (request, response, next) => {
    try {
      log('info', 'Received create demo job request', {
        path: '/v1/demo-jobs',
        hasIdempotencyKey: Boolean(request.header('Idempotency-Key')),
        body: request.body,
      });

      const parsed = createDemoJobRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError('INVALID_REQUEST', 'Invalid request payload', {
          issues: parsed.error.issues,
        });
      }

      const payload = parsed.data;
      const idempotencyKey = request.header('Idempotency-Key')?.trim();

      if (idempotencyKey) {
        const resolution = context.jobStore.resolveIdempotency(idempotencyKey, payload);
        if (resolution.kind === 'conflict') {
          throw new AppError(
            'IDEMPOTENCY_KEY_CONFLICT',
            'Idempotency-Key has already been used with a different payload',
          );
        }

        if (resolution.kind === 'replay') {
          log('info', 'Replaying existing job for idempotency key', {
            idempotencyKey,
            jobId: resolution.job.jobId,
            status: resolution.job.status,
          });
          response.status(202).json({
            jobId: resolution.job.jobId,
            status: resolution.job.status,
          });
          return;
        }
      }

      const jobId = `job_${nanoid(14)}`;
      const record = context.jobStore.createJob({
        jobId,
        repoUrl: payload.repoUrl,
        ref: payload.ref,
      });

      if (idempotencyKey) {
        context.jobStore.registerIdempotency(idempotencyKey, payload, jobId);
      }

      log('info', 'Created new demo job', {
        jobId,
        repoUrl: payload.repoUrl,
        ref: payload.ref ?? null,
      });

      context.workflowRunner.start({
        jobId,
        repoUrl: payload.repoUrl,
        ref: payload.ref,
      });

      response.status(202).json({
        jobId,
        status: record.status,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/v1/demo-jobs/:jobId', (request, response, next) => {
    try {
      const job = context.jobStore.getJob(request.params.jobId);
      if (!job) {
        throw new AppError('JOB_NOT_FOUND', 'No demo job exists for the requested id');
      }

      log('debug', 'Fetched job status', {
        jobId: job.jobId,
        status: job.status,
        updatedAt: job.updatedAt,
      });

      response.status(200).json({
        jobId: job.jobId,
        status: job.status,
        stopReason: job.stopReason ?? null,
        summary: job.summary ?? null,
        steps: job.steps,
        artifacts: job.artifacts,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/v1/demo-jobs/:jobId/artifacts', (request, response, next) => {
    try {
      const job = context.jobStore.getJob(request.params.jobId);
      if (!job) {
        throw new AppError('JOB_NOT_FOUND', 'No demo job exists for the requested id');
      }

      log('debug', 'Fetched job artifacts', {
        jobId: job.jobId,
        status: job.status,
      });

      response.status(200).json({
        jobId: job.jobId,
        status: job.status,
        artifacts: job.artifacts,
      });
    } catch (error) {
      next(error);
    }
  });

  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      const appError = asAppError(error);

      log('error', 'Request failed', {
        code: appError.code,
        message: appError.message,
        detail: appError.detail,
      });

      const statusCode =
        appError.code === 'JOB_NOT_FOUND'
          ? 404
          : appError.code === 'INVALID_REQUEST' ||
              appError.code === 'INVALID_REPO_URL' ||
              appError.code === 'IDEMPOTENCY_KEY_CONFLICT'
            ? appError.code === 'IDEMPOTENCY_KEY_CONFLICT'
              ? 409
              : 400
            : appError.code === 'REPO_NOT_PUBLIC' || appError.code === 'REPO_NOT_FOUND'
              ? 400
              : 500;

      response.status(statusCode).json(toErrorResponse(appError));
    },
  );

  return app;
};
