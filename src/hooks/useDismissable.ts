import { useEffect, useRef, type RefObject } from "react";

/**
 * Small helper for the app's overlay surfaces (notification panel, mobile
 * drawer). It provides the two behaviours both need and that are easy to get
 * wrong inline:
 *
 * - **Escape closes**, and only while the surface is open.
 * - **Focus returns to the trigger** on close, so a keyboard user is not
 *   dropped at the top of the document.
 *
 * It deliberately does not implement a focus trap. Neither surface is modal
 * (the notification panel is a non-modal popover and the drawer does not block
 * the page from being reachable once closed), and a partial trap is worse than
 * none. Full modal semantics would justify a real trap, but that is a larger
 * change than this phase calls for.
 */
export function useDismissable(
  isOpen: boolean,
  onDismiss: () => void,
  triggerRef?: RefObject<HTMLElement | null>
) {
  // Keep the latest callback without re-binding the listener on every render.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        dismissRef.current();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  // Returning focus on close keeps keyboard position predictable.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (isOpen) {
      wasOpen.current = true;
      return;
    }
    if (wasOpen.current) {
      wasOpen.current = false;
      triggerRef?.current?.focus();
    }
  }, [isOpen, triggerRef]);
}
