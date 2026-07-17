// Simplex 2D noise with analytical derivatives (Gustavson corner scheme,
// derivative form after Quilez "morenoise"). Deterministic per seed.

export interface NoiseSample {
  value: number;
  dx: number;
  dy: number;
}

/** xmur3 string hash — deterministic 32-bit unsigned int from a string. */
export function hashString(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
// 8 unit gradients around the circle.
const GRAD_X: number[] = [];
const GRAD_Y: number[] = [];
for (let i = 0; i < 8; i++) {
  GRAD_X.push(Math.cos((i * Math.PI) / 4));
  GRAD_Y.push(Math.sin((i * Math.PI) / 4));
}
// Empirical scale to bring output near [-1, 1]; sample() clamps for safety.
const SCALE = 45.23;

export class Simplex2 {
  private perm = new Uint8Array(512);

  constructor(seed: number) {
    const rand = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = p[i]!;
      p[i] = p[j]!;
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255]!;
  }

  sample(x: number, y: number): NoiseSample {
    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const t = (i + j) * G2;
    const x0 = x - (i - t);
    const y0 = y - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;

    let value = 0;
    let dx = 0;
    let dy = 0;

    const corner = (cx: number, cy: number, gi: number) => {
      const tt = 0.5 - cx * cx - cy * cy;
      if (tt <= 0) return;
      const gx = GRAD_X[gi]!;
      const gy = GRAD_Y[gi]!;
      const gdot = gx * cx + gy * cy;
      const t2 = tt * tt;
      const t4 = t2 * t2;
      value += t4 * gdot;
      // d/dx [t^4 (g.d)] = -8 x t^3 (g.d) + t^4 gx
      dx += -8 * cx * tt * t2 * gdot + t4 * gx;
      dy += -8 * cy * tt * t2 * gdot + t4 * gy;
    };

    corner(x0, y0, this.perm[ii + this.perm[jj]!]! & 7);
    corner(x1, y1, this.perm[ii + i1 + this.perm[jj + j1]!]! & 7);
    corner(x2, y2, this.perm[ii + 1 + this.perm[jj + 1]!]! & 7);

    let v = value * SCALE;
    if (v > 1) v = 1;
    else if (v < -1) v = -1;
    return { value: v, dx: dx * SCALE, dy: dy * SCALE };
  }
}

/** Standard fBm with chain-ruled derivatives, normalized to ~[-1, 1]. */
export function fbm(
  noise: Simplex2,
  x: number,
  y: number,
  octaves: number,
  lacunarity = 2,
  gain = 0.5,
): NoiseSample {
  let value = 0;
  let dx = 0;
  let dy = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = noise.sample(x * freq, y * freq);
    value += amp * n.value;
    dx += amp * freq * n.dx;
    dy += amp * freq * n.dy;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return { value: value / norm, dx: dx / norm, dy: dy / norm };
}

/**
 * Erosion-style fBm (Quilez / de Carpentier): high-frequency octaves are
 * damped where the accumulated gradient is steep, producing smooth valleys
 * and rough ridges.
 */
export function erodedFbm(
  noise: Simplex2,
  x: number,
  y: number,
  octaves: number,
  erosion: number,
): NoiseSample {
  let value = 0;
  let sumDx = 0;
  let sumDy = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = noise.sample(x * freq, y * freq);
    sumDx += amp * freq * n.dx;
    sumDy += amp * freq * n.dy;
    value += (amp * n.value) / (1 + erosion * (sumDx * sumDx + sumDy * sumDy));
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return { value: value / norm, dx: sumDx / norm, dy: sumDy / norm };
}

/** Ridged multifractal in [0, 1]: sharp continuous crests. */
export function ridgedFbm(noise: Simplex2, x: number, y: number, octaves: number): number {
  let value = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(noise.sample(x * freq, y * freq).value);
    value += amp * n * n;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return value / norm;
}
