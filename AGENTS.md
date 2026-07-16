# Hopeland — Guia do projeto

Guia canônico para colaboradores humanos **e agentes de IA**. Descreve o que o
projeto é, como está construído, e como novas mudanças devem ser abordadas.
Leia isto antes de tocar em qualquer código.

> Convenção de idioma: **texto para o usuário final em PT-BR; identificadores,
> tipos, nomes de arquivo e mensagens de commit em inglês.** Esta documentação
> segue a mesma mistura de propósito.

---

## 1. O que é o Hopeland

MMO sandbox jogável no navegador. O jogador cria um personagem respondendo a
perguntas narrativas, recebe um **retrato em camadas** gerado a partir de suas
escolhas, entra num mundo 2D (Phaser) e **envelhece com o tempo de jogo ativo**
— de criança a idoso — até morrer de velhice, quando cria um novo personagem.

Conceitos centrais:

- **Identidade determinística**: a aparência do personagem deriva das escolhas +
  uma `seed` aleatória. A mesma seed é a mesma pessoa em qualquer idade.
- **Tempo de jogo ativo**: só conta enquanto a aba está visível (heartbeat). A
  idade é derivada desse acúmulo, nunca armazenada diretamente.
- **Persistência real**: personagens vivem no Supabase, protegidos por RLS.

---

## 2. Stack técnica

| Camada | Tecnologia |
|---|---|
| Framework | **TanStack Start** (React 19, SSR) sobre **Nitro** (preset `cloudflare_module`) |
| Build/dev | **Vite 8** + **bun** (runtime, gerenciador de pacotes e test runner) |
| Roteamento | TanStack Router (file-based, `src/routes`) |
| Estilo | Tailwind CSS 4 + shadcn/ui (Radix) |
| Jogo 2D | **Phaser 4** |
| Auth + dados | **Supabase** (Postgres, RLS, Auth via Google OAuth) |
| Hospedagem | **Cloudflare Workers** (Workers Builds, git-connected) |
| Imagens | pipeline **sharp** (build-time) → WebP + manifesto |

Não há pasta `backend/` — o "backend" é o lado servidor do próprio Worker
(server functions do TanStack) + Supabase. O projeto **não usa mais Lovable**
(foi removido; qualquer artefato `@lovable.dev/*` que reaparecer é regressão).

---

## 3. Estrutura do repositório

```
/
├── app/                      # a aplicação (raiz do Worker; deploy aponta aqui)
│   ├── public/
│   │   └── portraits/        # SAÍDA do pipeline: WebP 320px + manifest.json (committed)
│   ├── scripts/
│   │   └── build-portraits.mjs   # sharp: source PNG -> WebP + manifest
│   ├── src/
│   │   ├── routes/           # rotas file-based do TanStack Router
│   │   │   ├── __root.tsx    # layout raiz + error boundary
│   │   │   ├── index.tsx     # "/" -> redireciona por sessão
│   │   │   ├── auth.tsx      # login Google OAuth
│   │   │   ├── character-creation.tsx  # fluxo de criação (5 etapas)
│   │   │   └── game.tsx      # mundo Phaser + HUD + heartbeat
│   │   ├── components/
│   │   │   ├── CharacterPortrait.tsx   # <canvas> que compõe as camadas
│   │   │   ├── PhaserGame.tsx          # embute o jogo Phaser
│   │   │   ├── portrait/{composite,fallback}.ts
│   │   │   └── ui/           # shadcn/ui
│   │   ├── lib/
│   │   │   ├── character-schema.ts     # tipos + buildCharacter + regras de skill/aparência
│   │   │   ├── character.functions.ts  # server functions (auth, CRUD, heartbeat)
│   │   │   ├── character-row.ts        # serialização Character <-> linha do banco
│   │   │   ├── character-store.ts      # cache em sessionStorage
│   │   │   ├── portrait-selection.ts   # PRNG + seleção de camadas por idade/gênero
│   │   │   ├── age-stage.ts            # idade derivada de played_seconds
│   │   │   ├── use-heartbeat.ts        # hook do tick de tempo de jogo
│   │   │   └── security-headers.ts     # (em PR) headers de resposta
│   │   ├── integrations/supabase/      # clients + middleware de auth + tipos gerados
│   │   ├── server.ts         # entry do Worker (envolve toda resposta)
│   │   └── start.ts          # createStart (middleware de request)
│   ├── supabase/
│   │   ├── config.toml       # project_id = tekvkpxneckdxhtkcfeo (produção)
│   │   └── migrations/       # SQL versionado (aplicado manualmente / via MCP)
│   ├── wrangler.jsonc        # config do Worker (vars públicas, observability, keep_vars)
│   ├── wrangler-vars.ts      # injeta VITE_* do wrangler.jsonc no bundle (ver §6)
│   └── vite.config.ts        # tanstackStart + nitro(cloudflare_module) + tailwind + react
├── assets/portraits/
│   ├── source/               # subset CURADO dos PNGs do mod (versionado)
│   └── CREDITS.md            # atribuição + licença dos assets (ver §5.4)
├── docs/superpowers/
│   ├── specs/                # design docs aprovados (YYYY-MM-DD-<tema>-design.md)
│   └── plans/                # planos de implementação passo a passo
├── .github/workflows/        # codeql.yml (só JS/TS), backend-ci removido
└── AGENTS.md                 # este arquivo
```

