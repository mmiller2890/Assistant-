/**
 * True when a scroll container sits at or near its bottom edge. Used to decide
 * whether a live feed should stay pinned to the newest content: if the user has
 * scrolled up to re-read earlier turns, new content must NOT yank them back
 * down. Content shorter than the viewport counts as "at bottom" (nothing to
 * scroll), so the very first turns still pin correctly.
 */
export function isNearBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  threshold = 80
): boolean {
  return scrollHeight - scrollTop - clientHeight <= threshold;
}
