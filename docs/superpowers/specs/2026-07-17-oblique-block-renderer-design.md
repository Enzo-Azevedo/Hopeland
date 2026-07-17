# Renderer 2.5D oblíquo com blocos — Design

**Data:** 2026-07-17
**Status:** aprovado (brainstorming com o dono; decisões visuais tomadas em mockups)
**Fase 2 do mundo procedural** (spec base: `2026-07-16-procedural-world-design.md`)

## Objetivo

Trocar o renderer top-down plano por um **2.5D de blocos com grid reto**: a
elevação do terreno vira altura física visível (morros sobem, penhascos
mostram paredes, água fica rebaixada), mantendo o mundo alinhado aos eixos da
tela — identidade própria, deliberadamente **não** o diamante isométrico do
Minecraft Dungeons (decisão do dono).

Só o renderer muda. Geração (`getTile`), chunk-planner, movimento/fadiga,
spawn, heartbeat e render-on-demand permanecem intactos.

Fora de escopo: quebra de tile, água animada, avatar do jogador (continua o
retângulo), decorações (árvores/pedras), mouse picking, multiplayer visível.

## Decisões do dono (mockups comparados no visual companion)

| Decisão | Escolha |
|---|---|
| Projeção | **Oblíqua reta, topo quadrado 32×32 sem distorção** (rejeitados: diamante iso estilo Dungeons; topo achatado 2:1) |
| Relevo | **Colinas suaves**: 14 níveis de meio-bloco (rejeitado: 6 níveis terraceados) |
| Oclusão do jogador | **Silhueta translúcida** através do terreno (estilo Dungeons) |
| Rendering | **Bake por chunk em RenderTexture** + silhueta analítica (rejeitados: SpriteGPULayer, sprites individuais) |
| Controles | WASD = eixos da tela — com grid reto, coincide com os eixos do mundo; nada muda |

## Geometria (`app/src/lib/world/projection.ts`, puro e testado)

- `screenX = tx·32` ; `screenY = ty·32 − level·16`. Topo do bloco = tile
  32×32 do atlas atual, intacto.
- **Níveis**: água = 0 (superfície chapada no nível do mar); terra = 1..13.
  Meio-bloco = **16px**; altura máxima na tela = 208px.
  `levelFor(elevation)`: água (`elevation < GEN.water`) → 0; terra mapeia
  `[GEN.beach, 1] → 1..13` por curva monotônica que preserva colinas suaves
  (quantização de meio em meio bloco, sem degraus gigantes).
- Só a **face sul** é visível. `wallHeightFor(tile, southNeighbor)` =
  `max(0, level − levelSouth)` × 16px. Como `getWorldTile` é global e puro,
  o bake consulta o vizinho sul real **mesmo através da borda do chunk** —
  paredes de borda corretas por construção, sem lógica de costura.
- Velocidade, fadiga, spawn e endereçamento de chunk seguem em espaço de
  mundo — zero mudança mecânica.

## Assets (`app/scripts/build-tiles.mjs` estendido)

- Topos: o atlas atual (`atlas.png`/`atlas.json`) serve sem alteração.
- Novo: **tiras de parede 32×16** por material, escurecidas (~25% na metade
  superior da tira via multiply, mais escura no rodapé para leitura de
  profundidade). Mapeamento terreno→parede fiel ao Minecraft:
  - grama/floresta/selva/savana/taiga/tundra/pântano → `dirt.png`
  - deserto/praia → `sand.png` ; montanha (`rock`) → `stone.png`
  - neve/`snow_rock` → `snow.png`
- Saída committed em `app/public/tiles/` (`walls.png` + entrada no manifesto
  ou `walls.json`), como o pipeline atual. Créditos já cobertos por
  `assets/tiles/CREDITS.md`.

## Bake por chunk (RenderTexture)

- Por chunk (32×32 tiles), desenhado **uma vez**, tiles em ordem norte→sul:
  parede (se `wallHeight > 0`, tiras empilhadas) e depois o topo em
  `(x·32, y·32 − level·16)` relativo ao chunk.
- **RT: 1024 × 1440** (1024 + 208 de padding no topo para blocos altos da
  fileira norte + 208 embaixo para paredes que pendem além da borda sul).
  Posição na tela: `(cx·1024, cy·1024 − 208)`.
- **Depth entre chunks = cy** (fileiras do sul por cima — resolve paredes
  pendentes). Dentro da mesma fileira não há sobreposição horizontal.
- Custo por frame: **1 draw call por chunk**, igual a hoje. Fila orçada
  (1 bake/frame), anel 5×5, pool/destroy e render-on-demand inalterados
  (bake continua contando como frame sujo).
- `TilemapGPULayer` e o fallback saem do código (RT é API estável). O patch
  do Phaser permanece no repo (inofensivo; issue upstream segue válida).
- Quebra de tile futura = re-bake do chunk afetado.

## Jogador

- Desenha acima do terreno em `screenY − level·16` do tile atual, com
  **interpolação de ~100ms** entre níveis (sem teleporte visual ao subir
  degrau). Câmera segue a posição projetada.
- **Silhueta**: teste analítico por frame — varre 2-3 fileiras ao sul do
  jogador; se topo+parede de algum tile cobre o retângulo projetado do
  jogador (nível alto o bastante), ativa o clone silhueta (cor chapada
  translúcida, depth acima de tudo). Sem re-ordenação de terreno.

## Testes (bun, co-locados em `app/src/lib/world/`)

- `projection.test.ts`: mapeamento tile↔tela (incl. coordenadas negativas);
  `levelFor` — água=0, terra∈[1,13], monotônica em elevation, praia no
  nível 1; `wallHeightFor` — só quando o vizinho sul é mais baixo, valor
  exato, consistência através de bordas de chunk (amostragem no mundo real
  com a seed "Esperança").
- Oclusão: função pura `isOccluded(playerTile, playerLevel, tilesAoSul)` com
  casos: vale fundo atrás de paredão → true; planície → false.
- Verificação visual (AGENTS §7.5): script sharp descartável renderiza
  ~64×64 tiles com o motor real (topos coloridos por terreno + paredes
  escurecidas + offset de nível) para inspecionar o relevo antes de
  commitar; teste no navegador via acesso convidado (flag ainda ativa).

## Arquivos

- Criar: `app/src/lib/world/projection.ts` (+ `.test.ts`)
- Modificar: `app/scripts/build-tiles.mjs` (tiras de parede),
  `app/public/tiles/*` (saída), `app/src/components/PhaserGame.tsx`
  (bake RT no lugar da GPU layer; jogador projetado + silhueta)
- Intocados: `noise.ts`, `world-gen.ts`, `world-config.ts` (ganha só as
  constantes do projection), `chunk-manager.ts`, `movement.ts`
