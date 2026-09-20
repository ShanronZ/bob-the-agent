import { useEffect, useRef, useState } from "react";

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

// Animates a stat tile's number counting up (or down) to a new target
// whenever it changes, instead of the value just snapping — the signature
// move of a polished analytics dashboard. `null` (no data yet) passes
// straight through so the caller can render its own placeholder.
export function useCountUp(target: number | null, durationMs = 700): number | null {
  const [display, setDisplay] = useState(target ?? 0);
  const fromRef = useRef(target ?? 0);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (target === null) return;
    const from = fromRef.current;
    if (from === target) return;

    const reduceMotion =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const start = performance.now();
    const tick = (now: number) => {
      if (reduceMotion) {
        setDisplay(target);
        fromRef.current = target;
        return;
      }
      const elapsed = now - start;
      const t = Math.min(1, elapsed / durationMs);
      const value = from + (target - from) * easeOutCubic(t);
      setDisplay(value);
      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };
    frameRef.current = requestAnimationFrame(tick);

    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [target, durationMs]);

  return target === null ? null : display;
}
