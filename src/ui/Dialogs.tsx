import type { LoadedCard } from '../engine/card/schema';
import { LENGTH_INFO, MODE_INFO, type Mode, type RoundLength } from '../engine/game';
import { OPPONENT_PROFILES, type OpponentProfile } from '../engine/opponents';
import type { ProgressData } from '../engine/progress';
import { describeSimModel } from '../engine/simulate';
import { Button, Chip, Modal, Segmented, Toggle } from './components';
import { simSettingsFrom, type Settings } from './lib';

export function SettingsDialog({ open, onClose, settings, setSettings }: { open: boolean; onClose: () => void; settings: Settings; setSettings: (s: Settings) => void }) {
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setSettings({ ...settings, [k]: v });
  return (
    <Modal open={open} onClose={onClose} title="Settings">
      <div className="space-y-5">
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint mb-2">Opponents</h3>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(OPPONENT_PROFILES) as OpponentProfile[]).map((p) => (
              <Chip key={p} active={settings.opponents === p} onClick={() => set('opponents', p)}>
                {OPPONENT_PROFILES[p].name}
              </Chip>
            ))}
          </div>
          <p className="text-xs text-ink-faint mt-1.5">{OPPONENT_PROFILES[settings.opponents].description}</p>
          <Toggle checked={settings.courtesy} onChange={(v) => set('courtesy', v)} label="Courtesy pass" hint="Offer the optional courtesy pass after a full Charleston." />
        </section>
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint mb-1">Probability engine</h3>
          <Toggle checked={settings.simulation} onChange={(v) => set('simulation', v)} label="Monte Carlo simulation" hint="Runs in a background worker. Off = grading uses the heuristic opportunity score." />
          {settings.simulation && (
            <div className="space-y-3 mt-1">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm">Precision</span>
                <Segmented value={settings.simPrecision} onChange={(v) => set('simPrecision', v)} options={[{ value: 'fast', label: '1,000 walls' }, { value: 'precise', label: '4,000 walls' }]} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm">Model</span>
                <Segmented value={settings.simModel} onChange={(v) => set('simModel', v)} options={[{ value: 'calls', label: 'Draws + calls' }, { value: 'draws', label: 'Draws only' }]} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm">Horizon</span>
                <Segmented value={String(settings.horizon) as '20'} onChange={(v) => set('horizon', Number(v))} options={[{ value: '12', label: '12 turns' }, { value: '20', label: '20 turns' }, { value: '24', label: '24 turns' }]} />
              </div>
              <p className="text-[11px] text-ink-faint leading-snug">{describeSimModel(simSettingsFrom(settings, 0)).replace(', seed 0', '')}</p>
            </div>
          )}
        </section>
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint mb-1">Display</h3>
          <div className="flex items-center justify-between gap-3 py-2">
            <span className="text-sm font-medium">Animations</span>
            <Segmented value={settings.animations} onChange={(v) => set('animations', v)} options={[{ value: 'normal', label: 'Normal' }, { value: 'fast', label: 'Fast' }, { value: 'off', label: 'Off' }]} />
          </div>
          <Toggle checked={settings.tileLabels} onChange={(v) => set('tileLabels', v)} label="Tile labels" hint="Show names under tiles (e.g. “5 Dot”)." />
          <Toggle checked={settings.confidence} onChange={(v) => set('confidence', v)} label="Confidence training" hint="Rate your confidence in your #1 choice; compare with results over time." />
          <Toggle checked={settings.trackProgress} onChange={(v) => set('trackProgress', v)} label="Track progress locally" hint="Stored only in this browser. Powers spaced repetition." />
        </section>
      </div>
    </Modal>
  );
}

