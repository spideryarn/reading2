/**
 * **Criteria — the referee writes what they are judging the paper against, and
 * each one becomes a coloured, re-runnable pass over the prose.**
 *
 * Stage 3 of docs/plans/260831an-referee-mode-for-peer-reviewers.md § 1. The
 * band half (the hook, the URL parameter, resolving results into marks) and the
 * panel half (what is on screen) are both here, split the way every other mode
 * splits them: `CriteriaBand` owns the parameter and pushes the resolved
 * passages up to `Reader`, which owns the prose; everything below it is a pure
 * function of its props.
 *
 * ## The three visual rules, and they are the part most likely to go wrong
 *
 * **1. The prose stripe carries the valence, and it did not used to.** It
 * carried criterion identity until 2026-09-02, when Greg read a paper with it
 * and found the panel and the prose saying opposite things about one phrase —
 * *"So if extrapolation" counts against on the left, and yet it is highlighted
 * with a green line in the text on the right.* Two palettes painted next to each
 * other with nothing on screen saying they were two. So the stripe is now the
 * ramp (`resolveCriterion` carries the number, `hitMarks` resolves the token),
 * and the row below is where the same number is said in words.
 *
 * What that gives up is *which criterion made this red phrase*, which the
 * paragraph bar and the rail still answer coarsely because both still read
 * `slot`. What pays for it is rule 3, extended into the prose: the mark carries
 * a **sign**, and this panel prints a **key** whenever a for/against criterion
 * is switched on.
 * docs/plans/260902f-make-referee-mode-understandable.md has the argument and
 * the two things it knowingly does not fix.
 *
 * The plan also asked for the valence in the prose gutter, beside the marked
 * block, and that is **not built** — the gutter holds the permalink and the chat
 * button and nothing else.
 *
 * **2. The pivot is anchored at zero.** `valenceStep` in src/web/valence.ts,
 * and the note there about what scaling to the data would silently do.
 *
 * **3. Colour is never the only carrier.** Every row prints the ordinal rank
 * (leading, and large), the direction in words, and the signed number — on the
 * screen, and as one ordered sentence for a screen reader (`valenceLabel`, and
 * see `CriterionResult` for why that sentence is a `.sr-only` span rather than
 * an `aria-label`). That is not politeness: it is the stated condition under
 * which `--div-rg-*` — red↔green, which docs/project/colour-scales.md otherwise
 * argues down — is permitted at all. If this panel ever stops printing the
 * direction in words, the default has to move to `--div-*`.
 *
 * Since the prose is painted by valence too, the same rule has to be met *there*
 * — where there are no words. Two things meet it: the sign after the mark
 * (`data-dir`, drawn by styles.css as generated content), and `TheKey` below,
 * which states the mapping in words and glyphs whenever a for/against criterion
 * is switched on.
 *
 * ## One ramp for the whole mode
 *
 * `?refscale=rg|br`, and every swatch on this panel takes it — not the
 * criterion's own `config.scale`, which is still stored and no longer read for
 * display. The two ramps put red at opposite ends of the truth (`--div-rg-0` is
 * red for *against*, `--div-8` is red for *favour*), so a per-criterion choice
 * would have meant one red underline meaning opposite verdicts in one document
 * the moment the prose started carrying it. `refScaleParam` in params.ts has
 * the rest, including why it is in the URL rather than in the column.
 *
 * ## And the rule that is about the reader rather than the pixels
 *
 * **Marks are default-off.** `?crits=` starts empty, exactly as `?runs=` does,
 * because *the article acquires marks when the reader asks for them and at no
 * other time* — and here that is also the cheap 80% of the anchoring problem
 * the plan's § 1 is about: the referee reads the paper before the model paints
 * on it.
 *
 * Two acts switch a criterion on without the tick being pressed, and both are
 * the referee asking: **running** it, and **pressing one of its results** (both
 * go through `onShow`). The rule is about arriving at a paper with nothing
 * painted on it, not about the tick being the only door — and the sentence
 * above the list says so out loud, because its first draft claimed the opposite
 * on the very screen where a finished run does it.
 *
 * ## The referee's own valence, which is here now, and the rule it is under
 *
 * A passage can carry two valences on one criterion — the model's and the
 * referee's — and the whole value is in the distance between them
 * (src/referee-criteria.ts § `valenceGap`). The referee's is a comment
 * (`comments.criterion_id` + `comments.valence`, drizzle/0043), made from a
 * prose selection and never from this panel (src/web/PlaceOnCriterion.tsx says
 * why at length). Since 2026-09-01 this panel reads it back in two places:
 * `RefereeGap`, the second line on a row they both reached, and `Yours`, the
 * sub-lists of placements that are not beside a model result — the ones the
 * model never returned, and the ones in a paragraph where block-level matching
 * cannot say which passage is which (`pairPlacements`).
 *
 * **Two valences, never one.** Nothing here averages them, reconciles them,
 * splits the difference or prints a single number. The referee's line comes
 * first on the row, so what they read first is their own judgement rather than
 * the one they might be reacting to, and the disagreement is said in a plain
 * sentence rather than measured. tests/referee-gap.test.tsx collects every digit
 * inside that line and compares it against the two that went in, because a mean
 * would read perfectly well.
 *
 * ## What is deliberately still not here
 *
 * **A gap-sorted disagreement list across all criteria.** Deferred by the plan,
 * and not because it is hard: a list sorted by disagreement is a ranking of the
 * referee's own work, which wants thought before it wants code.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useQueryState } from "nuqs";

import type {
  DivergingScale,
  RefereeCriterionConfig,
  RefereeCriterionKind,
  RefereePoles,
  RefereeResult,
} from "../referee-criteria.js";
import type { Block, BlockId, Comment } from "../types.js";
import { assignSlots, PALETTE_BY_HUE } from "./hit-colours.js";
import { critsParam, refScaleParam } from "./params.js";
import { placementWords } from "./PlaceOnCriterion.js";
import { type Found, resolveCriterion } from "./search-hits.js";
import { useCriteria, type SavedCriterionState } from "./useCriteria.js";
import {
  directionWords,
  signedValence,
  valenceLabel,
  valenceSentence,
  valenceToken,
  valenceWords,
} from "./valence.js";

/**
 * **Starter packs, taken from real referee forms** — Nature's, PLOS ONE's
 * technical-soundness gate, eLife's split of *significance of findings* from
 * *strength of evidence*, and NeurIPS's soundness / presentation /
 * contribution.
 *
 * A constant array, editable on arrival: pressing one fills the box and nothing
 * else, so the referee's criterion is still theirs and still says what they
 * meant. A preset that ran itself would be the mode deciding what this paper
 * should be judged against, which is the one thing the whole design refuses.
 *
 * The two-ended ones carry poles because that is what makes them two-ended, and
 * the poles are written in the form's own vocabulary rather than as "good" and
 * "bad" — *"the controls are adequate"* and *"the controls are pre-registered"*
 * are different questions and only one of them is any given referee's.
 */
