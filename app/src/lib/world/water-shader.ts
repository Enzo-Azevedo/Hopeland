// Fragment shader da água: flow-map de duas fases sobre value noise
// procedural, pixelado (grade 4px, 4 tons), profundidade e espuma via
// amostragem bilinear manual do campo toroidal. GLSL ES 1.0.

export const WATER_FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform float uTime;       // ms de tempo RENDERIZADO (congela dormindo)
uniform vec2  uScroll;     // scroll da câmera em px de mundo
uniform vec2  uResolution; // tamanho do quad/viewport em px
uniform vec2  uWind;       // vento global, em unidades de MAX_CURRENT
uniform sampler2D uFlowTex;

const float TILE = 32.0;
const float FIELD = 160.0;
const float SNAP = 4.0;
const float FLOW_REACH = 14.0;  // px de arrasto visual por ciclo
const float NOISE_FREQ = 0.55;  // oitava base por tile

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

vec4 fieldTexelAt(vec2 tile) {
  vec2 wrapped = mod(mod(tile, FIELD) + FIELD, FIELD);
  return texture2D(uFlowTex, (wrapped + 0.5) / FIELD);
}

void main(void) {
  // gl_FragCoord é bottom-left; o mundo é top-left.
  vec2 screenPx = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);
  vec2 worldPx = screenPx + uScroll;
  // Estética pixelada: tudo calculado no centro de células de 4px.
  vec2 snapped = floor(worldPx / SNAP) * SNAP + SNAP * 0.5;
  vec2 tile = floor(snapped / TILE);

  vec4 texel = fieldTexelAt(tile);
  vec2 flow = (texel.rg * 255.0 - 128.0) / 127.0; // [-1,1] por componente

  // Composição canal + vento (mesma regra do gameplay):
  // deep 1.0, costa 0.5, rio 0.1 — B = kind*85/255.
  float kindB = texel.b;
  float infl = kindB < 0.5 ? 1.0 : (kindB < 0.84 ? 0.5 : 0.1);
  flow += uWind * infl;

  // Bilinear manual do campo para profundidade (B) e máscara de água (A).
  vec2 tpos = snapped / TILE - 0.5;
  vec2 base = floor(tpos);
  vec2 frac2 = tpos - base;
  vec4 t00 = fieldTexelAt(base);
  vec4 t10 = fieldTexelAt(base + vec2(1.0, 0.0));
  vec4 t01 = fieldTexelAt(base + vec2(0.0, 1.0));
  vec4 t11 = fieldTexelAt(base + vec2(1.0, 1.0));
  vec2 smoothBA = mix(
    mix(t00.ba, t10.ba, frac2.x),
    mix(t01.ba, t11.ba, frac2.x),
    frac2.y
  );
  float depthRamp = smoothBA.x; // 0 terra .. 1 rio (via kind*85/255)
  float waterness = smoothBA.y; // 0 terra .. 1 água (máscara bilinear)

  // Flow-map: duas fases dente-de-serra defasadas 0.5, cross-fade triangular.
  // Rio: fase ~2x mais rápida e ruído anisotrópico (comprimido ~3x na
  // perpendicular) — streaks alongados na direção da corrente.
  bool isRiver = kindB >= 0.84;
  float speed = isRiver ? 0.0009 : 0.00045;
  float ph0 = fract(uTime * speed);
  float ph1 = fract(ph0 + 0.5);

  float fmag = length(flow);
  vec2 fdir = fmag > 0.001 ? flow / fmag : vec2(1.0, 0.0);
  vec2 fperp = vec2(-fdir.y, fdir.x);

  vec2 p0 = snapped - flow * ph0 * FLOW_REACH;
  vec2 p1 = snapped - flow * ph1 * FLOW_REACH;
  vec2 uv0;
  vec2 uv1;
  if (isRiver) {
    uv0 = vec2(dot(p0, fdir), dot(p0, fperp) * 3.0) / TILE * NOISE_FREQ;
    uv1 = vec2(dot(p1, fdir), dot(p1, fperp) * 3.0) / TILE * NOISE_FREQ;
  } else {
    uv0 = p0 / TILE * NOISE_FREQ;
    uv1 = p1 / TILE * NOISE_FREQ;
  }
  float n0 = vnoise(uv0) * 0.7 + vnoise(uv0 * 2.7) * 0.3;
  float n1 = vnoise(uv1) * 0.7 + vnoise(uv1 * 2.7) * 0.3;
  float w0 = 1.0 - abs(ph0 * 2.0 - 1.0);
  float w1 = 1.0 - w0;
  float wave = n0 * w0 + n1 * w1;

  // Cor por profundidade (deep escuro -> rio claro), posterizada em 4 tons.
  vec3 deep = vec3(0.075, 0.16, 0.36);
  vec3 shallow = vec3(0.19, 0.38, 0.72);
  vec3 riverc = vec3(0.30, 0.53, 0.89);
  vec3 baseColor = depthRamp < 0.55
    ? mix(deep, shallow, depthRamp / 0.55)
    : mix(shallow, riverc, (depthRamp - 0.55) / 0.45);
  float tone = floor(wave * 4.0) / 4.0;
  float toneAmp = isRiver ? 0.46 : 0.30;
  vec3 color = baseColor * (0.80 + tone * toneAmp);

  // Espuma pixelada na fronteira água/terra, pulsando devagar.
  float pulse = 0.7 + 0.3 * sin(uTime * 0.002 + snapped.x * 0.08 + snapped.y * 0.05);
  if (waterness > 0.15 && waterness < 0.62) {
    float foam = step(0.35, wave * pulse);
    color = mix(color, vec3(0.88, 0.94, 0.98), foam * 0.85);
  }

  gl_FragColor = vec4(color, 1.0);
}
`;
