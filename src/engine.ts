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
