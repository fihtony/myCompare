/**
 * Hook for synchronized vertical scrolling between left pane, center col, and right pane.
 * Each pane has its own independent horizontal scroll (not synced).
 *
 * Layout assumption:
 *   .fd-left-pane   — overflow: auto (both X and Y)
 *   .fd-center-pane — overflow-y: scroll, overflow-x: hidden (Y only, no X)
 *   .fd-right-pane  — overflow: auto (both X and Y) — vertical scrollbar hidden via CSS
 *
 * Decision points (confirmed by user):
 *   1. JS scrollTop sync (precise, ~1 frame delay) — not virtual scroll
 *   2. Right vertical scrollbar hidden (scrollbar-width:none)
 *   3. Horizontal scroll is independent — left and right scroll separately
 */
import { useRef, useCallback } from "react";

export function useSyncScroll() {
  const leftPaneRef = useRef<HTMLDivElement>(null);
  const centerPaneRef = useRef<HTMLDivElement>(null);
  const rightPaneRef = useRef<HTMLDivElement>(null);
  /** Prevents re-entrant scroll sync bounce. */
  const syncingRef = useRef(false);

  const onLeftScroll = useCallback(() => {
    if (syncingRef.current) return;
    const left = leftPaneRef.current;
    const center = centerPaneRef.current;
    const right = rightPaneRef.current;
    if (!left) return;
    syncingRef.current = true;
    if (center) center.scrollTop = left.scrollTop;
    if (right) right.scrollTop = left.scrollTop;
    syncingRef.current = false;
  }, []);

  const onRightScroll = useCallback(() => {
    if (syncingRef.current) return;
    const left = leftPaneRef.current;
    const center = centerPaneRef.current;
    const right = rightPaneRef.current;
    if (!right) return;
    syncingRef.current = true;
    if (left) left.scrollTop = right.scrollTop;
    if (center) center.scrollTop = right.scrollTop;
    syncingRef.current = false;
  }, []);

  return { leftPaneRef, centerPaneRef, rightPaneRef, onLeftScroll, onRightScroll };
}
