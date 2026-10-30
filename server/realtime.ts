import { Server } from 'socket.io';
import { type Server as HttpServer } from 'node:http';
import { type Redis } from 'ioredis';
export async function attachRealtime(server: HttpServer, redis: Redis, origin: string) {
  const io = new Server(server, {
    serveClient: false,
    allowRequest: (req, callback) => callback(null, req.headers.origin === origin),
    maxHttpBufferSize: 4096,
    transports: ['websocket'],
    pingInterval: 25000,
    pingTimeout: 20000,
  });
  const subscriber = redis.duplicate();
  subscriber.on('error', () => {});
  await subscriber.subscribe(process.env.ROOM_EVENT_CHANNEL ?? 'temple:events');
  subscriber.on('message', (_channel, message) => {
    try {
      const event = JSON.parse(message);
      io.emit('temple.event', event);
    } catch {
      /* Ignore malformed internal messages. */
    }
  });
  // Read-only event channel: no client event changes seats, currency, gifts or admin settings.
  io.on('connection', (socket) => {
    socket.emit('resync.required', { serverTime: new Date().toISOString() });
  });
  return {
    async close() {
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await subscriber.quit();
    },
  };
}
