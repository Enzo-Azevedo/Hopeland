// app/scripts/build-portraits.mjs
// Converts curated portrait sources (assets/portraits/source) into
// 320x320 WebP layers + manifest.json under app/public/portraits.
// Run manually when curation changes: bun run build:portraits
import sharp from "sharp";
import { mkdir, readdir, rm, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = path.join(ROOT, "assets", "portraits", "source");
const OUT = path.join(ROOT, "app", "public", "portraits");
const SIZE = 320;
const MAX_BYTES = 60 * 1024;

// z-order bottom -> top; tint: which derived color multiplies the layer
const LAYERS = [
  { key: "neck",    tint: "skin" },
  { key: "clothes", tint: null  },
  { key: "head",    tint: "skin" },
  { key: "face-inner", tint: "skin" },
  { key: "face-outer", tint: null  },
  { key: "beard",   tint: "hair" },
  { key: "hair",    tint: "hair" },
];

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const manifest = {
  version: 1,
  size: SIZE,
  credit: "Portrait assets by TwoPenny — Portraits of the Rim (Nexus 425)",
  layers: {},
};

let failures = 0;
for (const { key, tint } of LAYERS) {
  const dir = path.join(SRC, key);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".png")).sort();
  if (files.length === 0) { console.error(`EMPTY layer dir: ${dir}`); failures++; continue; }
  await mkdir(path.join(OUT, key), { recursive: true });
  const variants = {};
  for (const file of files) {
    const variant = file.replace(/\.png$/, "");
    const rel = `${key}/${variant}.webp`;
    const outFile = path.join(OUT, key, `${variant}.webp`);
    await sharp(path.join(dir, file))
      .resize(SIZE, SIZE, { fit: "contain" })
      .webp({ quality: 80 })
      .toFile(outFile);
    const { size } = await stat(outFile);
    if (size > MAX_BYTES) { console.error(`TOO BIG (${size}B): ${rel}`); failures++; }
    variants[variant] = rel;
  }
  manifest.layers[key] = { tint, variants };
}

await writeFile(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`portraits: ${Object.values(manifest.layers).reduce((n, l) => n + Object.keys(l.variants).length, 0)} variants -> ${OUT}`);
if (failures > 0) { console.error(`${failures} validation failure(s)`); process.exit(1); }
