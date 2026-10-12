import { useEffect, useMemo, useRef, useState } from 'react';
import { validateCard } from '../engine/card/parser';
import type { HandVariant, LoadedCard } from '../engine/card/schema';
import { matchVariant } from '../engine/evaluator';
import { Button, Chip, cx, Drawer, PatternText, VariantTiles } from './components';
import { fetchUnlockedCard } from './lib';

export function CardReference({
  open,
  onClose,
  card,
  rack,
  onFocus,
  onImport,
  onResetCard,
  customActive,
  revealCounts,
  initialTab = 'card',
}: {
  open: boolean;
  onClose: () => void;
  card: LoadedCard;
  rack: number[] | null;
  onFocus: (v: HandVariant | null) => void;
  onImport: (json: unknown) => void;
  onResetCard: () => void;
  customActive: boolean;
  /** Show per-line "tiles held" counts (hidden while the player is ranking, to avoid giving answers away). */
  revealCounts: boolean;
  /** Tab shown each time the drawer opens. */
  initialTab?: 'card' | 'source';
}) {
  const [cat, setCat] = useState<string>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [tab, setTab] = useState<'card' | 'guide' | 'source'>('card');
  const [importMsg, setImportMsg] = useState<{ ok: boolean; lines: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [passcode, setPasscode] = useState('');
  const [unlocking, setUnlocking] = useState(false);

  useEffect(() => {
    if (open) setTab(initialTab);
  }, [open, initialTab]);

  const lines = useMemo(() => card.lines.filter((l) => cat === 'all' || l.category === cat), [card, cat]);
  const variantCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of card.variants) m.set(v.categoryId, (m.get(v.categoryId) ?? 0) + 1);
    return m;
  }, [card]);

  const applyCard = (json: { title?: string }) => {
    const res = validateCard(json);
    if (!res.ok) {
      setImportMsg({ ok: false, lines: res.errors.slice(0, 12) });
      return;
    }
    onImport(json);
    setImportMsg({ ok: true, lines: [`Loaded "${json.title}" (${res.variantCount} hand variations).`, ...res.warnings] });
  };

  const handleFile = async (f: File) => {
    try {
      applyCard(JSON.parse(await f.text()));
    } catch (e) {
      setImportMsg({ ok: false, lines: [`Could not read file: ${(e as Error).message}`] });
    }
  };

  const handleUnlock = async () => {
    if (!passcode.trim()) return;
    setUnlocking(true);
    try {
      applyCard((await fetchUnlockedCard(passcode)) as { title?: string });
      setPasscode('');
    } catch (e) {
      setImportMsg({ ok: false, lines: [(e as Error).message] });
    } finally {
      setUnlocking(false);
    }
  };

  return (
    <Drawer open={open} onClose={onClose} title={<span>Card reference</span>}>
      <div className={cx('px-5 py-3 text-xs border-b', card.def.source.official ? 'bg-jade-50 border-jade-100' : 'bg-[#fbf3e1] border-[#ecd9a6]')} data-testid="card-source">
        <span className="font-semibold">{card.def.title}</span> · {card.def.year} ·{' '}
        <span className={card.def.source.official ? 'text-jade-700' : 'text-[#7a5a14]'}>
          {card.def.source.kind === 'demo' ? 'Fictional demo card' : card.def.source.kind === 'licensed' ? 'Licensed card (user-supplied)' : 'User-supplied card'}
        </span>
        <p className="mt-0.5 text-ink-soft">{card.def.source.attribution}</p>
      </div>
      <div className="px-5 pt-3 flex gap-2">
        {(['card', 'guide', 'source'] as const).map((t) => (
          <Chip key={t} active={tab === t} onClick={() => setTab(t)}>
            {t === 'card' ? 'Hands' : t === 'guide' ? 'How hands work' : 'Load a card'}
          </Chip>
        ))}
      </div>

      {tab === 'card' && (
        <div className="p-5 pt-3">
          <div className="flex flex-wrap gap-1.5 mb-3">
            <Chip active={cat === 'all'} onClick={() => setCat('all')} className="h-7 text-xs">
              All
            </Chip>
            {card.categories.map((c) => (
              <Chip key={c.id} active={cat === c.id} onClick={() => setCat(c.id)} className="h-7 text-xs">
                {c.name}
              </Chip>
            ))}
          </div>
          {cat !== 'all' && (
            <p className="text-sm text-ink-soft mb-3">
              {card.categoryById.get(cat)?.description}{' '}
              <span className="text-ink-faint">({variantCounts.get(cat)} legal variations across {lines.length} lines — more variations means more ways in, but not necessarily an easier hand.)</span>
            </p>
          )}
          <ul className="space-y-2">
            {lines.map((l) => {
              const isOpen = expanded === l.id;
              const best = rack && revealCounts
                ? l.variants.reduce((b, v) => {
                    const m = matchVariant(rack, v);
                    return m.naturals + m.jokersUsed > b ? m.naturals + m.jokersUsed : b;
                  }, 0)
                : null;
              return (
                <li key={l.id} className="rounded-xl bg-white border border-line">
                  <button type="button" className="w-full text-left px-3 py-2.5" onClick={() => setExpanded(isOpen ? null : l.id)} data-testid={`ref-line-${l.id}`}>
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-ink-faint">
                        {l.categoryName} #{l.line} · {l.concealed ? 'Concealed (C)' : 'Exposed (X)'}
                        {l.value ? ` · ${l.value} pts` : ''}
                      </span>
                      <span className="text-[11px] text-ink-faint">
                        {l.variants.length} var.{best !== null && <> · you hold up to <strong className="text-ink">{best}</strong>/14</>}
                      </span>
                    </span>
                    <PatternText line={l} className="block text-[15px] mt-1" />
                    <span className="block text-xs text-ink-soft mt-0.5">{l.description}</span>
                  </button>
                  {isOpen && (
                    <div className="border-t border-line px-3 py-2 max-h-80 overflow-y-auto scrollbar-thin">
                      <p className="text-[11px] text-ink-faint mb-2">Every legal variation. Faded tiles are ones you don’t hold; Jokers fill groups of 3+ where you have them. Tap one to highlight it in your rack.</p>
                      <ul className="space-y-1.5">
                        {l.variants.map((v) => (
                          <li key={v.id}>
                            <button
                              type="button"
                              onClick={() => {
                                const next = focusId === v.id ? null : v.id;
                                setFocusId(next);
                                onFocus(next ? v : null);
                              }}
                              className={cx('w-full text-left rounded-lg px-2 py-1.5', focusId === v.id ? 'bg-jade-50 ring-1 ring-jade-300' : 'hover:bg-paper')}
                            >
                              <span className="block text-[11px] text-ink-faint mb-0.5">{v.configLabel}</span>
                              <VariantTiles variant={v} rack={rack ?? undefined} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {tab === 'guide' && (
        <div className="p-5 pt-3 text-sm text-ink-soft space-y-3 leading-relaxed">
          <p><strong className="text-ink">Every hand is exactly 14 tiles</strong> built from groups:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong className="text-ink">Single</strong> (1) and <strong className="text-ink">pair</strong> (2) — must be the exact tiles. Jokers can never be used.</li>
            <li><strong className="text-ink">Pung</strong> (3), <strong className="text-ink">kong</strong> (4), <strong className="text-ink">quint</strong> (5) — Jokers may replace any tile. A quint of a number always needs a Joker (only 4 copies exist).</li>
          </ul>
          <p><strong className="text-ink">Colours</strong> on the card mean “different suits”, not specific suits: <span className="text-bam font-semibold">green</span>, <span className="text-crak font-semibold">red</span> and <span className="text-dot font-semibold">blue</span> groups must each be a different suit (Bam, Crak or Dot).</p>
          <p><strong className="text-ink">D</strong> means a dragon matching its group’s suit: Green with Bams, Red with Craks, White (Soap) with Dots. <strong className="text-ink">0</strong> is the White Dragon used as a zero in year hands.</p>
          <p><strong className="text-ink">Consecutive</strong> hands can start on any number that keeps the run within 1–9 — one card line can stand for dozens of exact hands.</p>
          <p><strong className="text-ink">Exposed (X)</strong> hands let you call discards to complete pungs and kongs. <strong className="text-ink">Concealed (C)</strong> hands must be drawn yourself (except the final tile for Mahjong).</p>
          <p className="text-xs text-ink-faint">Rules follow standard NMJL practice; see docs/RULES.md in the project for the full list of assumptions.</p>
        </div>
      )}

      {tab === 'source' && (
        <div className="p-5 pt-3 text-sm text-ink-soft space-y-3">
          <p>
            Mahjong IQ ships with a <strong className="text-ink">fictional demo card</strong>. The official NMJL card is copyrighted, so it isn’t bundled. If you own a card,
            you can enter it as JSON (see <code className="text-xs bg-paper px-1 rounded">docs/CARD_FORMAT.md</code>) and load it here. Cards are validated before use and stored only in this browser.
          </p>
          <form
            className="rounded-xl border border-line bg-white p-3 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void handleUnlock();
            }}
          >
            <p className="font-semibold text-ink">Have a passcode?</p>
            <p className="text-xs">Unlock the card the site owner has set up. It’s then saved in this browser.</p>
            <div className="flex gap-2">
              <input
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                inputMode="numeric"
                autoComplete="off"
                placeholder="Passcode"
                aria-label="Card passcode"
                data-testid="unlock-passcode"
                className="flex-1 min-w-0 h-10 rounded-xl border border-line px-3 text-sm bg-white"
              />
              <Button type="submit" disabled={unlocking || !passcode.trim()} data-testid="unlock-submit">
                {unlocking ? 'Unlocking…' : 'Unlock card'}
              </Button>
            </div>
          </form>
          <p className="text-xs">Or load a card file you’ve entered yourself:</p>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
          <div className="flex gap-2 flex-wrap">
            <Button variant="secondary" onClick={() => fileRef.current?.click()}>
              Import card JSON…
            </Button>
            {customActive && (
              <Button variant="ghost" onClick={onResetCard}>
                Revert to demo card
              </Button>
            )}
          </div>
          {importMsg && (
            <div className={cx('rounded-xl px-3 py-2 text-xs', importMsg.ok ? 'bg-jade-50 text-jade-800' : 'bg-red-50 text-[#8f2d22]')}>
              {importMsg.lines.map((l, i) => (
                <p key={i}>{l}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
