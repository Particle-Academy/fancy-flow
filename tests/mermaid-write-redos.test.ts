/**
 * Code scanning alert 4 (js/polynomial-redos): `safeId` in src/mermaid/write.ts
 * trimmed a node id's edge dashes with `/^-+|-+$/g`, a pattern that can run in
 * quadratic time. Node ids come from the caller's graph, so the trim is now a
 * linear scan. These tests pin the renaming behaviour so the rewrite cannot
 * change it, and bound the time on a hostile id.
 */
import { describe, expect, test } from "vitest";
import { exportMermaid } from "../src/mermaid";

const renamed = (id: string) =>
  exportMermaid({ nodes: [{ id, type: "note", position: { x: 0, y: 0 }, data: { label: "x" } }], edges: [] } as never)
    .report.renamedIds[id];

describe("exportMermaid node ids", () => {
  test("leading and trailing dashes become underscores", () => {
    expect(renamed("-a b-")).toBe("_a_b_");
  });

  test("an id that is only a dash becomes an underscore", () => {
    expect(renamed("-")).toBe("_");
  });

  test("runs of dashes collapse to one underscore", () => {
    expect(renamed("a--b!")).toBe("a_b_");
  });

  test("a hostile id with a long run of dashes stays fast", () => {
    const id = "a" + "-".repeat(200000) + "!";
    const start = performance.now();
    expect(renamed(id)).toBe("a__");
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
