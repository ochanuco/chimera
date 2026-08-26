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
}

export interface GraphLayout {
  positions: Map<string, NodePosition>;
  width: number;
  height: number;
}

export const NODE_WIDTH = 160;
export const NODE_HEIGHT = 172;
export const LAYER_GAP_X = 260;
export const NODE_GAP_Y = 210;
export const MARGIN = 40;

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
 * Computes x/y positions for every node: x by layer, y by created_at order
 * within the layer. Node spacing is fixed (see NODE_WIDTH / NODE_GAP_Y).
 */
export function computeGraphLayout(nodes: LayoutNodeInput[], edges: LayoutEdgeInput[]): GraphLayout {
  const nodeIds = nodes.map((n) => n.id);
  const backEdgeIndices = findBackEdgeIndices(nodeIds, edges);
  const layerById = computeLayers(nodeIds, edges, backEdgeIndices);

  const byLayer = new Map<number, LayoutNodeInput[]>();
  for (const node of nodes) {
    const layer = layerById.get(node.id) ?? 0;
    const list = byLayer.get(layer) ?? [];
    list.push(node);
    byLayer.set(layer, list);
  }

  const positions = new Map<string, NodePosition>();
  let maxLayer = 0;
  let maxOrder = 0;
  for (const [layer, layerNodes] of byLayer) {
    layerNodes.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id.localeCompare(b.id)));
    layerNodes.forEach((node, order) => {
      positions.set(node.id, {
        id: node.id,
        layer,
        order,
        x: MARGIN + layer * LAYER_GAP_X,
        y: MARGIN + order * NODE_GAP_Y,
      });
      maxLayer = Math.max(maxLayer, layer);
      maxOrder = Math.max(maxOrder, order);
    });
  }

  const width = MARGIN * 2 + (maxLayer + 1) * LAYER_GAP_X - (LAYER_GAP_X - NODE_WIDTH);
  const height = MARGIN * 2 + (maxOrder + 1) * NODE_GAP_Y - (NODE_GAP_Y - NODE_HEIGHT);

  return { positions, width, height };
}
