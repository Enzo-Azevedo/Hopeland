# Sistema de retrato em camadas — design

Data: 2026-07-14
Status: aprovado em brainstorming (modelo derivado + seed; expressão por humor; canvas + tint)

## Objetivo

Substituir o retrato placeholder (primitivas geométricas em canvas) por retratos
compostos de camadas de arte real, usando os assets do mod **Portraits of the Rim**
(autor: TwoPenny, Nexus mod 425), permitido com crédito ao autor.

O retrato é **derivado** das escolhas narrativas + uma seed aleatória gerada na
criação. O jogador não edita a aparência — o personagem é "revelado". Única parte
dinâmica no v1: a camada de rosto/expressão muda com o humor (0–100 → low/mid/high),
já previsto no schema atual.

## Decisões já tomadas

| Decisão | Escolha |
|---|---|
| Modelo de aparência | Derivado das escolhas + seed aleatória (sem editor) |
| Dinamismo v1 | Só expressão por humor; resto fixo na criação |
| Render | Canvas 2D compondo camadas WebP com tint (multiply) — os assets do mod são brancos por design, tingidos em runtime |
| Entrega de assets | Manifesto JSON + WebP 320×320 gerados por script de build (sharp) a partir de subset curado |
| Escala futura | Manifesto agnóstico de motor; evoluções possíveis: atlas+Phaser (retratos in-game) ou composição server-side no Worker (`/portrait/:seed.png`). Decisão adiada (YAGNI) |

## Organização de assets

```
assets/portraits/
  CREDITS.md              # atribuição a TwoPenny + link Nexus + termos
  source/                 # subset curado, PNGs 600×600 originais do mod
    head/                 # 12: yf/ym × 6 formas (average|narrow × normal|pointy|wide)
    face-inner/           # 18: 9 por gênero, 3 por bucket de humor (low|mid|high) — base de pele (tint)
    face-outer/           # 18: mesmos variantes — detalhes (olhos/sobrancelha, sem tint)
    hair/                 # ~10 neutros (an-*)
    beard/                # ~5 (masculino, chance via seed)
    neck/                 # 2 (1 por gênero)
    clothes/              # 12: 1 por profissão (OuterClothingTorso + mods VE*)
app/public/portraits/     # SAÍDA do build (committed): WebP 320×320 + manifest.json
app/scripts/build-portraits.mjs   # pipeline sharp: resize+WebP+manifesto
```

- O `.7z` do mod e a extração completa ficam FORA do git (adicionar `*.7z` ao
  `.gitignore` da raiz). Só o subset curado em `assets/portraits/source/` é versionado.
- O script de build roda manualmente (`bun run build:portraits`) quando a curadoria
  muda; a saída é commitada, então o build da Cloudflare não muda.

## Manifesto (schema)

```jsonc
{
  "version": 1,
  "size": 320,
  "credit": "Portrait assets by TwoPenny — Portraits of the Rim (Nexus 425)",
  "layers": {
    // ordem de empilhamento = ordem das chaves
    "neck":    { "tint": "skin", "variants": { "f": "neck/f.webp", "m": "neck/m.webp" } },
    "clothes": { "tint": null,   "variants": { "ferreiro": "clothes/ferreiro.webp", /* ... */ } },
    "head":    { "tint": "skin", "variants": { "yf-averagenormal": "head/yf-averagenormal.webp", /* ... */ } },
    "face-inner": { "tint": "skin", "variants": { "f-low-1": "face-inner/f-low-1.webp", /* ... */ } },
    "face-outer": { "tint": null,   "variants": { "f-low-1": "face-outer/f-low-1.webp", /* ... */ } },
    "beard":   { "tint": "hair", "variants": { /* ... */ } },
    "hair":    { "tint": "hair", "variants": { "afro": "hair/afro.webp", /* ... */ } }
  }
}
```

- `tint: "skin" | "hair" | null` — camadas brancas recebem multiply da cor derivada;
  camadas já coloridas (roupa) passam direto.
- Rosto vem em par InnerFace/OuterFace do mod (mesmos nomes de arquivo): inner é a
  base de pele (tinge), outer são os detalhes por cima (não tinge). Confirmar o par
  visualmente na curadoria; se a hipótese estiver errada, ajustar `tint` por camada
  no manifesto — o formato já comporta.
- Nomes de variante são estáveis (chaves do jogo), não os nomes de arquivo do mod.

## Seleção (determinística)

Novos campos em `Character.appearance`: `seed: number` (u32, gerado server-side em
`buildCharacter`) e `gender: "f" | "m"` (derivado da seed no v1; campo separado para
permitir escolha explícita depois).

PRNG `mulberry32(seed)` consome na mesma ordem sempre:

1. `gender` — 50/50
2. `head` — forma dentre as 6 do gênero
3. `hair` — variante + cor (paleta de ~6 cores de cabelo)
4. `beard` — só `m`, chance 50%, variante
5. Variação de rosto dentro do bucket de humor (1 de 3)

Derivados sem seed (regras existentes):
- `skinTone` ← origem (mapa `ORIGIN_APPEARANCE` atual; cores hex do `SKIN_COLOR` atual)
- `clothes` ← profissão (1:1)
- bucket de expressão ← `moodExpression(mood)` (função existente)
- `build` ← físico (v1: não afeta camadas; porte fica para quando houver corpo inteiro)

Trocar humor NÃO re-sorteia nada: o rosto tem variação fixa por bucket escolhida na
criação (consome 3 sorteios, um por bucket, na criação).

## Componente

`CharacterPortrait` mantém a mesma interface pública (`appearance`, `mood`, `size`,
`className`). Internamente:

1. Busca `manifest.json` (cache em módulo) e as WebPs das camadas selecionadas.
2. Compõe em canvas: para camada com tint, desenha num canvas offscreen, aplica
   `globalCompositeOperation: "multiply"` com a cor, restaura alpha com
   `destination-in`, e desenha no canvas principal.
3. Redesenha só a pilha quando `mood` cruza bucket (troca 1 camada).
4. Fallback: enquanto carrega (ou em erro de fetch), desenha o placeholder
   geométrico atual — o código existente vira função de fallback, não é deletado.

`APPEARANCE_ASSET_MAP` (stub atual no schema) é substituído pelo manifesto.

## Créditos

- `assets/portraits/CREDITS.md` com atribuição completa e termos da página Nexus.
- Rodapé da tela de criação: "Arte do retrato: TwoPenny — Portraits of the Rim"
  com link. (Página de créditos dedicada fica pra quando existir menu.)

## Erros e testes

- Fetch de camada falhou → fallback geométrico + `console.error`; nunca quebra o fluxo.
- Unit (vitest): seleção determinística (mesma seed ⇒ mesmas variantes), buckets de
  humor, validação do manifesto (toda variante referenciada existe no JSON).
- Script de build valida: todo arquivo referenciado existe; nenhum WebP > 60 KB.
- Verificação manual: fluxo completo de criação com retrato real renderizado.

## Fora de escopo (v1)

- Editor de aparência; idade/envelhecimento; cicatrizes/ferimentos; roupa por
  equipamento; retrato como textura Phaser; endpoint server-side de retrato.