Arquivos grandes fora do git (ver `.gitignore` da raiz): o `.7z` do mod
(`Portaits of the Rim-425...`) e outros artefatos locais. Só o **subset curado**
em `assets/portraits/source/` é versionado.

---

## 4. Como rodar

Tudo dentro de `app/` com **bun**:

```bash
cd app
bun install
bun run dev            # dev server (Vite) em http://localhost:3000
bun test               # testes (bun test)
bunx tsc --noEmit      # typecheck
bun run build          # build de produção (gera .output/)
bun run build:portraits  # regenera public/portraits/ a partir de assets/portraits/source/
```

⚠️ **Caveat do dev server**: `bun run dev` injeta apenas as vars `VITE_*` (client).
As vars **server-side** (`process.env.SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`)
usadas pela middleware de auth **não** são carregadas em dev, então chamadas a
server functions autenticadas falham localmente com "Missing Supabase environment
variable(s)". Isso é esperado no dev; a auth real funciona em produção (onde as
vars existem no runtime do Worker). Para testar server functions localmente,
exporte essas vars ou use um `.dev.vars`.

Lint: `bun run lint` **falha em massa no Windows** por CRLF (prettier). É ruído
de checkout (autocrlf), não regressão. Um follow-up de `.gitattributes eol=lf`
resolve. CI/Linux (checkout LF) passa.

---

## 5. Arquitetura em detalhe

### 5.1 Autenticação
- Login é **Google OAuth via Supabase** (`auth.tsx` → `supabase.auth.signInWithOAuth`).
  Não há email/senha.
- Server functions usam a middleware `requireSupabaseAuth`
  (`integrations/supabase/auth-middleware.ts`): valida o Bearer JWT via
  `supabase.auth.getClaims` e injeta `context.supabase` (client RLS-scoped) +
  `context.userId`. **Toda escrita passa por server function**; o browser nunca
  escreve na tabela `characters` diretamente.
- `client.ts` (browser) e `client.server.ts` (service role, bypassa RLS — só para
  operações administrativas server-side confiáveis) são clients separados.

### 5.2 Camada de dados (Supabase)
- Projeto de produção: **`tekvkpxneckdxhtkcfeo`** (`supabase/config.toml`).
- Tabela `public.characters`: `id, user_id→auth.users, name, gender, choices,
  skills, tags, passives, appearance (jsonb), mood, played_seconds, last_tick_at,
  created_at, died_at`.
  - **Índice único parcial** `characters_one_alive_per_user` (`where died_at is
    null`) → **um personagem vivo por usuário**.
  - **RLS ativo**, policy `own rows` (`auth.uid() = user_id`). Verificado: a
    publishable key pública **não lê nem escreve** dados de outros usuários.
