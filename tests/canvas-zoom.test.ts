import { describe, expect, it } from "vitest";
import { wheelZoomProps } from "../src/components/canvas/FlowCanvas";

/**
 * What the mouse wheel does over the canvas.
 *
 * Asserted on the prop SET rather than by simulating a gesture: xyflow's zoom
 * lives in d3-zoom behind a real layout, so a jsdom simulation would be testing
 * our mock of it. The combination is the behaviour, and getting it wrong is
 * invisible in a screenshot — the canvas looks fine and feels broken.
 */
const wheel = (shiftKey: boolean, log: string[]) =>
  ({
    shiftKey,
    preventDefault: () => log.push(shiftKey ? "preventDefault:shift" : "preventDefault:bare"),
    stopPropagation: () => log.push(shiftKey ? "stopPropagation:shift" : "stopPropagation:bare"),
  }) as any;

describe("wheel zoom — on (the default)", () => {
  const props = wheelZoomProps(true);

  it("zooms with no modifier held", () => {
    expect(props.zoomActivationKeyCode).toBeNull();
    expect(props.zoomOnScroll).toBe(true);
  });

  it("never lets the page scroll under a wheel that is zooming", () => {
    // The two happening at once is the thing that makes a canvas feel broken.
    expect(props.preventScrolling).toBe(true);
  });

  it("installs no wheel handler", () => {
    // preventScrolling already covers it; a second mechanism would be a second
    // thing to keep in agreement with the first.
    expect(props.onWheelCapture).toBeUndefined();
  });
});

/**
 * Off mode is built out of what xyflow actually does, which is not what the
 * prop names suggest (fancy-flow#19, found by MOIC in a real browser):
 *
 * - its zoom filter reads `zoomActivationKeyPressed || zoomOnScroll`, so an
 *   activation key only ever ADDS permission. With `zoomOnScroll` left true,
 *   every wheel zooms and the key restricts nothing;
 * - its wheel handler returns early when `!preventScrolling && !event.ctrlKey`,
 *   so `preventScrolling: false` disables wheel zoom outright — Shift included.
 *
 * The old set had both, so Shift+wheel could never zoom, and the handler tried
 * to fix it with `preventDefault()` inside a React wheel listener, which React
 * attaches as PASSIVE: the call did nothing but log a browser warning.
 *
 * So: zoom is off at the source (`zoomOnScroll: false`), the Shift key turns it
 * on, and `preventScrolling` stays TRUE so the zooming gesture never also
 * scrolls. The bare wheel is kept away from xyflow entirely with
 * `stopPropagation`, which a passive listener CAN do — no preventDefault
 * anywhere, so the page scrolls natively.
 */
describe("wheel zoom — off", () => {
  const props = wheelZoomProps(false);

  it("moves zoom onto Shift+wheel, and off the bare wheel at the source", () => {
    expect(props.zoomActivationKeyCode).toBe("Shift");
    // Not `zoomOnScroll: true`: the filter would let every wheel zoom.
    expect(props.zoomOnScroll).toBe(false);
  });

  it("keeps preventScrolling on, or xyflow refuses to zoom at all", () => {
    // `!preventScrolling && isWheel && !ctrlKey` returns before zooming.
    expect(props.preventScrolling).toBe(true);
  });

  it("gives the bare wheel back to the page without touching preventDefault", () => {
    const log: string[] = [];

    props.onWheelCapture?.(wheel(false, log));

    // Stopped before xyflow can preventDefault it; nothing prevented here, so a
    // passive listener is fine and the page scrolls as it always did.
    expect(log).toEqual(["stopPropagation:bare"]);
  });

  it("lets Shift+wheel through to xyflow, which zooms it and stops the scroll", () => {
    const log: string[] = [];

    props.onWheelCapture?.(wheel(true, log));

    expect(log).toEqual([]);
  });
});
