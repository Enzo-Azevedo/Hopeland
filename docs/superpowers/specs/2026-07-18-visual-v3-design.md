# Visual v3: costa viva, rios evidentes, relevo legível — Design

**Data:** 2026-07-18
**Status:** aprovado (brainstorming; parte B da dupla "água & relevo v3")
**Base:** water-shader (mergeado) + flow v2 (parte A — o vento `uWind` vem
de lá). Implementar DEPOIS da parte A.

## Objetivo

Corrigir/elevar três leituras visuais: (1) o oceano deve **sobrepor** a
borda do terreno (ondas lambendo a praia), não sumir por baixo; (2) rios
devem **evidenciar** seu movimento; (3) relevo/ressaltos fáceis de
identificar à primeira vista.

## 1. Ondas lambendo a praia (novo quad de espuma)

- **Segundo Shader GameObject fino** (`shore-shader.ts`), tela cheia,
  `depth 500_000` — **acima dos chunks** (max |cy| jamais chega perto),
  **abaixo do jogador** (1_000_000). Mesmo `uFlowTex`/`uScroll`/`uWind`.
- Fragment: desenha SÓ a faixa de fronteira água↔terra (waterness bilinear
  ∈ (0.35, 0.80), lado da terra incluído) — uma lâmina d'água translúcida +
  espuma pixelada que **avança e recua sobre a areia** no ritmo do vento
  (fase = dot(worldPx, dir(uWind)) + uTime). Fora da faixa: `alpha 0`.
- Resultado: a água visivelmente sobe na areia e cobre a borda do
  barranco/ledge — a sobreposição que o dono pediu, sem tocar no bake.
- Custo: +1 draw call; mesmo campo de dados.

## 2. Rios evidentes (ajustes no `water-shader.ts`)

- Para `kind = river` (canal B do campo): ruído **anisotrópico** — UV
  comprimida ~3× na direção perpendicular ao fluxo (streaks alongados ao
  longo da corrente), fase ~2× mais rápida, contraste de tons maior
  (posterização com amplitude ampliada). Rios ficam com riscos de corrente
  inconfundíveis; oceano mantém o visual atual dirigido pelo vento.

## 3. Relevo legível (bake, `PhaserGame.tsx`)

Escolhas do dono: contorno de degrau + AO nos topos ao pé de paredões.

- **Fio de luz**: tile cujo vizinho NORTE tem nível menor ganha uma faixa
  clara de 3px na borda norte do topo (stamp do frame `white`, tint claro
  `0xffffff`, alpha ~0.28, scaleY 3/32) — cada quebra de nível vira um
  contorno iluminado (leitura tipo Rimworld).
- **AO de vale**: tile cujo vizinho NORTE tem nível MAIOR ganha gradiente
  escuro na borda norte do topo (stamp `white`, tint 0x000000, alpha
  crescendo com a diferença de níveis: `min(0.30, 0.10 + diff*0.05)`,
  scaleY 6/32) — pés de paredão afundam visualmente.
- Ambos usam `getWorldTile` global — sem costura entre chunks; re-bake
  não muda de custo perceptível (≤ 2 stamps extras/tile só em quebras).

## Testes e verificação

- Bake: sem novos unit tests (stamps); `render-relief.ts` ganha o fio de
  luz/AO na visualização de debug para conferência antes do navegador.
- GLSL: verificação visual do dono (checklist: onda lambe a areia e cobre a
  borda; rio com streaks direcionais; degraus contornados; vales
  sombreados; sem costuras).

## Fora de escopo

Partículas, som de água, molhado dinâmico na areia (textura), sombras
projetadas reais.
