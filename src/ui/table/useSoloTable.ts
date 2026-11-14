import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LoadedCard } from '../../engine/card/schema';
import { applyAction, nextBotMove, suggestDiscard, TableError, viewFor, type SeatIndex, type TableAction, type TableState } from '../../engine/table';

/**
 * Drives a table entirely in the browser: the person plays one seat and bots play the rest,
 * with a short pause before each bot move so the play can be followed.
 */
export function useSoloTable(card: LoadedCard, initial: TableState, you: SeatIndex, pace: 'normal' | 'fast' = 'normal') {
  const [state, setState] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(state);
  latest.current = state;

  useEffect(() => {
    setState(initial);
    setError(null);
  }, [initial]);

  useEffect(() => {
    if (state.phase.name === 'ended') return;
    const move = nextBotMove(card, state);
    if (!move) return;
    const base = pace === 'fast' ? 150 : 650;
    const delay = state.phase.name === 'calls' || state.phase.name === 'charleston' ? base / 2 : base;
    const t = setTimeout(() => setState((s) => (s === state ? applyAction(card, s, move.seat, move.action) : s)), delay);
    return () => clearTimeout(t);
  }, [card, state, pace]);

  const act = useCallback(
    (a: TableAction) => {
      try {
        const next = applyAction(card, latest.current, you, a);
        latest.current = next;
        setState(next);
        setError(null);
      } catch (e) {
        if (e instanceof TableError) setError(e.message);
        else throw e;
      }
    },
    [card, you],
  );

  const view = useMemo(() => viewFor(card, state, you), [card, state, you]);
  const hint = useCallback(() => suggestDiscard(card, state, you), [card, state, you]);
  return { state, view, act, error, clearError: () => setError(null), hint };
}
