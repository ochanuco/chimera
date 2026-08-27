import { Layout } from '../layout';
import { computeGraphLayout, THUMB_SIZE, NODE_PADDING, thumbnailSlotPosition } from '../graph-layout';

export interface GraphGenerationData {
  short_id: string;
  rating: 'good' | 'neutral' | 'bad' | null;
  bookmark: boolean;
}

export interface GraphNodeData {
  id: string;
  short_id: string;
  raw_instruction: string | null;
  status: string;
  created_at: string;
  generation_count: number;
  generations: GraphGenerationData[];
  thumbnail_generation_short_id: string | null;
  /** Direct (undirected) neighbor Batches excluded by the current scope; 0 when nothing around this node is hidden. */
  hidden_neighbor_count: number;
}

/** Picks the one Generation a Batch card represents: the designated thumbnail, else the first 'good' rating, else the first Generation. */
export function representativeGeneration(node: GraphNodeData): GraphGenerationData | null {
  if (node.generations.length === 0) return null;
  if (node.thumbnail_generation_short_id) {
    const designated = node.generations.find((g) => g.short_id === node.thumbnail_generation_short_id);
    if (designated) return designated;
  }
  const good = node.generations.find((g) => g.rating === 'good');
  if (good) return good;
  return node.generations[0]!;
}

export type GraphEdgeType = 'reference' | 'relation' | 'story';

export interface GraphEdgeData {
  type: GraphEdgeType;
  source_batch_id: string;
  target_batch_id: string;
  label: string;
  source_generation_short_id?: string;
  story_id?: string;
}

export interface GraphStoryOption {
  id: string;
  name: string;
}

/** Current scope selection: value is the <select> option value ("" / "active" / "all" / "story:<id>" / "root:<short_id>"); label is the human-readable text shown next to the selector. */
export interface GraphScope {
  value: string;
  label: string;
}

/**
 * Cubic bezier from a node's bottom edge down to another node's top edge.
 * Edges that skip layers (span >= 2) would run straight through the boxes of
 * intermediate layers, so they arc into the empty space right of the column
 * with a bulge that grows with the number of layers skipped.
 */
function edgePath(sx: number, sy: number, tx: number, ty: number, bulge: number): string {
  const pull = Math.max(Math.abs(ty - sy) / 3, 50);
  return `M ${sx} ${sy} C ${sx + bulge} ${sy + pull}, ${tx + bulge} ${ty - pull}, ${tx} ${ty}`;
}

