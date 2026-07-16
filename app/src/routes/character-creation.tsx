import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { createCharacter, getActiveCharacter } from "@/lib/character.functions";
import type { PersistedCharacter } from "@/lib/character-row";
import type { Category, Character, Origin, Profession } from "@/lib/character-schema";
import { CharacterPortrait } from "@/components/CharacterPortrait";
import { loadManifest, preloadPortrait } from "@/components/portrait/composite";
import { saveActiveCharacter } from "@/lib/character-store";

const DEV = import.meta.env.DEV;
const log = (...a: unknown[]) => { if (DEV) console.log("[char-create]", ...a); };

export const Route = createFileRoute("/character-creation")({
  head: () => ({
    meta: [
      { title: "Criação de personagem — Hopeland" },
      { name: "description", content: "Responda três perguntas para moldar seu personagem em Hopeland." },
    ],
  }),
  component: CharacterCreationPage,
});

const CATEGORY_OPTIONS: Array<{ id: Category; title: string; body: string }> = [
  { id: "fisica", title: "Alguém de corpo forte", body: "Você sempre confiou nos próprios braços — no suor, no cansaço bom do trabalho pesado, no peso que os outros não aguentam." },
  { id: "intelectual", title: "Alguém de mente inquieta", body: "Você foi a criança que perguntava demais. As respostas que os adultos davam quase nunca bastavam." },
  { id: "agil", title: "Alguém de movimento leve", body: "Correr, escalar, cair e levantar. Você aprende com o corpo antes de aprender com a cabeça." },
  { id: "social", title: "Alguém de palavra fácil", body: "Onde há gente, há espaço pra você. Uma conversa começa e, quando percebe, todo mundo está ouvindo." },
];

const PROFESSION_OPTIONS: Array<{ id: Profession; title: string; body: string }> = [
  { id: "ferreiro", title: "Ferreiro", body: "Martelo, brasa, aço. Forjar até as mãos calejarem." },
  { id: "lenhador", title: "Lenhador", body: "Machado no ombro, floresta pela frente. Um golpe por vez." },
  { id: "estivador", title: "Estivador", body: "Carregar o mundo nas costas, da doca ao armazém." },
  { id: "bibliotecario", title: "Bibliotecário", body: "Um livro na mão, o silêncio como companhia. Guardar o que ninguém mais lê." },
  { id: "contador", title: "Contador", body: "Números que se comportam. Colunas que fecham. Ordem no caos." },
  { id: "alquimista", title: "Alquimista", body: "Misturar, observar, anotar. Buscar o padrão escondido nas coisas." },
  { id: "pescador", title: "Pescador", body: "Linha na água, paciência. Ler o vento e a corrente." },
  { id: "mensageiro", title: "Mensageiro", body: "Correr entre cidades levando notícias antes que envelheçam." },
  { id: "equilibrista", title: "Equilibrista de circo", body: "Andar na corda bamba enquanto a plateia prende o fôlego." },
  { id: "comerciante", title: "Comerciante", body: "Negociar preços, contornar clientes, fechar acordos com um sorriso." },
  { id: "menestrel", title: "Menestrel", body: "Cantar histórias antigas em praças e tabernas. Ser lembrado." },
  { id: "taberneiro", title: "Taberneiro", body: "Servir bebida, ouvir problema, virar dono do salão." },
];

const ORIGIN_OPTIONS: Array<{ id: Origin; title: string; body: string; effects: string[] }> = [
  { id: "praia", title: "Junto ao mar, na praia", body: "O sal na pele desde criança. Areia, sol, ondas.", effects: ["-20% dano de queimadura solar", "+20% velocidade máxima (passivo)"] },
  { id: "montanha", title: "No alto da montanha", body: "Ar rarefeito, chão irregular, silêncio.", effects: ["-50% dificuldade em testes de equilíbrio", "+3 Equilíbrio"] },
  { id: "deserto", title: "No coração do deserto", body: "Sol impiedoso, dunas até o horizonte. Aprender a durar.", effects: ["-75% dano de queimadura solar", "+2 Vigor"] },
  { id: "floresta", title: "Na floresta densa", body: "Copas altas, chão úmido. Cada barulho tem um dono.", effects: ["+3 Velocidade", "Tag: Natureza"] },
  { id: "cavernas", title: "Nas cavernas profundas", body: "Escuro, eco, pedra fria. Enxergar com o resto do corpo.", effects: ["+50% visão no escuro", "+3 Força"] },
  { id: "mar", title: "Em alto-mar, num barco", body: "Sem terra à vista, o convés balança, o vento decide o dia.", effects: ["+50% fôlego (tempo submerso)", "+3 Destreza"] },
  { id: "cidade", title: "Numa grande cidade", body: "Multidão, fumaça, ruído constante. Aprender a pensar rápido no meio de tudo.", effects: ["+50% irritação (debuff social)", "+5 Raciocínio"] },
];