export function ProgressDialog({ open, onClose, progress, card, onReset }: { open: boolean; onClose: () => void; progress: ProgressData; card: LoadedCard; onReset: () => void }) {
  const cats = card.categories.map((c) => ({ c, s: progress.categories[c.id] }));
  const modes = Object.entries(progress.byMode);
  const conf = progress.confidence;
  const confBy = [1, 2, 3].map((lvl) => {
    const xs = conf.filter((x) => x.stated === lvl);
    return { lvl, n: xs.length, avg: xs.length ? xs.reduce((a, b) => a + b.credit, 0) / xs.length : 0 };
  });
  return (
    <Modal open={open} onClose={onClose} title="Your progress" wide>
      {progress.rounds === 0 ? (
        <p className="text-ink-soft">No rounds yet.</p>
      ) : (
        <div className="space-y-6 text-sm">
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint mb-2">Personal bests (per mode — not comparable across modes)</h3>
            <div className="grid sm:grid-cols-2 gap-2">
              {modes.map(([k, m]) => {
                const [mode, length] = k.split('/') as [Mode, RoundLength];
                return (
                  <div key={k} className="rounded-xl bg-paper px-3 py-2 flex justify-between">
                    <span>
                      {MODE_INFO[mode]?.name} · {LENGTH_INFO[length]?.name}
                    </span>
                    <span className="text-ink-soft">
                      best <strong className="text-ink">{m.best}</strong> · avg {(m.total / m.rounds).toFixed(0)} · {m.rounds} rounds
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint mb-2">Category recognition</h3>
            <table className="w-full">
              <thead>
                <tr className="text-xs text-ink-faint text-left">
                  <th className="font-medium py-1">Category</th>
                  <th className="font-medium">Was strongest</th>
                  <th className="font-medium">You ranked it #1</th>
                  <th className="font-medium">In your top 3</th>
                  <th className="font-medium">Practice priority</th>
                </tr>
              </thead>
              <tbody>
                {cats.map(({ c, s }) => (
                  <tr key={c.id} className="border-t border-line">
                    <td className="py-1.5 font-medium">{c.name}</td>
                    <td>{s?.wasBest ?? 0}</td>
                    <td>{s && s.wasBest ? `${Math.round((100 * s.recognizedFirst) / s.wasBest)}%` : '—'}</td>
                    <td>{s && s.wasBest ? `${Math.round((100 * s.recognizedTop3) / s.wasBest)}%` : '—'}</td>
                    <td>{'●'.repeat(6 - (s?.box ?? 3))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="grid sm:grid-cols-3 gap-3">
            <Stat label="Primary choice outside engine top 3" value={progress.decisions ? `${Math.round((100 * progress.misplacedPrimary) / progress.decisions)}%` : '—'} />
            <Stat label="Average pass quality (recent)" value={progress.passCredits.length ? `${Math.round((100 * progress.passCredits.slice(-20).reduce((a, b) => a + b, 0)) / Math.min(20, progress.passCredits.length))}` : '—'} />
            <Stat label="Justified pivots taken" value={progress.pivots.opportunities ? `${progress.pivots.taken}/${progress.pivots.opportunities}` : '—'} />
          </section>
          {conf.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint mb-2">Confidence vs performance</h3>
              <div className="flex gap-3">
                {confBy.map((c) => (
                  <div key={c.lvl} className="rounded-xl bg-paper px-3 py-2 flex-1">
                    <div className="text-xs text-ink-faint">{['', 'Unsure', 'Fairly sure', 'Confident'][c.lvl]}</div>
                    <div className="font-semibold">{c.n ? `${Math.round(c.avg * 100)} avg credit` : '—'}</div>
                    <div className="text-[11px] text-ink-faint">{c.n} decisions</div>
                  </div>
                ))}
              </div>
            </section>
          )}
          <Button variant="danger" size="sm" onClick={onReset}>
            Reset all progress
          </Button>
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-paper px-3 py-2">
      <div className="text-xs text-ink-faint">{label}</div>
      <div className="font-display text-2xl font-semibold">{value}</div>
    </div>
  );
}