export function GraphPage({
  nodes,
  edges,
  stories,
  scope,
  emptyMessage,
}: {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
  stories: GraphStoryOption[];
  scope: GraphScope;
  emptyMessage?: string;
}) {
  const scopeBar = (
    <div class="graph-scope-bar">
      <select id="graph-scope">
        <option value="" selected={scope.value === ''}>
          Recent
        </option>
        <option value="active" selected={scope.value === 'active'}>
          Active tree
        </option>
        <option value="all" selected={scope.value === 'all'}>
          All
        </option>
        {stories.length > 0 && (
          <optgroup label="── Stories ──">
            {stories.map((s) => (
              <option value={`story:${s.id}`} selected={scope.value === `story:${s.id}`}>
                {s.name}
              </option>
            ))}
          </optgroup>
        )}
        {scope.value.startsWith('root:') && (
          <option value={scope.value} selected>
            {scope.label}
          </option>
        )}
      </select>
      <span class="graph-scope-label">
        {scope.label} · {nodes.length} batches
      </span>
    </div>
  );

  if (nodes.length === 0) {
    return (
      <Layout title="Graph">
        <h1>Graph</h1>
        {scopeBar}
        <p class="empty-state">
          {emptyMessage ?? 'No batches yet. Once generations start, their provenance graph appears here.'}
        </p>
      </Layout>
    );
  }

  const layout = computeGraphLayout(
    nodes.map((n) => ({ id: n.id, createdAt: n.created_at })),
    edges.map((e) => ({ source: e.source_batch_id, target: e.target_batch_id })),
  );

  // Batch cards show one representative Generation thumbnail (slot 0); reference
  // edges anchor there only when they point at that exact Generation, otherwise
  // they fall back to the Batch frame.
  const representativeByBatch = new Map(nodes.map((n) => [n.id, representativeGeneration(n)]));

  return (
    <Layout title="Graph">
      <h1>Graph</h1>
      {scopeBar}
      <div class="graph-legend">
        <div class="legend-row">
          <span class="legend-swatch legend-reference"></span> Reference（材料）
        </div>
        <div class="legend-row">
          <span class="legend-swatch legend-relation"></span> Refinement（再試行）
        </div>
        <div class="legend-row">
          <span class="legend-swatch legend-story"></span> Story（続き）
        </div>
      </div>
      <div class="graph-stage">
        <div id="graph-zoom-controls" class="graph-zoom-controls">
          <button type="button" data-zoom="in" title="Zoom in">+</button>
          <button type="button" data-zoom="out" title="Zoom out">−</button>
          <button type="button" data-zoom="reset" title="Reset view">⌂</button>
        </div>
        <div class="graph-viewport">
        <svg
          id="graph-svg"
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          preserveAspectRatio="xMidYMid meet"
        >
          <g class="graph-edges">
            {(() => {
              // 同一 Batch ペア間の複数エッジ（reference と refinement が併存する等）が
              // 完全に同一パスへ重なりラベルも潰れるため、ペア内 index で横にずらす。
              const pairCounts = new Map<string, number>();
              for (const e of edges) {
                const key = `${e.source_batch_id}->${e.target_batch_id}`;
                pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
              }
              const pairSeen = new Map<string, number>();
              const targetSeen = new Map<string, number>();
              return edges.map((e) => {
                const s = layout.positions.get(e.source_batch_id);
                const t = layout.positions.get(e.target_batch_id);
                if (!s || !t) return null;
                const key = `${e.source_batch_id}->${e.target_batch_id}`;
                const count = pairCounts.get(key) ?? 1;
                const index = pairSeen.get(key) ?? 0;
                pairSeen.set(key, index + 1);
                const fan = (index - (count - 1) / 2) * 36;

                let sx: number;
                let sy: number;
                const sourceRep =
                  e.type === 'reference' ? representativeByBatch.get(e.source_batch_id) : undefined;
                if (sourceRep && sourceRep.short_id === e.source_generation_short_id) {
                  const slot = thumbnailSlotPosition(0);
                  sx = s.x + slot.x + THUMB_SIZE / 2 + fan;
                  sy = s.y + slot.y + THUMB_SIZE;
                } else {
                  sx = s.x + s.width / 2 + fan;
                  sy = s.y + s.height;
                }

                const tx = t.x + t.width / 2 + fan;
                const ty = t.y;
                const span = Math.abs(t.layer - s.layer);
                const bulge = span >= 2 ? 150 + 100 * (span - 2) + fan : 0;
                // ラベルは target 枠の直上に置く。target が違えば重ならず、同一
                // target へ入る複数エッジ（pair 違い含む）は到着順で縦にずらす。
                const labelIndex = targetSeen.get(e.target_batch_id) ?? 0;
                targetSeen.set(e.target_batch_id, labelIndex + 1);
                const labelY = ty - 12 - labelIndex * 20;
                return (
                  <g class={`graph-edge edge-${e.type}`}>
                    <path d={edgePath(sx, sy, tx, ty, bulge)} />
                    <text x={tx + 10} y={labelY} text-anchor="start">
                      {e.label}
                    </text>
                  </g>
                );
              });
            })()}
          </g>
          <g class="graph-nodes">
            {nodes.map((n) => {
              const pos = layout.positions.get(n.id);
              if (!pos) return null;
              const rep = representativeByBatch.get(n.id) ?? null;
              const thumbSlot = thumbnailSlotPosition(0);
              const thumbX = pos.x + thumbSlot.x;
              const thumbY = pos.y + thumbSlot.y;
              return (
                <g class="graph-batch" data-batch-short-id={n.short_id} data-batch-id={n.id}>
                  <rect x={pos.x} y={pos.y} width={pos.width} height={pos.height} rx="10" class="graph-node-card" />
                  <g class="graph-batch-header" data-batch-short-id={n.short_id} data-batch-id={n.id}>
                    <text x={pos.x + NODE_PADDING} y={pos.y + 18} class="graph-node-shortid">
                      {n.short_id}
                    </text>
                    <text
                      x={pos.x + pos.width - NODE_PADDING}
                      y={pos.y + 18}
                      text-anchor="end"
                      class="graph-node-status"
                    >
                      {n.status} · {n.generation_count}
                    </text>
                  </g>
                  {rep === null ? (
                    <rect x={thumbX} y={thumbY} width={THUMB_SIZE} height={THUMB_SIZE} class="graph-gen-empty" />
                  ) : (
                    <g
                      class={`graph-gen-thumb${rep.rating === 'good' ? ' rating-good' : ''}`}
                      data-gen-short-id={rep.short_id}
                      data-batch-short-id={n.short_id}
                    >
                      <rect x={thumbX} y={thumbY} width={THUMB_SIZE} height={THUMB_SIZE} class="graph-gen-ring" />
                      <image
                        href={`/g/${rep.short_id}/image`}
                        x={thumbX}
                        y={thumbY}
                        width={THUMB_SIZE}
                        height={THUMB_SIZE}
                        preserveAspectRatio="xMidYMid slice"
                      />
                    </g>
                  )}
                  {n.hidden_neighbor_count > 0 &&
                    (() => {
                      const stubSlot = thumbnailSlotPosition(2);
                      const stubX = pos.x + stubSlot.x;
                      const stubY = pos.y + stubSlot.y;
                      return (
                        <g class="graph-node-stub" data-batch-short-id={n.short_id}>
                          <rect x={stubX} y={stubY} width={THUMB_SIZE} height={THUMB_SIZE} rx="6" />
                          <text
                            x={stubX + THUMB_SIZE / 2}
                            y={stubY + THUMB_SIZE / 2}
                            text-anchor="middle"
                            dominant-baseline="central"
                          >
                            ⋯ +{n.hidden_neighbor_count}
                          </text>
                        </g>
                      );
                    })()}
                </g>
              );
            })}
          </g>
        </svg>
        </div>
      </div>
      <div id="compare-bar" class="compare-bar hidden">
        <span id="compare-count">Compare (0)</span>
        <a id="compare-link" class="compare-go" href="#">
          Compare
        </a>
      </div>
      <div id="graph-context-menu" class="graph-context-menu hidden" role="menu"></div>
    </Layout>
  );
}
