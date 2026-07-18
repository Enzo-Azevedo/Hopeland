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
import { brightnessFor, isOccluded, levelFor, projectY, wallStripsFor } from "@/lib/world/projection";
import { currentFor } from "@/lib/world/current";
import { FIELD_TILES, encodeFlow, fieldTexel, flowAt, kindOf } from "@/lib/world/flow-field";
import { WATER_FRAG } from "@/lib/world/water-shader";

interface PhaserGameProps {
  onPositionChange?: (x: number, y: number) => void;
}

const WATER_TERRAINS = new Set(["deep_water", "water", "river"]);

interface AtlasManifest {
  tileSize: number;
  columns: number;
  frames: string[];
  terrain: Record<string, number[]>;
  waterFrames: Record<string, number[]>;
  white: number;
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
  private flowCanvas!: Phaser.Textures.CanvasTexture;
  private flowQueue: { cx: number; cy: number; row: number }[] = [];
  private renderedTime = 0;
  private waterQuad!: Phaser.GameObjects.Shader;
  private waterInterval = 0;
  private sleepAfterSettle = false;

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

    // Campo de fluxo toroidal 160x160: cada chunk escreve seu bloco 32x32
    // no slot (cx mod 5, cy mod 5); o shader endereça worldTile mod 160.
    this.flowCanvas = this.textures.createCanvas("flow-field", FIELD_TILES, FIELD_TILES)!;
    this.flowCanvas.setFilter(Phaser.Textures.FilterMode.NEAREST);

    const setupUniforms = (setUniform: (name: string, value: unknown) => void) => {
      setUniform("uTime", this.renderedTime);
      setUniform("uScroll", [this.cameras.main.scrollX, this.cameras.main.scrollY]);
      setUniform("uResolution", [this.scale.width, this.scale.height]);
      setUniform("uFlowTex", 0);
    };

    this.waterQuad = this.add.shader(
      {
        name: "water",
        fragmentSource: WATER_FRAG,
        setupUniforms,
      },
      0,
      0,
      this.scale.width,
      this.scale.height,
      ["flow-field"],
    );
    this.waterQuad.setOrigin(0, 0).setScrollFactor(0).setDepth(-1_000_000_000);
    this.scale.on(Phaser.Scale.Events.RESIZE, (size: Phaser.Structs.Size) => {
      this.waterQuad.setSize(size.width, size.height);
    });

    // Timer JS puro: os timers do Phaser não correm com o loop dormindo.
    this.waterInterval = window.setInterval(() => {
      if (!this.game.loop.running) {
        this.sleepAfterSettle = true;
        this.game.loop.wake();
      }
    }, 400);
    this.events.once(Phaser.Scenes.Events.DESTROY, () => {
      window.clearInterval(this.waterInterval);
    });

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

    const block = this.flowCanvas.context.createImageData(CHUNK_SIZE, CHUNK_SIZE);

