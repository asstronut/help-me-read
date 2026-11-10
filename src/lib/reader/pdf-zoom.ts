/** A PDF page is measured in points (72 to the inch); CSS has 96 pixels to the inch. */
export const CSS_PX_PER_POINT = 96 / 72;

/** The zooms − and + move through, as shares of the page's real size. */
export const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4] as const;

// A fitted page is rarely exactly on a step: within half a percent counts as being on it.
const SAME = 0.005;

/** The next step above (`dir` 1) or below (-1) `scale`; null when there is none. */
export function zoomStep(scale: number, dir: 1 | -1): number | null {
  if (dir === 1) return ZOOM_STEPS.find((s) => s > scale + SAME) ?? null;
  return ZOOM_STEPS.findLast((s) => s < scale - SAME) ?? null;
}
