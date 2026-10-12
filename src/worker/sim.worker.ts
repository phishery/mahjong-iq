/// <reference lib="webworker" />
/**
 * Web Worker running Monte Carlo simulations off the main thread.
 * Messages:
 *   { type: 'init', cardJson }                         — load/replace the active card
 *   { type: 'simulate', id, input: SimInput }          — run and reply { type: 'result', id, results }
 */

import { loadCard } from '../engine/card/parser';
import type { LoadedCard } from '../engine/card/schema';
import { simulate, type SimInput } from '../engine/simulate';

let card: LoadedCard | null = null;

self.onmessage = (e: MessageEvent) => {
  const msg = e.data;
  try {
    if (msg.type === 'init') {
      card = loadCard(msg.cardJson);
      (self as unknown as Worker).postMessage({ type: 'ready', cardId: card.def.id });
    } else if (msg.type === 'simulate') {
      if (!card) throw new Error('Card not loaded');
      const t0 = performance.now();
      const results = simulate(card, msg.input as SimInput);
      (self as unknown as Worker).postMessage({ type: 'result', id: msg.id, results, ms: performance.now() - t0 });
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: 'error', id: msg.id, message: (err as Error).message });
  }
};