const CRITERION_PRESETS: {
  label: string;
  criterion: string;
  kind: RefereeCriterionKind;
  poles?: { against: string; favour: string };
}[] = [
  {
    label: "Technical soundness",
    criterion: "Are the methods and the analysis technically sound, and is the reporting complete?",
    kind: "diverging",
    poles: { against: "a gap in the method or the reporting", favour: "sound and fully reported" },
  },
  {
    label: "Strength of evidence",
    criterion: "How strongly does the evidence presented support the claims that are made?",
    kind: "diverging",
    poles: { against: "the evidence falls short of the claim", favour: "the evidence carries the claim" },
  },
  {
    label: "Significance",
    criterion: "What would follow for the field if these findings held?",
    kind: "single",
  },
  {
    label: "Controls",
    criterion: "Are the controls adequate for the comparisons being drawn?",
    kind: "diverging",
    poles: { against: "a control is missing or inappropriate", favour: "the controls settle it" },
  },
  {
    label: "Presentation",
    criterion: "Where is the paper hard to follow — figures, notation, or organisation?",
    kind: "single",
  },
  {
    label: "Prior work",
    criterion: "Does this cite and engage with the relevant prior work?",
    kind: "literature",
  },
];

/* ------------------------------------------------------------------ band -- */

/**
 * The band: the hook, `?crits=`, and the passages pushed up to the prose.
 *
 * `SearchBand` in App.tsx is the model, and three of its decisions are copied
 * rather than reinvented:
 *
 * - **Slots are assigned over every criterion, not the switched-on ones**, so a
 *   criterion's colour does not change when the referee unticks the one above
 *   it. hit-colours.ts § What the assignment has to be.
 * - **A `pending` criterion contributes its results now**, which is the whole
 *   of what streaming buys: the hook appends each passage as it arrives and
 *   leaves the status `pending` until the authoritative answer lands, so
 *   filtering on `done` would quietly undo every frame upstream. A **failed**
 *   one still contributes nothing.
 * - **`useLayoutEffect`, not `useEffect`, to push the results up.** This
 *   component renders the new list immediately and the prose only changes after
 *   the setter runs, so a passive effect leaves a frame where the panel shows
 *   the new passages and the article still shows the old marks.
 */
export function CriteriaBand({
  slug,
  blocks,
  comments,
  onJump,
  onFound,
  openKey,
  onOpenKey,
}: {
  slug: string;
  blocks: Block[];
  /**
   * **Every comment this reader has on the article**, of which the ones
   * carrying a `criterionId` are the referee's own placements.
   *
   * Threaded down from `Reader` rather than fetched here, because `useComments`
   * is already mounted for the whole page and a second copy of the list would
   * be a second thing that can be stale — the gutter and this panel disagreeing
   * about a judgement is worse than either of them being slightly behind.
   * Read-only: a placement is *made* from a prose selection
   * (src/web/PlaceOnCriterion.tsx), never from here, and this panel has no way
   * to write one.
   */
  comments: readonly Comment[];
  onJump(blockId: BlockId): void;
  /** `Reader` owns the prose — see the seam described on `found` in App.tsx. */
  onFound(next: Found[]): void;
  /**
   * **Which marked passage the referee last pressed**, so the prose can ring
   * that phrase rather than merely scrolling to its block.
   *
   * Held by `Reader` and not here, exactly as search's `openHit` is and for the
   * same reason: `TableView` draws the ring, and a key held in this band would
   * be a second thing that can disagree with the marks the band pushed up.
   */
  openKey: string | null;
  onOpenKey(key: string | null): void;
}) {
  const api = useCriteria(slug);
  const [active, setActive] = useQueryState("crits", critsParam);
  /* The mode's ramp, read here because this band owns the parameters and the
     panel below it is a pure function of its props. Not written from here:
     there is no control for it yet, and the composer's per-criterion `<select>`
     was removed when this arrived. */
  const [scale] = useQueryState("refscale", refScaleParam);
  /* Absent means the empty set — marks are default-off, and `critsParam` says
     why that is a rule rather than a nicety. */
  const on = useMemo(() => active ?? [], [active]);

  const slots = useMemo(() => assignSlots(api.criteria), [api.criteria]);

  const found = useMemo(() => {
    const out: Found[] = [];
    for (const row of api.criteria) {
      if (!on.includes(row.id) || row.status === "error") continue;
      out.push(
        ...resolveCriterion(blocks, {
          id: row.id,
          slot: slots.get(row.id) ?? 0,
          results: row.results,
        }),
      );
    }
    return out;
  }, [api.criteria, on, slots, blocks]);

  useLayoutEffect(() => onFound(found), [found, onFound]);

  /* **A pressed passage that is no longer drawn cannot stay pressed.**
     Unticking a criterion, deleting it, or re-running it and getting different
     passages all take a key's mark out of the prose while the key survives — and
     the ring then belongs to nothing, or worse, to whatever else minted that
     key. Keyed on absence from `found`, so an ordinary tick is left alone.
     `useIdeasMode` in App.tsx has the same effect for the same reason.

     There is deliberately no counterpart that opens the *first* passage the way
     Ideas does. An idea is one selection with a stepper over its occurrences;
     several criteria can be switched on at once, so "the first" would be the
     first of whichever criterion happened to sort first, and pressing a row is
     the only thing here that means the referee chose a passage. */
  useEffect(() => {
    if (openKey !== null && !found.some((f) => f.key === openKey)) onOpenKey(null);
  }, [found, openKey, onOpenKey]);

  /* Leaving referee mode must take the marks out of the prose with it. Its own
     effect, with no dependency on the results, so it runs on unmount and only
     on unmount — folding it into the cleanup above would clear the marks on
     every frame and set them again immediately, which is a visible flicker of
     every highlight on the page. The trap `GlossaryBand` documents. */
  useEffect(
    () => () => {
      onFound([]);
    },
    [onFound],
  );

  const toggle = useCallback(
    (id: string) => {
      void setActive(on.includes(id) ? on.filter((x) => x !== id) : [...on, id]);
    },
    [on, setActive],
  );

  return (
    <CriteriaView
      api={api}
      slots={slots}
      active={on}
      comments={comments}
      scale={scale}
      onToggle={toggle}
      onJump={onJump}
      openKey={openKey}
      onOpenKey={onOpenKey}
      onShow={(id) => {
        /* **A criterion the referee has just run switches itself on**, which is
           the one exception to marks-are-default-off and is search's own: *a
           result the reader just paid for and cannot see is not a result*
           (App.tsx § `onAsk`). It does not weaken the anchoring argument, which
           is about *arriving* at a paper with nothing painted on it — pressing
           Run is the referee asking.

           Ticked here rather than inside `ask`, so `useCriteria` stays free of
           the URL. */
        if (!on.includes(id)) void setActive([...on, id]);
      }}
    />
  );
}

