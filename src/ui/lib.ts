/**
 * UI-side services: settings and progress persistence (localStorage, failure-tolerant),
 * and the simulation worker client (cached, stale-safe).
 */

import type { SimInput, SimResult, SimSettings } from '../engine/simulate';
import { DEFAULT_SIM } from '../engine/simulate';
import { emptyProgress, type ProgressData } from '../engine/progress';
import type { OpponentProfile } from '../engine/opponents';
import type { Mode, RoundLength } from '../engine/game';

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode) — keep working in memory */
  }
}

export interface Settings {
  mode: Mode;
  length: RoundLength;
  opponents: OpponentProfile;
  courtesy: boolean;
  simulation: boolean;
  simPrecision: 'fast' | 'precise';
  simModel: 'calls' | 'draws';
  horizon: number;
  animations: 'normal' | 'fast' | 'off';
  tileLabels: boolean;
  highlightSelected: boolean;
  confidence: boolean;
  trackProgress: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  mode: 'hybrid',
  length: 'first',
  opponents: 'competent',
  courtesy: true,
  simulation: true,
  simPrecision: 'fast',
  simModel: 'calls',
  horizon: DEFAULT_SIM.draws,
  animations: 'normal',
  tileLabels: false,
  highlightSelected: true,
  confidence: false,
  trackProgress: true,
};

const SETTINGS_KEY = 'mahjong-iq:settings:v1';
const PROGRESS_KEY = 'mahjong-iq:progress:v1';
const CARD_KEY = 'mahjong-iq:custom-card:v1';

export const loadSettings = () => read<Settings>(SETTINGS_KEY, DEFAULT_SETTINGS);
export const saveSettings = (s: Settings) => write(SETTINGS_KEY, s);
export const loadProgress = () => read<ProgressData>(PROGRESS_KEY, emptyProgress());
export const saveProgress = (p: ProgressData) => write(PROGRESS_KEY, p);
export function resetProgress() {
  try {
    localStorage.removeItem(PROGRESS_KEY);
  } catch {
    /* ignore */
  }
}
export function loadCustomCard(): unknown | null {
  try {
    const raw = localStorage.getItem(CARD_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
export function saveCustomCard(json: unknown | null) {
  try {
    if (json === null) localStorage.removeItem(CARD_KEY);
    else localStorage.setItem(CARD_KEY, JSON.stringify(json));
  } catch {
    /* ignore */
  }
}

export function simSettingsFrom(s: Settings, seed: number): SimSettings {
  return { draws: s.horizon, trials: s.simPrecision === 'precise' ? 4000 : 1000, seed, model: s.simModel };
}

// ---------------------------------------------------------------------------
// Simulation worker client
// ---------------------------------------------------------------------------

type Pending = { resolve: (r: SimResult[]) => void; reject: (e: Error) => void };

export class SimClient {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private cache = new Map<string, SimResult>();
  private cardId = '';

  constructor(cardJson: unknown, cardId: string) {
    this.setCard(cardJson, cardId);
  }

  setCard(cardJson: unknown, cardId: string) {
    this.cardId = cardId;
    this.cache.clear();
    try {
      this.worker?.terminate();
      this.worker = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => {
        const msg = e.data;
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.type === 'result') p.resolve(msg.results);
        else if (msg.type === 'error') p.reject(new Error(msg.message));
      };
      this.worker.postMessage({ type: 'init', cardJson });
    } catch {
      this.worker = null; // workers unavailable: simulation disabled, heuristic still works
    }
  }

  get available() {
    return !!this.worker;
  }

  private keyFor(input: SimInput, targetKey: string) {
    return [this.cardId, input.rack.join(''), input.knownElsewhere.join(''), input.draws, input.trials, input.seed, input.model, targetKey].join('|');
  }

  /** Run (or fetch from cache) simulations for the given targets. */
  async run(input: SimInput): Promise<SimResult[]> {
    const cached: SimResult[] = [];
    const missing = input.targets.filter((t) => {
      const hit = this.cache.get(this.keyFor(input, t.key));
      if (hit) cached.push(hit);
      return !hit;
    });
    if (!missing.length) return cached;
    if (!this.worker) throw new Error('Simulation worker unavailable');
    const id = ++this.seq;
    const results = await new Promise<SimResult[]>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ type: 'simulate', id, input: { ...input, targets: missing } });
    });
    for (const r of results) this.cache.set(this.keyFor(input, r.key), r);
    if (this.cache.size > 5000) this.cache.clear();
    return [...cached, ...results];
  }
}
