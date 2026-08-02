import { useMemo, type CSSProperties, type ReactNode } from "react";
import { FlowCanvas } from "../canvas";
import { buildNodeTypes } from "../../registry";
import { categoryAccent, getNodeKind } from "../../registry/registry";
import type { FlowGraph, FlowNode } from "../../types";

/** Outcome of one node in a run, for annotating the graph after the fact. */
export type FlowNodeStatus = "ok" | "running" | "failed" | "skipped" | "pending";

export interface FlowViewerClassNames {
  root?: string;
  list?: string;
  row?: string;
  rowIndex?: string;
  rowTitle?: string;
  rowDescription?: string;
  rowStatus?: string;
}

export interface FlowViewerProps {
  /** The graph to show. */
  graph: FlowGraph;
  /**
   * `canvas` draws the graph. `list` renders the nodes as rows — for a docs
   * page, a narrow column, print, or an audit view, where a pan-zoom surface is
   * the wrong shape and often not usable at all.
   */
  variant?: "canvas" | "list";
  /** Canvas height. Ignored by `list`. Default 480. */
  height?: number | string;
  /** Canvas minimap. Default false. */
  showMinimap?: boolean;
  /** Canvas pan/zoom/fit controls. Default true. */
  showControls?: boolean;
  /**
   * Per-node run outcome, keyed by node id. Lets the same component serve
   * "here is the workflow" and "here is what happened on Tuesday".
   */
  statuses?: Record<string, FlowNodeStatus>;
  /** Controlled selection. */
  selectedNodeId?: string | null;
  /** Omit and nothing is clickable — a viewer with no handler is inert. */
  onSelectNode?: (node: FlowNode) => void;
  className?: string;
  classNames?: FlowViewerClassNames;
  style?: CSSProperties;
  /** Rendered when the graph has no nodes. */
  empty?: ReactNode;
}

const STATUS_LABEL: Record<FlowNodeStatus, string> = {
  ok: "ok",
  running: "running",
  failed: "failed",
  skipped: "skipped",
  pending: "pending",
};

/**
 * FlowViewer — a workflow, read-only.
 *
 * **Read-only by construction, not by configuration.** There is no prop that
 * makes this editable, because a viewer that can be switched into an editor is
 * a viewer somebody eventually switches into an editor by accident. Before this
 * existed the only way to show a flow was `FlowEditor` (the whole editor) or
 * `FlowCanvas` plus four React Flow flags a consumer had to know to pass —
 * assembly, not an affordance, and nothing stopped the next person shipping a
 * fully editable canvas where they wanted a picture.
 *
 * Node titles come from the registry, so `overrideNodeKind()` renames apply
 * here too.
 */
export function FlowViewer({
  graph,
  variant = "canvas",
  height = 480,
  showMinimap = false,
  showControls = true,
  statuses,
  selectedNodeId = null,
  onSelectNode,
  className,
  classNames = {},
  style,
  empty,
}: FlowViewerProps) {
  const nodeTypes = useMemo(() => buildNodeTypes(), []);

  const rows = useMemo(
    () =>
      graph.nodes.map((node, index) => {
        const kind = getNodeKind(node.data?.kind ?? node.type ?? "");
        return {
          node,
          index,
          title: kind?.label ?? node.data?.label ?? node.data?.kind ?? node.id,
          description: kind?.description ?? null,
          accent: kind?.accent ?? categoryAccent(kind?.category ?? "custom"),
          status: statuses?.[node.id] ?? null,
        };
      }),
    [graph.nodes, statuses],
  );

  if (graph.nodes.length === 0) {
    return (
      <div className={cx("ff-viewer ff-viewer--empty", className, classNames.root)} style={style}>
        {empty ?? <span className="ff-viewer__empty">This flow has no nodes.</span>}
      </div>
    );
  }

  if (variant === "list") {
    return (
      <div
        className={cx("ff-viewer ff-viewer--list", className, classNames.root)}
        style={style}
        data-flow-viewer="list"
      >
        <ol className={cx("ff-viewer__list", classNames.list)}>
          {rows.map(({ node, index, title, description, accent, status }) => {
            const selected = node.id === selectedNodeId;
            const Row = onSelectNode ? "button" : "div";

            return (
              <li key={node.id}>
                <Row
                  {...(onSelectNode
                    ? { type: "button" as const, onClick: () => onSelectNode(node) }
                    : {})}
                  className={cx(
                    "ff-viewer__row",
                    selected && "ff-viewer__row--selected",
                    onSelectNode && "ff-viewer__row--interactive",
                    classNames.row,
                  )}
                  data-flow-viewer-node={node.id}
                  data-flow-viewer-status={status ?? undefined}
                  aria-current={selected || undefined}
                >
                  <span
                    className={cx("ff-viewer__index", classNames.rowIndex)}
                    style={{ backgroundColor: accent }}
                    aria-hidden
                  >
                    {index + 1}
                  </span>

                  <span className="ff-viewer__body">
                    <span className={cx("ff-viewer__title", classNames.rowTitle)}>{title}</span>
                    {description && (
                      <span className={cx("ff-viewer__desc", classNames.rowDescription)}>
                        {description}
                      </span>
                    )}
                  </span>

                  {status && (
                    <span
                      className={cx(
                        "ff-viewer__status",
                        `ff-viewer__status--${status}`,
                        classNames.rowStatus,
                      )}
                    >
                      {STATUS_LABEL[status]}
                    </span>
                  )}
                </Row>
              </li>
            );
          })}
        </ol>
      </div>
    );
  }

  return (
    <div
      className={cx("ff-viewer ff-viewer--canvas", className, classNames.root)}
      style={style}
      data-flow-viewer="canvas"
    >
      <FlowCanvas
        nodes={graph.nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        height={height}
        showControls={showControls}
        showMinimap={showMinimap}
        // The read-only contract. Every mutation path React Flow offers is
        // closed here rather than left to the caller to remember.
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={Boolean(onSelectNode)}
        edgesFocusable={false}
        elementsSelectable={Boolean(onSelectNode)}
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        connectOnClick={false}
        // A canvas embedded mid-page must not trap a reader's scroll.
        zoomOnScroll={false}
        onNodeClick={onSelectNode ? (_, node) => onSelectNode(node as FlowNode) : undefined}
        fitView
      />
    </div>
  );
}

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
