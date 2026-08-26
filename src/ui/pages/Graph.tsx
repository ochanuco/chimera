import { Layout } from '../layout';
import {
  computeGraphLayout,
  THUMB_SIZE,
  NODE_PADDING,
  thumbnailSlotPosition,
  MAX_VISIBLE_GENERATIONS,
} from '../graph-layout';

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
}

export type GraphEdgeType = 'reference' | 'relation' | 'story';

export interface GraphEdgeData {
  type: GraphEdgeType;
  source_batch_id: string;
  target_batch_id: string;
  label: string;
  source_generation_short_id?: string;
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

export function GraphPage({ nodes, edges }: { nodes: GraphNodeData[]; edges: GraphEdgeData[] }) {
  if (nodes.length === 0) {
    return (
      <Layout title="Graph">
        <h1>Graph</h1>
        <p class="empty-state">No batches yet. Once generations start, their provenance graph appears here.</p>
      </Layout>
    );
  }

  const layout = computeGraphLayout(
    nodes.map((n) => ({ id: n.id, createdAt: n.created_at, generationCount: n.generation_count })),
    edges.map((e) => ({ source: e.source_batch_id, target: e.target_batch_id })),
  );

  // Maps a Generation's short_id to where it renders on the graph, so reference
  // edges can anchor at the specific thumbnail instead of the whole Batch frame.
  // Index 8 (the 9th slot) is only a valid anchor when the Batch has <= 9
  // Generations -- otherwise that slot is visually replaced by a "+n" overflow
  // placeholder and isn't a real thumbnail to point at.
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const genLocation = new Map<string, { batchId: string; index: number }>();
  for (const node of nodes) {
    node.generations.forEach((g, index) => {
      genLocation.set(g.short_id, { batchId: node.id, index });
    });
  }

  return (
    <Layout title="Graph">
      <h1>Graph</h1>
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
                const sourceGenLoc =
                  e.type === 'reference' && e.source_generation_short_id
                    ? genLocation.get(e.source_generation_short_id)
                    : undefined;
                const sourceNode = sourceGenLoc ? nodeById.get(sourceGenLoc.batchId) : undefined;
                const lastVisibleIndex = MAX_VISIBLE_GENERATIONS - 1;
                if (
                  sourceGenLoc &&
                  sourceNode &&
                  (sourceGenLoc.index < lastVisibleIndex ||
                    (sourceGenLoc.index === lastVisibleIndex && sourceNode.generation_count <= MAX_VISIBLE_GENERATIONS))
                ) {
                  const slot = thumbnailSlotPosition(sourceGenLoc.index);
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
              const visibleCount = Math.min(n.generations.length, MAX_VISIBLE_GENERATIONS);
              const overflow = n.generation_count > MAX_VISIBLE_GENERATIONS;
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
                  {visibleCount === 0
                    ? (() => {
                        const slot = thumbnailSlotPosition(0);
                        return (
                          <rect
                            x={pos.x + slot.x}
                            y={pos.y + slot.y}
                            width={THUMB_SIZE}
                            height={THUMB_SIZE}
                            class="graph-gen-empty"
                          />
                        );
                      })()
                    : Array.from({ length: visibleCount }, (_, i) => {
                        const slot = thumbnailSlotPosition(i);
                        const x = pos.x + slot.x;
                        const y = pos.y + slot.y;
                        if (overflow && i === MAX_VISIBLE_GENERATIONS - 1) {
                          return (
                            <g class="graph-gen-more">
                              <rect x={x} y={y} width={THUMB_SIZE} height={THUMB_SIZE} class="graph-gen-more-rect" />
                              <text
                                x={x + THUMB_SIZE / 2}
                                y={y + THUMB_SIZE / 2}
                                text-anchor="middle"
                                dominant-baseline="central"
                              >
                                +{n.generation_count - (MAX_VISIBLE_GENERATIONS - 1)}
                              </text>
                            </g>
                          );
                        }
                        const g = n.generations[i]!;
                        const ratingClass = g.rating === 'good' ? ' rating-good' : '';
                        return (
                          <g
                            class={`graph-gen-thumb${ratingClass}`}
                            data-gen-short-id={g.short_id}
                            data-batch-short-id={n.short_id}
                          >
                            <rect x={x} y={y} width={THUMB_SIZE} height={THUMB_SIZE} class="graph-gen-ring" />
                            <image
                              href={`/g/${g.short_id}/image`}
                              x={x}
                              y={y}
                              width={THUMB_SIZE}
                              height={THUMB_SIZE}
                              preserveAspectRatio="xMidYMid slice"
                            />
                          </g>
                        );
                      })}
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