function CharacterCreationPage() {
  const navigate = useNavigate();
  const forge = useServerFn(createCharacter);
  const [step, setStep] = useState<0 | 1 | 2 | 3 | 4>(0);
  const [name, setName] = useState("");
  const [gender, setGender] = useState<"f" | "m" | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [profession, setProfession] = useState<Profession | null>(null);
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [character, setCharacter] = useState<PersistedCharacter | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Warm the portrait manifest as soon as the flow opens; the layer images
  // are preloaded right after the character is forged (see submit), so the
  // reveal step renders instantly.
  useEffect(() => {
    loadManifest().catch(() => {});
  }, []);

  // Alive character already exists -> this page is off-limits.
  const fetchActive = useServerFn(getActiveCharacter);
  useEffect(() => {
    fetchActive()
      .then((existing) => {
        if (existing) navigate({ to: "/game" });
      })
      .catch(() => { /* sem bloqueio: a criação segue e o insert é a barreira real */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    supabase.auth.getSession()
      .then(({ data }) => {
        if (!data.session) navigate({ to: "/auth" });
      })
      .catch((error) => {
        console.error("[auth] session check failed:", error);
        navigate({ to: "/auth" });
      });
  }, [navigate]);

  const submit = async (
    cat: Category = category!,
    prof: Profession = profession!,
    ori: Origin = origin!,
  ) => {
    if (!cat || !prof || !ori || !gender || name.trim().length < 2) return;
    setSubmitting(true);
    setError(null);
    log("submit:call", { cat, prof, ori, gender });
    try {
      const c = await forge({ data: { category: cat, profession: prof, origin: ori, name, gender } });
      log("submit:ok");
      setCharacter(c as PersistedCharacter);
      preloadPortrait((c as PersistedCharacter).appearance, "c");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Falha ao criar personagem.";
      log("submit:error", message);
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const retry = () => submit();

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <div className="absolute inset-x-0 top-0 -z-10 h-[36rem] bg-primary/10 blur-3xl" aria-hidden />
      <div className="mx-auto max-w-3xl px-6 py-16">
        <StepIndicator step={step} />
        <div key={step} className="mt-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {step === 0 && (
            <IdentityStep
              name={name}
              gender={gender}
              onName={setName}
              onGender={setGender}
              onContinue={() => setStep(1)}
            />
          )}
          {step === 1 && (
            <Question
              intro="Antes de tudo, quem você sempre foi?"
              prompt="Feche os olhos por um segundo e pense na versão de você que sobreviveu até aqui. Que tipo de pessoa ela sempre foi?"
              options={CATEGORY_OPTIONS}
              selected={category}
              onPick={(id) => { setCategory(id as Category); setTimeout(() => setStep(2), 250); }}
            />
          )}
          {step === 2 && (
            <Question
              intro="E se o mundo deixasse..."
              prompt='"Se eu pudesse, gostaria de ser um..."'
              options={PROFESSION_OPTIONS}
              selected={profession}
              onPick={(id) => { setProfession(id as Profession); setTimeout(() => setStep(3), 250); }}
              columns={3}
            />
          )}
          {step === 3 && (
            <Question
              intro="Um lugar pra chamar de seu."
              prompt='"Este definitivamente seria um ótimo lugar para viver..."'
              options={ORIGIN_OPTIONS.map(o => ({ id: o.id, title: o.title, body: o.body }))}
              selected={origin}
              onPick={(id) => {
                const ori = id as Origin;
                setOrigin(ori);
                setTimeout(() => {
                  setStep(4);
                  submit(category!, profession!, ori);
                }, 250);
              }}
            />
          )}
          {step === 4 && (
            <RevealView
              character={character}
              submitting={submitting}
              error={error}
              onEnter={() => {
                if (!character) return;
                saveActiveCharacter(character);
                navigate({ to: "/game" });
              }}
              onRetry={retry}
              onRestart={() => { setStep(0); setName(""); setGender(null); setCategory(null); setProfession(null); setOrigin(null); setCharacter(null); setError(null); setSubmitting(false); }}
            />
          )}
        </div>
        <p className="mt-16 text-center text-xs text-muted-foreground">
          Arte do retrato:{" "}
          <a
            href="https://www.nexusmods.com/rimworld/mods/425"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            TwoPenny — Portraits of the Rim
          </a>
        </p>
      </div>
    </div>
  );
}

function StepIndicator({ step }: { step: number }) {
  const labels = ["Identidade", "Origem interior", "Vocação", "Terra natal", "Revelação"];
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      {labels.map((l, i) => (
        <div key={l} className="flex items-center gap-2">
          <span className={`grid h-6 w-6 place-items-center rounded-full border text-[11px] ${i <= step ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>{i + 1}</span>
          <span className={i === step ? "text-foreground font-medium" : ""}>{l}</span>
          {i < labels.length - 1 && <span className="mx-1 h-px w-6 bg-border" />}
        </div>
      ))}
    </div>
  );
}

interface Opt { id: string; title: string; body: string; footer?: string }

function Question({
  intro, prompt, options, selected, onPick, columns = 2,
}: {
  intro: string; prompt: string;
  options: Opt[]; selected: string | null;
  onPick: (id: string) => void;
  columns?: 2 | 3;
}) {
  const grid = columns === 3 ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2";
  return (
    <div>
      <p className="text-sm uppercase tracking-widest text-primary">{intro}</p>
      <h1 className="mt-3 font-display text-3xl sm:text-4xl font-bold leading-tight">{prompt}</h1>
      <div className={`mt-8 grid gap-3 ${grid}`}>
        {options.map((o) => {
          const isSel = selected === o.id;
          return (
            <Card
              key={o.id}
              onClick={() => onPick(o.id)}
              className={`cursor-pointer p-5 transition-all hover:border-primary hover:bg-primary/5 ${isSel ? "border-primary bg-primary/10 ring-2 ring-primary" : ""}`}
            >
              <div className="font-semibold">{o.title}</div>
              <p className="mt-1 text-sm text-muted-foreground">{o.body}</p>
              {o.footer && <div className="mt-3 text-xs text-primary/80">{o.footer}</div>}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function IdentityStep({
  name, gender, onName, onGender, onContinue,
}: {
  name: string;
  gender: "f" | "m" | null;
  onName: (v: string) => void;
  onGender: (g: "f" | "m") => void;
  onContinue: () => void;
}) {
  const ready = name.trim().length >= 2 && gender !== null;

  return (
    <div>
      <p className="text-sm uppercase tracking-widest text-primary">Toda história começa por alguém</p>
      <h1 className="mt-3 font-display text-3xl sm:text-4xl font-bold leading-tight">Quem é você?</h1>

      <div className="mt-8 max-w-sm space-y-3">
        <label htmlFor="char-name" className="text-sm font-medium">Nome do personagem</label>
        <Input
          id="char-name"
          value={name}
          onChange={(e) => onName(e.target.value)}
          maxLength={20}
          placeholder="Entre 2 e 20 caracteres"
          onKeyDown={(e) => { if (e.key === "Enter" && ready) onContinue(); }}
          autoFocus
        />
      </div>

      <div className="mt-6 grid max-w-sm grid-cols-2 gap-3">
        {([
          { id: "m", label: "Masculino" },
          { id: "f", label: "Feminino" },
        ] as const).map((g) => (
          <Card
            key={g.id}
            onClick={() => onGender(g.id)}
            className={`cursor-pointer p-4 text-center font-semibold transition-all hover:border-primary hover:bg-primary/5 ${gender === g.id ? "border-primary bg-primary/10 ring-2 ring-primary" : ""}`}
          >
            {g.label}
          </Card>
        ))}
      </div>

      <div className="mt-8">
        <Button size="lg" onClick={onContinue} disabled={!ready}>Continuar</Button>
      </div>
    </div>
  );
}

function RevealView({
  character, submitting, error, onEnter, onRetry, onRestart,
}: {
  character: PersistedCharacter | null;
  submitting: boolean;
  error: string | null;
  onEnter: () => void;
  onRetry: () => void;
  onRestart: () => void;
}) {
  if (error) {
    return (
      <Card className="p-8 text-center">
        <p className="text-destructive font-medium">Não foi possível finalizar seu personagem.</p>
        <p className="mt-2 text-sm text-muted-foreground">{error}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button onClick={onRetry}>Tentar novamente</Button>
          <Button variant="ghost" onClick={onRestart}>Recomeçar</Button>
        </div>
      </Card>
    );
  }

  if (submitting || !character) {
    return (
      <Card className="p-12 text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
        <p className="mt-4 text-sm text-muted-foreground">Forjando seu personagem...</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6 text-center">
      <div>
        <p className="text-sm uppercase tracking-widest text-primary">Você acaba de ser forjado</p>
        <h1 className="mt-2 font-display text-3xl sm:text-4xl font-bold">{character.name}</h1>
      </div>

      <div className="flex justify-center">
        <CharacterPortrait
          appearance={character.appearance}
          mood={character.mood}
          size={288}
          ageStage="c"
          className="rounded-xl border border-border bg-muted/30 shadow-lg"
        />
      </div>

      <div className="flex flex-wrap justify-center gap-3 pt-2">
        <Button size="lg" onClick={onEnter}>Entrar no mundo</Button>
        <Button size="lg" variant="ghost" onClick={onRestart}>Recomeçar</Button>
      </div>
    </div>
  );
}
