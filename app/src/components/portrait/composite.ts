// app/src/components/portrait/composite.ts
// Loads and composites portrait layers on a canvas. White mod art is
// tinted via multiply + destination-in (preserves the layer's alpha).
import type { PortraitManifest, SelectedLayer } from "@/lib/portrait-selection";

let manifestPromise: Promise<PortraitManifest> | null = null;

export function loadManifest(): Promise<PortraitManifest> {
  if (!manifestPromise) {
    manifestPromise = fetch("/portraits/manifest.json").then((r) => {
      if (!r.ok) throw new Error(`manifest fetch failed: ${r.status}`);
      return r.json() as Promise<PortraitManifest>;
    });
    // Allow retry after a transient failure instead of caching the rejection.
    manifestPromise.catch(() => { manifestPromise = null; });
  }
  return manifestPromise;
}

const imageCache = new Map<string, Promise<HTMLImageElement>>();

function loadImage(url: string): Promise<HTMLImageElement> {
  let p = imageCache.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`portrait layer failed to load: ${url}`));
      img.src = url;
    });
    p.catch(() => { imageCache.delete(url); });
    imageCache.set(url, p);
  }
  return p;
}

function tinted(img: HTMLImageElement, color: string): HTMLCanvasElement {
  const off = document.createElement("canvas");
  off.width = img.naturalWidth;
  off.height = img.naturalHeight;
  const ctx = off.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, off.width, off.height);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(img, 0, 0);
  return off;
}

export async function compositePortrait(
  canvas: HTMLCanvasElement,
  layers: SelectedLayer[],
): Promise<void> {
  const images = await Promise.all(layers.map((l) => loadImage(l.url)));
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  layers.forEach((layer, i) => {
    const source = layer.tint ? tinted(images[i], layer.tint) : images[i];
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  });
}
