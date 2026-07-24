import { describe, it, expect } from "vitest";
import { getHelperLines } from "../src/components/canvas/helper-lines";

const node = (id: string, x: number, y: number, w = 100, h = 40): any => ({
  id,
  position: { x, y },
  width: w,
  height: h,
  data: {},
});

describe("getHelperLines", () => {
  it("snaps a near-aligned left edge and reports a vertical guide", () => {
    const nodes = [node("a", 103, 200), node("b", 100, 50)]; // a.left 103 ≈ b.left 100
    const res = getHelperLines({ id: "a", position: { x: 103, y: 200 } }, nodes);
    expect(res.vertical).toBe(100);
    expect(res.snapPosition.x).toBe(100);
  });

  it("snaps a near-aligned top edge and reports a horizontal guide", () => {
    const nodes = [node("a", 400, 52), node("b", 100, 50)]; // a.top 52 ≈ b.top 50
    const res = getHelperLines({ id: "a", position: { x: 400, y: 52 } }, nodes);
    expect(res.horizontal).toBe(50);
    expect(res.snapPosition.y).toBe(50);
  });

  it("reports no guide when nothing is within snap distance", () => {
    const res = getHelperLines({ id: "a", position: { x: 0, y: 0 } }, [node("a", 0, 0), node("b", 500, 500)]);
    expect(res.vertical).toBeUndefined();
    expect(res.horizontal).toBeUndefined();
  });

  it("returns empty when the dragged node isn't found", () => {
    const res = getHelperLines({ id: "zzz", position: { x: 0, y: 0 } }, [node("a", 0, 0)]);
    expect(res.snapPosition).toEqual({ x: undefined, y: undefined });
  });
});
