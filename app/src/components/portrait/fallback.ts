// app/src/components/portrait/fallback.ts
// Geometric placeholder portrait, used before the seed field existed and
// as a fallback if the layered art fails to load.
import {
  moodExpression,
  type Appearance,
  type FacialMark,
  type MoodExpression,
} from "@/lib/character-schema";
import { SKIN_COLOR } from "@/lib/portrait-selection";

const BUILD_WIDTH: Record<Appearance["build"], number> = {
  slim: 0.78,
  average: 0.9,
  sturdy: 1.02,
  robust: 1.14,
};

export function drawFallbackPortrait(
  canvas: HTMLCanvasElement,
  appearance: Appearance,
  mood: number,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  draw(ctx, canvas.width, appearance, moodExpression(mood));
}

// --- Layered drawing ---------------------------------------------------------
// Order (back → front) matches the design doc:
// 1 skin  2 marks  3 build  4 expression  5 hair  6 clothes  7 scars
function draw(
  ctx: CanvasRenderingContext2D,
  size: number,
  appearance: Appearance,
  expression: MoodExpression,
) {
  ctx.clearRect(0, 0, size, size);

  // Background — soft frame so the portrait reads on any surface.
  const bg = ctx.createLinearGradient(0, 0, 0, size);
  bg.addColorStop(0, "rgba(255,255,255,0.06)");
  bg.addColorStop(1, "rgba(0,0,0,0.25)");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  const cx = size / 2;
  const cy = size * 0.52;
  const baseR = size * 0.28;

  // Layer 3 — build (shoulders behind head)
  drawShoulders(ctx, cx, size, appearance);

  // Layer 1 — skin (head base)
  const skin = SKIN_COLOR[appearance.skinTone];
  drawHead(ctx, cx, cy, baseR, appearance, skin);

  // Layer 2 — facial marks / texture
  drawMarks(ctx, cx, cy, baseR, appearance.facialMark);

  // Layer 4 — expression (eyes + mouth reflect mood)
  drawExpression(ctx, cx, cy, baseR, expression);

  // Layer 5 — hair placeholder (neutral cap silhouette)
  drawHairPlaceholder(ctx, cx, cy, baseR);

  // Layer 6 — clothes placeholder (collar wedge)
  drawClothesPlaceholder(ctx, cx, size, appearance);

  // Layer 7 — scars/wounds placeholder (intentionally empty for now)
}

