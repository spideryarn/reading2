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
 * **1. The prose stripe carries criterion identity, never valence.** Sol's
 * finding 7. `annotateHtml` keeps every identity slot on an overlapping mark
 * while collapsing strength to the strongest, so repainting the stripe by
 * valence destroys provenance: two negative criteria over one phrase would both
 * go red and the reader, mid-sentence, could not tell which said what. So
 * `resolveCriterion` drops the valence on the way to the marks (it says so at
 * length), and the valence appears **here, in the row**, and nowhere else.
 *
 * The plan also asked for it in the prose gutter, beside the marked block, and
 * that is **not built** — the gutter holds the permalink and the chat button
 * and nothing else. Recorded rather than quietly dropped: the row is the
 * simplest thing that satisfies rule 3 below, and the gutter is an addition to
 * make once somebody has read with this and found the panel too far away.
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
 * ## And the rule that is about the reader rather than the pixels
 *
 * **Marks are default-off.** `?crits=` starts empty, exactly as `?runs=` does,
 * because *the article acquires marks when the reader asks for them and at no
 * other time* — and here that is also the cheap 80% of the anchoring problem
 * the plan's § 1 is about: the referee reads the paper before the model paints
 * on it.
 *
 * ## What is deliberately not here
 *
 * **The referee's own valence, and the disagreement list.** A passage can carry
 * two valences on one criterion — the model's and the referee's — and the whole
 * value is in the distance between them (src/referee-criteria.ts §
 * `valenceGap`). The referee's is a comment (`comments.criterion_id` +
 * `comments.valence`, drizzle/0043) and writing one is the next stage's work.
 * Nothing here averages, reconciles or shows one number.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useQueryState } from "nuqs";

import type {
  DivergingScale,
  RefereeCriterionConfig,
  RefereeCriterionKind,
  RefereeResult,
} from "../referee-criteria.js";
import { DEFAULT_DIVERGING_SCALE } from "../referee-criteria.js";
import type { Block, BlockId } from "../types.js";
import { assignSlots, PALETTE_BY_HUE } from "./hit-colours.js";
import { critsParam } from "./params.js";
import { type Found, resolveCriterion } from "./search-hits.js";
import { useCriteria, type SavedCriterionState } from "./useCriteria.js";
import { signedValence, valenceLabel, valenceToken, valenceWords } from "./valence.js";

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
  onJump,
  onFound,
}: {
  slug: string;
  blocks: Block[];
  onJump(blockId: BlockId): void;
  /** `Reader` owns the prose — see the seam described on `found` in App.tsx. */
  onFound(next: Found[]): void;
}) {
  const api = useCriteria(slug);
  const [active, setActive] = useQueryState("crits", critsParam);
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
      onToggle={toggle}
      onJump={onJump}
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
  onToggle,
  onJump,
  onShow,
}: {
  api: ReturnType<typeof useCriteria>;
  slots: Map<string, number>;
  active: string[];
  onToggle(id: string): void;
  onJump(blockId: BlockId): void;
  onShow(id: string): void;
}) {
  return (
    <div className="crit">
      <NewCriterion
        onAsk={(criterion, config) => {
          onShow(api.ask(criterion, config));
        }}
      />

      {api.error && <p className="crit-error">{api.error}</p>}

      {!api.loaded && <p className="gloss-quiet">Loading your criteria…</p>}
      {api.loaded && !api.loadFailed && api.criteria.length === 0 && (
        <p className="gloss-quiet">
          Nothing yet. Write what you have been asked to judge this paper against, and it becomes a
          pass over the prose.
        </p>
      )}

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
            onToggle={() => onToggle(row.id)}
            onRetry={() => api.retry(row.id)}
            onRemove={() => api.remove(row.id)}
            onRecolour={(colour) => api.recolour(row.id, colour)}
            onJump={onJump}
          />
        ))}
      </ul>
    </div>
  );
}

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
  onAsk,
}: {
  onAsk(criterion: string, config: RefereeCriterionConfig): void;
}) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<RefereeCriterionKind>("single");
  const [against, setAgainst] = useState("");
  const [favour, setFavour] = useState("");
  const [scale, setScale] = useState<DivergingScale>(DEFAULT_DIVERGING_SCALE);

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
          <label className="crit-label" htmlFor="crit-scale">
            Scale
          </label>
          <select
            id="crit-scale"
            value={scale}
            onChange={(e) => setScale(e.target.value === "br" ? "br" : "rg")}
          >
            <option value="rg">Red to green</option>
            <option value="br">Blue to red</option>
          </select>
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

/* -------------------------------------------------------------- one row -- */

function CriterionRow({
  row,
  slot,
  showing,
  onToggle,
  onRetry,
  onRemove,
  onRecolour,
  onJump,
}: {
  row: SavedCriterionState;
  slot: number | undefined;
  showing: boolean;
  onToggle(): void;
  onRetry(): void;
  onRemove(): void;
  onRecolour(colour: number | null): void;
  onJump(blockId: BlockId): void;
}) {
  const [picking, setPicking] = useState(false);
  return (
    <li className="crit-row">
      <div className="crit-head">
        <label className="crit-tick">
          <input
            type="checkbox"
            checked={showing}
            onChange={onToggle}
            /* The row's own hue, so the tick and the mark it draws are visibly
               the same thing — `--cat-rgb` holds a palette *reference*, never a
               colour, which is the seam hit-colours.ts keeps. */
            style={
              slot === undefined
                ? undefined
                : ({ "--cat-rgb": `var(--cat-${slot}-rgb)` } as React.CSSProperties)
            }
          />
          <span className="crit-criterion">{row.criterion}</span>
        </label>
        <button
          type="button"
          className="crit-colour"
          aria-label="Colour"
          aria-expanded={picking}
          onClick={() => setPicking((v) => !v)}
          style={
            slot === undefined
              ? undefined
              : ({ "--cat-rgb": `var(--cat-${slot}-rgb)` } as React.CSSProperties)
          }
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
           model missed it. tests/referee-copy-is-about-the-model.test.ts. */
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
            onJump={onJump}
          />
        ))}
      </ol>
    </li>
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
  onJump,
}: {
  result: RefereeResult;
  rank: number;
  config: RefereeCriterionConfig;
  onJump(blockId: BlockId): void;
}) {
  const diverging = result.kind === "diverging" && config.kind === "diverging";
  return (
    <li className="crit-result">
      <button type="button" className="crit-jump" onClick={() => onJump(result.blockId)}>
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
            style={{ background: valenceToken(config.scale, result.valence) }}
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
