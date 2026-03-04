export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export const log = (level: LogLevel, message: string, meta?: Record<string, unknown>): void => {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(meta ? { meta } : {}),
  };

  const line = JSON.stringify(payload);

  if (level === 'error' || level === 'warn') {
    console.error(line);
    return;
  }

  console.log(line);
};
