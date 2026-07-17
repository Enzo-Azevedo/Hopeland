# Mundo procedural com biomas — Design

**Data:** 2026-07-16
**Status:** aprovado (brainstorming com o dono do projeto)

## Objetivo

Substituir o placeholder do `PhaserGame.tsx` (grid verde + retângulo) por um
mundo 2D top-down **infinito, procedural e determinístico**, com biomas
realistas texturizados pelo pack **Classic Faithful 32x**, onde é
**impossível o jogador ficar preso** — garantido por construção, não por
validação.

Fora de escopo desta entrega: quebrar tiles, ferramentas, inventário,
persistência de modificações do mundo, avatar do jogador, animação de água,
multiplayer visível. O modelo de dados já nasce pronto para diffs futuros.

## Decisões fundamentais

| Decisão | Escolha |
|---|---|
| Extensão | Infinito, gerado em chunks sob demanda |
| Seed | Constante global versionada no código (`world-config.ts`); mesma para todos (MMO). Migra para o banco se um dia houver múltiplos mundos |
| Anti-trava | **Nenhum tile bloqueia.** Água nada-se (lento), subida prolongada fatiga (lento). Sem colisores de terreno |
| Biomas | 9+: tundra, taiga, neve, planície, floresta, pântano, deserto, savana, floresta tropical + água (oceano/rio/costa), praia, montanha (rocha/rocha nevada) |
| Escala de bioma | Manchas de ~500×500 tiles; continentes ~2000 tiles |
| Determinismo | `getTile(seed, x, y)` é função pura; chunks independentes entre si e da ordem de geração |

## Pipeline de geração (por tile)

Toda a geração é função pura de `(seed, tileX, tileY)`. Ruído base: **simplex
2D com derivadas analíticas** (implementação própria, sem dependência nova;
hash da grade derivado de `mulberry32`, já usado no repo).

1. **Domain warping** — dois fBm auxiliares distorcem as coordenadas
   (amplitude ~100-200 tiles) antes de amostrar as camadas seguintes.
   Costas recortadas e fronteiras de bioma orgânicas.
2. **Continentalidade** — fBm de frequência baixíssima (~2000 tiles)
   remapeado por spline: oceano profundo → oceano → costa → planície →
   planalto.
3. **Elevação com erosão** — fBm 5-6 octaves com **amortecimento por
   gradiente acumulado** (Quilez/de Carpentier): encostas íngremes suprimem
   octaves de alta frequência → vales lisos, cristas rugosas. Zonas altas
   misturam **ridged multifractal** para cordilheiras contínuas.
4. **Clima** — temperatura (ruído suave − penalidade por altitude ⇒ linha de
   neve) × umidade (ruído independente), comprimento de onda calibrado para
   biomas de ~500 tiles. Matriz de Whittaker 3×3 escolhe o bioma.
5. **Rios (context-free)** — ruído ridged warpado; `|valor| < ε` vira água
   rasa nadável, com ε crescendo em terra baixa (rios alargam rumo ao mar).
   Sem simulação global — compatível com chunks infinitos.

**Saída por tile:** `{ biome, terrain, elevation, slope }`.
`terrain ∈ { deep_water, water, river, beach, grass, forest, swamp, desert,
savanna, tundra, snow, taiga, rock, snow_rock }`. `slope` vem das derivadas
analíticas (grátis) e alimenta a fadiga de subida.

Custo: ~10 avaliações de ruído por tile; um chunk (1024 tiles) gera em poucos
ms.

## Chunks e rendering (Phaser 4)

- **Chunk = 32×32 tiles**, tile de 32 px ⇒ 1024×1024 px. Endereço canônico
  `(chunkX, chunkY, tileIndex)` com `chunk = floor(tile/32)`.
- **RenderTexture por chunk**: os tiles são carimbados do atlas **uma vez**;
  no steady-state cada chunk custa 1 draw call. (TilemapLayer faz culling por
  tile por frame — pior para chunks estáticos. Quando existir quebra de tile,
  re-carimba-se só o tile alterado.)
- **Anel 5×5** de chunks ao redor da câmera; criação via **fila com orçamento
  de tempo** (máx. 1 chunk assado por frame, priorizando a direção do
  movimento) — nunca trava o frame. Web Worker para o ruído só se um hitch
  for medido.
