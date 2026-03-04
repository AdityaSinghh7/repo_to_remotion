import 'dotenv/config';
import { env } from './config/env.js';
import { createServer } from './api/server.js';
import { createAppContext } from './mastra.js';
import { log } from './utils/logger.js';

const start = async (): Promise<void> => {
  const context = await createAppContext();
  const app = createServer(context);

  app.listen(env.port, () => {
    log('info', 'repo-to-remotion service started', {
      port: env.port,
    });
  });
};

start().catch((error) => {
  log('error', 'fatal startup error', {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
