import type { FlowNode } from "../../types";

export type HelperLineChange = { id: string; position?: { x: number; y: number } };

export type HelperLinesResult = {
  /** Y of a horizontal guide line (flow coords), if the drag aligns on Y. */
  horizontal?: number;
  /** X of a vertical guide line (flow coords), if the drag aligns on X. */
  vertical?: number;
  /** The snapped position to apply to the dragged node. */
  snapPosition: { x?: number; y?: number };
};

const w = (n: FlowNode): number => (n as any).width ?? (n as any).measured?.width ?? 0;
const h = (n: FlowNode): number => (n as any).height ?? (n as any).measured?.height ?? 0;

/**
 * Compute alignment guide lines (and a snapped position) for a node being
 * dragged to `change.position`, against the other nodes. Standard "helper
 * lines" algorithm: match the dragged node's left/right/top/bottom edges to any
 * other node's edges within `distance`, snapping to the nearest. Pure + testable.
 */
export function getHelperLines(change: HelperLineChange, nodes: FlowNode[], distance = 6): HelperLinesResult {
  const result: HelperLinesResult = { snapPosition: { x: undefined, y: undefined } };
  const a = nodes.find((n) => n.id === change.id);
  if (!a || !change.position) return result;

  const A = {
    left: change.position.x,
    right: change.position.x + w(a),
    top: change.position.y,
    bottom: change.position.y + h(a),
    width: w(a),
    height: h(a),
  };
  let vDist = distance;
  let hDist = distance;

  for (const b of nodes) {
    if (b.id === a.id) continue;
    const B = { left: b.position.x, right: b.position.x + w(b), top: b.position.y, bottom: b.position.y + h(b) };

    // Vertical guides (X alignment).
    const ll = Math.abs(A.left - B.left);
    if (ll < vDist) { result.snapPosition.x = B.left; result.vertical = B.left; vDist = ll; }
    const rr = Math.abs(A.right - B.right);
    if (rr < vDist) { result.snapPosition.x = B.right - A.width; result.vertical = B.right; vDist = rr; }
    const lr = Math.abs(A.left - B.right);
    if (lr < vDist) { result.snapPosition.x = B.right; result.vertical = B.right; vDist = lr; }
    const rl = Math.abs(A.right - B.left);
    if (rl < vDist) { result.snapPosition.x = B.left - A.width; result.vertical = B.left; vDist = rl; }

    // Horizontal guides (Y alignment).
    const tt = Math.abs(A.top - B.top);
    if (tt < hDist) { result.snapPosition.y = B.top; result.horizontal = B.top; hDist = tt; }
    const bb = Math.abs(A.bottom - B.bottom);
    if (bb < hDist) { result.snapPosition.y = B.bottom - A.height; result.horizontal = B.bottom; hDist = bb; }
    const tb = Math.abs(A.top - B.bottom);
    if (tb < hDist) { result.snapPosition.y = B.bottom; result.horizontal = B.bottom; hDist = tb; }
    const bt = Math.abs(A.bottom - B.top);
    if (bt < hDist) { result.snapPosition.y = B.top - A.height; result.horizontal = B.top; hDist = bt; }
  }

  return result;
}
