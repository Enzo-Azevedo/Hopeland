// app/scripts/build-tiles.mjs
// Builds public/tiles/atlas.png + atlas.json from assets/tiles/source/.
// Grayscale Minecraft textures (grass, water) are tinted per terrain with a
// multiply blend, mirroring Minecraft's biome colormap approach.
// Output is committed — the Cloudflare build never runs this.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const SRC = path.resolve(import.meta.dirname, "../../assets/tiles/source");
const OUT = path.resolve(import.meta.dirname, "../public/tiles");
const TILE = 32;
const COLUMNS = 8;

const tint = (hex) => async (file) =>
  sharp(path.join(SRC, file))
    .extract({ left: 0, top: 0, width: TILE, height: TILE })
    .composite([{ input: { create: { width: TILE, height: TILE, channels: 4, background: hex } }, blend: "multiply" }])
    .png()
    .toBuffer();

const plain = () => async (file) =>
  sharp(path.join(SRC, file))
    .extract({ left: 0, top: 0, width: TILE, height: TILE })
    .png()
    .toBuffer();

// Water: crop 4 frames (rows 0-3) from the animation strip, then tint.
const waterFrame = (row, hex) => async (file) =>
  sharp(path.join(SRC, file))
    .extract({ left: 0, top: row * TILE, width: TILE, height: TILE })
    .composite([{ input: { create: { width: TILE, height: TILE, channels: 4, background: hex } }, blend: "multiply" }])
    .png()
    .toBuffer();

// name -> { file, make } ; order defines frame indices.
const FRAME_DEFS = [];
const TERRAIN = {};
const WATER_FRAMES = {};

function def(terrain, name, file, make) {
  FRAME_DEFS.push({ name, file, make });
  (TERRAIN[terrain] ??= []).push(FRAME_DEFS.length - 1);
}

// Land terrains (variants: primary first).
def("grass", "grass_0", "grass_block_top.png", tint("#91BD59"));
def("grass", "grass_1", "moss_block.png", tint("#A5C97A"));
def("forest", "forest_0", "grass_block_top.png", tint("#79C05A"));
def("forest", "forest_1", "moss_block.png", tint("#79C05A"));
def("jungle", "jungle_0", "grass_block_top.png", tint("#59C93C"));
def("jungle", "jungle_1", "moss_block.png", tint("#59C93C"));
def("savanna", "savanna_0", "grass_block_top.png", tint("#BFB755"));
def("savanna", "savanna_1", "coarse_dirt.png", plain());
def("taiga", "taiga_0", "podzol_top.png", plain());
def("taiga", "taiga_1", "grass_block_top.png", tint("#86B783"));
def("tundra", "tundra_0", "grass_block_top.png", tint("#80B497"));
def("tundra", "tundra_1", "coarse_dirt.png", plain());
def("swamp", "swamp_0", "mud.png", plain());
def("swamp", "swamp_1", "grass_block_top.png", tint("#6A7039"));
def("desert", "desert_0", "sand.png", plain());
def("desert", "desert_1", "sandstone_top.png", plain());
def("beach", "beach_0", "sand.png", plain());
def("snow", "snow_0", "snow.png", plain());
def("rock", "rock_0", "stone.png", plain());
def("rock", "rock_1", "andesite.png", plain());
def("snow_rock", "snow_rock_0", "snow.png", plain());
def("snow_rock", "snow_rock_1", "gravel.png", plain());

// Water animation frames.
for (const [terrain, hex] of [
  ["water", "#3F76E4"],
  ["deep_water", "#2A4F9E"],
  ["river", "#4F86E8"],
]) {
  WATER_FRAMES[terrain] = [];
  for (let row = 0; row < 4; row++) {
    FRAME_DEFS.push({ name: `${terrain}_${row}`, file: "water_still.png", make: waterFrame(row, hex) });
    WATER_FRAMES[terrain].push(FRAME_DEFS.length - 1);
  }
  TERRAIN[terrain] = [WATER_FRAMES[terrain][0]];
}

const buffers = [];
for (const d of FRAME_DEFS) buffers.push(await d.make(d.file));

const rows = Math.ceil(FRAME_DEFS.length / COLUMNS);
const composites = buffers.map((input, i) => ({
  input,
  left: (i % COLUMNS) * TILE,
  top: Math.floor(i / COLUMNS) * TILE,
}));

await mkdir(OUT, { recursive: true });
await sharp({
  create: { width: COLUMNS * TILE, height: rows * TILE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
})
  .composite(composites)
  .png()
  .toFile(path.join(OUT, "atlas.png"));

await writeFile(
  path.join(OUT, "atlas.json"),
  JSON.stringify(
    {
      tileSize: TILE,
      columns: COLUMNS,
      frames: FRAME_DEFS.map((d) => d.name),
      terrain: TERRAIN,
      waterFrames: WATER_FRAMES,
    },
    null,
    2,
  ),
);

console.log(`atlas: ${FRAME_DEFS.length} frames, ${COLUMNS}x${rows}`);