function drawHead(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
  appearance: Appearance, skin: string,
) {
  const w = r * BUILD_WIDTH[appearance.build];
  ctx.save();
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.ellipse(cx, cy, w, r * 1.05, 0, 0, Math.PI * 2);
  ctx.fill();
  // Subtle shading
  const grad = ctx.createRadialGradient(cx - w * 0.4, cy - r * 0.4, r * 0.2, cx, cy, r * 1.2);
  grad.addColorStop(0, "rgba(255,255,255,0.18)");
  grad.addColorStop(1, "rgba(0,0,0,0.22)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(cx, cy, w, r * 1.05, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawShoulders(
  ctx: CanvasRenderingContext2D,
  cx: number, size: number, appearance: Appearance,
) {
  const w = size * 0.55 * BUILD_WIDTH[appearance.build];
  const y = size * 0.86;
  ctx.save();
  ctx.fillStyle = "rgba(30,30,40,0.55)";
  ctx.beginPath();
  ctx.moveTo(cx - w, size);
  ctx.quadraticCurveTo(cx - w, y - size * 0.06, cx, y - size * 0.1);
  ctx.quadraticCurveTo(cx + w, y - size * 0.06, cx + w, size);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawMarks(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number, mark: FacialMark,
) {
  ctx.save();
  ctx.globalAlpha = 0.6;
  switch (mark) {
    case "freckles_sunspots": {
      ctx.fillStyle = "rgba(120,70,40,0.55)";
      for (const [dx, dy, s] of freckles(12, r)) dot(ctx, cx + dx, cy + dy, s);
      break;
    }
    case "chapped_windburn": {
      ctx.fillStyle = "rgba(200,80,80,0.35)";
      ctx.beginPath(); ctx.ellipse(cx - r * 0.55, cy + r * 0.05, r * 0.18, r * 0.08, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + r * 0.55, cy + r * 0.05, r * 0.18, r * 0.08, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(150,50,50,0.6)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx - r * 0.12, cy + r * 0.5); ctx.lineTo(cx + r * 0.12, cy + r * 0.5); ctx.stroke();
      break;
    }
    case "dry_eye_creases": {
      ctx.strokeStyle = "rgba(90,55,30,0.55)"; ctx.lineWidth = 1;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + s * r * 0.55, cy - r * 0.15);
        ctx.lineTo(cx + s * r * 0.8, cy - r * 0.05);
        ctx.moveTo(cx + s * r * 0.55, cy - r * 0.05);
        ctx.lineTo(cx + s * r * 0.82, cy + r * 0.05);
        ctx.stroke();
      }
      break;
    }
    case "old_scratches": {
      ctx.strokeStyle = "rgba(90,50,40,0.6)"; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(cx - r * 0.4, cy + r * 0.3); ctx.lineTo(cx - r * 0.15, cy + r * 0.55); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + r * 0.2, cy - r * 0.2); ctx.lineTo(cx + r * 0.45, cy - r * 0.05); ctx.stroke();
      break;
    }
    case "under_eye_shadows": {
      ctx.fillStyle = "rgba(60,40,70,0.35)";
      ctx.beginPath(); ctx.ellipse(cx - r * 0.35, cy - r * 0.05, r * 0.18, r * 0.08, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx + r * 0.35, cy - r * 0.05, r * 0.18, r * 0.08, 0, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case "salt_wrinkles": {
      ctx.strokeStyle = "rgba(70,70,90,0.5)"; ctx.lineWidth = 1;
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx + s * r * 0.55, cy - r * 0.15);
        ctx.quadraticCurveTo(cx + s * r * 0.75, cy - r * 0.1, cx + s * r * 0.9, cy);
        ctx.stroke();
      }
      break;
    }
    case "brow_tension": {
      ctx.strokeStyle = "rgba(50,30,20,0.6)"; ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.1, cy - r * 0.45);
      ctx.lineTo(cx + r * 0.1, cy - r * 0.45);
      ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

function freckles(count: number, r: number): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  // deterministic pseudo-random from index
  for (let i = 0; i < count; i++) {
    const a = (i * 2.399) % (Math.PI * 2);
    const rad = r * (0.35 + ((i * 13) % 7) / 20);
    out.push([Math.cos(a) * rad, Math.sin(a) * rad * 0.55, 1 + (i % 2) * 0.6]);
  }
  return out;
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}

function drawExpression(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number, expr: MoodExpression,
) {
  ctx.save();
  const eyeY = cy - r * 0.05;
  const eyeDx = r * 0.32;
  ctx.fillStyle = "#1a1a1a";
  const eyeShape = (side: -1 | 1) => {
    const x = cx + side * eyeDx;
    ctx.beginPath();
    if (expr === "low") ctx.ellipse(x, eyeY + r * 0.05, r * 0.09, r * 0.03, 0, 0, Math.PI * 2);
    else if (expr === "high") ctx.ellipse(x, eyeY - r * 0.02, r * 0.08, r * 0.06, 0, 0, Math.PI * 2);
    else ctx.ellipse(x, eyeY, r * 0.08, r * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
  };
  eyeShape(-1); eyeShape(1);

  // Mouth
  ctx.strokeStyle = "#3b1f14";
  ctx.lineWidth = 2;
  ctx.beginPath();
  const mouthY = cy + r * 0.5;
  if (expr === "high") {
    ctx.arc(cx, mouthY - r * 0.05, r * 0.28, 0.15 * Math.PI, 0.85 * Math.PI);
  } else if (expr === "low") {
    ctx.arc(cx, mouthY + r * 0.28, r * 0.28, 1.15 * Math.PI, 1.85 * Math.PI);
  } else {
    ctx.moveTo(cx - r * 0.2, mouthY);
    ctx.lineTo(cx + r * 0.2, mouthY);
  }
  ctx.stroke();
  ctx.restore();
}

function drawHairPlaceholder(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, r: number,
) {
  ctx.save();
  ctx.fillStyle = "rgba(40,30,25,0.85)";
  ctx.beginPath();
  ctx.ellipse(cx, cy - r * 0.7, r * 1.02, r * 0.55, 0, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawClothesPlaceholder(
  ctx: CanvasRenderingContext2D,
  cx: number, size: number, appearance: Appearance,
) {
  ctx.save();
  const w = size * 0.22 * BUILD_WIDTH[appearance.build];
  const y = size * 0.82;
  ctx.fillStyle = "rgba(70,80,95,0.9)";
  ctx.beginPath();
  ctx.moveTo(cx - w, size);
  ctx.lineTo(cx, y);
  ctx.lineTo(cx + w, size);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
