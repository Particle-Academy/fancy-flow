import { ViewportPortal } from "@xyflow/react";

/**
 * HelperLines — alignment guides drawn during a drag. Rendered in flow
 * coordinate space (ViewportPortal), so the lines track pan/zoom. Positions come
 * from `getHelperLines`.
 */
export function HelperLines({ horizontal, vertical }: { horizontal?: number; vertical?: number }) {
  if (horizontal === undefined && vertical === undefined) return null;
  return (
    <ViewportPortal>
      {vertical !== undefined && (
        <div
          className="ff-helper-line"
          style={{ position: "absolute", transform: `translateX(${vertical}px)`, top: -5000, height: 10000, width: 1, pointerEvents: "none" }}
        />
      )}
      {horizontal !== undefined && (
        <div
          className="ff-helper-line"
          style={{ position: "absolute", transform: `translateY(${horizontal}px)`, left: -5000, width: 10000, height: 1, pointerEvents: "none" }}
        />
      )}
    </ViewportPortal>
  );
}
