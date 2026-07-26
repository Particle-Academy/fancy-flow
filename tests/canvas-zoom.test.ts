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
  ({ shiftKey, preventDefault: () => log.push(shiftKey ? "shift" : "bare") }) as any;

describe("wheel zoom — on (the default)", () => {
  const props = wheelZoomProps(true);

  it("zooms with no modifier held", () => {
    expect(props.zoomActivationKeyCode).toBeNull();
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

describe("wheel zoom — off", () => {
  const props = wheelZoomProps(false);

  it("moves zoom onto Shift+wheel", () => {
    expect(props.zoomActivationKeyCode).toBe("Shift");
  });

  it("gives the bare wheel back to the page", () => {
    const log: string[] = [];
    expect(props.preventScrolling).toBe(false);

    props.onWheelCapture?.(wheel(false, log));
    expect(log).toEqual([]);
  });

  it("still stops the page scrolling while Shift+wheel zooms", () => {
    // preventScrolling:false alone would let the zoom gesture scroll the page
    // too — the exact bug this handler exists to close.
    const log: string[] = [];

    props.onWheelCapture?.(wheel(true, log));
    expect(log).toEqual(["shift"]);
  });
});
