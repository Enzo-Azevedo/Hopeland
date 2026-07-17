import { useEffect, useRef } from "react";
import Phaser from "phaser";
import {
  CHUNK_PX,
  CHUNK_SIZE,
  CHUNK_RT_HEIGHT_PX,
  CLIMB_DELTA,
  HALF_STEP_PX,
  MAX_CHUNK_CREATES_PER_FRAME,
  RT_PAD_PX,
  TILE_SIZE,
  VIEW_RADIUS,
  WORLD_SEED,
} from "@/lib/world/world-config";
import { findSpawn, getWorldTile } from "@/lib/world/world-gen";
import { FatigueTracker, TERRAIN_SPEED } from "@/lib/world/movement";
import { chunkKey, planChunkUpdates, tileToChunk } from "@/lib/world/chunk-manager";
import { pickVariant } from "@/lib/world/tile-variants";
import { isOccluded, levelFor, projectY, wallStripsFor } from "@/lib/world/projection";

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

interface WallsManifest {
  stripWidth: number;
  stripHeight: number;
  frames: string[];
  terrain: Record<string, number>;
}

interface LoadedChunk {
  rt: Phaser.GameObjects.RenderTexture;
}

class WorldScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle;
  private worldX = 0;
  private worldY = 0;
  private renderLevel = 0;
  private cursors!: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  };
  private onMove?: (x: number, y: number) => void;
  private lastEmit = 0;
  private manifest!: AtlasManifest;
  private wallsManifest!: WallsManifest;
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
    this.load.spritesheet("walls", "/tiles/walls.png", {
      frameWidth: TILE_SIZE,
      frameHeight: 16,
    });
    this.load.json("walls-manifest", "/tiles/walls.json");
  }

  create() {
    this.manifest = this.cache.json.get("tiles-manifest") as AtlasManifest;
    this.wallsManifest = this.cache.json.get("walls-manifest") as WallsManifest;

    const spawn = findSpawn(WORLD_SEED);
    this.worldX = spawn.tx * TILE_SIZE + TILE_SIZE / 2;
    this.worldY = spawn.ty * TILE_SIZE + TILE_SIZE / 2;
    this.renderLevel = levelFor(getWorldTile(spawn.tx, spawn.ty));

    this.player = this.add.rectangle(
      this.worldX,
      projectY(this.worldY, this.renderLevel),
      24,
      24,
      0xf5c542,
    );
    this.player.setStrokeStyle(2, 0x000000);
    this.player.setDepth(1_000_000); // always above terrain; occlusion is a style

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
    const rt = this.add.renderTexture(
      cx * CHUNK_PX,
      cy * CHUNK_PX - RT_PAD_PX,
      CHUNK_PX,
      CHUNK_RT_HEIGHT_PX,
    );
    rt.setOrigin(0, 0);
    // Southern rows must paint over walls hanging from northern chunks.
    rt.setDepth(cy);

    for (let y = 0; y < CHUNK_SIZE; y++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const tx = cx * CHUNK_SIZE + x;
        const ty = cy * CHUNK_SIZE + y;
        const tile = getWorldTile(tx, ty);
        const level = levelFor(tile);
        const south = getWorldTile(tx, ty + 1);
        const strips = wallStripsFor(level, levelFor(south));

        const localX = x * TILE_SIZE;
        const topY = RT_PAD_PX + projectY(y * TILE_SIZE, level);

        const wallFrame = this.wallsManifest.terrain[tile.terrain];
        if (strips > 0 && wallFrame !== undefined) {
          for (let s = 0; s < strips; s++) {
            rt.stamp("walls", wallFrame, localX, topY + TILE_SIZE + s * HALF_STEP_PX, {
              originX: 0,
              originY: 0,
            });
          }
        }
        rt.stamp("tiles", this.frameFor(tile.terrain, tx, ty), localX, topY, {
          originX: 0,
          originY: 0,
        });
      }
    }
    // Phaser 4: stamp() only queues commands into the texture's command
    // buffer — nothing is drawn until render() flushes it ("You must do
    // this in order to see anything drawn to it").
    rt.render();
    this.chunks.set(chunkKey(cx, cy), { rt });
  }

  private updateChunks(force = false) {
    const center = {
      cx: tileToChunk(Math.floor(this.worldX / TILE_SIZE)),
      cy: tileToChunk(Math.floor(this.worldY / TILE_SIZE)),
    };
    const plan = planChunkUpdates(
      new Set(this.chunks.keys()),
      center,
      VIEW_RADIUS,
      force ? (VIEW_RADIUS * 2 + 1) ** 2 : MAX_CHUNK_CREATES_PER_FRAME,
    );
    for (const key of plan.destroy) {
      this.chunks.get(key)!.rt.destroy();
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

    const tx = Math.floor(this.worldX / TILE_SIZE);
    const ty = Math.floor(this.worldY / TILE_SIZE);
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
      this.worldX += (dx / norm) * speed;
      this.worldY += (dy / norm) * speed;

      const now = performance.now();
      if (this.onMove && now - this.lastEmit > 50) {
        this.lastEmit = now;
        this.onMove(this.worldX, this.worldY);
      }
    }

    const targetLevel = levelFor(here);
    // ~100ms visual lerp between levels so climbing a step doesn't teleport.
    this.renderLevel += (targetLevel - this.renderLevel) * Math.min(1, delta / 100);
    if (Math.abs(targetLevel - this.renderLevel) < 0.01) this.renderLevel = targetLevel;
    this.player.setPosition(this.worldX, projectY(this.worldY, this.renderLevel));

    // Silhouette when terrain south of the player would cover it.
    const colA = Math.floor((this.worldX - 12) / TILE_SIZE);
    const colB = Math.floor((this.worldX + 12) / TILE_SIZE);
    const southLevels: number[][] = [];
    for (let d = 1; d <= 3; d++) {
      const row: number[] = [];
      for (let c = colA; c <= colB; c++) row.push(levelFor(getWorldTile(c, ty + d)));
      southLevels.push(row);
    }
    const hidden = isOccluded(targetLevel, southLevels);
    this.player.setFillStyle(0xf5c542, hidden ? 0.35 : 1);
    this.player.setStrokeStyle(2, 0x000000, hidden ? 0.2 : 1);

    const chunksChanged = this.updateChunks();

    // Dirty tracking em nível de frame: hoje as únicas fontes de mudança
    // visual são movimento do jogador (e o lerp da câmera que o segue),
    // bake de chunk e o lerp do nível de renderização (subida/descida de
    // bloco). Sem nada sujo por ~0,5s (tempo do lerp assentar), o loop
    // dorme e a GPU zera; o wake é instantâneo via listeners do DOM.
    // ATENÇÃO (futuro): água animada, NPCs ou outros jogadores visíveis
    // são novas fontes de sujeira — inclua-as aqui ou o mundo congela.
    const levelSettling = this.renderLevel !== targetLevel;
    if (dx !== 0 || dy !== 0 || chunksChanged || levelSettling) {
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
