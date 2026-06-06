# @particle-academy/fancy-flow

[![Fancified](art/fancified.svg)](https://particle.academy)

Workflow editor + runner with six built-in node kits, tokenized theme, and topological execution with per-node status events. React Flow is bundled — consumers `npm install fancy-flow` and get nothing extra.

## Install

```bash
npm install @particle-academy/fancy-flow
```

```ts
import "@particle-academy/fancy-flow/styles.css";
```

No more `@xyflow/react` peer install since `0.3.0` — it's bundled into our dist and hidden behind the `defineNode` / `<NodePort>` authoring API (see "Custom nodes" below). React Flow's own stylesheet is included inside ours.

> **Why might I see two copies?** If your app *also* imports `@xyflow/react` directly somewhere (e.g. for a non-fancy-flow surface), your bundler will include both our bundled copy and yours. They won't share React-Flow's provider state. Two ways to avoid it: (a) author every custom node with `defineNode` + `<NodePort>` instead of importing react-flow yourself, or (b) tell your bundler to alias `@xyflow/react` to a single source. Cases where you actually need both are rare.

## Custom nodes — no react-flow imports needed

```tsx
import { defineNode, NodePort } from "@particle-academy/fancy-flow";

type MyData = { label: string; threshold: number };

export const ThresholdNode = defineNode<MyData>(({ data, selected }) => (
  <div className={selected ? "node node--selected" : "node"}>
    <NodePort side="left" type="target" id="in" />
    <div className="node__title">{data.label}</div>
    <div className="node__body">≥ {data.threshold}</div>
    <NodePort side="right" type="source" id="pass" title="pass" />
    <NodePort side="right" type="source" id="fail" title="fail" style={{ top: "70%" }} />
  </div>
));
```

`defineNode` returns a memoized component compatible with the underlying engine; `<NodePort>` renders a connection handle. Together they cover what the typical node author needs — multiple ports, source vs target, position per side — without ever importing from `@xyflow/react`.

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
