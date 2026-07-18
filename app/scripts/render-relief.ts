// Renders an oblique-projected patch of the real world (tops shaded by
// level + dark south walls) so the relief can be eyeballed before commit.
// Usage: bun scripts/render-relief.ts [sizeTiles=64] [originX=0] [originY=0]

import sharp from "sharp";
import { getWorldTile, type Terrain } from "../src/lib/world/world-gen";
import { brightnessFor, levelFor, wallStripsFor } from "../src/lib/world/projection";

const COLORS: Record<Terrain, [number, number, number]> = {
  deep_water: [42, 79, 158],
  water: [63, 118, 228],
  river: [79, 134, 232],
  beach: [219, 203, 158],
  grass: [145, 189, 89],
  forest: [95, 156, 74],
  jungle: [64, 165, 50],
  swamp: [106, 112, 57],
  desert: [229, 216, 172],
  savanna: [191, 183, 85],
  tundra: [128, 180, 151],
  snow: [240, 244, 248],
  taiga: [134, 183, 131],
  rock: [130, 130, 130],
  snow_rock: [210, 215, 222],
};

const size = Number(process.argv[2] ?? 64);
const ox = Number(process.argv[3] ?? 0);
const oy = Number(process.argv[4] ?? 0);
const CELL = 8; // px per tile
const STEP = CELL / 2; // px per level (half-block feel)
const PAD = 13 * STEP;
const W = size * CELL;
const H = size * CELL + 2 * PAD;
const buf = Buffer.alloc(W * H * 3);

function px(x: number, y: number, r: number, g: number, b: number) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  buf[i] = r;
  buf[i + 1] = g;
  buf[i + 2] = b;
}

// North to south so southern tiles paint over hanging walls.
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const t = getWorldTile(ox + x, oy + y);
    const level = levelFor(t);
    const south = levelFor(getWorldTile(ox + x, oy + y + 1));
    const strips = wallStripsFor(level, south);
    const [r, g, b] = COLORS[t.terrain];
    const shade = brightnessFor(level);
    const topY = PAD + y * CELL - level * STEP;
    // wall first
    for (let wy = 0; wy < strips * STEP; wy++) {
      for (let wx = 0; wx < CELL; wx++) {
        px(x * CELL + wx, topY + CELL + wy, 74, 53, 39);
      }
    }
    // top
    for (let ty2 = 0; ty2 < CELL; ty2++) {
      for (let tx2 = 0; tx2 < CELL; tx2++) {
        px(
          x * CELL + tx2,
          topY + ty2,
          Math.round(r * shade),
          Math.round(g * shade),
          Math.round(b * shade),
        );
      }
    }
  }
}

await sharp(buf, { raw: { width: W, height: H, channels: 3 } })
  .png()
  .toFile("world-relief.png");
console.log(`world-relief.png: ${W}x${H}, ${size}x${size} tiles from (${ox},${oy})`);