- RPC `heartbeat_tick()` (`security invoker`, `search_path` fixo): incrementa
  `played_seconds` em +60s no máximo a cada 55s (throttle server-side, guarda
  contra corrida entre abas) e marca `died_at` ao cruzar 284h. Retorna
  `(played_seconds, died)`.
- **Migrações**: versionadas em `app/supabase/migrations/`, aplicadas
  **manualmente** (SQL Editor do dashboard) ou via **MCP do Supabase**. O
  histórico de migrações do Supabase não registra as aplicadas à mão — o repo é
  a fonte da verdade. Sempre commit o `.sql` junto.

### 5.3 Server functions (`lib/character.functions.ts`)
- `createCharacter` — valida entrada, `buildCharacter`, insere a linha (erro
  PT-BR se já existe personagem vivo).
- `getActiveCharacter` — retorna o personagem vivo (`died_at is null`) ou null.
- `heartbeat` — chama o RPC; retorna `{ playedSeconds, dead }`.
- `setCharacterMoodDebug` / `setPlayedSecondsDebug` — **debug/dev only**. Devem
  ser gateadas por `assertDev()` (`import.meta.env.DEV`), que o Vite compila para
  `throw` incondicional em produção. Nunca exponha endpoints de cheat em prod.

### 5.4 Sistema de retrato (a peça mais elaborada)
Assets do mod **Portraits of the Rim** (autor **TwoPenny**, Nexus mod 425),
licença **CC BY-NC-ND 4.0** — uso não-comercial com atribuição (ver
`assets/portraits/CREDITS.md`; TODO do dono: contatar o autor sobre o NC-ND, já
que o resize para WebP é discutivelmente uma adaptação). **Se o Hopeland
monetizar, esses assets precisam ser renegociados ou substituídos.**

Pipeline:
1. `assets/portraits/source/<camada>/<variantKey>.png` — subset curado, com
   **chaves prefixadas por estágio de idade** (`c/t/y/m/e`). Camadas: neck,
   clothes, head, face-inner, face-outer, beard, hair.
2. `scripts/build-portraits.mjs` (sharp) → WebP 320×320 q80 (≤60 KB) +
   `manifest.json` em `public/portraits/`. **A saída é committed**; o build da
   Cloudflare não roda o pipeline.
3. `portrait-selection.ts` — PRNG `mulberry32(appearance.seed)` com **ordem de
   sorteio estável** (contrato: nunca reordene; sempre consome todos os sorteios).
   Escolhe uma variante por camada. Regras: pele←origem, roupa←profissão+porte+
   gênero, expressão←humor (buckets low/mid/high), cabelo por **pool de gênero**
   (homem não sorteia penteado feminino). `ageStage` só troca o prefixo das
   chaves — **mesma seed = mesma pessoa em qualquer idade**.
4. `CharacterPortrait.tsx` — compõe as camadas num `<canvas>` com **tint
   multiply** (a arte do mod é branca; é tingida em runtime pela cor derivada),
   escala por `devicePixelRatio`, com fallback geométrico para personagens legados
   ou erro de carregamento. `preloadPortrait()` aquece o cache antes da revelação.

Regras de tamanho de roupa e idade seguem o **código do mod** (`Requirements.cs`):
tamanhos `s/m/l/xl` mapeiam gênero+tipo de corpo, não 1:1 com porte. Documentado
em `CREDITS.md`.

### 5.5 Envelhecimento e morte (`age-stage.ts`)
- Estágios derivados de `played_seconds` (horas de jogo ativo, cumulativas):
  criança <8h, adolescente <24h, jovem adulto <84h, meia-idade <234h, idoso
  <284h, **morte em 284h**. Idade nunca é armazenada.
- O `heartbeat_tick` marca `died_at` ao cruzar o limiar; `game.tsx` mostra a
  `DeathView` e libera a criação de um novo personagem.

