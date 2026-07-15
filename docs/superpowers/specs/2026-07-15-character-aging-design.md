# Envelhecimento e morte por velhice — design (Spec B)

Data: 2026-07-15
Status: aprovado em brainstorming
Pré-requisito: `2026-07-15-character-persistence-design.md` (Spec A — `played_seconds`)

## Objetivo

Todo personagem nasce criança e envelhece com tempo de jogo ativo, mantendo as
mesmas características (seed, cabelo, rosto/traits, tom de pele, roupa da
profissão) através das faixas etárias — só a arte da faixa muda. Ao fim da
velhice o personagem morre e o jogador cria outro.

## Decisões já tomadas

| Decisão | Escolha |
|---|---|
| Estágios | criança → adolescente → jovem adulto → meia-idade → idoso (tiers do mod c/t/y/m/e) |
| Limiares (horas de jogo ativas, cumulativas) | criança até 8h; teen até 24h; jovem até 84h; meia-idade até 234h; idoso até 284h; **morte em 284h** |
| Idade | Derivada de `played_seconds` — nunca armazenada |
| Identidade | Mesmos nomes de variante entre idades (verificado: 9 traits de rosto existem em cf/cm/tf/tm/af/am; cabelo `cn-`/`an-` compartilham os 48 nomes) |
| Pós-morte | Linha arquivada (`died_at`); tela de morte; criação liberada |

## Faixas → assets

```
ageStage(playedSeconds): "c" | "t" | "y" | "m" | "e"   (+ "dead" sinalizado à parte)
```

| Camada | criança (c) | teen (t) | jovem (y) | meia-idade (m) | idoso (e) |
|---|---|---|---|---|---|
| head | `c{g}-<shape>` (6 formas × gênero) | `t{g}-<shape>` | `y{g}-<shape>` (já curado) | `m{g}-<shape>` | `e{g}-<shape>` |
| face inner/outer | `c-<g>-<bucket>-<n>` (mesmos 9 traits) | `t-...` | adulto `a-...` (atual) | adulto | adulto |
| hair | `cn-<nome>` (mesmos nomes) | adulto `an-` | adulto | adulto | adulto |
| beard | — | — | como hoje (chance via seed) | como hoje | como hoje |
| neck | `c{g}-child` (único, sem porte) | `t{g}-<tier>` (4 portes) | `a{g}-<tier>` (atual) | atual | atual |
| clothes | `s` (ambos gêneros) | f→`m`; m→`m` (porte sturdy/robust→`l`) | regra atual | atual | atual |

Curadoria adicional: ~48 cabeças (c/t/m/e × 2 gêneros × 6 formas), 36+36 rostos
(c/t inner+outer × 2 gêneros × 9), 10 cabelos `cn`, 2 pescoços criança,
8 pescoços teen, 12 roupas `s` (reaproveitar as fontes já identificadas).
Convenção de chave no manifesto ganha o prefixo de estágio **em todas as
camadas etárias, incluindo as adultas existentes** (renomeação one-time dos
arquivos em `assets/portraits/source/`: `head/f-averagenormal.png` →
`head/y-f-averagenormal.png`, `face-*/f-low-1.png` → `face-*/a-f-low-1.png`,
`neck/f-thin.png` → `neck/a-f-thin.png`, `hair/afro.png` → `hair/a-afro.png`,
`clothes/<prof>-m.png` → `clothes/a-<prof>-m.png` etc.), para que a seleção
monte chaves por um único padrão `<estágio>-<resto>`. Rostos/pescoços/roupas
usam estágio de arte `c|t|a` (adulto cobre y/m/e); cabeças usam `c|t|y|m|e`;
cabelo usa `c|a`; barba segue sem estágio (só adulto). O pipeline
(`build-portraits.mjs`) não muda de formato, só de contagem.

## Seleção e componente

- `selectPortraitLayers(appearance, mood, manifest, ageStage)` — novo parâmetro
  obrigatório com default `"y"` (compatibilidade: chamadas existentes seguem
  renderizando jovem adulto).
- O contrato de draws do PRNG NÃO muda (mesmos 9 draws); `ageStage` só troca o
  prefixo das chaves. Mesmo seed = mesma pessoa em qualquer idade.
- `CharacterPortrait` ganha prop `ageStage?: AgeStage` (default `"y"`).
- `/game` e revelação calculam `ageStage` de `played_seconds` (criação = 0 →
  criança; a revelação mostra o retrato infantil).
- Preload (`preloadPortrait`): pré-carrega o estágio atual; troca de estágio é
  rara (horas de jogo), buscar na hora é aceitável.

## Morte

- `heartbeat` (Spec A) detecta `played_seconds >= 1_022_400` (284h) e grava
  `died_at = now()` na mesma atualização (transação única); retorna o estado
  `dead: true`.
- `/game` ao receber `dead: true` (ou ao carregar personagem com `died_at`):
  mostra `DeathView` — "{nome} viveu {horas}h em Hopeland." + botão
  "Criar novo personagem" → limpa cache local → `/character-creation`.
- `/character-creation` já libera (índice de vivo não vê a linha arquivada).
- `getActiveCharacter` retorna só vivos (where `died_at is null`).

## Erros e testes

- `ageStage()` — testes de fronteira em todos os limiares (8h-1s → c; 8h → t;
  284h → dead etc.).
- Seleção por estágio: chaves corretas por camada/estágio (criança sem barba,
  pescoço único, roupa `s`; teen com porte no pescoço; identidade: mesmo
  seed+trait através dos estágios).
- Manifesto: todas as combinações estágio×gênero×porte×bucket resolvem
  (varredura exaustiva — fecha o follow-up antigo do review).
- Manual: debug fn para setar `played_seconds` e ver o mesmo personagem nas 5
  idades + fluxo de morte completo.

## Fora de escopo

- Efeitos de idade em skills/gameplay; herança; envelhecimento offline;
  cemitério/histórico visível; ferimentos/características adquiridas (o
  usuário explicitamente as desconsiderou aqui).