- **Pool de RenderTextures**: chunks que saem do anel devolvem a textura ao
  pool. Cache LRU dos dados de tile gerados.
- Câmera segue o jogador (retângulo atual permanece).

## Texturas (Classic Faithful 32x)

Pipeline espelhado no dos retratos:

1. Subset **curado** (~40-60 PNGs de `assets/minecraft/textures/block/`) do
   zip → `assets/tiles/source/` (versionado; o zip fica fora do git).
2. `app/scripts/build-tiles.mjs` (sharp): aplica **tints de bioma** nas
   texturas grayscale (grama/folhagem, como o colormap do Minecraft) e monta
   **um atlas PNG + JSON** em `app/public/tiles/`. **Saída committed** — o
   build da Cloudflare não roda o pipeline.
3. Cada terreno mapeia para 2-4 variantes escolhidas por hash determinístico
   do tile (quebra repetição). Sem máscaras de transição na v1 — bordas
   duras estilo Minecraft; o warp já evita fronteiras retas.
4. Água usa o primeiro frame da strip animada.

**Licença** ⚠️: Faithful License v3 — atribuição + link para
faithfulpack.net obrigatórios, **monetização proibida**. Agravante: Faithful
recria a arte da Mojang (zona cinzenta de IP fora de Minecraft). Registrar em
`assets/tiles/CREDITS.md`, mesma pendência pré-monetização dos retratos
(CC BY-NC-ND). Resolver antes de qualquer receita.

## Movimento

Modificadores multiplicativos de velocidade lidos do tile sob o jogador
(nenhum colisor):

| Terreno | Multiplicador |
|---|---|
| Oceano profundo | 0.35× |
| Água/rio/costa | 0.45× |
| Pântano | 0.8× |
| Neve | 0.9× |
| Demais | 1× |

**Fadiga de subida**: movendo-se com `slope` acima do limiar e elevação
crescente, fadiga acumula 0→1 em ~4 s contínuos; velocidade interpola 1× →
0.4×; recupera em ~2 s em plano/descida.

**Invariante anti-trava:** todo terreno tem multiplicador > 0 e não existe
colisão de terreno ⇒ impossível prender o jogador, por construção.

## Spawn

Busca determinística em espiral a partir de `(0,0)` pelo primeiro tile de
planície/floresta em terra firme — mesmo ponto para todos os jogadores.
Posição do jogador continua não persistida (dívida registrada).

## Arquivos

- `app/src/lib/world/noise.ts` — simplex + derivadas, fBm, eroded, ridged, warp
- `app/src/lib/world/world-gen.ts` — pipeline → `getTile(seed, x, y)`
- `app/src/lib/world/chunk-manager.ts` — anel, fila com orçamento, pool, LRU
- `app/src/lib/world/movement.ts` — modificadores + fadiga
- `app/src/lib/world/world-config.ts` — seed global + escalas/limiares
- `app/scripts/build-tiles.mjs`, `assets/tiles/source/`,
  `assets/tiles/CREDITS.md`, `app/public/tiles/` (atlas committed)
- `app/src/components/PhaserGame.tsx` — refeito para usar o mundo

## Testes (TDD, bun test)

- **Determinismo**: mesma seed ⇒ mesmos tiles; resultado independe da ordem
  de geração dos chunks.
- **Biomas**: matriz de Whittaker, linha de neve por altitude, praia na
  costa; escala média de bioma ~500 tiles por amostragem estatística.
- **Anti-trava**: varredura de milhares de tiles — todo terreno tem
  multiplicador de velocidade > 0.
- **Fadiga**: acumula em subida, recupera em plano, respeita os limites.
- **Spawn**: cai em terra firme, é determinístico.

## Verificação visual (AGENTS.md §7.5 adaptado)

Script descartável renderiza mapa grande (ex.: 2048×2048 tiles → PNG colorido
por bioma/elevação) **usando o motor real** (`getTile`), para inspecionar
continentes, cordilheiras, rios e escala de bioma antes de commitar.

## Referências

- Red Blob Games — Making maps with noise functions
- Inigo Quilez — value noise derivatives / morenoise
- Giliam de Carpentier — Scape: procedural extensions (erosão por derivadas)
- alcatrazEscapee — Why are rivers so complicated? (rios context-free)
- Alan Zucconi — The World Generation of Minecraft (multi-noise + splines)
