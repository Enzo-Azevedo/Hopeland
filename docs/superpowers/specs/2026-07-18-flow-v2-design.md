# Mecânica de fluxo v2: vento, nascentes e cancelamento — Design

**Data:** 2026-07-18
**Status:** aprovado (brainstorming; parte A da dupla "água & relevo v3")
**Base:** water-shader (mergeado). Parte B (visual v3) tem spec própria.

## Objetivo

Três mecânicas pedidas pelo dono: (1) **vento dinâmico completo** — define o
movimento das ondas E o empurrão do oceano; (2) **nascente única por canal**;
(3) **cancelamento de fluxos opostos** com redução retroativa limitada.

## 1. Vento (`app/src/lib/world/wind.ts`, novo)

- **Separação canal × vento** preserva pureza e caches: o campo cacheável
  (`channelFlowAt` = gradiente + momento + deflexão de margem, o atual
  `currentFor` sem deriva) continua estático; o vento é **global**, não
  por tile.
- `windAt(seed, timeMs): { vx, vy }` — puro em `(seed, tempo)`: direção gira
  lentamente (período ~10 min) + rajadas determinísticas (ruído 1D no tempo),
  interpolação suave entre degraus de **10s** (`t/10000` como coordenada do
  ruído). Magnitude ∈ [0.004, 0.02] px/ms (teto = força do oceano profundo).
- **Tempo de época** (`Date.now()`), não o tempo renderizado: todos os
  jogadores do MMO veem o mesmo vento sem sincronização.
- Composição única para gameplay e visual:
  `fluxo(tile, t) = canal(tile) + influência(kind) · vento(t)`, com
  influência: deep **1.0**, water/coast **0.5**, river **0.1**, terra 0.
  Clamp final no teto do terreno (anti-trava intacto: teto máximo 0.05 <
  nado 0.07).
- API: `currentFor(seed, tx, ty, timeMs = 0)` — quarto parâmetro opcional
  (testes usam constantes; a cena passa `Date.now()`). `flowAt`/data texture
  continuam guardando **só o canal**; o shader recebe `uWind` (uniform vec2,
  avaliado por frame renderizado) e compõe igual.
- A deriva de ruído espacial atual do oceano **morre** — o vento a substitui.

## 2. Nascente única por canal (`current.ts`)

- `isSpring(seed, tx, ty): boolean` — oficial. Candidata = tile de RIO sem
  vizinho de água mais alto (cabeça de cadeia). É nascente só se, numa
  caminhada limitada pelo canal (**raio 12 tiles**, água conectada,
  8-vizinhança, visitação limitada a ~80 tiles), não houver outra cabeça
  que vença o **desempate determinístico: menor `(ty, tx)` lexicográfico**.
- Não altera o fluxo (fluxo já é contínuo pelas mecânicas existentes);
  é o conceito canônico para gameplay futuro (peixes, pureza, etc.).
- Testes: em rios reais, duas cabeças no mesmo canal ⇒ exatamente uma é
  nascente; determinismo; terra nunca é nascente.

## 3. Cancelamento de fluxos opostos (`current.ts`)

Regra do dono: onde dois fluxos se encontram de frente, a força no ponto de
encontro chega a **0**, e a redução se propaga para trás nos dois lados,
limitada pela força do lado oposto à mesma distância do encontro.

- Implementação (pura, pós-deflexão): caminhada a jusante limitada
  (**3 passos** — calibrado: com 6, meandros comuns disparavam falsos encontros e o fluxo parava de seguir o canal; varredura 1-6 documentada no task report) seguindo o octante do fluxo; se o tile seguinte tem fluxo
  com `dot < 0` (oposto), achou o ponto de encontro à distância `k`.
- Redução: `v'(t) = v(t) · max(0, 1 − |v_oposto(k)| / |v(t)|)` onde
  `v_oposto(k)` é a força do tile do lado oposto à distância `k` do
  encontro. No encontro (k=0 dos dois lados) ⇒ 0. Só **reduz** magnitude —
  anti-trava preservado por construção.
- Testes: pares adjacentes com dot<0 no mundo real têm magnitude reduzida
  vs o canal cru (exportar `rawChannelFlow` para comparação); nunca aumenta;
  determinismo.

## Arquivos

- Criar: `app/src/lib/world/wind.ts` (+ test)
- Modificar: `app/src/lib/world/current.ts` (channelFlowAt, isSpring,
  cancelamento, novo parâmetro de tempo) + tests
- Modificar: `app/src/lib/world/flow-field.ts` (usa canal puro; sem mudança
  de encoding), `PhaserGame.tsx` (passa `Date.now()` ao push; uniform
  `uWind`), `water-shader.ts` (compõe `uWind` com influência por kind)
- Testes existentes de current continuam passando com `timeMs` fixo.

## Fora de escopo

Visual v3 (spec própria); vento afetando terra/projéteis; previsão do tempo.
