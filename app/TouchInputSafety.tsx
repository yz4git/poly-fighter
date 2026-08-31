"use client";

import { useEffect } from "react";

const TOUCH_CONTROL_SELECTOR = ".virtual-pad, .touch-action";

type ActivePointer = {
  target: HTMLElement;
  pointerType: string;
  isPrimary: boolean;
};

function closestTouchControl(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>(TOUCH_CONTROL_SELECTOR);
}

function createSyntheticPointerCancel(pointerId: number, pointerType: string, isPrimary: boolean): Event {
  try {
    return new PointerEvent("pointercancel", {
      bubbles: true,
      cancelable: false,
      pointerId,
      pointerType,
      isPrimary,
    });
  } catch {
    // Older Safari builds can reject direct PointerEvent construction even when
    // native pointer events themselves are available. Preserve the fields React
    // uses so the existing onPointerCancel handlers can still release ownership.
    const fallback = new Event("pointercancel", { bubbles: true, cancelable: false });
    Object.defineProperties(fallback, {
      pointerId: { configurable: true, value: pointerId },
      pointerType: { configurable: true, value: pointerType },
      isPrimary: { configurable: true, value: isPrimary },
    });
    return fallback;
  }
}

/**
 * Global safety net for iPhone Safari pointer ownership.
 *
 * The game controls already release themselves on pointerup / pointercancel /
 * lostpointercapture. Safari can occasionally end a system gesture, app switch,
 * or interrupted multi-touch sequence without delivering that terminal event to
 * the original React element. When that happens a direction owner can remain
 * pressed forever and the virtual pad refuses the next pointer because it still
 * believes the old pointer owns it.
 *
 * This capture-phase registry remembers the actual control element that began
 * each pointer. Any terminal browser/lifecycle signal explicitly releases native
 * pointer capture and sends that same element a synthetic pointercancel. That
 * deliberately routes recovery through the control's normal React cleanup path,
 * keeping game input ownership, VirtualPadTracker state, and knob UI in sync.
 */
export default function TouchInputSafety() {
  useEffect(() => {
    const activePointers = new Map<number, ActivePointer>();

    const releasePointer = (pointerId: number) => {
      const active = activePointers.get(pointerId);
      if (!active) return;
      // Delete before dispatch so releasePointerCapture/lostpointercapture cannot
      // recursively release the same pointer.
      activePointers.delete(pointerId);

      try {
        if (active.target.hasPointerCapture?.(pointerId)) {
          active.target.releasePointerCapture?.(pointerId);
        }
      } catch {
        // Pointer capture may already have been dropped by Safari. The synthetic
        // cancel below is the authoritative cleanup path.
      }

      if (!active.target.isConnected) return;
      active.target.dispatchEvent(
        createSyntheticPointerCancel(pointerId, active.pointerType, active.isPrimary),
      );
    };

    const releaseAll = () => {
      for (const pointerId of [...activePointers.keys()]) releasePointer(pointerId);
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = closestTouchControl(event.target);
      if (!target) return;
      activePointers.set(event.pointerId, {
        target,
        pointerType: event.pointerType || "touch",
        isPrimary: event.isPrimary,
      });
    };

    const onPointerFinished = (event: PointerEvent) => releasePointer(event.pointerId);
    const onLostPointerCapture = (event: PointerEvent) => {
      // Queue behind the native lost-capture event. If the component's own
      // handler already cleaned up, this becomes a harmless no-op.
      if (!activePointers.has(event.pointerId)) return;
      queueMicrotask(() => releasePointer(event.pointerId));
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") releaseAll();
    };
    const onTouchEnd = (event: TouchEvent) => {
      // Fallback for rare WebKit sequences where the final touchend exists but
      // the corresponding pointerup never reaches the pointer pipeline.
      if (event.touches.length === 0) releaseAll();
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointerup", onPointerFinished, true);
    window.addEventListener("pointercancel", onPointerFinished, true);
    document.addEventListener("lostpointercapture", onLostPointerCapture, true);
    window.addEventListener("blur", releaseAll);
    window.addEventListener("focus", releaseAll);
    window.addEventListener("pagehide", releaseAll);
    window.addEventListener("orientationchange", releaseAll);
    document.addEventListener("visibilitychange", onVisibilityChange);
    document.addEventListener("touchend", onTouchEnd, true);
    document.addEventListener("touchcancel", releaseAll, true);

    return () => {
      releaseAll();
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointerup", onPointerFinished, true);
      window.removeEventListener("pointercancel", onPointerFinished, true);
      document.removeEventListener("lostpointercapture", onLostPointerCapture, true);
      window.removeEventListener("blur", releaseAll);
      window.removeEventListener("focus", releaseAll);
      window.removeEventListener("pagehide", releaseAll);
      window.removeEventListener("orientationchange", releaseAll);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      document.removeEventListener("touchend", onTouchEnd, true);
      document.removeEventListener("touchcancel", releaseAll, true);
    };
  }, []);

  return null;
}
