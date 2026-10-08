import type { DeliverOutline, DeliverOutlines } from '../../lib/catalogs';
import { LIGHT_FROM_CHOICES } from './OptionControls';

/** Used when the recipe publishes no `deliver.outlines`: white inside, purple outside. */
export const FALLBACK_OUTLINES: DeliverOutlines = {
  default: [
    { color: '#ffffff', width: 0.4 },
    { color: '#885b80', width: 1.04 },
  ],
  maxCount: 6,
  maxWidth: 5,
};

export const OUTLINE_MIN_WIDTH = 0.2;
export const STROKE_DIRECTIONS = ['nw', 'n', 'ne', 'w', null, 'e', 'sw', 's', 'se'] as const;
const DIRECTION_LABELS = Object.fromEntries(LIGHT_FROM_CHOICES);

export function formatWidth(width: number): string {
  return String(Number(width.toFixed(2)));
}

/** A 3x3 direction picker; the centre cell is the figure. The chosen direction lives in `data-value`. */
export function Compass({ name, value, centreLabel = '人物' }: { name: string; value: string; centreLabel?: string }) {
  return (
    <div class="compass" data-compass={name} data-value={value}>
      {STROKE_DIRECTIONS.map((dir) =>
        dir === null ? (
          <span class="compass-centre">{centreLabel}</span>
        ) : (
          <button
            type="button"
            class={`wb-pill compass-btn${dir === value ? ' wb-pill-on' : ''}`}
            data-compass-dir={dir}
            aria-label={DIRECTION_LABELS[dir]}
            aria-pressed={dir === value ? 'true' : 'false'}
          >
            {dir}
          </button>
        ),
      )}
    </div>
  );
}

function OutlineRow({ outline, index, maxWidth }: { outline: DeliverOutline; index: number; maxWidth: number }) {
  return (
    <div class="outline-row" data-outline-row>
      <span class="outline-n">{index + 1}</span>
      <input type="color" class="outline-color" data-outline-color value={outline.color} aria-label="色" />
      <input
        type="range"
        class="outline-width"
        data-outline-width
        min={String(OUTLINE_MIN_WIDTH)}
        max={String(maxWidth)}
        step="0.02"
        value={String(outline.width)}
        aria-label="幅"
      />
      <span class="outline-pct" data-outline-pct>
        {formatWidth(outline.width)}%
      </span>
      <button type="button" class="icon-btn" data-outline-up aria-label="内側へ">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
          <path d="M6 15l6-6 6 6" />
        </svg>
      </button>
      <button type="button" class="icon-btn" data-outline-down aria-label="外側へ">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <button type="button" class="icon-btn" data-outline-remove aria-label="このフチを消す">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}

/** The outline list (inside → outside) plus the shading of the outermost one. Shared by the deliver form and the workbench. */
export function OutlineEditor({ outlines, stroke }: { outlines: DeliverOutlines | null; stroke: string }) {
  const spec = outlines ?? FALLBACK_OUTLINES;
  const dir = stroke !== 'even';
  return (
    <div
      class="outline-editor"
      data-outline-editor
      data-outline-default={JSON.stringify(spec.default)}
      data-outline-max-count={String(spec.maxCount)}
      data-outline-max-width={String(spec.maxWidth)}
      data-stroke-default={stroke}
    >
      <div class="outline-rows" data-outline-rows>
        {spec.default.map((outline, i) => (
          <OutlineRow outline={outline} index={i} maxWidth={spec.maxWidth} />
        ))}
      </div>
      <template data-outline-row-template>
        <OutlineRow outline={{ color: '#d9c6ee', width: 0.8 }} index={0} maxWidth={spec.maxWidth} />
      </template>
      <div class="outline-actions">
        <button type="button" class="wb-pill" data-outline-add>
          + 外側に足す
        </button>
        <button type="button" class="wb-pill" data-outline-reset>
          白・紫に戻す
        </button>
      </div>
      <div class="outline-stroke" data-outline-stroke data-value={stroke}>
        <span class="outline-stroke-label">一番外の陰影</span>
        <button type="button" class={`wb-pill${dir ? '' : ' wb-pill-on'}`} data-stroke-mode="even">
          均一
        </button>
        <button type="button" class={`wb-pill${dir ? ' wb-pill-on' : ''}`} data-stroke-mode="dir">
          光の向きで陰影
        </button>
        <div class="outline-stroke-compass" data-outline-stroke-compass hidden={!dir}>
          <Compass name="stroke" value={dir ? stroke : 'nw'} />
        </div>
      </div>
      <p class="outline-note">prompt で描いた白フチは、この内側に残ります。</p>
    </div>
  );
}
