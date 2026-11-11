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

const accents = new Map<string, number | null>();
export function faviconAccent(host: string, image: HTMLImageElement): number | null {
  if (accents.has(host)) return accents.get(host)!;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 16;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0, 16, 16);
  const accent = extractAccent(context.getImageData(0, 0, 16, 16).data);
  accents.set(host, accent);
  return accent;
}
