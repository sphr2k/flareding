/** Hue voting avoids washing complementary foreground/background colors to gray. */
export function extractAccent(pixels: ArrayLike<number>): number | null {
  const buckets = Array.from({ length: 36 }, () => ({ weight: 0, x: 0, y: 0 }));
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i] / 255,
      g = pixels[i + 1] / 255,
      b = pixels[i + 2] / 255;
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b),
      delta = max - min;
    const saturation = max ? delta / max : 0;
    if (pixels[i + 3] < 128 || max < 0.15 || min > 0.9 || saturation < 0.25) continue;
    let hue =
      max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
    hue = (hue * 60 + 360) % 360;
    const weight = (saturation * pixels[i + 3]) / 255;
    const bucket = buckets[Math.floor(hue / 10)];
    bucket.weight += weight;
    bucket.x += Math.cos((hue * Math.PI) / 180) * weight;
    bucket.y += Math.sin((hue * Math.PI) / 180) * weight;
  }
  const winner = buckets.reduce((a, b) => (a.weight >= b.weight ? a : b));
  return winner.weight < 2 ? null : ((Math.atan2(winner.y, winner.x) * 180) / Math.PI + 360) % 360;
}

/**
 * Transparent, near-black brand marks disappear on a dark card surface.
 * Use an opaque neutral light tile behind predominantly dark pixels; keep
 * the original favicon colors and alpha channel unchanged.
 *
 * Pixels with very low alpha do not influence the decision. Bright details
 * prevent a dark-background favicon with contrasting text being misclassified.
 */
export function needsLightBacking(pixels: ArrayLike<number>): boolean {
  let total = 0;
  let dark = 0;
  let bright = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3] / 255;
    if (alpha < 0.25) continue;
    const r = pixels[i] / 255;
    const g = pixels[i + 1] / 255;
    const b = pixels[i + 2] / 255;
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    total += alpha;
    if (luminance < 0.3) dark += alpha;
    if (luminance > 0.52) bright += alpha;
  }
  return total > 2 && dark / total >= 0.72 && bright / total < 0.12;
}

export interface FaviconAppearance {
  accent: number | null;
  needsLightBacking: boolean;
}

const appearances = new Map<string, FaviconAppearance>();
export function analyzeFavicon(host: string, image: HTMLImageElement): FaviconAppearance {
  const cached = appearances.get(host);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 16;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return { accent: null, needsLightBacking: false };
  context.drawImage(image, 0, 0, 16, 16);
  const pixels = context.getImageData(0, 0, 16, 16).data;
  const result = {
    accent: extractAccent(pixels),
    needsLightBacking: needsLightBacking(pixels),
  };
  appearances.set(host, result);
  return result;
}
