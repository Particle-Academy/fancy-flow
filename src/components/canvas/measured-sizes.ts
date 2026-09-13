import type { FlowNode } from "../../types";

export type MeasuredSizes = Readonly<Record<string, { width: number; height: number }>>;

/**
 * The node sizes React Flow has reported, folded into a map by node id.
 *
 * React Flow measures every rendered node and announces the result as a
 * `dimensions` change through `onNodesChange`. A host that APPLIES node changes
 * ends up with `measured` on its node objects. A host that renders a graph
 * read-only never applies anything, and its node objects never learn their size.
 *
 * Returns the previous map unchanged when nothing moved, so a React state setter
 * can bail out instead of re-rendering on every measurement pass.
 */
export function collectMeasuredSizes(
  previous: MeasuredSizes,
  changes: ReadonlyArray<{ type: string; id?: string; dimensions?: { width: number; height: number } }>,
): MeasuredSizes {
  let next: Record<string, { width: number; height: number }> | null = null;

  for (const change of changes) {
    if (change.type !== "dimensions" || !change.id || !change.dimensions) continue;
    const { width, height } = change.dimensions;
    const known = (next ?? previous)[change.id];
    if (known && known.width === width && known.height === height) continue;
    next ??= { ...previous };
    next[change.id] = { width, height };
  }

  return next ?? previous;
}

/**
 * Nodes carrying the sizes the canvas measured, for any node that arrived
 * without its own.
 *
 * WHY: React Flow's `<MiniMap>` draws a node only when the node object the host
 * passed has dimensions (`nodeHasDimensions(node.internals.userNode)`). The main
 * canvas draws from React Flow's internal copy, which is measured either way. So
 * a read-only `FlowViewer` rendered its whole graph while its minimap found no
 * node to draw, and showed an empty rectangle over the canvas (fancy-flow #15).
 *
 * A node the host already measured is returned as is, so an editor applying its
 * own changes is untouched; so is the array itself when there is nothing to add.
 */
export function withMeasuredSizes<T extends FlowNode>(nodes: T[], sizes: MeasuredSizes): T[] {
  let changed = false;
  const out = nodes.map((node) => {
    const size = sizes[node.id];
    if (!size || node.measured?.width !== undefined) return node;
    changed = true;
    return { ...node, measured: { width: size.width, height: size.height } };
  });

  return changed ? out : nodes;
}
