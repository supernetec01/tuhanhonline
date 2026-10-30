import { createApp } from './app.js';
import express from 'express';
import { resolve } from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import { attachRealtime } from './realtime.js';
import { startJobs } from './jobs.js';
const instance = await createApp();
const { app, pool, redis, origin } = instance;
const httpServer = createHttpServer(app);
const realtime = await attachRealtime(httpServer, redis, origin);
const jobs =
  process.env.RUN_WORKER !== '0' && process.env.NODE_ENV !== 'production'
    ? await startJobs(pool, redis)
    : null;
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(resolve('dist'), { index: false }));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({
    server: { middlewareMode: true, hmr: { server: httpServer } },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT ?? 3000);
httpServer.listen(port, '0.0.0.0', () =>
  console.log(`Tu Hành Online running on port ${port} (${process.env.NODE_ENV ?? 'development'})`),
);
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await jobs?.close();
  await realtime.close();
  if (httpServer.listening) await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await instance.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
