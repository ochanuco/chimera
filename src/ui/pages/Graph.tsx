import { Layout } from '../layout';
import { computeGraphLayout, NODE_WIDTH, NODE_HEIGHT } from '../graph-layout';

export interface GraphNodeData {
  id: string;
  short_id: string;
  raw_instruction: string | null;
  status: string;
  created_at: string;
  generation_count: number;
  thumbnail_generation_short_id: string | null;
}

export type GraphEdgeType = 'reference' | 'relation' | 'story';

export interface GraphEdgeData {
  type: GraphEdgeType;
  source_batch_id: string;
  target_batch_id: string;
  label: string;
}

const IMG_SIZE = 120;

/** Cubic bezier from a node's right edge to another node's left edge. */
function edgePath(sx: number, sy: number, tx: number, ty: number): string {
  const pull = Math.max(Math.abs(tx - sx) / 2, 50);
  return `M ${sx} ${sy} C ${sx + pull} ${sy}, ${tx - pull} ${ty}, ${tx} ${ty}`;
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
    nodes.map((n) => ({ id: n.id, createdAt: n.created_at })),
    edges.map((e) => ({ source: e.source_batch_id, target: e.target_batch_id })),
  );

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
            {edges.map((e) => {
              const s = layout.positions.get(e.source_batch_id);
              const t = layout.positions.get(e.target_batch_id);
              if (!s || !t) return null;
              const sx = s.x + NODE_WIDTH;
              const sy = s.y + NODE_HEIGHT / 2;
              const tx = t.x;
              const ty = t.y + NODE_HEIGHT / 2;
              const mx = (sx + tx) / 2;
              const my = (sy + ty) / 2;
              return (
                <g class={`graph-edge edge-${e.type}`}>
                  <path d={edgePath(sx, sy, tx, ty)} />
                  <text x={mx} y={my - 4} text-anchor="middle">
                    {e.label}
                  </text>
                </g>
              );
            })}
          </g>
          <g class="graph-nodes">
            {nodes.map((n) => {
              const pos = layout.positions.get(n.id);
              if (!pos) return null;
              const imgX = pos.x + (NODE_WIDTH - IMG_SIZE) / 2;
              const imgY = pos.y + 8;
              return (
                <a href={`/b/${n.short_id}`} class="graph-node">
                  <rect x={pos.x} y={pos.y} width={NODE_WIDTH} height={NODE_HEIGHT} rx="8" class="graph-node-card" />
                  {n.thumbnail_generation_short_id ? (
                    <image
                      href={`/g/${n.thumbnail_generation_short_id}/image`}
                      x={imgX}
                      y={imgY}
                      width={IMG_SIZE}
                      height={IMG_SIZE}
                      preserveAspectRatio="xMidYMid slice"
                    />
                  ) : (
                    <rect x={imgX} y={imgY} width={IMG_SIZE} height={IMG_SIZE} class="graph-node-noimg" />
                  )}
                  <text x={pos.x + NODE_WIDTH / 2} y={imgY + IMG_SIZE + 18} text-anchor="middle" class="graph-node-shortid">
                    {n.short_id}
                  </text>
                  <text x={pos.x + NODE_WIDTH / 2} y={imgY + IMG_SIZE + 34} text-anchor="middle" class="graph-node-status">
                    {n.status} · {n.generation_count}
                  </text>
                </a>
              );
            })}
          </g>
        </svg>
        </div>
      </div>
    </Layout>
  );
}
