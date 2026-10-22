import { type RefObject, useEffect } from "react";

/** How close to the edge of the screen the pointer must be to start scrolling, in pixels. */
const zone = 56;
const fastest = 18;

/**
 * Scrolls a container sideways while a Ticket is held near its left or right
 * edge, so a phone can carry a Ticket to a Status that is off screen. The
 * pointer decides, not the held Ticket: a Ticket nearly as wide as the screen
 * always touches an edge, so scrolling by its box would never stop.
 */
export function useEdgeScroll(scroller: RefObject<HTMLElement | null>, holding: boolean) {
  useEffect(() => {
    if (!holding) return;
    let x: number | null = null;
    const fromPointer = (event: PointerEvent) => {
      x = event.clientX;
    };
    const fromTouch = (event: TouchEvent) => {
      x = event.touches[0]?.clientX ?? x;
    };
    window.addEventListener("pointermove", fromPointer);
    window.addEventListener("touchmove", fromTouch, { passive: true });

    let frame = 0;
    const tick = () => {
      const el = scroller.current;
      if (el && x !== null) {
        const box = el.getBoundingClientRect();
        const left = Math.max(box.left, 0) + zone;
        const right = Math.min(box.right, window.innerWidth) - zone;
        const depth = x < left ? x - left : x > right ? x - right : 0;
        if (depth !== 0) {
          el.scrollLeft += Math.sign(depth) * Math.min(fastest, 3 + (Math.abs(depth) / zone) * 15);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", fromPointer);
      window.removeEventListener("touchmove", fromTouch);
    };
  }, [scroller, holding]);
}
