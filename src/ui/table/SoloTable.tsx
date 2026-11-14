import type { LoadedCard } from '../../engine/card/schema';
import type { SeatIndex, TableState } from '../../engine/table';
import { Button } from '../components';
import { TableScreen } from './TableScreen';
import { useSoloTable } from './useSoloTable';

/** Play a hand in the browser against three computer players. */
export function SoloTable({
  card,
  initial,
  you,
  showLabels,
  fast,
  onReport,
  onNewRound,
}: {
  card: LoadedCard;
  initial: TableState;
  you: SeatIndex;
  showLabels: boolean;
  fast: boolean;
  onReport?: () => void;
  onNewRound: () => void;
}) {
  const t = useSoloTable(card, initial, you, fast ? 'fast' : 'normal');
  return (
    <TableScreen
      card={card}
      view={t.view}
      act={t.act}
      error={t.error}
      clearError={t.clearError}
      hint={t.hint}
      showLabels={showLabels}
      banner={
        <p className="text-xs text-ink-soft">
          Playing out your Charleston against three computer players. You sit {['East', 'South', 'West', 'North'][you]}; East discards first.
        </p>
      }
      endActions={
        <span className="flex flex-wrap gap-2">
          <Button onClick={onNewRound} data-testid="solo-new-round">
            New round →
          </Button>
          {onReport && (
            <Button variant="secondary" onClick={onReport}>
              Charleston report
            </Button>
          )}
        </span>
      }
    />
  );
}
