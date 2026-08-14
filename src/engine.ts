/**
 * Headless flow engine — **zero React**.
 *
 * Import this entry to run a `FlowGraph` anywhere there is no DOM: a Node
 * server, a queue worker, a CLI, an edge function, or a test. It pulls in only
 * the pure topological runner + the graph/executor types — none of the editor,
 * hooks, or `@xyflow/react`/React runtime code.
 *
 * ```ts
 * import { runFlow, type ExecutorRegistry } from "@particle-academy/fancy-flow/engine";
 *
 * const executors: ExecutorRegistry = {
 *   llm_call: async ({ inputs }) => ({ text: await callModel(inputs) }),
 *   "*": ({ node }) => ({ ran: node.id }),
 * };
 *
 * const result = await runFlow(graph, executors, (event) => log(event));
 * // result.ok / result.outputs / result.error
 * ```
 *
 * The same `runFlow` powers the in-editor `useFlowRun` hook — the editor and a
 * headless backend execute the identical engine, so a graph an agent or human
 * authors in `<FlowEditor>` runs unchanged on the server.
 */
export { runFlow, type RunOptions, type RunResult } from "./runtime/run-flow";

/**
 * Trigger collision — the runs one event fires, as a group.
 *
 * `runFlow` runs one graph, so a host that fans one webhook out to several flows
 * loops it, and a loop has no answer for the flow that deletes the record they
 * were all fired for: the rest resolve `ok: true` having done nothing. Reach for
 * `runCohort` whenever the fan-out shares state.
 */
export {
  runCohort,
  type CohortGuard,
  type CohortOptions,
  type CohortPolicy,
  type CohortResult,
} from "./runtime/run-cohort";

export type {
  FlowGraph,
  FlowNode,
  FlowEdge,
  FlowNodeData,
  FlowNodeKind,
  BaseNodeData,
  TriggerNodeData,
  ActionNodeData,
  DecisionNodeData,
  OutputNodeData,
  NoteNodeData,
  SubgraphNodeData,
  PortDescriptor,
  NodeExecutor,
  ExecutorRegistry,
  RunEvent,
  NodeRunStatus,
} from "./types";

/**
 * The kind registry, React-free.
 *
 * Re-exported here because a headless consumer has to register kinds and could
 * not: `@particle-academy/fancy-flow/registry` re-exports `RegistryNode`, so
 * importing it to call one function drags React into a queue worker, a CLI, or
 * a node package's CI. Found when the first marketplace package's fixtures
 * failed on a clean install with "Cannot find package 'react'".
 *
 * Imported straight from the module rather than the barrel, for that same
 * reason. These are the identical functions the editor uses — one registry,
 * two doors into it, not a headless copy that can drift.
 */
export {
  registerNodeKind,
  getNodeKind,
  resolveKindId,
  kindIds,
  listNodeKinds,
  defaultConfigFor,
  validateConfig,
} from "./registry/registry";
export type { NodeKindDefinition, ConfigField, NodeCategory, PortSpec } from "./registry/types";

/**
 * The human-pause contract.
 *
 * Exported from the headless entry because the code that needs it most is a
 * server-side durable runner, which must never import React. Imported straight
 * from the module rather than the registry barrel for the same reason — that
 * barrel pulls in `RegistryNode`.
 *
 * A runner calls `decodePause(result.error)`: non-null means park the run on
 * `signal.nodeId` and wait for a person; null means it genuinely failed.
 */
export {
  pauseForHuman,
  encodePause,
  decodePause,
  isPause,
  PAUSE_PREFIX,
  LEGACY_PAUSE_PREFIXES,
  type PauseAwaiting,
  type PauseSignal,
} from "./registry/pause";

/**
 * Marketplace contracts — the node package manifest and the golden-fixture
 * runner. Headless for the same reason as the pause contract: the CLI and CI
 * are what read them, and neither has a DOM.
 */
export {
  NODE_MANIFEST_SCHEMA_VERSION,
  validateNodeManifest,
  checkRuntimeSupport,
  checkCapabilities,
  satisfiesRange,
  runFixtures,
  validateFixtureFile,
  type NodePackageManifest,
  type NodeRuntimeId,
  type NodeRuntimeSpec,
  type CapabilityRequirement,
  type SideEffects,
  type ManifestProblem,
  type ManifestValidation,
  type FixtureFile,
  type FixtureCase,
  type FixtureExpectation,
  type FixtureStubs,
  type FixtureEventExpectation,
  type FixtureFailure,
  type FixtureRunResult,
} from "./marketplace";

/**
 * Refuse to SAVE a subflow loop, instead of discovering it mid-run.
 *
 * The runtime depth cap stays and is the right backstop for a loop created from
 * the other end (someone edits B after A was saved). It is not a substitute for
 * refusing to write one: by the time it fires, every node above the subflow has
 * already run on each pass, side effects included.
 *
 * Needs the host's resolver, because schema validation sees one graph at a time
 * and A → B → A is made of two individually valid graphs.
 *
 * The TS twin of `FancyFlow\Analysis\SubflowCycle` (fancy-flow-php#5).
 */
export { findSubflowCycle } from "./analysis/subflow-cycle";
