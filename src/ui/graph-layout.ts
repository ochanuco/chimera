// Layered DAG layout for the Graph View (docs/ui.md "Graph View" section).
//
// Layer assignment: layer(node) = longest path length from any zero-indegree
// root, computed over the combined batch->batch graph (all three Relation
// Separation edge kinds together, see docs/domain-model.md). Real generation
// history can contain cycles (e.g. a StoryRelation looping back to an earlier
// Batch), so a plain longest-path recursion would not terminate. We instead:
//
//   1. DFS the graph with a visited-state guard to find "back edges" (edges
//      that point at a node currently on the recursion stack) -- the classic
//      technique for turning any directed graph into a DAG by removing the
//      minimal set of edges that create cycles.
//   2. Drop only those back edges from layering (they are still returned to
//      the caller for drawing -- layout never hides an edge).
//   3. Run Kahn's algorithm over the remaining (guaranteed acyclic) graph,
//      propagating layer(v) = max(layer(v), layer(u) + 1) along edges u->v.
//
// Isolated nodes (no edges at all) default to layer 0, same as any other
// zero-indegree root.
//
// Node sizing: each node is a Batch group frame showing one representative
// Generation thumbnail plus, when neighbors are hidden by the current scope,
// a drill-down stub (docs/ui.md) -- both fit in a single thumbnail row, so
// node height is fixed. The thumbnail grid geometry (3 columns) is kept for
// slot positioning even though only slots 0 and 2 are ever drawn.
export interface LayoutEdgeInput {
  source: string;
  target: string;
}

export interface LayoutNodeInput {
  id: string;
  createdAt: string;
}

export interface NodePosition {
  id: string;
  layer: number;
  order: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GraphLayout {
  positions: Map<string, NodePosition>;
  width: number;
  height: number;
}

// --- Node box metrics (docs/ui.md: 3-column thumbnail grid inside a Batch frame) ---
export const THUMB_SIZE = 48;
export const THUMB_GAP = 6;
export const NODE_PADDING = 10;
export const HEADER_HEIGHT = 28;
export const THUMBS_PER_ROW = 3;

export const NODE_WIDTH = THUMBS_PER_ROW * THUMB_SIZE + (THUMBS_PER_ROW - 1) * THUMB_GAP + NODE_PADDING * 2;

// 家系図スタイルの縦型レイアウト: layer が縦（上=親）、同一 layer 内の並びが横。
export const NODE_GAP_X = NODE_WIDTH + 40;
export const LAYER_GAP_Y = 90;
export const MARGIN = 40;

/** Node height for a Batch card: header + a single thumbnail row (docs/ui.md). */
export function computeNodeHeight(): number {
  return HEADER_HEIGHT + NODE_PADDING + THUMB_SIZE + NODE_PADDING;
}

/** Local (node-relative) top-left position of thumbnail grid slot `index` (0-based, row-major). */
export function thumbnailSlotPosition(index: number): { x: number; y: number } {
  const row = Math.floor(index / THUMBS_PER_ROW);
  const col = index % THUMBS_PER_ROW;
  return {
    x: NODE_PADDING + col * (THUMB_SIZE + THUMB_GAP),
    y: HEADER_HEIGHT + NODE_PADDING + row * (THUMB_SIZE + THUMB_GAP),
  };
}

/** Finds edge indices that close a cycle, via DFS with a 3-color (unvisited/visiting/done) guard. */
function findBackEdgeIndices(nodeIds: string[], edges: LayoutEdgeInput[]): Set<number> {
  const adjacency = new Map<string, { to: string; edgeIndex: number }[]>();
  for (const id of nodeIds) adjacency.set(id, []);
  edges.forEach((edge, edgeIndex) => {
    adjacency.get(edge.source)?.push({ to: edge.target, edgeIndex });
  });

  const state = new Map<string, 0 | 1 | 2>();
  const backEdgeIndices = new Set<number>();

  // Iterative DFS to avoid recursion-depth limits on larger histories.
  for (const start of nodeIds) {
    if (state.get(start)) continue;
    const stack: { node: string; iter: number }[] = [{ node: start, iter: 0 }];
    state.set(start, 1);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const neighbors = adjacency.get(frame.node) ?? [];
      if (frame.iter < neighbors.length) {
        const { to, edgeIndex } = neighbors[frame.iter]!;
        frame.iter += 1;
        const toState = state.get(to) ?? 0;
        if (toState === 0) {
          state.set(to, 1);
          stack.push({ node: to, iter: 0 });
        } else if (toState === 1) {
          backEdgeIndices.add(edgeIndex);
        }
        // toState === 2 (done): forward/cross edge, not a cycle.
      } else {
        state.set(frame.node, 2);
        stack.pop();
      }
    }
  }

