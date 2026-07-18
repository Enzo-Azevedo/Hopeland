# Shader de água (flow-map pixelado) — Design

**Data:** 2026-07-18
**Status:** aprovado (brainstorming; dono pediu o upgrade registrado e escolheu estética pixelada + substituição total)
**Base:** living-water (mergeado) — este shader substitui os mecanismos de água atuais.

## Objetivo

Tornar o fluxo da água **visível por pixel** — cada braço de rio corre na
própria direção, alinhado ao empurrão real do `currentFor` — com ondas,
gradiente de profundidade e espuma de costa, em estética **pixelada
estilizada** (UVs em grade de 4px, cores posterizadas em ~4 tons), mantendo
o render-on-demand.

**Tecnologias verificadas (2026-07-18):** Shader GameObject do Phaser 4
(guia oficial, contrato `textures` + `setupUniforms`, zero issues abertas);
flow-map de duas fases (padrão da indústria, sem estado acumulado — imune ao
bug de aceleração anterior); CanvasTexture para a data texture. Alternativas
descartadas: RenderNode custom (para shaders batched), Filters (pós-fx),
canvas WebGL paralelo.

## Arquitetura

### Dados (CPU → GPU): `app/src/lib/world/flow-field.ts`

- `flowAt(seed, tx, ty): { vx, vy, kind }` — puro com **cache permanente**
  (o mundo é estático): `kind` ∈ {0 terra, 1 deep, 2 water/coast, 3 river},
  vetor do `currentFor` real — o visual usa o mesmo campo que empurra o
  jogador, alinhamento por construção.
- `encodeFlow(vx, vy, kind): [r, g, b]` / helpers de slot: R/G = componentes
  do vetor mapeadas para bytes (`v / MAX_CURRENT * 127 + 128`), B = kind
  (0, 85, 170, 255). Roundtrip com erro < 1 passo de quantização (testado).
- **Data texture toroidal 160×160** (5×5 chunks × 32 tiles, CanvasTexture
  RGBA, filtro NEAREST): o bloco 32×32 de cada chunk vai no slot
  `(cx mod 5, cy mod 5)`; o shader endereça `worldTile mod 160`. Nunca se
  reescreve a textura inteira ao andar.
- Preenchimento em duas passadas: **tipo** síncrono no bake do chunk (o
  `getWorldTile` já foi chamado; fluxo 0 provisório); **fluxo** via fila
  orçada (~256 tiles/frame, rios custam ~0,3ms/tile mas são raros) — a água
  aparece correta no primeiro frame, a direção refina em ~4 frames.

### Shader: `app/src/lib/world/water-shader.ts` (fonte GLSL) + cena

- **Um quad de tela cheia** (`this.add.shader` com `fragmentSource`),
  `scrollFactor 0`, depth −1e9 (sob os chunks), resize acompanha a viewport.
  1 draw call.
- Uniforms: `uTime` (tempo **renderizado** acumulado — congela dormindo),
  `uScroll`, `uResolution`, `uFlowTex` (unit 0 via `textures` array).
- Fragment (GLSL ES 1.0):
  1. `worldPx = coordenada do fragmento + uScroll` (atenção: gl_FragCoord é
     bottom-left — inverter Y), **snap em grade de 4px**;
  2. texel toroidal → `kind` (NEAREST) + `kindSmooth` (bilinear manual de 4
     texels do canal B) + vetor de fluxo decodificado;
  3. **flow-map**: duas fases dente-de-serra defasadas 0,5; padrão = value
     noise procedural 2 oitavas (hash aritmético, sem textura extra)
     amostrado em `worldUV − flow·fase·alcance`; mistura com peso
     triangular — movimento contínuo na direção do fluxo;
  4. cor base por profundidade via `kindSmooth` (deep escuro → river claro),
     **posterizada em 4 tons**; ondulação modula entre tons;
  5. **espuma**: fronteira água/terra detectada por `kindSmooth` próximo do
     limiar terra — tom quase branco pulsando lento;
  6. `kind == terra` → mesma cor de água (o terreno opaco dos RTs cobre; só
     tiles nível 0 são buracos).

### O que morre

TileSprite global, deriva/maré em código, sprites de rio + animação
`river-flow`, véu escuro do bake, `water-N.png` (geração e arquivos).
Terreno/bake de blocos, correnteza de gameplay, anti-trava, sono do loop:
intocados.

### Economia (render-on-demand)

`uTime` acumula `delta` apenas em frames renderizados — dormindo, congela;
os wakes de 400ms continuam dando vida discreta em idle. O tick de água
existente vira só "wake pulse" (sem troca de textura).

## Testes

- `flow-field`: roundtrip encode/decode (erro ≤ 1/127·MAX_CURRENT); kind por
  terreno (terra 0, rio 3…); slot toroidal para coordenadas negativas
  (`mod` euclidiano); cache determinístico e permanente.
- GLSL: não unit-testável — verificação visual no navegador (fluxo do rio
  segue as setas do dono; profundidade gradua; espuma na costa; pixelado
  coeso; parado, água ainda vive em passos de 400ms) + screenshot no PR.

## Fora de escopo

Reflexos, refração do terreno sob a água, partículas, som. Iluminação
dia/noite (outro projeto).
