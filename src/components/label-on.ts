import type { CSSProperties } from "react";

/**
 * Spread beside an inline accent, on a surface in the stylesheet's "Labels on a
 * colour" rule, so its label can be worked out from the colour it sits on:
 *
 *   <header className="ff-node__header" style={{ background: accent, ...labelOn(accent) }}>
 *
 * The stylesheet cannot read another property's value, so it has to be told. Without
 * this the label falls back to white, which is what a hand-written header still gets.
 */
export function labelOn(background: string): CSSProperties {
  return { "--ff-private-label-on": background } as CSSProperties;
}