/* ----------------------------------------------------------------- panel -- */

/**
 * Everything on screen, as a pure function of its props — the same band-owns-
 * the-URL, panel-is-pure split every other mode in this app makes.
 *
 * Not exported, because nothing outside this file uses it yet and an export
 * nobody imports is a knip finding rather than a seam. The split is worth
 * having anyway: it is what would let a test render the panel with no router,
 * on the day one wants to.
 */
function CriteriaView({
  api,
  slots,
  active,
  comments,
  scale,
  onToggle,
  onJump,
  openKey,
  onOpenKey,
  onShow,
}: {
  api: ReturnType<typeof useCriteria>;
  slots: Map<string, number>;
  active: string[];
  comments: readonly Comment[];
  /** The mode's ramp — `?refscale=`. Every swatch below takes it. */
  scale: DivergingScale;
  onToggle(id: string): void;
  onJump(blockId: BlockId): void;
  openKey: string | null;
  onOpenKey(key: string | null): void;
  onShow(id: string): void;
}) {
  /* Whether to print the key at all: it is about a mapping that only exists
     once something is painted by direction, and a legend for marks nobody has
     asked for would be an explanation of a thing that is not happening.
     `config.kind` and not `results[0].kind`, because a criterion that is on and
     still streaming is already painting. */
  const anyDiverging = api.criteria.some(
    (row) => active.includes(row.id) && row.config.kind === "diverging",
  );
  return (
    <div className="crit">
      <NewCriterion scale={scale} onAsk={(criterion, config) => onShow(api.ask(criterion, config))} />

      {api.error && <p className="crit-error">{api.error}</p>}

      {!api.loaded && <p className="gloss-quiet">Loading your criteria…</p>}
      {api.loaded && !api.loadFailed && api.criteria.length === 0 && (
        <p className="gloss-quiet">
          Nothing yet. Write what you have been asked to judge this paper against, and it becomes a
          pass over the prose.
        </p>
      )}

      {/* **What the tick does, in visible text above the list.** Claims labels
          its identical checkbox in words — *"Mark these passages in the paper"* —
          and this one's label is the criterion itself, so a first-time referee
          had no way to know that the box is what paints the paper. Sol's finding
          8. It says what a finished run does to the tick as well, because that
          is the one thing the panel does *for* the referee and the sentence read
          as a flat contradiction of it until Sol's finding 7 on the built
          code. */}
      {api.criteria.length > 0 && <p className="crit-how">{WHAT_THE_TICK_DOES}</p>}

      {anyDiverging && <TheKey scale={scale} />}

      <ul className="crit-list">
        {/* Newest first: the criterion you just wrote is the one you are looking
            at. The store keeps insertion order so the file reads chronologically;
            the panel sorts for display, exactly as the search panel does. */}
        {[...api.criteria].reverse().map((row) => (
          <CriterionRow
            key={row.id}
            row={row}
            slot={slots.get(row.id)}
            showing={active.includes(row.id)}
            comments={comments}
            scale={scale}
            onToggle={() => onToggle(row.id)}
            onRetry={() => api.retry(row.id)}
            onRemove={() => api.remove(row.id)}
            onRecolour={(colour) => api.recolour(row.id, colour)}
            onJump={onJump}
            openKey={openKey}
            /* **Pressing a result switches its criterion on**, and without this
               the press did nothing at all: an unticked criterion contributes
               no `Found`, so the key had no mark to ring — and the band's own
               "a pressed passage that is no longer drawn cannot stay pressed"
               effect then cleared it on the next frame. The row was clickable
               throughout, so the referee pressed a passage, arrived at the
               paragraph, and found nothing distinguished. GPT Sol's finding 1.

               `onShow` rather than `onToggle`, because pressing a result is not
               a toggle: pressing it twice must not turn the marks off. It is the
               same call a finished run makes, for the same reason — *a result
               you asked to see and cannot see is not a result*. Batched with the
               open key in one event, so `found` and `openKey` land in the same
               render and the absence effect never sees the gap. */
            onOpenKey={(key) => {
              if (key !== null) onShow(row.id);
              onOpenKey(key);
            }}
          />
        ))}
      </ul>
    </div>
  );
}

/**
 * **What the tick does**, in one visible sentence above the list.
 *
 * Reader-facing copy, and a fact about *this app* rather than about the paper —
 * docs/project/copy.md. Two sentences and both are load-bearing: the first names
 * the control, because the checkbox's own label is the criterion's words and
 * therefore says nothing about marking; the second states the exception,
 * because there is one.
 *
 * **The first draft said "Nothing is marked until you do", and it was false** —
 * `onShow` ticks a criterion the moment its run comes back, which is search's
 * own rule that *a result the reader just paid for and cannot see is not a
 * result*. So the visible sentence said the opposite of what the panel does, on
 * the very screen where the referee watches it happen. GPT Sol's finding 7, and
 * his replacement wording, which says the same rule the other way up: the tick
 * is the switch, and a run flips it for you.
 *
 * Module-local rather than exported. tests/referee-criteria-panel.test.tsx
 * asserts the sentence as a literal, which is the point: a copy test that read
 * the constant would pass over any wording at all.
 */
const WHAT_THE_TICK_DOES =
  "A criterion marks its passages while its tick is on. New runs turn it on automatically.";

