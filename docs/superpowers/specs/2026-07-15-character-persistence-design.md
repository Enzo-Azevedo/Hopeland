# Persistência de personagem + tempo jogado — design (Spec A)

Data: 2026-07-15
Status: aprovado em brainstorming
Sucessor: `2026-07-15-character-aging-design.md` (Spec B, depende deste)

## Objetivo

Mover o personagem de sessionStorage para o Supabase e acumular tempo de jogo
ativo por personagem. É o pré-requisito do envelhecimento (Spec B): idade será
derivada de `played_seconds`.

## Decisões já tomadas

| Decisão | Escolha |
|---|---|
| Storage | Supabase (Postgres + RLS), projeto `tekvkpxneckdxhtkcfeo` (o de produção — corrigir `app/supabase/config.toml`, que aponta para um project_id antigo da era Lovable) |
| Vivos por usuário | Exatamente 1 (índice único parcial) |
| Tempo | `played_seconds` acumulado por heartbeat de jogo ativo — tempo offline não conta |
| Morto | Linha arquivada (`died_at` preenchido), nunca deletada |

## Tabela `characters`

```sql
create table public.characters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  gender text not null check (gender in ('f','m')),
  choices jsonb not null,      -- { category, profession, origin }
  skills jsonb not null,
  tags jsonb not null default '[]',
  passives jsonb not null default '[]',
  appearance jsonb not null,   -- { skinTone, facialMark, build, seed, gender, clothes, ... }
  mood int not null default 50 check (mood between 0 and 100),
  played_seconds int not null default 0 check (played_seconds >= 0),
  created_at timestamptz not null default now(),
  died_at timestamptz
);

-- 1 personagem vivo por usuário
create unique index characters_one_alive_per_user
  on public.characters (user_id) where died_at is null;

alter table public.characters enable row level security;
create policy "own rows" on public.characters
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

Migração versionada em `app/supabase/migrations/<timestamp>_characters.sql`;
aplicada pelo dono via dashboard SQL editor ou `supabase db push`.

**Escritas passam só pelas server functions** (TanStack server fns com o client
server-side autenticado). O client browser não escreve `characters` diretamente;
a RLS é a segunda linha de defesa, não a API.

## Server functions (app/src/lib/character.functions.ts)

- `createCharacter` (existente): além de construir, **insere** a linha. Erro
  claro se já existe personagem vivo (unique index → mensagem PT-BR).
- `getActiveCharacter` (nova): retorna o personagem vivo do usuário ou `null`.
- `heartbeat` (nova): incrementa `played_seconds` do personagem vivo.
  - Input: nenhum (identidade vem da sessão).
  - Server-autoritativo: incremento fixo de `HEARTBEAT_SECONDS = 60`,
    independente do que o client alegue; chamadas mais frequentes que 55s
    (margem de rede) desde o último tick são ignoradas — exige coluna
    `last_tick_at timestamptz` na tabela (incluir na migração) e a atualização
    é condicional (`where last_tick_at is null or last_tick_at <= now() - interval '55 seconds'`),
    o que também serve de guarda contra corrida entre abas.
  - Retorna `played_seconds` atualizado (Spec B deriva idade/morte disso).
- `setCharacterMoodDebug` (existente): passa a persistir mood na linha.

## Fluxo no client

- `/character-creation`: no mount, `getActiveCharacter()`; se existir vivo,
  redireciona para `/game` (impede segundo personagem).
- `/game`: carrega o personagem via `getActiveCharacter()` (fonte da verdade);
  sessionStorage vira cache de conveniência (`character-store.ts` mantém a
  interface atual, alimentada pelo fetch). Sem personagem vivo → redireciona
  para `/character-creation`.
- Heartbeat: `/game` chama `heartbeat()` a cada 60s enquanto a aba está
  visível (`document.visibilityState === "visible"`); pausa quando oculta.
  Falha de rede: silenciosa, tenta no próximo tick (perda de ticks é aceitável).

## Erros e testes

- Insert duplicado (vivo já existe) → mensagem "Você já tem um personagem vivo.".
- Testes (bun test): shape do insert payload a partir de `buildCharacter`
  (serialização jsonb), regra de throttle do heartbeat (função pura extraída,
  ex.: `shouldTick(lastTickAt, now)`), e validação da migração SQL presente.
- Verificação manual: criar personagem → recarregar browser → personagem
  volta do banco; `played_seconds` cresce ~60/min com aba aberta.

## Fora de escopo

- Envelhecimento/morte (Spec B); múltiplos personagens; migração de
  personagens antigos de sessionStorage (jogo jovem — usuários recriam);
  tempo offline; anti-cheat além do throttle server-side.
