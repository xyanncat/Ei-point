import { createApp } from './app.js';
const app = createApp({ logger: true });
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    app.close()
      .then(() => process.exit(0))
      .catch((err) => {
        app.log.error(err, 'shutdown failed');
        process.exit(1);
      });
  });
}
await app.listen({ port: Number(process.env.API_PORT ?? 3001), host: '0.0.0.0' });
