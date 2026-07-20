/**
 * Golden fixtures — the parity guarantee, and a publishing requirement.
 *
 * Every runtime a node package claims runs these same JSON cases. That is what
 * makes "this node behaves identically on TS and PHP" verified rather than
 * asserted, and it is the one thing a loose collection of repos can never
 * offer.
 *
 * WHY IT IS REQUIRED RATHER THAN ENCOURAGED: cross-runtime drift does not fail
 * loudly. The 0.9.0 port-resolution divergence produced flows that routed
 * correctly in the editor and silently down one path on the server — status
 * `completed`, no error, no exception, nothing to alert on. A guarantee that
 * only holds when an author opts in is not a guarantee.
 *
 * WHAT A CASE ASSERTS, and why it matters more than it looks:
 *
 *   A fixture asserts THE DOWNSTREAM NODE EXECUTED — not the port the node
 *   recorded. The distinction is the whole lesson of that incident. A test
 *   reading back `outputs.router.__port` stays green while no edge fires and
 *   the run halts at the branch: the node faithfully recorded its choice, and
 *   nothing downstream ever ran. So the runner wires a real probe to every
 *   declared port and reports which probes actually executed.
 *
 * The format is plain JSON with no expressions or callbacks, so the PHP runner
 * executes byte-identical cases without an embedded JS engine.
 */

import { runFlow } from "../runtime/run-flow";
import { getNodeKind } from "../registry/registry";
import { resolveNodePorts } from "../registry/ports";
import { decodePause, type PauseAwaiting } from "../registry/pause";
import type { FlowGraph, FlowNode, NodeExecutor } from "../types";

/** What a case expects to have happened. */
export type FixtureExpectation = {
  /**
   * Output ports whose downstream node must have executed — the assertion that
   * catches routing drift. Order-insensitive; the set must match exactly, so a
   * node that fires an extra port fails just as loudly as one that fires none.
   */
  ports?: string[];
  /** The value carried downstream, deep-compared when present. */
  value?: unknown;
  /** The run halted for a person. */
  pause?: { awaiting: PauseAwaiting; detail?: unknown };
  /** The run failed, and the message contains this substring. */
  error?: string;
};

export type FixtureCase = {
  /** Human-readable, and what a failure report names. */
  name: string;
  /** Config for the node under test — drives config-derived ports. */
  config?: Record<string, unknown>;
  /**
   * The node's resolved output ports, stated rather than derived.
   *
   * NOT a convenience. TS derives config-driven ports by running a JavaScript
   * function (`switch_case`'s cases, `llm_router`'s routes); PHP cannot, and
   * falls back to the kind's static declaration. Left there, the identical
   * fixture would build a DIFFERENT graph on each runtime — the fixtures would
   * silently stop comparing like with like, which is the exact failure they
   * exist to catch.
   *
   * So a case states its ports the same way an exported document does (see
   * 0.10.1, "serialize resolved ports"), and both runners honour it. Omit it
   * only for a node whose ports are static.
   */
  ports?: string[];
  /** Inputs delivered on the node's input ports. */
  inputs?: Record<string, unknown>;
  expect: FixtureExpectation;
};

export type FixtureFile = {
  /** The kind under test. Must match the manifest's `kind`. */
  kind: string;
  cases: FixtureCase[];
};

export type FixtureFailure = {
  case: string;
  message: string;
};

export type FixtureRunResult = {
  ok: boolean;
  passed: number;
  failures: FixtureFailure[];
};

const SUBJECT = "subject";
const TRIGGER = "trigger";
const probeId = (port: string) => `probe:${port}`;

/**
 * Build the graph a case runs in: a trigger, the node under test, and one
 * probe per declared output port.
 *
 * The probes are the point. Reading the subject's return value would tell us
 * what it *recorded*; only a probe tells us what actually reached a downstream
 * node through a real edge.
 */
