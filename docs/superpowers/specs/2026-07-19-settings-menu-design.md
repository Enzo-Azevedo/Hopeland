# Menu de configurações (gráficos e jogabilidade) — Design

**Data:** 2026-07-19
**Status:** aprovado (brainstorming com o dono)
**Base:** visual v3 (PR #41). Se #41 ainda não estiver mergeado ao implementar,
rebase sobre ele — a cena compartilha pontos de edição.

## Objetivo

Menu de configurações in-game com persistência local e efeito imediato:

| Seção | Opção | Padrão |
|---|---|---|
| Gráficos | **Tiles sempre animados** | OFF |
| Jogabilidade | **Números de elevação** fixos sobre os tiles | OFF |
| Jogabilidade | **Setas de direção dos fluidos** | OFF |

## Sistema (`app/src/lib/settings.ts`)

- `interface GameSettings { alwaysAnimate: boolean; showElevation: boolean; showFlowArrows: boolean }`
- `DEFAULT_SETTINGS` = tudo `false`.
- `loadSettings(storage?) / saveSettings(patch, storage?)`: chave
  **`hopeland-settings-v1`**, JSON com **merge sobre os defaults** (chaves
  desconhecidas ignoradas, ausentes preenchidas); seguro em SSR
  (`typeof window` guard) e com storage injetável para testes.
- `getSettings()` (snapshot atual) e `subscribe(fn): unsubscribe` — mini
  emitter; `saveSettings` notifica os inscritos.
- Testes (bun, storage fake): defaults quando vazio/corrompido; merge de
  chave parcial; persistência round-trip; subscribe notifica e cancela.

## UI (React, `game.tsx` + novo `ui/switch.tsx`)

- Botão **⚙** no canto superior direito (ao lado de "Sair") abre/fecha um
  Card flutuante com as duas seções e três switches (componente `Switch`
  minimal estilo shadcn — `role="switch"`, `aria-checked`, focável).
- Texto PT-BR: "Gráficos" / "Tiles sempre animados"; "Jogabilidade" /
  "Números de elevação" / "Setas de fluxo".
- Mudanças chamam `saveSettings` (aplica + persiste); estado local via
  `useState` + `subscribe`.

## Cena (PhaserGame.tsx)

- **Tiles sempre animados**: no bloco de sono do `update()`, se
  `alwaysAnimate` está ON, zera `cleanFrames`/`sleepAfterSettle` e nunca
  chama `loop.sleep()`. O subscriber da cena dá `loop.wake()` quando a
  opção liga com o loop dormindo.
- **Números de elevação**: quando ON, o bake desenha o nível (1..13) no
  canto do topo de cada tile de terra via `rt.draw` de um
  `Phaser.GameObjects.Text` reutilizável (`make.text({ add: false })`,
  fonte monospace 10px, branco com stroke preto), antes do `rt.render()`.
  Alternar a opção **re-assa o anel**: destrói todos os chunks e deixa a
  fila orçada recriá-los (mesmo caminho do streaming; ~1s espalhado).
  Água (nível 0) não numera.
- **Setas de fluido**: quando ON, um container (`depth 600_000`) mantém um
  **pool de Images** com textura de seta gerada em runtime
  (`Graphics.generateTexture("flow-arrow")`, ~12px, branca translúcida).
  A cada tick de água (400ms) e a cada travessia de tile da câmera:
  reposiciona uma seta por tile de água visível (viewport + 1),
  `rotation = atan2(currentFor(seed, tx, ty, Date.now()))`, alpha
  proporcional à magnitude (correnteza fraca = seta discreta). Pool
  dimensionado pela viewport; sobras invisíveis. OFF destrói o container.
- Mudança de qualquer setting conta como frame sujo.

## Fora de escopo

Menu de pausa completo, controles remapeáveis, som, idioma, contas.

## Testes e verificação

- `settings.test.ts` (acima). Cena/GLSL: sem unit tests — gate
  tsc/test/build + navegador do dono (checklist: switches persistem após
  F5; sempre-animados deixa a água fluida contínua; números aparecem após
  o re-bake e somem ao desligar; setas seguem rio abaixo e giram com o
  vento no oceano; setas/números não vazam para tiles fora d'água/terra).