/**
 * **The key: what a coloured mark in the paper means**, shown only while a
 * for/against criterion is switched on.
 *
 * This is the second half of what pays for painting the prose by direction. The
 * first is the sign after each mark (`data-dir` — src/web/annotate.ts and the
 * `::after` rules in styles.css); this states the mapping on screen, in words
 * and glyphs, so a reader does not have to have read a card somebody dismissed.
 * docs/project/colour-scales.md forbids colour being the only carrier of a
 * good/bad judgement, and a legend printed where the judgements are is the
 * plainest way to meet it.
 *
 * **It tracks the mode's ramp rather than naming red and green.** On `br` the
 * two ends are blue and red, and a key that said "red counts against" there
 * would be exactly wrong — which is the failure a hard-coded sentence invites
 * and a swatch does not. The swatches take the same `valenceToken` every row
 * does, at the two poles and the middle, so the key and the rows cannot drift.
 *
 * The glyphs are ordinary text here, unlike in the prose where they must be
 * generated content: a legend is our own writing and copying it out of the panel
 * copies nothing of the author's.
 *
 * **All four signs, not the two ends.** It printed the two poles alone until
 * GPT Sol's finding 5, and a legend that stops short of the glyphs a reader
 * will actually meet is worse than no legend. The middle one is the commonest
 * answer of the three — zero is a real answer, src/web/valence.ts — and the
 * fourth is the one nobody could guess, because it does not come from a valence
 * at all: it is what the renderer prints where two marks cover one phrase and
 * point opposite ways, and the whole point of it is that the panel, not the
 * prose, says which is which.
 *
 * That fourth one gets no swatch, and that is the honest spelling rather than
 * an omission: there is no one colour for it. The phrase wears **both** stripes,
 * which is exactly what the sign is admitting.
 */
function TheKey({ scale }: { scale: DivergingScale }) {
  return (
    <p className="crit-key">
      <span className="crit-key-lead">In the paper:</span>
      {([-100, 0, 100] as const).map((valence) => (
        <span className="crit-key-end" key={valence}>
          <span
            className="crit-key-swatch"
            aria-hidden="true"
            style={{ background: valenceToken(scale, valence) }}
          />
          {/* Not `aria-hidden`, unlike the swatch beside it. The swatch is a
              colour and there is nothing to say about it; the sign is the
              carrier itself, and a real minus (U+2212) is what a screen reader
              pronounces as "minus" — src/web/valence.ts § `signedValence`. So
              the key reads as *"minus counts against, plus counts for"*, which
              is what it means. */}
          <span className="crit-key-sign">{signOf(valence)}</span>
          {valenceWords(valence)}
        </span>
      ))}
      <span className="crit-key-end">
        <span className="crit-key-sign">{MIXED_SIGN}</span>
        {directionWords("mixed")}
      </span>
    </p>
  );
}

/**
 * The glyph for one valence — the same three characters
 * `mark.hit[data-dir]::after` draws in the prose, which is the only reason this
 * legend is worth printing at all.
 *
 * A real minus, U+2212, matching `signedValence` and the stylesheet rather than
 * a hyphen.
 */
function signOf(valence: number): string {
  if (valence < 0) return "−";
  if (valence > 0) return "+";
  return "·";
}

/** The fourth glyph, which no valence produces — `directionWords`' fourth word. */
const MIXED_SIGN = "±";

/* ------------------------------------------------------------- the form -- */

/**
 * Writing a criterion.
 *
 * The kind is chosen explicitly rather than inferred from whether the poles are
 * filled in, because inferring it would mean a referee who typed one pole and
 * stopped got a `single` criterion silently — a different question from the one
 * they were halfway through asking.
 */
