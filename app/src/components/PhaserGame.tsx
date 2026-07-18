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
import { pickVariant, tileHash } from "@/lib/world/tile-variants";
import { brightnessFor, isOccluded, levelFor, projectY, wallStripsFor } from "@/lib/world/projection";
import { currentFor } from "@/lib/world/current";

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
  rivers?: Phaser.GameObjects.Container;
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
  private waterLayer!: Phaser.GameObjects.TileSprite;
  private waterFrameIdx = 0;
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
    // Texturas independentes: TileSprite azulejando sub-frame de atlas vaza
    // bordas (linhas) e quebra o tilePosition.
    for (let i = 0; i < 4; i++) {
      this.load.image(`water-${i}`, `/tiles/water-${i}.png`);
    }
  }

  create() {
    this.manifest = this.cache.json.get("tiles-manifest") as AtlasManifest;
    this.wallsManifest = this.cache.json.get("walls-manifest") as WallsManifest;

    // Água é sempre plana no nível 0: uma única camada animada sob todos os
    // chunks; tiles de água ficam transparentes no bake e a revelam.
    this.waterLayer = this.add
      .tileSprite(0, 0, this.scale.width, this.scale.height, "water-0")
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(-1_000_000_000);

    // Rios têm tiles e animação próprios (frames mais claros do atlas), com
    // fase deslocada por posição — cintilam como água corrente, distintos
    // do oceano da camada global.
    if (!this.anims.exists("river-flow")) {
      this.anims.create({
        key: "river-flow",
        frames: this.anims.generateFrameNumbers("tiles", {
          frames: this.manifest.waterFrames["river"]!,
        }),
        frameRate: 2.5,
        repeat: -1,
      });
    }
    this.scale.on(Phaser.Scale.Events.RESIZE, (size: Phaser.Structs.Size) => {
      this.waterLayer.setSize(size.width, size.height);
    });

    // Timer JS puro: os timers do Phaser não correm com o loop dormindo.
    this.waterInterval = window.setInterval(() => {
      this.waterFrameIdx = (this.waterFrameIdx + 1) % 4;
      this.waterLayer.setTexture(`water-${this.waterFrameIdx}`);
      if (!this.game.loop.running) {
        // Acorda para mostrar o novo frame e permite voltar a dormir já no
        // próximo frame limpo (sem esperar os 30 frames do contador).
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

    let rivers: Phaser.GameObjects.Container | undefined;
    const riverFrames = this.manifest.waterFrames["river"]!;

    for (let y = 0; y < CHUNK_SIZE; y++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const tx = cx * CHUNK_SIZE + x;
        const ty = cy * CHUNK_SIZE + y;
        const tile = getWorldTile(tx, ty);
        const level = levelFor(tile);
        const localX = x * TILE_SIZE;

        if (level === 0) {
          // Água: transparente (camada animada por baixo). Oceano profundo
          // ganha um véu escuro — raso claro -> fundo escuro, sem shader.
          if (tile.terrain === "deep_water") {
            rt.stamp("tiles", this.manifest.white, localX, RT_PAD_PX + y * TILE_SIZE, {
              originX: 0,
              originY: 0,
              tint: 0x0a1a3a,
              alpha: 0.45,
            });
          } else if (tile.terrain === "river") {
            // Rio: sprite animado próprio (acima do oceano, abaixo do
            // terreno — barrancos continuam cobrindo a margem).
            if (!rivers) {
              rivers = this.add.container(0, 0).setDepth(-500_000_000);
            }
            const phase = tileHash(tx, ty) % riverFrames.length;
            const sprite = this.add.sprite(
              tx * TILE_SIZE + TILE_SIZE / 2,
              ty * TILE_SIZE + TILE_SIZE / 2,
              "tiles",
              riverFrames[phase],
            );
            sprite.play({ key: "river-flow", startFrame: phase });
            rivers.add(sprite);
          }
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
    // Phaser 4: stamp() only queues commands into the texture's command
    // buffer — nothing is drawn until render() flushes it ("You must do
    // this in order to see anything drawn to it").
    rt.render();
    this.chunks.set(chunkKey(cx, cy), { rt, rivers });
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
      chunk.rivers?.destroy(true);
      this.chunks.delete(key);
    }
    for (const c of plan.create) this.createChunk(c.cx, c.cy);
    return plan.create.length > 0 || plan.destroy.length > 0;
  }

  update(time: number, delta: number) {
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

    // Água ancorada no mundo (anti "água acompanha o jogador") + deriva
    // global LENTA e CONSTANTE + maré vai-e-vem. A deriva é função do tempo
    // (nunca acumula estado): velocidade fixa ~6px/s, jamais acelera. O
    // módulo de 32000ms devolve exatamente múltiplos de 32px (textura),
    // então o wrap é invisível e a precisão de float não degrada.
    const t = time % 32000;
    const driftX = t * 0.006; // 0.006*32000 = 192 = 6 texturas
    const driftY = t * 0.003; // 0.003*32000 = 96  = 3 texturas
    const tideX = Math.sin(time / 1400) * 5;
    const tideY = Math.cos(time / 1900) * 4;
    this.waterLayer.setTilePosition(
      this.cameras.main.scrollX + driftX + tideX,
      this.cameras.main.scrollY + driftY + tideY,
    );

    const chunksChanged = this.updateChunks();

    // Dirty tracking em nível de frame: hoje as únicas fontes de mudança
    // visual são movimento do jogador (e o lerp da câmera que o segue),
    // bake de chunk e o lerp do nível de renderização (subida/descida de
    // bloco). Sem nada sujo por ~0,5s (tempo do lerp assentar), o loop
    // dorme e a GPU zera; o wake é instantâneo via listeners do DOM.
    // ATENÇÃO (futuro): água animada, NPCs ou outros jogadores visíveis
    // são novas fontes de sujeira — inclua-as aqui ou o mundo congela.
    const levelSettling = this.renderLevel !== targetLevel;
    if (dx !== 0 || dy !== 0 || chunksChanged || levelSettling || inWater) {
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
