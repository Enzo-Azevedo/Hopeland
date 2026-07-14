import { useEffect, useRef } from "react";
import Phaser from "phaser";

interface PhaserGameProps {
  onPositionChange?: (x: number, y: number) => void;
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

  constructor(onMove?: (x: number, y: number) => void) {
    super("WorldScene");
    this.onMove = onMove;
  }

  create() {
    const { width, height } = this.scale;

    const g = this.add.graphics();
    g.fillStyle(0x3a5a3a, 1);
    g.fillRect(0, 0, width, height);
    g.lineStyle(1, 0x2a4a2a, 0.6);
    for (let x = 0; x < width; x += 40) {
      g.lineBetween(x, 0, x, height);
    }
    for (let y = 0; y < height; y += 40) {
      g.lineBetween(0, y, width, y);
    }

    this.player = this.add.rectangle(width / 2, height / 2, 24, 24, 0xf5c542);
    this.player.setStrokeStyle(2, 0x000000);

    this.cursors = this.input.keyboard!.addKeys("W,A,S,D") as typeof this.cursors;
  }

  update(_time: number, delta: number) {
    const speed = 0.2 * delta;
    let dx = 0;
    let dy = 0;
    if (this.cursors.W.isDown) dy -= speed;
    if (this.cursors.S.isDown) dy += speed;
    if (this.cursors.A.isDown) dx -= speed;
    if (this.cursors.D.isDown) dx += speed;

    if (dx !== 0 || dy !== 0) {
      this.player.x += dx;
      this.player.y += dy;
      const now = performance.now();
      if (this.onMove && now - this.lastEmit > 50) {
        this.lastEmit = now;
        this.onMove(this.player.x, this.player.y);
      }
    }
  }
}

export function PhaserGame({ onPositionChange }: PhaserGameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (!containerRef.current || gameRef.current) return;

    const game = new Phaser.Game({
      type: Phaser.AUTO,
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
