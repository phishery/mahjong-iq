import { KINDS, KIND_INDEX, KIND_OF_ID, kindName } from '../../engine/tiles';
import { Tile, TileBack, TileStyleContext, type TileStyle } from '../Tile';

const flowerIds = Array.from({ length: KIND_OF_ID.length }, (_, i) => i).filter((id) => KIND_OF_ID[id] === KIND_INDEX.F);

/** Design review page (…/#tiles): every face, the eight Flowers and the back, in each style. */
export function TileSheet() {
  return (
    <div className="max-w-[1400px] mx-auto px-4 py-6 space-y-8" data-testid="tile-sheet">
      {(['painted', 'classic'] as TileStyle[]).map((style) => (
        <TileStyleContext.Provider key={style} value={style}>
          <section className="space-y-4">
            <h2 className="font-display text-2xl font-semibold capitalize">{style}</h2>
            <div className="flex flex-wrap gap-3">
              {KINDS.filter((k) => k !== 'F').map((k) => (
                <figure key={k} className="flex flex-col items-center gap-1">
                  <Tile kind={k} size="lg" />
                  <figcaption className="text-[10px] text-ink-faint">{kindName(k)}</figcaption>
                </figure>
              ))}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              {flowerIds.map((id, i) => (
                <figure key={id} className="flex flex-col items-center gap-1">
                  <Tile kind="F" id={id} size="lg" />
                  <figcaption className="text-[10px] text-ink-faint">Flower {i + 1}</figcaption>
                </figure>
              ))}
              <figure className="flex flex-col items-center gap-1 ml-6">
                <TileBack width={56} />
                <figcaption className="text-[10px] text-ink-faint">Back</figcaption>
              </figure>
              <figure className="flex flex-col items-center gap-1">
                <TileBack width={120} />
                <figcaption className="text-[10px] text-ink-faint">Back (large)</figcaption>
              </figure>
            </div>
            <div className="flex flex-wrap gap-1 items-end">
              {(['1D', '5B', '7C', 'E', 'RD', 'J'] as const).map((k) => (
                <Tile key={k} kind={k} size="xs" />
              ))}
              {(['1D', '5B', '7C', 'E', 'RD', 'J'] as const).map((k) => (
                <Tile key={`s${k}`} kind={k} size="sm" />
              ))}
              <span className="text-[10px] text-ink-faint ml-2">small sizes (discard floor)</span>
            </div>
          </section>
        </TileStyleContext.Provider>
      ))}
    </div>
  );
}
