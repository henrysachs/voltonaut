import type { CenterlinePoint, ElevationSample } from "@voltonaut/engine";

/** SVG preview box the Strecke cards render the centerline into (#75). */
export const PREVIEW_WIDTH_PX = 132;
export const PREVIEW_HEIGHT_PX = 84;
const PREVIEW_PADDING_PX = 8;

/** Sum of all positive elevation steps along the profile, rounded to metres. */
export function routeElevationGainM(samples: readonly ElevationSample[]): number {
  let gainM = 0;

  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];

    if (previous === undefined || current === undefined) continue;

    const stepM = current.elevationM - previous.elevationM;

    if (stepM > 0) gainM += stepM;
  }

  return Math.round(gainM);
}

/** Route length for a card label: "8 km", "12.5 km". */
export function formatRouteLength(lengthM: number): string {
  const lengthKm = lengthM / 1000;

  return `${Number.isInteger(lengthKm) ? lengthKm : Number(lengthKm.toFixed(1))} km`;
}

/**
 * SVG path for the route shape: the centerline scaled to fit the preview box,
 * aspect preserved, one decimal per coordinate. Loops include their closing
 * point, so the path ends where it starts.
 */
export function routePreviewPath(
  centerline: readonly CenterlinePoint[],
  widthPx = PREVIEW_WIDTH_PX,
  heightPx = PREVIEW_HEIGHT_PX,
  paddingPx = PREVIEW_PADDING_PX,
): string {
  if (centerline.length < 2) {
    throw new RangeError("a route preview needs at least two centerline points");
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (const point of centerline) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }

  const spanX = maxX - minX;
  const spanZ = maxZ - minZ;

  if (spanX <= 0 || spanZ <= 0) {
    throw new RangeError("a route preview needs a two-dimensional centerline");
  }

  const innerWidthPx = widthPx - 2 * paddingPx;
  const innerHeightPx = heightPx - 2 * paddingPx;
  const scalePx = Math.min(innerWidthPx / spanX, innerHeightPx / spanZ);
  const offsetX = paddingPx + (innerWidthPx - spanX * scalePx) / 2;
  const offsetY = paddingPx + (innerHeightPx - spanZ * scalePx) / 2;
  const segments: string[] = [];

  for (const [index, point] of centerline.entries()) {
    const xPx = offsetX + (point.x - minX) * scalePx;
    const yPx = offsetY + (maxZ - point.z) * scalePx;
    const command = index === 0 ? "M" : "L";

    segments.push(`${command} ${xPx.toFixed(1)} ${yPx.toFixed(1)}`);
  }

  return segments.join(" ");
}
