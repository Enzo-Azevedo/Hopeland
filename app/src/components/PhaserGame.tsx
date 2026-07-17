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
import { pickVariant } from "@/lib/world/tile-variants";

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
  container: Phaser.GameObjects.Container;
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
  private cleanFrames = 0;

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

    // Render-on-demand: o loop dorme quando nada está sujo (GPU a zero) e
    // acorda no primeiro input. Listeners no DOM porque, dormindo, o Phaser
    // não processa a própria fila de teclado até o próximo passo do loop.
    const wake = () => {
      if (!this.game.loop.running) this.game.loop.wake();
    };
    window.addEventListener("keydown", wake);
    window.addEventListener("pointerdown", wake);
    window.addEventListener("resize", wake);
    this.events.once(Phaser.Scenes.Events.DESTROY, () => {
      window.removeEventListener("keydown", wake);
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("resize", wake);
    });

    this.updateChunks(true);
  }

  private frameFor(terrain: string, tx: number, ty: number): number {
    const frames = this.manifest.terrain[terrain] ?? this.manifest.terrain["grass"]!;
    return pickVariant(frames, tx, ty);
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

    // The layer lives at (0,0) inside a container placed at the chunk's
    // world position. Phaser 4.2.1's SubmitterTilemapGPULayer applies the
    // layer's own (x,y) twice (once in the sprite matrix, again in setQuad),
    // which doubled chunk offsets and left chunk-wide holes in the world.
    // With the layer at (0,0) the double-apply is a no-op and the container
    // provides the position exactly once, via parentMatrix.
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
      layer = new GPULayer(this, map, 0, tileset, 0, 0);
    } catch (err) {
      // Fallback (canvas renderer or API change): classic layer, still correct.
      console.warn("TilemapGPULayer unavailable, falling back to TilemapLayer", err);
      layer = map.createLayer(0, tileset, 0, 0)!;
      layer.removeFromDisplayList();
    }
    const container = this.add.container(cx * CHUNK_PX, cy * CHUNK_PX, [layer]);
    this.chunks.set(chunkKey(cx, cy), { map, container });
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
      chunk.container.destroy(true);
      chunk.map.destroy();
      this.chunks.delete(key);
    }
    for (const c of plan.create) this.createChunk(c.cx, c.cy);
    return plan.create.length > 0 || plan.destroy.length > 0;
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

    const chunksChanged = this.updateChunks();

    // Dirty tracking em nível de frame: hoje as únicas fontes de mudança
    // visual são movimento do jogador (e o lerp da câmera que o segue) e
    // bake de chunk. Sem nada sujo por ~0,5s (tempo do lerp assentar), o
    // loop dorme e a GPU zera; o wake é instantâneo via listeners do DOM.
    // ATENÇÃO (futuro): água animada, NPCs ou outros jogadores visíveis
    // são novas fontes de sujeira — inclua-as aqui ou o mundo congela.
    if (dx !== 0 || dy !== 0 || chunksChanged) {
      this.cleanFrames = 0;
    } else if (++this.cleanFrames >= 30) {
      this.cleanFrames = 0;
      this.game.loop.sleep();
    }
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
      // NEAREST + roundPixels: sem isso o filtro LINEAR + scroll fracionário
      // da câmera criam linhas visíveis nas bordas dos chunks (Phaser #7317).
      pixelArt: true,
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
