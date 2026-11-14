/** Entry point: `npm run server` (development) or `node`/`tsx server/index.ts` in production. */

import { startServer } from './server';

const port = Number(process.env.PORT ?? 8787);
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const server = await startServer({
  port,
  allowedOrigins,
  cardJson: process.env.CARD_JSON || undefined,
  cardPasscode: process.env.CARD_PASSCODE || undefined,
  log: (m) => console.log(`[game-server] ${m}`),
});

console.log(
  `[game-server] listening on :${server.port} (ws path /ws)` +
    (allowedOrigins.length ? `, origins: ${allowedOrigins.join(', ')}` : ', any origin') +
    (process.env.CARD_JSON ? ', private card available' : ''),
);

const shutdown = () => server.close().then(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
