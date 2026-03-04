export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const levelPriority: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const configuredLevel = (process.env.LOG_LEVEL as LogLevel | undefined) ?? 'debug';

export const log = (level: LogLevel, message: string, meta?: Record<string, unknown>): void => {
  if (levelPriority[level] < levelPriority[configuredLevel]) {
    return;
  }

  const payload = {
    timestamp: new Date().toISOString(),
    pid: process.pid,
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