function NewCriterion({
  scale,
  onAsk,
}: {
  /**
   * **The mode's ramp, written into the new row** — `?refscale=`.
   *
   * There was a `<select>` here until 2026-09-02 and it was a mistake nobody had
   * noticed: the two ramps put red at opposite ends of the truth, so two
   * criteria could paint opposite verdicts in the same colour. One scale for the
   * whole mode fixes that, works retroactively over criteria already run, and
   * needs no migration (`refScaleParam` in params.ts).
   *
   * The column is still written rather than left null, so
   * `referee_criteria.scale` does not start lying about rows made after the
   * switch. It is no longer read for display anywhere, and the day it is dropped
   * is a decision rather than a discovery — the plan names it.
   */
  scale: DivergingScale;
  onAsk(criterion: string, config: RefereeCriterionConfig): void;
}) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<RefereeCriterionKind>("single");
  const [against, setAgainst] = useState("");
  const [favour, setFavour] = useState("");

  const config: RefereeCriterionConfig =
    kind === "diverging"
      ? { kind, poles: { against: against.trim(), favour: favour.trim() }, scale }
      : { kind };

  /* The same rule the server enforces (`criterionProblem`) and the database
     enforces again (`referee_criteria_diverging_shape`), asked here so the
     button is off rather than the request refused. Three checks of one rule is
     not duplication to tidy away: this one is a disabled button, the server's
     is a 400 for anything that is not this panel, and the database's is true of
     every writer there will ever be. */
  const ready =
    text.trim() !== "" &&
    (kind !== "diverging" || (against.trim() !== "" && favour.trim() !== ""));

  return (
    <form
      className="crit-new"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        onAsk(text.trim(), config);
        setText("");
      }}
    >
      <label className="crit-label" htmlFor="crit-text">
        What are you judging this paper against?
      </label>
      <textarea
        id="crit-text"
        className="crit-text"
        rows={2}
        value={text}
        maxLength={500}
        placeholder="Are the controls adequate?"
        onChange={(e) => setText(e.target.value)}
      />

      <div className="crit-kinds" role="radiogroup" aria-label="What kind of criterion">
        {(["single", "diverging", "literature"] as const).map((k) => (
          // biome-ignore lint/a11y/useSemanticElements: a radiogroup of <button>s is the documented ARIA pattern and the call DiagramPanel.tsx, Dock.tsx, SearchPanel.tsx and App.tsx's RefereeViews already make
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={k === kind}
            /* Its own tab stop and no key handler — the arrows belong to the
               article, which is what `RefereeViews` in App.tsx records Greg
               asking for and what tests/arrows-belong-to-the-article.test.tsx
               sweeps every `role="radio"` in the client for. */
            tabIndex={0}
            className={`crit-kind-btn${k === kind ? " on" : ""}`}
            onClick={() => setKind(k)}
          >
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <p className="crit-kind-note">{KIND_NOTE[kind]}</p>

      {kind === "diverging" && (
        <div className="crit-poles">
          <label className="crit-label" htmlFor="crit-against">
            What counts against
          </label>
          <input
            id="crit-against"
            value={against}
            maxLength={200}
            placeholder="a control is missing"
            onChange={(e) => setAgainst(e.target.value)}
          />
          <label className="crit-label" htmlFor="crit-favour">
            What counts for
          </label>
          <input
            id="crit-favour"
            value={favour}
            maxLength={200}
            placeholder="the controls settle it"
            onChange={(e) => setFavour(e.target.value)}
          />
        </div>
      )}

      <div className="crit-presets">
        {CRITERION_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            className="crit-preset"
            onClick={() => {
              setText(p.criterion);
              setKind(p.kind);
              setAgainst(p.poles?.against ?? "");
              setFavour(p.poles?.favour ?? "");
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <button type="submit" className="crit-run" disabled={!ready}>
        Run this criterion
      </button>
    </form>
  );
}

const KIND_LABEL: Record<RefereeCriterionKind, string> = {
  single: "Find passages",
  diverging: "Two ends",
  literature: "Check the literature",
};

/** What each kind actually does, in the referee's terms rather than ours. */
const KIND_NOTE: Record<RefereeCriterionKind, string> = {
  single: "Marks the passages that bear on this. No judgement attached.",
  diverging:
    "Also says which way each passage cuts, between two ends you name. It is not a score for the paper, and nothing adds them up.",
  literature:
    "Goes to the web and brings back sources. A passage with no source link is not shown, because you could not check it.",
};

/* ------------------------------------------- the referee's own placements -- */

/**
 * A comment the referee actually placed: it names a criterion *and* carries a
 * number.
 *
 * The narrowing is the point rather than the convenience. `Comment.criterionId`
 * and `Comment.valence` are both optional and independent — a comment naming a
 * criterion without a number is the ordinary case, a referee who wrote a
 * sentence and did not score it — so a `Comment` on its own cannot be printed
 * beside the model's number, and a `?? 0` reaching for the missing half would
 * print *"counts neither way"* over a judgement nobody made.
 */
interface Placement extends Comment {
  criterionId: string;
  valence: number;
}

/**
 * **Which of the referee's comments are placements on this criterion.**
 *
 * Two filters and both matter. `criterionId === id` is the whole distinction
 * between a review comment and a reading note
 * (docs/project/comments.md § the referee's own placement) — an ordinary
 * bookmark on the same paragraph is not a judgement and must never be shown as
 * one. `valence !== undefined` is what makes it a *placement*: a note answering
 * a criterion with no number has nothing to set against the model's, so it
 * stays where it already is, in the gutter beside the passage.
 *
 * That second choice is the one to reopen if a referee is surprised. Including
 * the unscored ones in the misses list below would also be defensible — the
 * model missed the passage either way — and was passed over because the list is
 * read as *the referee's other judgement*, and a row in it with no judgement in
 * it would be the odd one out.
 */
function placementsOn(comments: readonly Comment[], criterionId: string): Placement[] {
  return comments.filter(
    (c): c is Placement => c.criterionId === criterionId && c.valence !== undefined,
  );
}

/**
 * Where each of the referee's placements goes on screen.
 *
 * Three homes and not two, and the third is the whole point of this function —
 * see `pairPlacements`.
 */
interface Pairing {
  /**
   * The one placement that may be drawn beside the one model result on a block.
   * A block is in here only when the pairing is unambiguous.
   */
  paired: Map<BlockId, Placement>;
  /**
   * Placements on a block the model *did* answer on, where which passage
   * answers which is not decidable.
   */
  unpaired: Placement[];
  /** Placements on a block the model returned nothing for. */
  missed: Placement[];
}

/**
 * **Matching is on criterion and block, and nothing finer — so it pairs only
 * where a block holds one of each.**
 *
 * A model result and a referee's comment both anchor to a `blockId`, and the
 * comment additionally knows the offset of the words it was made on. Matching
 * on the overlap of the two spans would be more precise and is **deferred**
 * until same-block-different-passage is shown to be common: a paragraph is the
 * unit a referee argues about, and the offsets on the two sides come from
 * different things (the model quotes, the referee selects) so an overlap test
 * would need `resolveCriterion`'s span arithmetic to mean anything.
 *
 * What is *not* deferred is being honest about what block-level matching cannot
 * decide. This used to keep the first placement on each block and hand it to
 * every model result on that block, and send the rest to the misses list. Both
 * halves of that were false statements about the referee's work, and GPT Sol's
 * finding 4 on 2026-09-01 named them:
 *
 * - **Reusing one placement.** Two model results in one paragraph both drew the
 *   same *"You: leans underpowered · −50"*, as though the referee had placed
 *   each of the two passages. They placed one.
 * - **Calling the leftovers misses.** A second placement in a paragraph the
 *   model *had* answered on landed under *"Yours, that the model did not turn
 *   up"* — a heading that is simply untrue there, and untrue in words rather
 *   than in a number, which is the worse way to be wrong.
 *
 * So: one result and one placement on a block pair up; anything else on a block
 * the model answered goes to `unpaired`, which says on screen that it is more
 * than one passage and the panel cannot say which is which. Nothing is dropped
 * and nothing is duplicated — every placement appears exactly once, in exactly
 * one of the three.
 *
 * The alternative that was passed over is **pairing one-to-one in order**,
 * first placement to first result. It is cheap and it invents an
 * attribution: the ordering of the model's results is its own ranking and the
 * referee's comments are in the order they were written, so the pairs would be
 * an artefact of two unrelated sort orders, printed with the same confidence as
 * a real match. Ambiguity that says it is ambiguous is the smaller lie, and it
 * is the shape that stops being needed the day span-overlap matching lands.
 */
function pairPlacements(
  placements: readonly Placement[],
  results: readonly RefereeResult[],
): Pairing {
  const theirs = new Map<BlockId, number>();
  for (const r of results) theirs.set(r.blockId, (theirs.get(r.blockId) ?? 0) + 1);
  const mine = new Map<BlockId, number>();
  for (const p of placements) mine.set(p.blockId, (mine.get(p.blockId) ?? 0) + 1);

  const paired = new Map<BlockId, Placement>();
  const unpaired: Placement[] = [];
  const missed: Placement[] = [];
  for (const p of placements) {
    const answers = theirs.get(p.blockId) ?? 0;
    if (answers === 0) missed.push(p);
    else if (answers === 1 && mine.get(p.blockId) === 1) paired.set(p.blockId, p);
    else unpaired.push(p);
  }
  return { paired, unpaired, missed };
}

/**
 * Reader-facing, and each is a fact about *this run* rather than about the
 * paper — docs/project/copy.md, and the same care
 * tests/referee-copy-is-about-the-model.test.ts takes over the empty state.
 *
 * The second exists because **a referee may place passages before ever asking
 * the model**, which is the anchoring-friendly order and the one the whole mode
 * would prefer. Calling those "misses" would say the model looked and found
 * nothing, which is a claim about a search that has not happened.
 */
const MODEL_MISSED = "Yours, that the model did not turn up";
const MODEL_HAS_NOT_ANSWERED = "Yours, and the model has not answered this criterion yet";
/**
 * The third heading, and the one that exists because block-level matching has a
 * state it cannot decide — `pairPlacements`.
 */
const MODEL_ALSO_HERE = "Yours, in a paragraph the model also answered on";
const WHICH_IS_WHICH =
  "More than one passage in this paragraph, so we cannot say which of yours goes with which of the model's.";

/**
 * **Do these two point opposite ways?** That is the whole of the question, and
 * the sentence it draws says only that.
 *
 * It is not a measure of how far apart they are. A referee's −100 against a
 * model's −5 returns `false` here, and that is *not* because the two are the
 * same answer — they are not, and this comment used to say they were. The
 * five-position instrument records **strength** deliberately
 * (src/web/PlaceOnCriterion.tsx): *clearly underpowered* and *barely* are
 * different judgements, and the difference is real. It is simply not what a
 * predicate called `directionsDiffer` can see, and it is not lost either — the
 * line above prints both judgements in the referee's own pole words with both
 * numbers beside them, which is where a reader sees that one of them said it
 * mildly.
 *
 * Zero is *"counts neither way"* — a real answer, the middle of the five, and
 * the commonest one (src/web/valence.ts). It is **not** a refusal to judge, and
 * this comment used to describe it as one. It points in neither direction, so
 * it cannot point in the opposite one, so a referee who pressed the middle
 * against a model's −64 gets no disagreement sentence. That gap is worth
 * showing and is shown, in words, on the line above; a sentence saying they
 * "disagree" would be describing a contradiction that is not there.
 *
 * **Still not `valenceGap`**, and the reason is now the honest one rather than
 * the old "−100 and −5 are the same answer". Subtracting the two asserts they
 * are measurements on one interval scale, and they are not: a referee's −50 is
 * one of five pressed words, a model's −50 is a continuous estimate. Sol's
 * finding 6 on 2026-09-01, recorded and deferred — before a gap-*sorted* list
 * can rank by that distance, the two sides need shared bins or an explicit
 * instrument on each number. So `valenceGap` still has no caller, which is
 * better than one written to satisfy a search for callers.
 */
function directionsDiffer(referee: number, model: number): boolean {
  return (referee < 0 && model > 0) || (referee > 0 && model < 0);
}

/* -------------------------------------------------------------- one row -- */

function CriterionRow({
  row,
  slot,
  showing,
  comments,
  scale,
  onToggle,
  onRetry,
  onRemove,
  onRecolour,
  onJump,
  openKey,
  onOpenKey,
}: {
  row: SavedCriterionState;
  slot: number | undefined;
  showing: boolean;
  comments: readonly Comment[];
  /** The mode's ramp, not `row.config.scale` — see this file's header. */
  scale: DivergingScale;
  onToggle(): void;
  onRetry(): void;
  onRemove(): void;
  onRecolour(colour: number | null): void;
  onJump(blockId: BlockId): void;
  openKey: string | null;
  onOpenKey(key: string | null): void;
}) {
  const [picking, setPicking] = useState(false);
  /* Only a `diverging` criterion has two ends, so only a `diverging` criterion
     can hold a placement — `markProblem` refuses the rest, and there would be
     no poles to print one between. */
  const poles = row.config.kind === "diverging" ? row.config.poles : null;
  const placements = poles === null ? [] : placementsOn(comments, row.id);
  const { paired, unpaired, missed } = pairPlacements(placements, row.results);
  /**
   * **Whether this row's hue still paints the marks in the prose** — and for a
   * for/against criterion it no longer does.
   *
   * Since the reversal, a `diverging` criterion's phrase marks are drawn by
   * *direction* from the mode's ramp; its categorical hue reaches only the bar
   * down the left of the paragraph and the lane in the rail. So the two controls
   * below stop claiming otherwise: the tick drops the hue rather than wearing a
   * colour that has nothing to do with what the tick paints, and the colour
   * button says what it actually colours. GPT Sol's finding 6, and the comment
   * on the tick said the opposite in so many words until 2026-09-02.
   *
   * Every other kind is unchanged — a `single` or `literature` criterion still
   * paints its stripes in its own hue, and there the tick wearing that hue is
   * exactly right.
   */
  const identityPaintsProse = row.config.kind !== "diverging";
  const hue =
    slot === undefined
      ? undefined
      : ({ "--cat-rgb": `var(--cat-${slot}-rgb)` } as React.CSSProperties);
  return (
    <li className="crit-row">
      <div className="crit-head">
        <label className="crit-tick">
          <input
            type="checkbox"
            checked={showing}
            onChange={onToggle}
            /* The row's own hue where the row's own hue is what the tick draws,
               and nothing where it is not — see `identityPaintsProse` above.
               `--cat-rgb` holds a palette *reference*, never a colour, which is
               the seam hit-colours.ts keeps; with it absent the stylesheet falls
               back to the neutral wash, which is the honest answer for a
               criterion whose marks take their colour from a ramp. */
            style={identityPaintsProse ? hue : undefined}
          />
          <span className="crit-criterion">{row.criterion}</span>
        </label>
        <button
          type="button"
          className="crit-colour"
          /* Two labels, because the control does two different amounts. On a
             for/against criterion it no longer reaches the prose at all, and
             "Colour" beside a red-and-green paper is an invitation to change
             the wrong thing and conclude the app is broken. */
          aria-label={identityPaintsProse ? "Mark colour" : "Bar and rail colour"}
          aria-expanded={picking}
          onClick={() => setPicking((v) => !v)}
          style={hue}
        />
        <button type="button" className="crit-del" aria-label="Delete" onClick={onRemove}>
          ×
        </button>
      </div>

      {picking && (
        <div className="crit-picker">
          {/* In hue order rather than slot order — `PALETTE_BY_HUE` in
              hit-colours.ts, and the note there about why slot numbers are not
              a spectrum. Numbered by position, because a slot number is an
              implementation detail a reader has no way to see. */}
          {PALETTE_BY_HUE.map((i, position) => (
            <button
              key={i}
              type="button"
              className={`crit-swatch${slot === i ? " current" : ""}`}
              style={{ "--cat-rgb": `var(--cat-${i}-rgb)` } as React.CSSProperties}
              aria-label={`Colour ${position + 1}`}
              aria-pressed={slot === i}
              onClick={() => {
                onRecolour(i);
                setPicking(false);
              }}
            />
          ))}
          <button
            type="button"
            className="crit-swatch-auto"
            onClick={() => {
              onRecolour(null);
              setPicking(false);
            }}
          >
            Automatic
          </button>
        </div>
      )}

      <p className="crit-meta">
        <span className="crit-kind">{KIND_LABEL[row.config.kind]}</span>
        {row.stale && (
          <span className="crit-stale"> · answered about an earlier version of this paper</span>
        )}
      </p>

      {row.status === "pending" && row.results.length === 0 && (
        <p className="gloss-quiet">Reading the paper…</p>
      )}
      {row.status === "error" && (
        <p className="crit-error">
          {row.error}{" "}
          <button type="button" className="crit-retry" onClick={onRetry}>
            Try again
          </button>
        </p>
      )}
      {row.status === "done" && row.results.length === 0 && (
        /* Not "nothing in this paper bears on that", which is the shorter and
           more natural sentence and is a claim we have no standing to make. A
           zero-result row can mean the extractor dropped a table, a figure or a
           supplement; that the paper words the thing differently; or that the
           model missed it. tests/referee-copy-is-about-the-model.test.ts.

           **And this branch no longer covers a fourth thing it used to.** An
           answer where the model *did* point at passages and none of them could
           be kept — a diverging row with no valence, an invented block id — is
           a failed run now (`ANSWER_UNUSABLE`, src/referee-criteria-run.ts) and
           lands in the `error` branch above with a Try again. It used to land
           here, where this sentence was false about it. GPT Sol's finding 4. */
        <p className="gloss-quiet">
          The model did not find a passage for this — which is a fact about the search, not
          about the paper.
        </p>
      )}

      <ol className="crit-results">
        {row.results.map((result, i) => (
          <CriterionResult
            /* The index is part of the key on purpose, and it is the same
               three-part shape `resolveCriterion` mints for the marks: one
               criterion can quote the same words in the same block twice with
               different reasoning, so the block id alone is not an identity.
               The list is replaced wholesale by each stream frame rather than
               reordered, so an index key cannot carry state across a move. */
            // biome-ignore lint/suspicious/noArrayIndexKey: the ordinal is the identity here — see above
            key={`${result.blockId}:${i}`}
            result={result}
            rank={i + 1}
            config={row.config}
            scale={scale}
            placement={paired.get(result.blockId)}
            /* **The key `resolveCriterion` mints for this same result**, and it
               has to be built the same way here or pressing the row would ring
               nothing at all: criterion id, block id, and the result's index in
               the stored list — which is `i`, because this list is `row.results`
               in its stored order and is replaced wholesale rather than
               reordered. Two copies of one key shape is the thing to watch here:
               if either side changes, the ring goes quiet rather than wrong,
               which is the failure docs/reusable/silent-success.md is about, so
               tests/referee-criteria-panel.test.tsx presses a row and looks for
               the key in the marks. */
            foundKey={`${row.id}:${result.blockId}:${i}`}
            open={openKey === `${row.id}:${result.blockId}:${i}`}
            onOpen={onOpenKey}
            onJump={onJump}
          />
        ))}
      </ol>

      {poles !== null && unpaired.length > 0 && (
        <Yours placements={unpaired} poles={poles} list={{ kind: "unpaired" }} onJump={onJump} />
      )}

      {poles !== null && missed.length > 0 && (
        <Yours
          placements={missed}
          poles={poles}
          list={{
            kind: "missed",
            /* `done` is the only status under which "the model did not turn up"
               is true. A run still streaming, or one that failed, has not looked
               — and a row that says otherwise is the shape
               docs/reusable/silent-success.md is about, with the referee told a
               search came back empty when it never ran. */
            answered: row.status === "done",
          }}
          onJump={onJump}
        />
      )}
    </li>
  );
}

/**
 * Which of the two sub-lists this is. A union rather than two booleans, because
 * *"the model has not answered yet"* is a fact about a missed placement and
 * says nothing about an unpaired one — and a prop that is meaningless half the
 * time is a prop somebody eventually reads in the half where it is.
 */
type YoursList = { kind: "missed"; answered: boolean } | { kind: "unpaired" };

/**
 * **The referee's placements that are not drawn beside a model result**, under
 * a heading that says why.
 *
 * Two headings, two reasons, and they are different claims:
 *
 * - **"Yours, that the model did not turn up"** — the mirror image of the gap,
 *   and arguably the more valuable half. It exists only because the referee
 *   places a passage from the prose rather than from this panel: a control
 *   beside each model result could only ever collect judgements on passages the
 *   model had already surfaced, so the model's *misses* would be unreachable by
 *   construction (src/web/PlaceOnCriterion.tsx § it lives in the selection
 *   flow).
 * - **"Yours, in a paragraph the model also answered on"** — not a miss at all.
 *   The model was here; block-level matching just cannot say which passage is
 *   which (`pairPlacements`). Saying "did not turn up" over these is the false
 *   label Sol's finding 4 caught, so the heading changes rather than the truth
 *   being rounded to fit the heading we already had.
 *
 * No rank in either, deliberately. The number on a model row is that model's
 * ordering of its own answers; the referee's placements have no such ordering
 * and inventing one — by valence, by recency — would be this panel ranking the
 * referee's work, which is the thing the plan defers on purpose.
 */
function Yours({
  placements,
  poles,
  list,
  onJump,
}: {
  placements: readonly Placement[];
  poles: RefereePoles;
  list: YoursList;
  onJump(blockId: BlockId): void;
}) {
  /* Separate class names on the two lists, not one shared name with a
     modifier. Same reasoning as `crit-yours` below: tests/referee-gap.test.tsx
     tells the lists apart by class, and a shared one would let a placement in
     the wrong list pass every assertion written about the right one. */
  const css =
    list.kind === "missed"
      ? { box: "crit-misses", head: "crit-misses-head", list: "crit-miss-list", one: "crit-miss" }
      : {
          box: "crit-unpaired",
          head: "crit-unpaired-head",
          list: "crit-unpaired-list",
          one: "crit-unpaired-one",
        };
  return (
    <div className={css.box}>
      <p className={css.head}>
        {list.kind === "unpaired"
          ? MODEL_ALSO_HERE
          : list.answered
            ? MODEL_MISSED
            : MODEL_HAS_NOT_ANSWERED}
      </p>
      {list.kind === "unpaired" && <p className="crit-unpaired-why">{WHICH_IS_WHICH}</p>}
      <ul className={css.list}>
        {placements.map((p) => (
          <li className={css.one} key={p.id}>
            <button type="button" className="crit-jump" onClick={() => onJump(p.blockId)}>
              <span className="crit-quote">{p.quote}</span>
            </button>
            {/* `crit-yours` and not `crit-gap`: there is no gap here, because
                there is only one judgement. The class is the difference, and
                tests/referee-gap.test.tsx counts on it — a shared class would
                let a row with one judgement pass every assertion written about
                a row with two. */}
            <p className="crit-yours">{refereeSide(p.valence, poles)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One passage.
 *
 * **The rank leads**, large, with everything else beside it — the plan's § 1,
 * and the honest version of Greg's preference for ranking over scores: it does
 * not turn a −100…+100 valence into a ranking, but it is what the panel puts
 * first and what the model was asked to think about (the prompt asks for an
 * ordering *relative to the other passages in this paper*).
 */
function CriterionResult({
  result,
  rank,
  config,
  scale,
  placement,
  foundKey,
  open,
  onOpen,
  onJump,
}: {
  result: RefereeResult;
  rank: number;
  config: RefereeCriterionConfig;
  /** The mode's ramp, not `config.scale` — see this file's header. */
  scale: DivergingScale;
  /** The referee's own placement of this same block, if they made one. */
  placement: Placement | undefined;
  /** This passage's key in the marks — `resolveCriterion`'s, rebuilt. */
  foundKey: string;
  /** True when this is the row the referee last pressed. */
  open: boolean;
  onOpen(key: string): void;
  onJump(blockId: BlockId): void;
}) {
  const diverging = result.kind === "diverging" && config.kind === "diverging";
  return (
    <li className={`crit-result${open ? " on" : ""}`}>
      <button
        type="button"
        className="crit-jump"
        onClick={() => {
          /* **Both, and in this order.** The key is what draws the ring around
             this exact phrase (`mark.hit[data-hit-open]`); the jump is what puts
             it on screen. Referee mode passed `null` for the key until
             2026-09-02, so a press scrolled to the paragraph and left the
             passage indistinguishable from every other mark in it — while
             Search's identical rows had the ring all along. Same call
             `SearchBand` makes, including the "always jump, even when the block
             is already on screen" part: a criterion result is a place the
             referee has not been yet. */
          onOpen(foundKey);
          onJump(result.blockId);
        }}
      >
        <span className="crit-rank">{rank}</span>
        <span className="crit-quote">{result.quote}</span>
      </button>

      {diverging && (
        /**
         * **Four carriers, and the colour is the fourth.**
         *
         * The visible half is the swatch, the direction in words, the referee's
         * own end and the signed number; the spoken half is `valenceLabel`,
         * which is those same four facts in the same order with the rank in
         * front. The visible spans are `aria-hidden` and the sentence is
         * `.sr-only`, so a screen reader hears the ordered sentence **once**
         * rather than the pieces and then the sentence again.
         *
         * An `aria-label` on this `<p>` would have been the obvious spelling
         * and is wrong: a paragraph's role does not support a name, so the
         * attribute is ignored — which reads in the source exactly like the
         * accessibility this design is conditional on, while providing none of
         * it. docs/project/colour-scales.md: colour may never be the only
         * carrier, and a carrier nothing announces is not one.
         */
        <p className="crit-valence">
          <span className="sr-only">{valenceLabel(rank, result.valence, config.poles)}</span>
          <span
            className="crit-valence-swatch"
            aria-hidden="true"
            style={{ background: valenceToken(scale, result.valence) }}
          />
          <span className="crit-valence-words" aria-hidden="true">
            {valenceWords(result.valence)}
          </span>
          <span className="crit-valence-end" aria-hidden="true">
            {result.valence < 0
              ? config.poles.against
              : result.valence > 0
                ? config.poles.favour
                : "neither end"}
          </span>
          <span className="crit-valence-number" aria-hidden="true">
            {signedValence(result.valence)}
          </span>
        </p>
      )}

      {diverging && placement && (
        <RefereeGap referee={placement.valence} model={result.valence} poles={config.poles} />
      )}

      {result.reasoning && <p className="crit-why">{result.reasoning}</p>}

      {result.kind === "literature" && (
        <p className="crit-cites">
          {result.citations.map((c) => (
            /* Every URL has already passed `isWebUrl` before storage
               (`readCitations`), which is where model output stops being a
               string; this is not the last line of defence and does not pretend
               to be one. `rel` because it is a link to somewhere we know
               nothing about. */
            <a key={c.url} href={c.url} target="_blank" rel="noreferrer noopener">
              {c.title ?? c.url}
            </a>
          ))}
        </p>
      )}
    </li>
  );
}

/* --------------------------------------------- the referee's line on a row -- */

/**
 * The referee's half of the sentence — *"You: leans underpowered · −50"*.
 *
 * `placementWords` comes from src/web/PlaceOnCriterion.tsx, which is where the
 * five positions and their labels are defined. Importing it rather than
 * rebuilding the words here is what keeps the label the referee *pressed* and
 * the label they are shown the same string; a second copy is how the two ends
 * end up swapped in one of them.
 */
function refereeSide(valence: number, poles: RefereePoles): string {
  return `You: ${placementWords(valence, poles)} · ${signedValence(valence)}`;
}

/**
 * **Both judgements on one line, the referee's first.**
 *
 * The order is the design and not a layout preference. The referee's own
 * placement is what they read first, so the model's number is not the thing
 * they are reacting to — the same anchoring argument that put the placement
 * instrument in the prose selection rather than in this panel
 * (src/web/PlaceOnCriterion.tsx).
 *
 * **Two valences, never one.** There is no mean here, no difference, no arrow
 * and no bar: `valenceGap` is explicit that averaging them, or letting one
 * overwrite the other, deletes exactly the thing worth looking at
 * (src/referee-criteria.ts). What the line offers instead is both numbers side
 * by side and a sentence when they point opposite ways.
 *
 * ## Why this is plain text, where the row above it is four hidden spans
 *
 * `CriterionResult`'s valence paragraph splits into `aria-hidden` pieces with a
 * `.sr-only` sentence beside them, because the visible version is a swatch and
 * three fragments and a screen reader would otherwise hear them loose. This one
 * is *already* one ordered sentence in words — the direction, the referee's own
 * end and the number, on both sides — so there is nothing to hide and nothing
 * to say twice. It carries no swatch for the same reason: colour would be a
 * fifth carrier of something four words already say, and
 * docs/project/colour-scales.md wants the words first, not the colour as well.
 */
function RefereeGap({
  referee,
  model,
  poles,
}: {
  referee: number;
  model: number;
  poles: RefereePoles;
}) {
  return (
    <>
      <p className="crit-gap">
        {refereeSide(referee, poles)} — Model: {valenceSentence(model, poles)}
      </p>
      {/* A plain sentence rather than a measured distance, and its own
          paragraph rather than a word inside the line above, so that what the
          referee sees is *that* they disagree and never *by how much* — the
          number would be the single number this whole feature refuses. */}
      {directionsDiffer(referee, model) && (
        <p className="crit-disagree">You and the model disagree here.</p>
      )}
    </>
  );
}
