import type { CSSProperties } from "react";

export type FlowRunControlsProps = {
  running: boolean;
  onRun: () => void;
  onCancel?: () => void;
  onReset?: () => void;
  className?: string;
  style?: CSSProperties;
};

/** FlowRunControls — Run / Cancel / Reset buttons. Wire to a `useFlowRun`. */
export function FlowRunControls({ running, onRun, onCancel, onReset, className, style }: FlowRunControlsProps) {
  return (
    <div className={["ff-run-controls", className ?? ""].filter(Boolean).join(" ")} style={style}>
      {!running ? (
        <button type="button" className="ff-run-controls__btn ff-run-controls__btn--run" onClick={onRun}>
          ▶ Run
        </button>
      ) : (
        <button type="button" className="ff-run-controls__btn ff-run-controls__btn--cancel" onClick={onCancel}>
          ⏹ Cancel
        </button>
      )}
      {onReset && (
        <button type="button" className="ff-run-controls__btn ff-run-controls__btn--reset" onClick={onReset} disabled={running}>
          Reset
        </button>
      )}
    </div>
  );
}
