/**
 * Validate a card definition JSON file.
 *   npm run validate-card -- path/to/card.json
 */
import { readFileSync } from 'node:fs';
import { loadCard, validateCard } from '../src/engine/card/parser';

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run validate-card -- <card.json>');
  process.exit(2);
}
const json = JSON.parse(readFileSync(file, 'utf8'));
const res = validateCard(json);
for (const w of res.warnings) console.warn(`warning: ${w}`);
if (!res.ok) {
  for (const e of res.errors) console.error(`error: ${e}`);
  console.error(`\n✗ ${res.errors.length} error(s)`);
  process.exit(1);
}
const card = loadCard(json);
console.log(`✓ ${card.def.title} (${card.def.year}) — ${card.categories.length} categories, ${card.lines.length} lines, ${res.variantCount} concrete variants`);
for (const c of card.categories) {
  const lines = card.lines.filter((l) => l.category === c.id);
  console.log(`  ${c.name.padEnd(20)} ${String(lines.length).padStart(2)} lines  ${String(lines.reduce((a, l) => a + l.variants.length, 0)).padStart(4)} variants`);
}
console.log(`Source: ${card.def.source.kind}${card.def.source.official ? ' (marked official)' : ''} — ${card.def.source.attribution}`);
