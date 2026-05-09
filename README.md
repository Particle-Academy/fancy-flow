# @particle-academy/fancy-flow

Workflow editor + runner built on [React Flow](https://reactflow.dev/). Six built-in node kits, tokenized theme, topological execution with per-node status events.

## Install

```bash
npm install @particle-academy/fancy-flow @xyflow/react
```

```ts
import "@xyflow/react/dist/style.css";
import "@particle-academy/fancy-flow/styles.css";
```

## Quick start

```tsx
import { FlowCanvas, useFlowState, useFlowRun, applyStatusesToNodes, FlowRunControls, FlowRunFeed } from "@particle-academy/fancy-flow";
import type { ExecutorRegistry, FlowGraph } from "@particle-academy/fancy-flow";

const initial: FlowGraph = {
  nodes: [
    { id: "t",  type: "trigger",  position: { x: 0, y: 0 },   data: { kind: "trigger", label: "Manual" } },
    { id: "a",  type: "action",   position: { x: 240, y: 0 }, data: { kind: "action",  label: "Fetch user" } },
    { id: "d",  type: "decision", position: { x: 480, y: 0 }, data: { kind: "decision", label: "Active?" } },
    { id: "ok", type: "output",   position: { x: 720, y: -60 }, data: { kind: "output", label: "Allow" } },
    { id: "no", type: "output",   position: { x: 720, y: 80 },  data: { kind: "output", label: "Deny" } },
  ],
  edges: [
    { id: "e1", source: "t", target: "a" },
    { id: "e2", source: "a", target: "d" },
    { id: "e3", source: "d", sourceHandle: "true",  target: "ok" },
    { id: "e4", source: "d", sourceHandle: "false", target: "no" },
  ],
};

const executors: ExecutorRegistry = {
  trigger: () => ({ now: Date.now() }),
  action:  async () => ({ id: 1, active: true }),
  decision: ({ inputs }) => ({ branch: (inputs.in as any)?.active ? "true" : "false" }),
  output:  ({ inputs }) => inputs.in,
};

function MyEditor() {
  const flow = useFlowState(initial);
  const runner = useFlowRun();
  const renderedNodes = applyStatusesToNodes(flow.nodes, runner.statuses, runner.statusText);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 16 }}>
      <FlowCanvas
        nodes={renderedNodes}
        edges={flow.edges}
        onNodesChange={flow.onNodesChange}
        onEdgesChange={flow.onEdgesChange}
        onConnect={flow.onConnect}
        toolbar={<FlowRunControls running={runner.running} onRun={() => runner.run(flow.toGraph(), executors)} onCancel={runner.cancel} onReset={runner.reset} />}
      />
      <FlowRunFeed entries={runner.feed} />
    </div>
  );
}
```

## Node kit (v0.1)

| Kind | Purpose | Default ports |
|---|---|---|
| `trigger` | Entry point | outputs only (`out`) |
| `action` | Work-doing node | `in` → `out` |
| `decision` | Branching | `in` → `true` / `false` (configurable) |
| `output` | Terminal | `in` only |
| `note` | Annotation | none |
| `subgraph` | Collapse a group | facade ports |

Custom nodes plug in via xyflow's standard `nodeTypes` prop:

```tsx
<FlowCanvas nodeTypes={{ ...defaultNodeTypes, myNode: MyCustomNode }} ... />
```

## Runtime

`runFlow(graph, executors, onEvent?, options?)` does a topological walk:

- Each node fires once when all upstream connected ports have produced values.
- Decision-style nodes can return `{ branch: "true" }` or `{ __port: "out", value }` to activate specific output ports — only edges leaving an active port propagate.
- Cycles abort the run.
- `onEvent` receives `RunEvent`s for status, output, log, run-start/end.

`useFlowRun` wraps `runFlow` with React state for statuses, status text, and a feed log.

## Status

`v0.1` — editor + runner + node kit. Roadmap:

- Subgraph expand/collapse interactions
- Edge labels (config metadata)
- Auto-layout (`dagre` integration)
- Persistence helpers (zod schema)
- Agent bridge (in `@particle-academy/agent-integrations` — coming next)

## License

MIT
