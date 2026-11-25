import { createContext, memo, useContext } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { MermaidDirection, MermaidNodeMeta, MermaidShape } from "../../mermaid/types";
import type { FlowNode } from "../../types";

/** Each node's effective direction, so handles sit where edges arrive. */
export const MermaidDirections = createContext<ReadonlyMap<string, MermaidDirection>>(new Map());

const SIDES: Record<MermaidDirection, [Position, Position]> = {
  TB: [Position.Top, Position.Bottom],
  BT: [Position.Bottom, Position.Top],
  LR: [Position.Left, Position.Right],
  RL: [Position.Right, Position.Left],
};

function Shape({ shape, w, h }: { shape: MermaidShape; w: number; h: number }) {
  const poly = (points: Array<[number, number]>) => <polygon points={points.map((p) => p.join(",")).join(" ")} />;
  const inset = 14;
  let body;
  switch (shape) {
    case "round":
      body = <rect x={1} y={1} width={w - 2} height={h - 2} rx={12} />;
      break;
    case "stadium":
      body = <rect x={1} y={1} width={w - 2} height={h - 2} rx={(h - 2) / 2} />;
      break;
    case "subroutine":
      body = (
        <>
          <rect x={1} y={1} width={w - 2} height={h - 2} />
          <line x1={9} y1={1} x2={9} y2={h - 1} />
          <line x1={w - 9} y1={1} x2={w - 9} y2={h - 1} />
        </>
      );
      break;
    case "cylinder": {
      const rx = (w - 2) / 2;
      const ry = 8;
      body = (
        <>
          <path d={`M1 ${ry} A ${rx} ${ry} 0 0 0 ${w - 1} ${ry} V ${h - ry} A ${rx} ${ry} 0 0 1 1 ${h - ry} Z`} />
          <path d={`M1 ${ry} A ${rx} ${ry} 0 0 1 ${w - 1} ${ry}`} />
        </>
      );
      break;
    }
    case "circle":
      body = <circle cx={w / 2} cy={h / 2} r={Math.min(w, h) / 2 - 1} />;
      break;
    case "double-circle":
      body = (
        <>
          <circle cx={w / 2} cy={h / 2} r={Math.min(w, h) / 2 - 1} />
          <circle cx={w / 2} cy={h / 2} r={Math.min(w, h) / 2 - 6} />
        </>
      );
      break;
    case "asymmetric":
      body = poly([[1, 1], [w - 1, 1], [w - 1, h - 1], [1, h - 1], [inset, h / 2]]);
      break;
    case "diamond":
      body = poly([[w / 2, 1], [w - 1, h / 2], [w / 2, h - 1], [1, h / 2]]);
      break;
    case "hexagon":
      body = poly([[inset, 1], [w - inset, 1], [w - 1, h / 2], [w - inset, h - 1], [inset, h - 1], [1, h / 2]]);
      break;
    case "parallelogram":
      body = poly([[inset, 1], [w - 1, 1], [w - inset, h - 1], [1, h - 1]]);
      break;
    case "parallelogram-alt":
      body = poly([[1, 1], [w - inset, 1], [w - 1, h - 1], [inset, h - 1]]);
      break;
    case "trapezoid":
      body = poly([[inset, 1], [w - inset, 1], [w - 1, h - 1], [1, h - 1]]);
      break;
    case "trapezoid-alt":
      body = poly([[1, 1], [w - 1, 1], [w - inset, h - 1], [inset, h - 1]]);
      break;
    default:
      body = <rect x={1} y={1} width={w - 2} height={h - 2} rx={4} />;
  }
  return (
    <svg className="ff-mnode__shape" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden focusable="false">
      {body}
    </svg>
  );
}

/**
 * One imported Mermaid node, drawn read-only. The label is a React text child:
 * whatever it contains, it is never parsed as markup.
 */
function MermaidNodeInner({ id, data, width, height }: NodeProps<FlowNode>) {
  const meta = (data as unknown as { mermaid?: MermaidNodeMeta }).mermaid;
  const label = typeof data.label === "string" ? data.label : "";
  const direction = useContext(MermaidDirections).get(id) ?? "TB";
  const [inSide, outSide] = SIDES[direction];
  const handles = (
    <>
      <Handle type="target" position={inSide} isConnectable={false} className="ff-mnode__handle" />
      <Handle type="source" position={outSide} isConnectable={false} className="ff-mnode__handle" />
    </>
  );

  if (meta?.subgraph) {
    return (
      <div className="ff-mgroup" data-mermaid-node={id} data-mermaid-subgraph="">
        <div className="ff-mgroup__title">{label}</div>
        {handles}
      </div>
    );
  }

  const shape = meta?.shape ?? "rect";
  const w = Math.max(1, Math.round(width ?? 120));
  const h = Math.max(1, Math.round(height ?? 48));
  return (
    <div className="ff-mnode" data-mermaid-node={id} data-mermaid-shape={shape} style={{ width: w, height: h }}>
      <Shape shape={shape} w={w} h={h} />
      <span className="ff-mnode__label">{label}</span>
      {handles}
    </div>
  );
}

export const MermaidNode = memo(MermaidNodeInner);
