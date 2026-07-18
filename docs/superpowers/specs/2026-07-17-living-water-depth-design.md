# Água viva e profundidade ambiente — Design

**Data:** 2026-07-17
**Status:** aprovado (brainstorming com o dono)
**Base:** renderer 2.5D oblíquo (spec `2026-07-17-oblique-block-renderer-design.md`, mergeado)

## Objetivo

Dar vida à água (animação constante + gradiente raso→fundo) e profundidade
visual ao mundo (brilho por elevação + oclusão ambiente na base dos
penhascos), **sem shader custom e sem custo por frame** — tudo por camada
separada + tints em bake-time. Um shader de ondas fica registrado como
upgrade futuro isolado.

Decisões do dono: abordagem C (camada+tints agora, shader depois); água
anima sempre, acordando o loop ~2,5x/s mesmo em idle.

## Arquitetura

**Insight estrutural:** a água é sempre plana no nível 0 — não precisa estar
no bake dos chunks.

1. **Camada de água**: `TileSprite` do tamanho da viewport, `scrollFactor 0`,
   `depth -1e9` (abaixo de todos os chunks), `tilePosition` = scroll da
   câmera (plano infinito). Usa os 4 frames de água existentes do atlas,
   trocando a cada **400ms**. Redimensiona no resize.
2. **Bake dos chunks (mudanças)**:
   - Tiles de água **não carimbam nada** (transparência revela a camada).
   - `deep_water`: carimba véu escuro translúcido — novo frame **`white`**
     (32×32 branco sólido) no atlas, com `tint #0a1a3a` e `alpha 0.45`.
     `water`/`river` ficam sem véu (rasos, claros).
   - Topos de terra: `tint` por nível via **`brightnessFor(level)`** (nova
     função pura em `projection.ts`): monotônica, vales ≈0.82 → picos 1.0,
     aplicada como tint cinza no stamp.
   - **Oclusão ambiente**: overlay escuro (frame `white`, tint `0x000000`)
     sobre a **última tira** de cada parede, alpha crescendo com a altura do
     paredão (ex.: `min(0.35, 0.08 + strips * 0.03)`).
3. **Tick da água × render-on-demand**: `setInterval` de 400ms no JS (timers
   do Phaser não correm com o loop dormindo). No tick: avança o frame do
   TileSprite; se o loop está dormindo, `wake()` e seta flag
   `sleepAfterSettle` — o `update()` seguinte pode dormir **no primeiro
   frame limpo**, sem esperar os 30 frames. Custo do idle ≈ 2,5 frames/s
   (~4% de 60fps). O interval é limpo no destroy da cena.

## Correnteza (mecânica)

A água **empurra** quem está nela — jogador hoje; NPCs/mobs futuros consomem
a mesma API.

- **`currentFor(seed, tx, ty): { vx: number; vy: number }`** — função pura
  (novo módulo `app/src/lib/world/current.ts`), vetor em px/ms:
  - **Geração local**: descida do campo de elevação (gradiente negativo via
    `getElevation`), com magnitude proporcional à inclinação (força plena a
    partir de `|grad| ≥ 0.002`).
  - **Momento a jusante (mecânica do dono, 2026-07-18)**: cada tile herda
    **metade da força do tile a montante** (vizinho de água mais alto),
    recursivo por 4 passos (1/2, 1/4, 1/8, 1/16) — a foz continua seguindo o
    canal do rio ao desaguar, e quanto mais longe da geração, mais fraca a
    força. No oceano plano (sem geração nem herança) entra a deriva suave
    de ruído.
  - **Deflexão de margem (mecânica do dono, 2026-07-18)**: se a direção
    padrão do fluxo colide com a borda do terreno, **90% da força desvia**
    para o vizinho de água mais livre (mais cercado de água), nunca de
    volta ao tile de onde a força veio — o fluxo "escorrega" em diagonal
    acompanhando o canal. Testado: o fluxo quantizado de tiles de rio
    aponta para água (não para a margem) em >85% da amostra.
  - Intensidade por terreno (teto pós-soma): `river` mais forte, `water`
    média, `deep_water` suave. Terra = vetor nulo.
- **Invariante anti-trava (testado):** a intensidade máxima da correnteza é
  **estritamente menor** que a velocidade de nado
  (`0.2 × TERRAIN_SPEED[deep_water] = 0.07 px/ms`) — nadar contra a
  correnteza sempre vence; impossível ficar preso, por construção.
- Aplicação na cena: a cada frame com o jogador em tile de água,
  `worldX/Y += current × delta` (antes dos modificadores de movimento;
  fadiga não é afetada). **Enquanto o jogador está na água o loop não dorme**
  (a correnteza move o jogador/câmera continuamente) — custo aceito, estar
  na água é transitório.
- Testes: pureza/determinismo; magnitude ≤ limite anti-trava em varredura de
  tiles reais de água; direção aponta descida onde o gradiente é claro
  (margem de rio); terra retorna vetor nulo.

## Fora de escopo

Shader de ondas (filtro custom Phaser 4 — upgrade futuro na camada já
separada), espuma de borda, reflexos, profundidade contínua por pixel.

## Arquivos

- `app/scripts/build-tiles.mjs` — frame `white` no atlas + campo `white`
  (índice) no `atlas.json`.
- `app/src/lib/world/projection.ts` — `brightnessFor(level: number): number`
  (+ testes: limites [0.8, 1.0], monotônica, nível 13 = 1.0).
- `app/src/lib/world/current.ts` — `currentFor(seed, tx, ty)` (+ testes).
- `app/src/components/PhaserGame.tsx` — camada de água + tick/wake +
  mudanças no bake (transparência, véu, tints, oclusão).
- `app/src/lib/world/atlas.test.ts` — `white` presente e válido.
- `app/scripts/render-relief.ts` — aplicar `brightnessFor` no shading para a
  verificação visual refletir o jogo.

## Testes e verificação

- `brightnessFor`: puro, limites, monotonicidade.
- Manifesto: frame `white` válido.
- Visual (AGENTS §7.5): re-render do relevo com brilho por nível (vales
  visivelmente mais escuros); no navegador (acesso convidado): água anima
  parado, oceano escuro vs costa clara, GPU em idle fica em ~2-3 fps de
  atividade em vez de 0 (trade-off aceito pelo dono).
