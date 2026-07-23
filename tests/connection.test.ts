import { describe, it, expect } from "vitest";
import type { Connection } from "@xyflow/react";
import type { FlowNode, PortDescriptor } from "../src/types";
import {
  createConnectionValidator,
  defaultPortCompatibility,
  ANY_PORT_TYPE,
} from "../src/registry/connection";

// Ports declared on `data` win over the kind in resolveNodePorts, so these
// fixtures need no registered kinds — they exercise the resolver + rule alone.
function node(id: string, ports: { inputs?: PortDescriptor[]; outputs?: PortDescriptor[] }): FlowNode {
  return {
    id,
    position: { x: 0, y: 0 },
    data: { kind: "action", label: id, ...ports },
  } as FlowNode;
}

const conn = (
  source: string | null,
  target: string | null,
  sourceHandle: string | null = null,
  targetHandle: string | null = null,
): Connection => ({ source: source as string, target: target as string, sourceHandle, targetHandle });

describe("defaultPortCompatibility", () => {
  it("allows two untyped ports", () => {
    expect(defaultPortCompatibility({ id: "a" }, { id: "b" })).toBe(true);
  });
  it("allows when one side is untyped (untyped = wildcard)", () => {
    expect(defaultPortCompatibility({ id: "a", type: "text" }, { id: "b" })).toBe(true);
    expect(defaultPortCompatibility({ id: "a" }, { id: "b", type: "text" })).toBe(true);
  });
  it("allows matching concrete types", () => {
    expect(defaultPortCompatibility({ id: "a", type: "text" }, { id: "b", type: "text" })).toBe(true);
  });
  it("rejects differing concrete types", () => {
    expect(defaultPortCompatibility({ id: "a", type: "text" }, { id: "b", type: "number" })).toBe(false);
  });
  it("treats the `any` wildcard as compatible with anything", () => {
    expect(defaultPortCompatibility({ id: "a", type: ANY_PORT_TYPE }, { id: "b", type: "number" })).toBe(true);
    expect(defaultPortCompatibility({ id: "a", type: "text" }, { id: "b", type: ANY_PORT_TYPE })).toBe(true);
  });
});

describe("createConnectionValidator", () => {
  const nodes = [
    node("a", { outputs: [{ id: "out", type: "text" }] }),
    node("b", { inputs: [{ id: "in", type: "text" }] }),
    node("c", { inputs: [{ id: "in", type: "number" }] }),
    node("u1", { outputs: [{ id: "out" }] }), // untyped
    node("u2", { inputs: [{ id: "in" }] }), // untyped
  ];
  const isValid = createConnectionValidator(() => nodes);

  it("accepts a type-compatible connection", () => {
    expect(isValid(conn("a", "b", "out", "in"))).toBe(true);
  });
  it("rejects a type-incompatible connection", () => {
    expect(isValid(conn("a", "c", "out", "in"))).toBe(false);
  });
  it("accepts an untyped connection (no regression for untyped graphs)", () => {
    expect(isValid(conn("u1", "u2", "out", "in"))).toBe(true);
  });
  it("resolves a lone default handle when the handle id is absent", () => {
    // sourceHandle/targetHandle null, but each side has exactly one port.
    expect(isValid(conn("a", "b"))).toBe(true);
  });
  it("rejects a missing endpoint", () => {
    expect(isValid(conn(null, "b", null, "in"))).toBe(false);
    expect(isValid(conn("a", null, "out", null))).toBe(false);
  });
  it("rejects an unknown node", () => {
    expect(isValid(conn("a", "zzz", "out", "in"))).toBe(false);
  });
  it("blocks a self-connection by default", () => {
    const self = [node("s", { inputs: [{ id: "in", type: "text" }], outputs: [{ id: "out", type: "text" }] })];
    expect(createConnectionValidator(() => self)(conn("s", "s", "out", "in"))).toBe(false);
  });
  it("permits a self-connection when allowSelfConnection is set", () => {
    const self = [node("s", { inputs: [{ id: "in", type: "text" }], outputs: [{ id: "out", type: "text" }] })];
    expect(
      createConnectionValidator(() => self, { allowSelfConnection: true })(conn("s", "s", "out", "in")),
    ).toBe(true);
  });
  it("honors a custom compatibility override (permissive)", () => {
    const permissive = createConnectionValidator(() => nodes, { compatible: () => true });
    expect(permissive(conn("a", "c", "out", "in"))).toBe(true); // mismatch now allowed
  });
  it("honors a custom compatibility override (strict — untyped rejected)", () => {
    const strict = createConnectionValidator(() => nodes, {
      compatible: (s, t) => !!s?.type && s.type === t?.type,
    });
    expect(strict(conn("u1", "u2", "out", "in"))).toBe(false); // untyped now rejected
  });
  it("sees live node changes through the getter", () => {
    let live = [node("x", { outputs: [{ id: "out", type: "text" }] }), node("y", { inputs: [{ id: "in", type: "number" }] })];
    const v = createConnectionValidator(() => live);
    expect(v(conn("x", "y", "out", "in"))).toBe(false); // text -> number
    live = [node("x", { outputs: [{ id: "out", type: "number" }] }), node("y", { inputs: [{ id: "in", type: "number" }] })];
    expect(v(conn("x", "y", "out", "in"))).toBe(true); // now number -> number
  });
});