function buildGraph(kindId: string, testCase: FixtureCase): { graph: FlowGraph; ports: string[] } {
  const subject: FlowNode = {
    id: SUBJECT,
    type: kindId,
    position: { x: 0, y: 100 },
    data: { kind: kindId, config: testCase.config ?? {} },
  } as unknown as FlowNode;

  const kind = getNodeKind(kindId) ?? undefined;
  // An explicitly declared port list wins, so both runtimes build the same
  // graph even where one can derive config-driven ports and the other cannot.
  const ports = testCase.ports ?? (resolveNodePorts(subject, kind).outputs ?? []).map((p) => p.id);
  const effective = ports.length ? ports : ["out"];

  const nodes: FlowNode[] = [
    { id: TRIGGER, type: "manual_trigger", position: { x: 0, y: 0 }, data: {} } as unknown as FlowNode,
    subject,
    ...effective.map(
      (port, i) =>
        ({
          id: probeId(port),
          type: "@particle-academy/transform",
          position: { x: i * 200, y: 200 },
          data: {},
        }) as unknown as FlowNode,
    ),
  ];

  const edges = [
    { id: `e:trigger`, source: TRIGGER, target: SUBJECT },
    ...effective.map((port) => ({
      id: `e:${port}`,
      source: SUBJECT,
      sourceHandle: port,
      target: probeId(port),
    })),
  ];

  return { graph: { nodes, edges } as FlowGraph, ports: effective };
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Run one fixture file against a kind's executor.
 *
 * `executor` is the node's own; everything else in the graph is supplied here,
 * so a case exercises the node and nothing but the node.
 */
export async function runFixtures(
  file: FixtureFile,
  executor: NodeExecutor,
): Promise<FixtureRunResult> {
  const failures: FixtureFailure[] = [];
  let passed = 0;

  for (const testCase of file.cases) {
    const { graph } = buildGraph(file.kind, testCase);
    const fired: string[] = [];
    let carried: unknown;

    const executors: Record<string, NodeExecutor> = {
      manual_trigger: () => testCase.inputs ?? {},
      "@particle-academy/manual_trigger": () => testCase.inputs ?? {},
      [file.kind]: executor,
    };

    // A probe per port, bound by NODE ID — `pickExecutor` checks that before
    // kind, so each probe reports which specific port reached it. Recording
    // here, rather than inspecting the subject's result, is what makes this
    // assert reachability instead of intent.
    for (const node of graph.nodes) {
      if (!node.id.startsWith("probe:")) continue;
      const port = node.id.slice("probe:".length);
      executors[node.id] = ((ctx: { inputs: Record<string, unknown> }) => {
        fired.push(port);
        carried = ctx.inputs?.in ?? ctx.inputs;
        return undefined;
      }) as unknown as NodeExecutor;
    }

    const result = await runFlow(graph, executors, () => {});
    const fail = (message: string) => failures.push({ case: testCase.name, message });
    const expected = testCase.expect;
    let caseOk = true;

    if (expected.pause) {
      const paused = decodePause(result.error);
      if (!paused) {
        caseOk = false;
        fail(`expected a pause awaiting "${expected.pause.awaiting}", got ${result.ok ? "a completed run" : `error: ${result.error}`}`);
      } else {
        if (paused.awaiting !== expected.pause.awaiting) {
          caseOk = false;
          fail(`expected pause awaiting "${expected.pause.awaiting}", got "${paused.awaiting}"`);
        }
        if ("detail" in expected.pause && !deepEqual(paused.detail, expected.pause.detail)) {
          caseOk = false;
          fail(`pause detail mismatch: expected ${JSON.stringify(expected.pause.detail)}, got ${JSON.stringify(paused.detail)}`);
        }
      }
    } else if (expected.error !== undefined) {
      if (result.ok) {
        caseOk = false;
        fail(`expected an error containing "${expected.error}", but the run succeeded`);
      } else if (!String(result.error ?? "").includes(expected.error)) {
        caseOk = false;
        fail(`expected an error containing "${expected.error}", got "${result.error}"`);
      }
    } else {
      if (expected.ports !== undefined) {
        const got = [...fired].sort();
        const want = [...expected.ports].sort();
        if (!deepEqual(got, want)) {
          caseOk = false;
          // Name the failure in terms of reachability, because that is what
          // the assertion means and what a reader needs to act on.
          fail(
            `expected these ports to reach a downstream node: [${want.join(", ")}], but [${got.join(", ")}] did` +
              (result.ok ? "" : ` (run error: ${result.error})`),
          );
        }
      }
      if ("value" in expected && !deepEqual(carried, expected.value)) {
        caseOk = false;
        fail(`expected the value carried downstream to be ${JSON.stringify(expected.value)}, got ${JSON.stringify(carried)}`);
      }
    }

    if (caseOk) passed += 1;
  }

  return { ok: failures.length === 0, passed, failures };
}

/**
 * Validate a fixture file's shape before running it.
 *
 * A package that publishes an empty or malformed fixture file has satisfied the
 * letter of the requirement and none of its purpose, so this is checked at
 * publish rather than trusted.
 */
export function validateFixtureFile(input: unknown, expectedKind?: string): string[] {
  const problems: string[] = [];

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return ["Fixture file must be a JSON object."];
  }

  const f = input as Record<string, unknown>;

  if (typeof f.kind !== "string" || f.kind.trim() === "") {
    problems.push("`kind` is required — the kind these cases exercise.");
  } else if (expectedKind && f.kind !== expectedKind) {
    problems.push(`\`kind\` is "${f.kind}" but the manifest declares "${expectedKind}".`);
  }

  if (!Array.isArray(f.cases) || f.cases.length === 0) {
    problems.push("`cases` must contain at least one case — an empty fixture file proves nothing.");
    return problems;
  }

  f.cases.forEach((c: unknown, i: number) => {
    const label = `cases[${i}]`;
    if (typeof c !== "object" || c === null) {
      problems.push(`${label} must be an object.`);
      return;
    }
    const testCase = c as Record<string, unknown>;
    if (typeof testCase.name !== "string" || testCase.name.trim() === "") {
      problems.push(`${label}.name is required — a failure report names it.`);
    }
    if (typeof testCase.expect !== "object" || testCase.expect === null) {
      problems.push(`${label}.expect is required — a case that asserts nothing passes vacuously.`);
      return;
    }
    const expect = testCase.expect as Record<string, unknown>;
    if (
      expect.ports === undefined &&
      expect.value === undefined &&
      expect.pause === undefined &&
      expect.error === undefined
    ) {
      problems.push(`${label}.expect must assert at least one of: ports, value, pause, error.`);
    }
    if (expect.ports !== undefined && (!Array.isArray(expect.ports) || expect.ports.some((p) => typeof p !== "string"))) {
      problems.push(`${label}.expect.ports must be an array of port id strings.`);
    }
  });

  return problems;
}