  return backEdgeIndices;
}

/** Longest-path layer for each node, via Kahn's algorithm over the back-edge-free DAG. */
function computeLayers(nodeIds: string[], edges: LayoutEdgeInput[], backEdgeIndices: Set<number>): Map<string, number> {
  const forwardEdges = edges.filter((_, i) => !backEdgeIndices.has(i));
  const adjacency = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const id of nodeIds) {
    adjacency.set(id, []);
    indegree.set(id, 0);
  }
  for (const edge of forwardEdges) {
    adjacency.get(edge.source)?.push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }

  const layer = new Map<string, number>();
  for (const id of nodeIds) layer.set(id, 0);

  const queue: string[] = nodeIds.filter((id) => (indegree.get(id) ?? 0) === 0);
  let head = 0;
  while (head < queue.length) {
    const u = queue[head]!;
    head += 1;
    for (const v of adjacency.get(u) ?? []) {
      layer.set(v, Math.max(layer.get(v) ?? 0, (layer.get(u) ?? 0) + 1));
      const remaining = (indegree.get(v) ?? 0) - 1;
      indegree.set(v, remaining);
      if (remaining === 0) queue.push(v);
    }
  }

  return layer;
}

/**
 * Computes x/y/width/height for every node: x by layer, y by created_at order
 * within the layer. Node width and height are both fixed (a single thumbnail
 * row per card). A layer's y position is offset by the node height plus gap
 * of every *previous* layer.
 */
export function computeGraphLayout(nodes: LayoutNodeInput[], edges: LayoutEdgeInput[]): GraphLayout {
  const nodeIds = nodes.map((n) => n.id);
  const backEdgeIndices = findBackEdgeIndices(nodeIds, edges);
  const layerById = computeLayers(nodeIds, edges, backEdgeIndices);
  const nodeHeight = computeNodeHeight();

  const byLayer = new Map<number, LayoutNodeInput[]>();
  for (const node of nodes) {
    const layer = layerById.get(node.id) ?? 0;
    const list = byLayer.get(layer) ?? [];
    list.push(node);
    byLayer.set(layer, list);
  }

  const maxLayer = Math.max(0, ...Array.from(byLayer.keys()));

  // y offset of each layer = MARGIN + sum of (tallest node height + gap) for every prior layer.
  const layerY = new Map<number, number>();
  const layerMaxHeight = new Map<number, number>();
  let runningY = MARGIN;
  for (let layer = 0; layer <= maxLayer; layer += 1) {
    layerY.set(layer, runningY);
    const layerNodes = byLayer.get(layer) ?? [];
    const maxHeight = layerNodes.length > 0 ? nodeHeight : 0;
    layerMaxHeight.set(layer, maxHeight);
    runningY += maxHeight + LAYER_GAP_Y;
  }

  const positions = new Map<string, NodePosition>();
  let maxOrder = 0;
  for (const [layer, layerNodes] of byLayer) {
    layerNodes.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id.localeCompare(b.id)));
    layerNodes.forEach((node, order) => {
      positions.set(node.id, {
        id: node.id,
        layer,
        order,
        x: MARGIN + order * NODE_GAP_X,
        y: layerY.get(layer) ?? MARGIN,
        width: NODE_WIDTH,
        height: nodeHeight,
      });
      maxOrder = Math.max(maxOrder, order);
    });
  }

  const totalNodeHeight = Array.from(layerMaxHeight.values()).reduce((sum, h) => sum + h, 0);
  const width = MARGIN * 2 + (maxOrder + 1) * NODE_GAP_X - (NODE_GAP_X - NODE_WIDTH);
  const height = MARGIN * 2 + totalNodeHeight + Math.max(0, byLayer.size - 1) * LAYER_GAP_Y;

  return { positions, width, height };
}
