import {
  type CSSProperties,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  type DefaultEdgeOptions,
  type Edge,
  type EdgeTypes,
  type FitViewOptions,
  type NodeTypes,
  type ReactFlowProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { defaultNodeTypes } from "../nodes";
import { createConnectionValidator, type ConnectionValidatorOptions } from "../../registry/connection";
import { sortNodesParentFirst } from "../FlowEditor/graph-ops";
import { getHelperLines } from "./helper-lines";
import { collectMeasuredSizes, withMeasuredSizes, type MeasuredSizes } from "./measured-sizes";
import { minimapNodeColor } from "./minimap";
import { HelperLines } from "./HelperLines";
import type { FlowNode } from "../../types";
import { useResolvedColorMode } from "./use-resolved-color-mode";

/**
 * With wheel-zoom off, a BARE wheel must reach the page and never xyflow.
 *
 * Capture phase, so it lands before xyflow's own wheel handling, and
 * `stopPropagation` rather than `preventDefault`: React attaches wheel
 * listeners as PASSIVE, so a `preventDefault()` here does nothing except log
 * "Unable to preventDefault inside passive event listener invocation"
 * (fancy-flow#19). Stopping the event needs no such permission, and the page
 * then scrolls natively because nobody prevented it.
 *
 * Shift+wheel is left alone so xyflow zooms it — with `preventScrolling` on,
 * xyflow prevents that gesture's scroll itself.
 */
function keepBareWheelFromZooming(event: ReactWheelEvent<HTMLDivElement>): void {
  if (!event.shiftKey) event.stopPropagation();
}

/**
 * The three React Flow props that together decide what the wheel does.
 *
 * Extracted because they only make sense as a set, and getting the set wrong is
 * invisible in a screenshot: the canvas looks fine and feels broken. This is
 * the unit worth testing — mounting a canvas to assert it would be testing
 * d3-zoom through jsdom.
 *
 * - **on** (default): no modifier needed, and the page never scrolls under a
 *   wheel that is zooming.
 * - **off**: zoom moves to Shift+wheel and the bare wheel goes back to the page.
 *
 * Off is built out of what xyflow DOES, which its prop names disguise
 * (fancy-flow#19): its filter reads `zoomActivationKeyPressed || zoomOnScroll`,
 * so an activation key only adds permission and restricts nothing while
 * `zoomOnScroll` is true; and its wheel handler returns early when
 * `!preventScrolling && !event.ctrlKey`, so `preventScrolling: false` turns
 * wheel zoom off entirely, Shift included. Hence: zoom off at the source, the
 * key turning it back on, `preventScrolling` left ON so the zoom gesture cannot
 * also scroll, and the bare wheel stopped before xyflow sees it.
 */
export function wheelZoomProps(zoomOnWheel: boolean): {
  zoomOnScroll: boolean;
  zoomActivationKeyCode: string | null;
  preventScrolling: boolean;
  onWheelCapture?: (event: ReactWheelEvent<HTMLDivElement>) => void;
} {
  return zoomOnWheel
    ? { zoomOnScroll: true, zoomActivationKeyCode: null, preventScrolling: true }
    : {
        zoomOnScroll: false,
        zoomActivationKeyCode: "Shift",
        preventScrolling: true,
        onWheelCapture: keepBareWheelFromZooming,
      };
}

export type FlowCanvasProps = Omit<ReactFlowProps<FlowNode, Edge>, "nodes" | "edges" | "height"> & {
  nodes: FlowNode[];
  edges: Edge[];
  /** Background variant. Default: "dots". */
  background?: BackgroundVariant | "none";
  /** Show pan/zoom/fit controls. Default true. */
  showControls?: boolean;
  /** Show minimap. Default false (turn on for big graphs). */
  showMinimap?: boolean;
  /** Pixel height; FlowCanvas expects a sized container. Default 600. */
  height?: number | string;
  /**
   * Enforce port-type compatibility on new connections. `true` (default) uses
   * the built-in validator: a connection is refused only when both ports
   * declare a concrete, differing `type` (so untyped graphs are unaffected),
   * and self-loops are blocked. Pass options to tune the rule, or `false` to
   * disable. An `isValidConnection` you pass yourself always takes precedence.
   */
  validateConnections?: boolean | ConnectionValidatorOptions;
  /** Show alignment guide lines while dragging, and snap to them. Default off. */
  showHelperLines?: boolean;
  /**
   * A bare mouse wheel over the canvas zooms it. Default **true**.
   *
   * Turn it off for a canvas embedded mid-page, where a reader scrolling past
   * would otherwise get trapped zooming. With it off the wheel scrolls the page
   * and **Shift+wheel** zooms instead.
   *
   * Either way, a wheel gesture that zooms never also scrolls the page — the
   * two happening at once is the thing that makes an embedded canvas feel
   * broken.
   */
  zoomOnWheel?: boolean;
  /** Optional toolbar / palette etc. rendered above the canvas. */
  toolbar?: ReactNode;
  className?: string;
  style?: CSSProperties;
};

const DEFAULT_FIT_VIEW: FitViewOptions = { padding: 0.2 };
const DEFAULT_EDGE_OPTIONS: DefaultEdgeOptions = {
  type: "smoothstep",
  animated: false,
};

/**
 * FlowCanvas — themed React Flow surface with the kit's nodes registered
 * by default. Pass your own `nodeTypes` to extend; the kit's defaults are
 * merged behind yours.
 *
 * Hosts wire `onNodesChange` / `onEdgesChange` / `onConnect` themselves
 * (xyflow's standard pattern). The surrounding `useFlowState` hook in
 * `runtime/use-flow-state.ts` is a convenience that wires those for you.
 */
export function FlowCanvas({
  nodes,
  edges,
  background = BackgroundVariant.Dots,
  showControls = true,
  showMinimap = false,
  height = 600,
  validateConnections = true,
  isValidConnection,
  colorMode,
  showHelperLines = false,
  zoomOnWheel = true,
  onNodesChange,
  toolbar,
  nodeTypes,
  edgeTypes,
  className,
  style,
  ...rest
}: FlowCanvasProps) {
  const mergedNodeTypes = useMemo<NodeTypes>(
    () => ({ ...defaultNodeTypes, ...(nodeTypes ?? {}) }),
    [nodeTypes],
  );

  // Read nodes live through a ref so the validator (built once) always sees the
  // current graph without being rebuilt on every node change.
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const builtinValidator = useMemo(
    () =>
      validateConnections === false
        ? undefined
        : createConnectionValidator(
            () => nodesRef.current,
            validateConnections === true ? undefined : validateConnections,
          ),
    [validateConnections],
  );
  // A caller-supplied predicate wins; otherwise fall back to port-type validation.
  const resolvedIsValidConnection = isValidConnection ?? builtinValidator;

  const mergedEdgeTypes = useMemo<EdgeTypes | undefined>(
    () => (edgeTypes ? { ...edgeTypes } : undefined),
    [edgeTypes],
  );

  // xyflow requires a parent node to precede its children in the array; grouping
  // (swimlanes) can produce any order, so normalize it here at the boundary.
  // Sizes the canvas has measured, supplied to nodes that arrived without one,
  // so the minimap can draw a graph whose host never applies node changes (a
  // read-only FlowViewer). See measured-sizes.ts.
  const [measuredSizes, setMeasuredSizes] = useState<MeasuredSizes>({});
  const orderedNodes = useMemo(
    () => withMeasuredSizes(sortNodesParentFirst(nodes), measuredSizes),
    [nodes, measuredSizes],
  );

  // Helper lines: on a single-node drag, snap to aligned edges + show guides.
  const [helperLines, setHelperLines] = useState<{ horizontal?: number; vertical?: number }>({});
  const handleNodesChange = useCallback(
    (changes: any[]) => {
      setMeasuredSizes((previous) => collectMeasuredSizes(previous, changes));
      if (showHelperLines) {
        const pos = changes.filter((c) => c.type === "position" && c.position);
        if (pos.length === 1 && pos[0].dragging) {
          const lines = getHelperLines(pos[0], nodesRef.current);
          if (lines.snapPosition.x !== undefined) pos[0].position.x = lines.snapPosition.x;
          if (lines.snapPosition.y !== undefined) pos[0].position.y = lines.snapPosition.y;
          setHelperLines({ horizontal: lines.horizontal, vertical: lines.vertical });
        } else {
          setHelperLines({});
        }
      }
      onNodesChange?.(changes as any);
    },
    [showHelperLines, onNodesChange],
  );

  /**
   * An unset `colorMode` means "follow the app", NOT "light".
   *
   * It used to pass straight through to React Flow, whose own default is
   * light — so on a dark page React Flow's layer stayed light underneath our
   * `ff-` styles, which look right because they hang off an ancestor `.dark`.
   * Any node kind without a registered type falls back to React Flow's default
   * node: a white box with unreadable text on a dark canvas. Passing a mode
   * explicitly still wins.
   */
  const resolvedColorMode = useResolvedColorMode(colorMode);

  return (
    <div
      className={[
        "ff-canvas",
        // colorMode drives BOTH react-flow's chrome (below) and our `ff-` styles
        // via the shared `.dark` class / light opt-out — one theme signal.
        resolvedColorMode === "dark" ? "dark" : "",
        resolvedColorMode === "light" ? "ff-canvas--light" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ height, ...style }}
    >
      {toolbar && <div className="ff-canvas__toolbar">{toolbar}</div>}
      <div className="ff-canvas__surface">
        <ReactFlow
          nodes={orderedNodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          colorMode={resolvedColorMode}
          nodeTypes={mergedNodeTypes}
          edgeTypes={mergedEdgeTypes}
          fitView
          fitViewOptions={DEFAULT_FIT_VIEW}
          defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
          proOptions={{ hideAttribution: true }}
          // Wheel zooms by default; `zoomOnWheel={false}` moves that onto
          // Shift+wheel and gives the bare wheel back to the page. The three
          // props only make sense as a set — see wheelZoomProps.
          {...wheelZoomProps(zoomOnWheel)}
          isValidConnection={resolvedIsValidConnection}
          {...rest}
        >
          {background !== "none" && (
            <Background variant={background as BackgroundVariant} gap={20} size={1} color="rgba(0,0,0,0.18)" />
          )}
          {showControls && <Controls className="ff-controls" position="bottom-right" />}
          {showMinimap && (
            <MiniMap className="ff-minimap" pannable zoomable nodeColor={minimapNodeColor} nodeBorderRadius={4} />
          )}
          {showHelperLines && <HelperLines horizontal={helperLines.horizontal} vertical={helperLines.vertical} />}
        </ReactFlow>
      </div>
    </div>
  );
}