### 5.6 Fluxo de criação (`character-creation.tsx`)
5 etapas: **Identidade** (nome + gênero explícito) → **Origem interior** →
**Vocação** → **Terra natal** → **Revelação** (retrato infantil + nome + entrar).
Nasce sempre criança. Bônus/debuffs/tags **não** são exibidos ao jogador.

---

## 6. Configuração & deploy

- **Deploy**: Cloudflare **Workers Builds** conectado ao Git; branch de produção
  = `main`. Merge na `main` dispara o build/deploy. **Root directory do build =
  `app`** (foi migrado de `client`; se recriar o projeto, ajuste isso). Há também
  um deploy hook manual.
- **Vars públicas** ficam em `wrangler.jsonc` (`vars` + `keep_vars: true` para não
  resetar a cada deploy). São `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` e suas
  versões `VITE_`. A **publishable key é pública por design** (o RLS protege os
  dados); a **service role key nunca** entra no repo nem no bundle.
- **Injeção no client**: o Worker runtime só tem `vars` como `env`, não como
  `process.env`/`import.meta.env`. `wrangler-vars.ts` lê as `VITE_*` do
  `wrangler.jsonc` e as injeta no bundle client via `import.meta.env.*` no
  `vite.config.ts`. **Sem isso o browser fica sem URL/chave do Supabase e a auth
  trava em "Carregando..." infinito** (bug já corrigido — não reintroduza).
- **Observability**: `wrangler.jsonc` tem `observability.logs` ligado.
- **CodeQL** roda só quando arquivos JS/TS mudam (path filter); não é required
  check (senão PRs sem JS/TS travariam).

---

## 7. Convenções e fluxo de trabalho

### 7.1 Git
- **Nunca commite direto na `main`.** Branch a partir da `main`, PR, merge.
- **Sem trailer `Co-Authored-By`** nos commits (regra do projeto).
- Identidade do repo: `Enzo Azevedo <118974042+Enzo-Azevedo@users.noreply.github.com>`.
- Mensagens de commit em inglês; assunto curto e imperativo; corpo explica o
  "porquê" quando não é óbvio.
- Branch protection na `main`: exige PR (0 approvals, adequado a projeto solo).
  "Automatically delete head branches" ligado.

### 7.2 Qualidade — sempre antes de commitar
```bash
cd app && bunx tsc --noEmit && bun test && bun run build
```
Nada de "provavelmente funciona": rode e confirme. Verifique a mudança
exercitando o fluxo afetado, não só os testes. Quando não der para dirigir o
fluxo (ex.: criação exige sessão Google), diga isso explicitamente.

### 7.3 TDD
Features e bugfixes vêm com teste. Padrão do repo: escreva o teste falhando
(RED), implemente o mínimo (GREEN), rode a suíte. Testes existentes:
`age-stage`, `portrait-selection`, `character-row`, `wrangler-vars`.

### 7.4 Fluxo spec → plano → implementação
Trabalho não-trivial segue o ciclo documentado em `docs/superpowers/`:
1. **Brainstorming** → design doc em `specs/YYYY-MM-DD-<tema>-design.md`.
2. **Plano** passo a passo em `plans/`.
3. **Implementação** task a task, com review entre tasks e verificação final.
Mudanças pequenas e óbvias podem pular direto para a implementação, mas mantenha
o hábito de escrever o "porquê".

### 7.5 Verificação visual de retrato
Para mudanças no sistema de retrato, componha as camadas com o **motor real de
seleção** (mesmo `selectPortraitLayers` + manifesto) via um script sharp
descartável e **olhe o resultado** antes de commitar (identidade persiste entre
idades? criança tem proporção infantil? roupa assenta no corpo?).

---

## 8. Segurança

Postura atual (avaliada por pentest autorizado do próprio dono):

- **RLS é a proteção principal dos dados** — a anon key é pública, então a
  correção do RLS é crítica. Está sólida (anon não lê nem escreve dados alheios).
- **Nada de segredo no bundle** — só publishable key + URL (públicas). A service
  role key nunca deve vazar para o client.
