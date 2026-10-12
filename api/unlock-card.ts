/**
 * Passcode-gated card delivery (Vercel Function).
 *
 * The card JSON and passcode live only in the Vercel project's environment variables
 * (CARD_JSON, CARD_PASSCODE) — never in the public repository or the static bundle.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

const FAILURE_DELAY_MS = 1000;

const digest = (s: string) => createHash('sha256').update(s).digest();
const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

export async function POST(request: Request): Promise<Response> {
  const card = process.env.CARD_JSON;
  const expected = process.env.CARD_PASSCODE;
  if (!card || !expected) return json({ error: 'No card is configured on this site.' }, 503);

  let passcode = '';
  try {
    const body = (await request.json()) as { passcode?: unknown };
    if (typeof body.passcode === 'string') passcode = body.passcode.trim();
  } catch {
    /* treated as a wrong passcode */
  }

  if (!timingSafeEqual(digest(passcode), digest(expected))) {
    await new Promise((r) => setTimeout(r, FAILURE_DELAY_MS));
    return json({ error: 'That passcode isn’t right.' }, 401);
  }
  return new Response(card, { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
