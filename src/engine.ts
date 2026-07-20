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
  runFixtures,
  validateFixtureFile,
  type NodePackageManifest,
  type NodeRuntimeId,
  type ManifestProblem,
  type ManifestValidation,
  type FixtureFile,
  type FixtureCase,
  type FixtureExpectation,
  type FixtureFailure,
  type FixtureRunResult,
} from "./marketplace";