- **Sem exposição de arquivos** — o Worker não serve `.git`, `.env`,
  `wrangler.jsonc`, código-fonte, backups, etc.
- **Headers de resposta**: CSP, HSTS, X-Frame-Options: DENY, X-Content-Type-
  Options, Referrer-Policy, Permissions-Policy — aplicados no `server.ts`
  (via `security-headers.ts`). CSP acomoda Supabase (REST+wss), Phaser (wasm) e
  a hidratação inline do TanStack. Ao adicionar dependências que fazem requests
  cross-origin, atualize a CSP (`connect-src`).
- **Endpoints de debug** (`set*Debug`) precisam ficar gateados por `assertDev()`.
- Funções Postgres `SECURITY DEFINER`/RPC: fixe `search_path` e `revoke execute
  from public/anon/authenticated` quando não devem ser chamáveis. Rode o
  **advisor de segurança do Supabase** após mudanças de DDL.
- Ações no Supabase de produção só com autorização explícita; migrações
  versionadas no repo.

Ao testar segurança, teste contra `wrangler dev` local para volume alto (evita
cota e throttle); produção é free plan (100k req/dia — fuzzing pesado derruba os
usuários reais).

---

## 9. Histórico do que foi construído

Ordem cronológica das entregas principais (ver `git log` para detalhes):

1. **Saída do Lovable** — removida a integração, `client/` renomeado para `app/`,
   `backend/` (vazio) removido, deps `@lovable.dev/*` e artefatos limpos,
   `vite.config.ts` reescrito com o stack real, CodeQL atualizado para v4.
2. **Infra de repo** — workflow de deleção de branch mergeada, CodeQL só em JS/TS,
   identidade git por repo, sem co-author.
3. **Sistema de retrato** — curadoria de assets, pipeline sharp, manifesto,
   seleção determinística por seed, composição em canvas com tint, créditos.
4. **Nome + gênero primeiro** — fluxo de criação começa pela identidade; retrato
   segue o gênero escolhido.
5. **Tamanho de roupa por porte/gênero** — corrigido para o mapeamento do mod.
6. **Preload + remoção do placeholder** — retrato aparece instantâneo, sem flash.
7. **Persistência (Supabase)** — tabela `characters`, RLS, server functions,
   heartbeat de tempo de jogo.
8. **Envelhecimento e morte** — estágios de idade por tempo de jogo, retrato por
   idade, morte aos 284h, pools de cabelo por gênero.
9. **Hardening de banco** — `search_path`, revokes de funções legadas.
10. **Segurança (em PRs)** — headers de resposta, gating dos debug endpoints.
11. **Enxugamento do fluxo** — remoção da etapa de resumo e dos efeitos exibidos.

---

## 10. Pontos de atenção / dívidas conhecidas

- **Licença dos assets** (CC BY-NC-ND) — resolver antes de qualquer monetização.
- **`.gitattributes eol=lf`** — para o lint parar de falhar por CRLF no Windows.
- **Dev server sem env server-side** — server functions autenticadas não rodam em
  `bun run dev` sem exportar as vars (§4).
- **Retrato como textura Phaser** — hoje o retrato é canvas HTML; se o jogo
  precisar do avatar em escala no mundo, evoluir para atlas/RenderTexture.
- **`/api/broadcast`** aparece no bundle como string de uma dependência — **não é
  rota do app**, não é exposição.
- **Personagens legados** em sessionStorage sem `seed` caem no fallback
  geométrico do retrato — comportamento intencional.

---

## 11. Para um agente de IA começar

1. Leia este arquivo inteiro e o `git log` recente.
2. Trabalhe em branch a partir da `main`; commits sem co-author.
3. Antes de finalizar: `bunx tsc --noEmit && bun test && bun run build` em `app/`.
4. Mudança de dados/SQL → migração versionada + aplicação manual/MCP autorizada.
5. Mudança de retrato → verificação visual com o motor real.
6. Nunca reintroduza Lovable, nunca exponha service role key ou endpoints de
   debug em produção, nunca commite direto na `main`.
