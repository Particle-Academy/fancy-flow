import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import type { FlowNode, NoteNodeData } from "../../types";

/**
 * NoteNode — annotation card with no ports. Useful for documenting graphs.
 * Body is plain text; hosts can wire onChange via the editor's onNodesChange
 * if they want it editable.
 */
function NoteNodeInner({ data, selected }: NodeProps<FlowNode>) {
  const noteData = data as NoteNodeData;
  return (
    <div className={`ff-note ${selected ? "ff-note--selected" : ""}`}>
      {noteData.label && <div className="ff-note__title">{noteData.label}</div>}
      {noteData.body && <p className="ff-note__body">{noteData.body}</p>}
    </div>
  );
}
export const NoteNode = memo(NoteNodeInner);
