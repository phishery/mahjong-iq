import demoCard from './demo-card.json';
import { loadCard } from '../card/parser';
import type { LoadedCard } from '../card/schema';

/** The bundled fictional demo card (never labelled as an official NMJL card). */
export const DEMO_CARD_JSON: unknown = demoCard;

let demo: LoadedCard | null = null;
export function getDemoCard(): LoadedCard {
  return (demo ??= loadCard(DEMO_CARD_JSON));
}
