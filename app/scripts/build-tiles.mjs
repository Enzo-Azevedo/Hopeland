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

// Solid white utility frame (tinted at stamp time: deep-water veil,
// wall-base occlusion). Appended last so existing indices never shift.
FRAME_DEFS.push({
  name: "white",
  file: null,
  make: async () =>
    sharp({ create: { width: TILE, height: TILE, channels: 4, background: "#ffffff" } })
      .png()
      .toBuffer(),
});
const WHITE_INDEX = FRAME_DEFS.length - 1;

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
      white: WHITE_INDEX,
    },
    null,
    2,
  ),
);

console.log(`atlas: ${FRAME_DEFS.length} frames, ${COLUMNS}x${rows}`);

// ---- South wall strips (oblique 2.5D renderer) --------------------------
// One 32x16 strip per material, darkened so walls read as shaded faces.
// Faithful to Minecraft: grass-family sides are dirt, desert/beach sand,
// mountain stone, snow snow.

const WALL_SOURCES = [
  ["dirt", "dirt.png"],
  ["sand", "sand.png"],
  ["stone", "stone.png"],
  ["snow", "snow.png"],
];

const WALL_TERRAIN = {
  beach: "sand",
  grass: "dirt",
  forest: "dirt",
  jungle: "dirt",
  swamp: "dirt",
  desert: "sand",
  savanna: "dirt",
  tundra: "dirt",
  snow: "snow",
  taiga: "dirt",
  rock: "stone",
  snow_rock: "snow",
};

const STRIP_H = 16;
const wallBuffers = [];
for (const [, file] of WALL_SOURCES) {
  wallBuffers.push(
    await sharp(path.join(SRC, file))
      .extract({ left: 0, top: 0, width: TILE, height: STRIP_H })
      .composite([
        // Uniform darkening so the face reads as shadowed...
        { input: { create: { width: TILE, height: STRIP_H, channels: 4, background: "#8f8f8f" } }, blend: "multiply" },
        // ...plus a darker foot for depth.
        { input: Buffer.from(
            `<svg width="${TILE}" height="${STRIP_H}"><rect y="${STRIP_H - 4}" width="${TILE}" height="4" fill="rgba(0,0,0,0.35)"/></svg>`,
          ), blend: "over" },
      ])
      .png()
      .toBuffer(),
  );
}

await sharp({
  create: { width: TILE, height: STRIP_H * WALL_SOURCES.length, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
})
  .composite(wallBuffers.map((input, i) => ({ input, left: 0, top: i * STRIP_H })))
  .png()
  .toFile(path.join(OUT, "walls.png"));

const wallFrameIndex = Object.fromEntries(WALL_SOURCES.map(([name], i) => [name, i]));
await writeFile(
  path.join(OUT, "walls.json"),
  JSON.stringify(
    {
      stripWidth: TILE,
      stripHeight: STRIP_H,
      frames: WALL_SOURCES.map(([name]) => name),
      terrain: Object.fromEntries(
        Object.entries(WALL_TERRAIN).map(([t, mat]) => [t, wallFrameIndex[mat]]),
      ),
    },
    null,
    2,
  ),
);

console.log(`walls: ${WALL_SOURCES.length} strips`);
