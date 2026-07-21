// Espuma de costa: um quad ACIMA do terreno que desenha só a faixa de
// fronteira água<->terra — a onda avança e recua sobre a areia no ritmo do
// vento, com lâmina d'água translúcida e espuma pixelada. Alpha 0 fora da
// faixa. GLSL ES 1.0.

export const SHORE_FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform float uTime;
uniform vec2  uScroll;
uniform vec2  uResolution;
uniform vec2  uWind;
uniform sampler2D uFlowTex;

const float TILE = 32.0;
const float FIELD = 160.0;
const float SNAP = 4.0;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec4 fieldTexelAt(vec2 tile) {
  vec2 wrapped = mod(mod(tile, FIELD) + FIELD, FIELD);
  return texture2D(uFlowTex, (wrapped + 0.5) / FIELD);
}

void main(void) {
  vec2 screenPx = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y);
  vec2 worldPx = screenPx + uScroll;
  vec2 snapped = floor(worldPx / SNAP) * SNAP + SNAP * 0.5;

  // waterness bilinear (canal A): 1 = água, 0 = terra.
  vec2 tpos = snapped / TILE - 0.5;
  vec2 base = floor(tpos);
  vec2 f = tpos - base;
  float w00 = fieldTexelAt(base).a;
  float w10 = fieldTexelAt(base + vec2(1.0, 0.0)).a;
  float w01 = fieldTexelAt(base + vec2(0.0, 1.0)).a;
  float w11 = fieldTexelAt(base + vec2(1.0, 1.0)).a;
  float waterness = mix(mix(w00, w10, f.x), mix(w01, w11, f.x), f.y);

  // Fora da faixa de fronteira (spec: 0.35..0.80): nada.
  if (waterness < 0.30 || waterness > 0.80) {
    gl_FragColor = vec4(0.0);
    return;
  }

  // A linha da onda oscila pela faixa no ritmo do vento: fase espacial ao
  // longo da direção do vento + tempo. windMag ~ [0.2, 1.0].
  float windMag = length(uWind);
  vec2 windDir = windMag > 0.001 ? uWind / windMag : vec2(1.0, 0.0);
  float phase = dot(snapped, windDir) * 0.045 + uTime * (0.0009 + windMag * 0.0012);
  float lap = sin(phase) * 0.5 + sin(phase * 0.37 + 1.7) * 0.5; // vai-e-vem irregular
  // Centro da linha de espuma: varre a faixa (avança na areia quando lap > 0).
  float foamCenter = 0.55 - lap * 0.17; // ~[0.38, 0.72]

  vec3 color = vec3(0.0);
  float alpha = 0.0;

  // Lâmina d'água translúcida sobre a areia quando a onda avançou:
  // pixels do lado da terra (waterness < 0.5) já "alcançados" pela linha.
  if (waterness > foamCenter && waterness < 0.55) {
    color = vec3(0.30, 0.50, 0.80);
    alpha = 0.30;
  }

  // Espuma pixelada na linha da onda (posterizada via hash da célula).
  float d = abs(waterness - foamCenter);
  if (d < 0.055) {
    float sparkle = step(0.35, hash(floor(snapped / SNAP) + floor(uTime * 0.002)));
    color = mix(color, vec3(0.92, 0.96, 1.0), 0.9);
    alpha = max(alpha, 0.85 * sparkle);
  }

  gl_FragColor = vec4(color * alpha, alpha); // premultiplicado p/ blend padrão
}
`;
