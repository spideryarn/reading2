/**
 * What kind of thing a glossary term is, drawn as an icon rather than a word.
 *
 * The word was a chip beside the term — `work`, `concept`, `person` — and on
 * 2026-09-29 Greg asked for it to go or to shrink:
 *
 * > In Glossary mode, we have a bunch of labels, e.g. `concept`, `work`. There
 * > don't seem to be many of them. And what is "work" anyway. Perhaps we can
 * > just get rid of these? Or at least replace them with icons with
 * > explanatory tooltips to reduce the amount of distracting text.
 * >
 * > — Greg, 2026-09-29, `[SPIDERYARN-READING2-4H]`
 *
 * **Only the kinds that say "this is not vocabulary" get one.** A person, a
 * place, an organisation, an event, a book: each tells the reader something the
 * name alone may not. `term` and `other` never had a chip, and **`concept`
 * lost its** here, because the prompt lists `concept` beside `term` and defines
 * neither (src/glossary.ts § OUTPUT), so the chip was the model's coin toss
 * shown as a fact. `kind` itself is still on the entry, in the export and in
 * the public DTO; only its drawing changed.
 *
 * `role="img"` with an `aria-label` so a screen reader hears the kind, and a
 * native `title` for the hover — the same mechanism as the sort buttons beside
 * it. docs/plans/260929a-compact-glossary-header-and-kind-icons.md.
 */
import { BookOpen, Building2, CalendarDays, MapPin, PersonStanding } from "lucide-react";
import type { ComponentType } from "react";
import type { GlossaryKind } from "../types.js";

type Drawn = Exclude<GlossaryKind, "concept" | "term" | "other">;

const KIND_ICON: Record<Drawn, { Icon: ComponentType<{ size?: number }>; label: string }> = {
  person: { Icon: PersonStanding, label: "A person" },
  place: { Icon: MapPin, label: "A place" },
  organization: {
    Icon: Building2,
    label: "An organisation — a company, institution or group",
  },
  event: { Icon: CalendarDays, label: "An event — something that happened at a particular time" },
  work: { Icon: BookOpen, label: "A work — a book, paper, film, law or other named piece of work" },
};

function isDrawn(kind: GlossaryKind): kind is Drawn {
  return Object.hasOwn(KIND_ICON, kind);
}

export function GlossaryKindIcon({ kind }: { kind: GlossaryKind }) {
  if (!isDrawn(kind)) return null;
  const { Icon, label } = KIND_ICON[kind];
  return (
    <span className="gloss-kind" role="img" aria-label={label} title={label}>
      <Icon size={12} />
    </span>
  );
}
