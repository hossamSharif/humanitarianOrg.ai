import { createApp } from './app';
import { getEnv } from './config/env';
import { closePool } from './db/pool';

const env = getEnv();
const app = createApp({ corsOrigins: env.CORS_ORIGINS });

const server = app.listen(env.PORT, () => {
  console.log(`@ngo/api listening on :${env.PORT}`);
});

function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  server.close(() => {
    closePool()
      .catch(() => {})
      .finally(() => process.exit(0));
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
