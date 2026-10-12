import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  attachSim,
  buildCandidates,
  chooseBasis,
  simTargets,
  withSelections,
  type DecisionAnalysis,
  type Selection,
} from '../engine/analysis';
import type { LoadedCard } from '../engine/card/schema';
import {
  currentLevel,
  playerKnowledge,
  requestCourtesy,
  startRound,
  submitCourtesy,
  submitPass,
  submitRanking,
  voteSecondCharleston,
  type RoundConfig,
  type RoundState,
} from '../engine/game';
import { recordRound, type ProgressData } from '../engine/progress';
import { mixSeed } from '../engine/rng';
import { gradeRanking } from '../engine/scoring';
import type { SimResult } from '../engine/simulate';
import type { TileId } from '../engine/tiles';
import { simSettingsFrom, type Settings, type SimClient } from './lib';

export type SimStatus = 'off' | 'running' | 'ready' | 'error';

export interface Animation {
  outgoing: TileId[];
  direction: 'right' | 'across' | 'left';
}

const ANIM_MS: Record<Settings['animations'], number> = { normal: 520, fast: 220, off: 0 };

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

export function useGame(
  card: LoadedCard,
  sim: SimClient | null,
  settings: Settings,
  onProgress: (fn: (p: ProgressData) => ProgressData) => void,
) {
  const [round, setRound] = useState<RoundState | null>(null);
  const [analysis, setAnalysis] = useState<DecisionAnalysis | null>(null);
  const [simStatus, setSimStatus] = useState<SimStatus>('off');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [anim, setAnim] = useState<Animation | null>(null);
  const [incoming, setIncoming] = useState<TileId[]>([]);
  const decisionStart = useRef(Date.now());
  const decisionKey = useRef('');
  const simPromise = useRef<Promise<SimResult[] | null> | null>(null);
  const recorded = useRef<string>('');

  const simEnabled = settings.simulation && !!sim?.available;

  const start = useCallback(
    (config: RoundConfig) => {
      setError(null);
      setIncoming([]);
      setAnim(null);
      setRound(startRound(card, config));
    },
    [card],
  );

  const quit = useCallback(() => {
    setRound(null);
    setAnalysis(null);
  }, []);

  // New decision point → heuristic analysis immediately, simulation in the background.
  useEffect(() => {
    if (!round || round.phase !== 'rank') return;
    const know = playerKnowledge(round);
    const key = `${round.config.seed}|${round.decisions.length}|${know.rack.join('')}`;
    if (decisionKey.current === key) return;
    decisionKey.current = key;
    decisionStart.current = Date.now();
    const an = buildCandidates(card, know, currentLevel(round));
    setAnalysis(an);
    if (!simEnabled || !sim) {
      setSimStatus('off');
      simPromise.current = null;
      return;
    }
    setSimStatus('running');
    const input = {
      ...simSettingsFrom(settings, mixSeed(round.config.seed, 9000 + round.decisions.length)),
      rack: know.rack,
      knownElsewhere: know.knownElsewhere,
      targets: simTargets(card, an),
    };
    const p = sim.run(input).catch(() => null);
    simPromise.current = p;
    p.then((results) => {
      if (decisionKey.current !== key) return; // stale: rack changed meanwhile
      if (!results) {
        setSimStatus('error');
        return;
      }
      setAnalysis((cur) => (cur ? attachSim(cur, results) : cur));
      setSimStatus('ready');
    });
  }, [round, card, sim, simEnabled, settings]);

  // Record progress once per finished round.
  useEffect(() => {
    if (!round || round.phase !== 'done' || !settings.trackProgress) return;
    const id = `${round.config.seed}|${round.startedAt}`;
    if (recorded.current === id) return;
    recorded.current = id;
    onProgress((p) => recordRound(p, card, round));
  }, [round, card, onProgress, settings.trackProgress]);

  const rank = useCallback(
    async (picks: Selection[], confidence?: number) => {
      if (!round || !analysis || submitting) return;
      setSubmitting(true);
      setError(null);
      try {
        const know = playerKnowledge(round);
        let an = withSelections(card, know, analysis, picks);
        if (simEnabled && sim) {
          const base = simPromise.current ? await withTimeout(simPromise.current, 8000) : null;
          if (base) an = attachSim(an, base);
          // Variant picks outside the shortlist need their own simulation (same seed → comparable).
          const missing = an.candidates.filter((c) => !c.sim);
          if (missing.length) {
            const input = {
              ...simSettingsFrom(settings, mixSeed(round.config.seed, 9000 + round.decisions.length)),
              rack: know.rack,
              knownElsewhere: know.knownElsewhere,
              targets: simTargets(card, { ...an, candidates: missing }),
            };
            const extra = await withTimeout(sim.run(input).catch(() => null), 8000);
            if (extra) an = attachSim(an, extra);
          }
        }
        const basis = chooseBasis(an);
        const grade = gradeRanking(an, picks, basis);
        const next = submitRanking(round, picks, an, grade, {
          confidence,
          ms: Date.now() - decisionStart.current,
        });
        setRound(next);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setSubmitting(false);
      }
    },
    [round, analysis, submitting, card, sim, simEnabled, settings],
  );

  const animate = useCallback(
    (outgoing: TileId[], direction: Animation['direction'], apply: () => RoundState) => {
      const ms = ANIM_MS[settings.animations];
      let next: RoundState;
      try {
        next = apply();
      } catch (e) {
        setError((e as Error).message);
        return;
      }
      setError(null);
      if (ms === 0) {
        setRound(next);
        setIncoming(next.lastReceived);
        return;
      }
      setAnim({ outgoing, direction });
      setTimeout(() => {
        setAnim(null);
        setRound(next);
        setIncoming(next.lastReceived);
      }, ms);
    },
    [settings.animations],
  );

  const pass = useCallback(
    (tiles: TileId[], blind: number) => {
      if (!round || anim) return;
      const step = round.schedule[round.stepIndex];
      animate(tiles, step.direction, () => submitPass(card, round, tiles, blind));
    },
    [round, anim, animate, card],
  );

  const vote = useCallback(
    (cont: boolean) => {
      if (!round) return;
      setRound(voteSecondCharleston(card, round, cont));
    },
    [round, card],
  );

  const courtesyAsk = useCallback(
    (n: number) => {
      if (!round) return;
      setRound(requestCourtesy(card, round, n));
    },
    [round, card],
  );

  const courtesyPass = useCallback(
    (tiles: TileId[]) => {
      if (!round || anim) return;
      animate(tiles, 'across', () => submitCourtesy(card, round, tiles));
    },
    [round, anim, animate, card],
  );

  const lastDecision = round?.decisions[round.decisions.length - 1] ?? null;
  const reviewing = !!round && round.phase !== 'rank' && !!lastDecision;

  return useMemo(
    () => ({
      round,
      analysis,
      simStatus,
      simEnabled,
      submitting,
      error,
      setError,
      anim,
      incoming,
      reviewing,
      lastDecision,
      start,
      quit,
      rank,
      pass,
      vote,
      courtesyAsk,
      courtesyPass,
    }),
    [round, analysis, simStatus, simEnabled, submitting, error, anim, incoming, reviewing, lastDecision, start, quit, rank, pass, vote, courtesyAsk, courtesyPass],
  );
}

export type GameApi = ReturnType<typeof useGame>;
