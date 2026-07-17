import { useEffect, useRef } from "react";
import Phaser from "phaser";
import {
  CHUNK_PX,
  CHUNK_SIZE,
  CLIMB_DELTA,
  MAX_CHUNK_CREATES_PER_FRAME,
  TILE_SIZE,
  VIEW_RADIUS,
  WORLD_SEED,
} from "@/lib/world/world-config";
import { findSpawn, getWorldTile } from "@/lib/world/world-gen";
import { FatigueTracker, TERRAIN_SPEED } from "@/lib/world/movement";
import { chunkKey, planChunkUpdates, tileToChunk } from "@/lib/world/chunk-manager";

interface PhaserGameProps {
  onPositionChange?: (x: number, y: number) => void;
}

interface AtlasManifest {
  tileSize: number;
  columns: number;
  frames: string[];
  terrain: Record<string, number[]>;
  waterFrames: Record<string, number[]>;
}

interface LoadedChunk {
  map: Phaser.Tilemaps.Tilemap;
  layer: Phaser.GameObjects.GameObject;
}

/** Deterministic per-tile hash for picking texture variants. */
function tileHash(tx: number, ty: number): number {
  let h = (Math.imul(tx, 73856093) ^ Math.imul(ty, 19349663)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
  return h;
}

class WorldScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle;
  private cursors!: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };
  private onMove?: (x: number, y: number) => void;
  private lastEmit = 0;
  private manifest!: AtlasManifest;
  private chunks = new Map<string, LoadedChunk>();
  private fatigue = new FatigueTracker();

  constructor(onMove?: (x: number, y: number) => void) {
    super("WorldScene");
    this.onMove = onMove;
  }

  preload() {
    this.load.spritesheet("tiles", "/tiles/atlas.png", {
      frameWidth: TILE_SIZE,
      frameHeight: TILE_SIZE,
    });
    this.load.json("tiles-manifest", "/tiles/atlas.json");
  }

  create() {
    this.manifest = this.cache.json.get("tiles-manifest") as AtlasManifest;

    const spawn = findSpawn(WORLD_SEED);
    const px = spawn.tx * TILE_SIZE + TILE_SIZE / 2;
    const py = spawn.ty * TILE_SIZE + TILE_SIZE / 2;

    this.player = this.add.rectangle(px, py, 24, 24, 0xf5c542);
    this.player.setStrokeStyle(2, 0x000000);
    this.player.setDepth(10);

    this.cameras.main.startFollow(this.player, true, 0.15, 0.15);

    this.cursors = this.input.keyboard!.addKeys("W,A,S,D") as typeof this.cursors;

    this.updateChunks(true);
  }

  private frameFor(terrain: string, tx: number, ty: number): number {
    const frames = this.manifest.terrain[terrain] ?? this.manifest.terrain["grass"]!;
    return frames[tileHash(tx, ty) % frames.length]!;
  }

  private createChunk(cx: number, cy: number) {
    const data: number[][] = [];
    for (let y = 0; y < CHUNK_SIZE; y++) {
      const row: number[] = [];
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const tx = cx * CHUNK_SIZE + x;
        const ty = cy * CHUNK_SIZE + y;
        row.push(this.frameFor(getWorldTile(tx, ty).terrain, tx, ty));
      }
      data.push(row);
    }

    const map = this.make.tilemap({ data, tileWidth: TILE_SIZE, tileHeight: TILE_SIZE });
    const tileset = map.addTilesetImage("tiles", "tiles", TILE_SIZE, TILE_SIZE, 0, 0)!;

    let layer: Phaser.GameObjects.GameObject;
    const GPULayer = (Phaser.Tilemaps as unknown as Record<string, unknown>)["TilemapGPULayer"] as
      | (new (
          scene: Phaser.Scene,
          tilemap: Phaser.Tilemaps.Tilemap,
          layerIndex: number,
          tileset: Phaser.Tilemaps.Tileset,
          x?: number,
          y?: number,
        ) => Phaser.GameObjects.GameObject)
      | undefined;
    try {
      if (!GPULayer) throw new Error("TilemapGPULayer unavailable");
      const gpu = new GPULayer(this, map, 0, tileset, cx * CHUNK_PX, cy * CHUNK_PX);
      this.add.existing(gpu);
      layer = gpu;
    } catch {
      // Fallback (canvas renderer or API change): classic layer, still correct.
      layer = map.createLayer(0, tileset, cx * CHUNK_PX, cy * CHUNK_PX)!;
    }
    this.chunks.set(chunkKey(cx, cy), { map, layer });
  }

  private updateChunks(force = false) {
    const center = {
      cx: tileToChunk(Math.floor(this.player.x / TILE_SIZE)),
      cy: tileToChunk(Math.floor(this.player.y / TILE_SIZE)),
    };
    const plan = planChunkUpdates(
      new Set(this.chunks.keys()),
      center,
      VIEW_RADIUS,
      force ? (VIEW_RADIUS * 2 + 1) ** 2 : MAX_CHUNK_CREATES_PER_FRAME,
    );
    for (const key of plan.destroy) {
      const chunk = this.chunks.get(key)!;
      chunk.layer.destroy();
      chunk.map.destroy();
      this.chunks.delete(key);
    }
    for (const c of plan.create) this.createChunk(c.cx, c.cy);
  }

  update(_time: number, delta: number) {
    let dx = 0;
    let dy = 0;
    if (this.cursors.W.isDown) dy -= 1;
    if (this.cursors.S.isDown) dy += 1;
    if (this.cursors.A.isDown) dx -= 1;
    if (this.cursors.D.isDown) dx += 1;

    const tx = Math.floor(this.player.x / TILE_SIZE);
    const ty = Math.floor(this.player.y / TILE_SIZE);
    const here = getWorldTile(tx, ty);

    let climbing = false;
    if (dx !== 0 || dy !== 0) {
      const ahead = getWorldTile(tx + Math.sign(dx), ty + Math.sign(dy));
      climbing = ahead.elevation - here.elevation > CLIMB_DELTA;
    }
    this.fatigue.update(delta, climbing && (dx !== 0 || dy !== 0));

    if (dx !== 0 || dy !== 0) {
      const norm = Math.hypot(dx, dy);
      const speed = 0.2 * delta * TERRAIN_SPEED[here.terrain] * this.fatigue.multiplier;
      this.player.x += (dx / norm) * speed;
      this.player.y += (dy / norm) * speed;

      const now = performance.now();
      if (this.onMove && now - this.lastEmit > 50) {
        this.lastEmit = now;
        this.onMove(this.player.x, this.player.y);
      }
    }

    this.updateChunks();
  }
}

export function PhaserGame({ onPositionChange }: PhaserGameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (!containerRef.current || gameRef.current) return;

    const game = new Phaser.Game({
      type: Phaser.WEBGL,
      parent: containerRef.current,
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      backgroundColor: "#1a2a1a",
      scene: new WorldScene(onPositionChange),
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
    });

    gameRef.current = game;

    return () => {
      game.destroy(true);
      gameRef.current = null;
    };
  }, [onPositionChange]);

  return <div ref={containerRef} className="w-full h-full" />;
}