    for (let y = 0; y < CHUNK_SIZE; y++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const tx = cx * CHUNK_SIZE + x;
        const ty = cy * CHUNK_SIZE + y;
        const tile = getWorldTile(tx, ty);
        const level = levelFor(tile);
        const localX = x * TILE_SIZE;

        const k = kindOf(tile.terrain);
        const px4 = (y * CHUNK_SIZE + x) * 4;
        block.data[px4] = 128; // fluxo 0 provisório
        block.data[px4 + 1] = 128;
        block.data[px4 + 2] = k * 85;
        block.data[px4 + 3] = k === 0 ? 0 : 255;

        if (level === 0) {
          // Água: sem stamp — o shader do quad de fundo desenha tudo, usando
          // o campo de fluxo escrito acima e refinado em update().
          continue;
        }

        const south = getWorldTile(tx, ty + 1);
        const strips = wallStripsFor(level, levelFor(south));
        const topY = RT_PAD_PX + projectY(y * TILE_SIZE, level);

        const wallFrame = this.wallsManifest.terrain[tile.terrain];
        if (strips > 0 && wallFrame !== undefined) {
          for (let s = 0; s < strips; s++) {
            rt.stamp("walls", wallFrame, localX, topY + TILE_SIZE + s * HALF_STEP_PX, {
              originX: 0,
              originY: 0,
            });
          }
          // Oclusão ambiente na base do paredão: quanto mais alto, mais escuro.
          rt.stamp("tiles", this.manifest.white, localX, topY + TILE_SIZE + (strips - 1) * HALF_STEP_PX, {
            originX: 0,
            originY: 0,
            scaleY: 0.5,
            tint: 0x000000,
            alpha: Math.min(0.35, 0.08 + strips * 0.03),
          });
        }

        const b = Math.round(255 * brightnessFor(level));
        rt.stamp("tiles", this.frameFor(tile.terrain, tx, ty), localX, topY, {
          originX: 0,
          originY: 0,
          tint: (b << 16) | (b << 8) | b,
        });
      }
    }
    const slotX = fieldTexel(cx * CHUNK_SIZE);
    const slotY = fieldTexel(cy * CHUNK_SIZE);
    this.flowCanvas.context.putImageData(block, slotX, slotY);
    this.flowCanvas.refresh();
    // Refinamento do fluxo (caro nos rios) em fila orçada, linha a linha.
    this.flowQueue = this.flowQueue.filter((q) => q.cx !== cx || q.cy !== cy);
    this.flowQueue.push({ cx, cy, row: 0 });

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
      const chunk = this.chunks.get(key)!;
      chunk.rt.destroy();
      this.chunks.delete(key);
    }
    for (const c of plan.create) this.createChunk(c.cx, c.cy);
    return plan.create.length > 0 || plan.destroy.length > 0;
  }

  update(time: number, delta: number) {
    this.renderedTime += delta;

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

    // Correnteza: a água empurra quem está nela (jogador hoje; NPCs futuros
    // usam a mesma currentFor). Sempre mais fraca que nadar — anti-trava.
    const cur = currentFor(WORLD_SEED, tx, ty);
    const inWater = cur.vx !== 0 || cur.vy !== 0;
    if (inWater) {
      // A correnteza nunca joga ninguém na terra: o eixo cujo destino
      // cruzaria a costa é cancelado. Sem isso o jogador oscila na borda
      // (empurrado de volta a cada frame) e o nível de render nunca sobe —
      // o "afundado no terreno" visto em produção.
      const nx = this.worldX + cur.vx * delta;
      const ny = this.worldY + cur.vy * delta;
      if (WATER_TERRAINS.has(getWorldTile(Math.floor(nx / TILE_SIZE), ty).terrain)) {
        this.worldX = nx;
      }
      if (WATER_TERRAINS.has(getWorldTile(tx, Math.floor(ny / TILE_SIZE)).terrain)) {
        this.worldY = ny;
      }
      const now = performance.now();
      if (this.onMove && now - this.lastEmit > 50) {
        this.lastEmit = now;
        this.onMove(this.worldX, this.worldY);
      }
    }

    // Tile efetivo pós-movimento (input + correnteza): nível e silhueta
    // usam a posição real do frame, não a de antes de mover.
    const fty = Math.floor(this.worldY / TILE_SIZE);
    const targetLevel = levelFor(getWorldTile(Math.floor(this.worldX / TILE_SIZE), fty));
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
      for (let c = colA; c <= colB; c++) row.push(levelFor(getWorldTile(c, fty + d)));
      southLevels.push(row);
    }
    const hidden = isOccluded(targetLevel, southLevels);
    this.player.setFillStyle(0xf5c542, hidden ? 0.35 : 1);
    this.player.setStrokeStyle(2, 0x000000, hidden ? 0.2 : 1);

    const chunksChanged = this.updateChunks();

    // Orçamento de 256 tiles/frame para refinar o fluxo do shader.
    let flowBudget = 256;
    let flowDirty = false;
    while (flowBudget > 0 && this.flowQueue.length > 0) {
      const job = this.flowQueue[0]!;
      if (!this.chunks.has(chunkKey(job.cx, job.cy))) {
        this.flowQueue.shift();
        continue;
      }
      const rowsNow = Math.min(
        Math.ceil(flowBudget / CHUNK_SIZE),
        CHUNK_SIZE - job.row,
      );
      const strip = this.flowCanvas.context.createImageData(CHUNK_SIZE, rowsNow);
      for (let ry = 0; ry < rowsNow; ry++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const s = flowAt(
            WORLD_SEED,
            job.cx * CHUNK_SIZE + x,
            job.cy * CHUNK_SIZE + job.row + ry,
          );
          const [r, g, b, a] = encodeFlow(s);
          const p = (ry * CHUNK_SIZE + x) * 4;
          strip.data[p] = r;
          strip.data[p + 1] = g;
          strip.data[p + 2] = b;
          strip.data[p + 3] = a;
        }
      }
      this.flowCanvas.context.putImageData(
        strip,
        fieldTexel(job.cx * CHUNK_SIZE),
        fieldTexel(job.cy * CHUNK_SIZE) + job.row,
      );
      flowDirty = true;
      job.row += rowsNow;
      flowBudget -= rowsNow * CHUNK_SIZE;
      if (job.row >= CHUNK_SIZE) this.flowQueue.shift();
    }
    if (flowDirty) this.flowCanvas.refresh();

    // Dirty tracking em nível de frame: hoje as únicas fontes de mudança
    // visual são movimento do jogador (e o lerp da câmera que o segue),
    // bake de chunk, o lerp do nível de renderização (subida/descida de
    // bloco) e o refinamento do campo de fluxo da água. Sem nada sujo por
    // ~0,5s (tempo do lerp assentar), o loop dorme e a GPU zera; o wake é
    // instantâneo via listeners do DOM.
    // ATENÇÃO (futuro): NPCs ou outros jogadores visíveis são novas fontes
    // de sujeira — inclua-as aqui ou o mundo congela.
    const levelSettling = this.renderLevel !== targetLevel;
    if (dx !== 0 || dy !== 0 || chunksChanged || levelSettling || inWater || flowDirty) {
      this.cleanFrames = 0;
      this.sleepAfterSettle = false;
    } else if (this.sleepAfterSettle) {
      // Frame limpo logo após um tick de água: mostrou o frame novo, dorme já.
      this.sleepAfterSettle = false;
      this.cleanFrames = 0;
      this.game.loop.sleep();
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
