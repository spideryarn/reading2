/**
 * The glossary panel — a **mode**, in the band between the spine and the prose.
 *
 * Greg, 2026-08-25, on where a mode goes, said of chat and named this feature
 * in the same breath:
 *
 * > I'm thinking that this might be a common pattern, that when we switch into
 * > a mode (e.g. Chat, Glossary, etc) we'll want to keep the spine and article,
 * > but reuse the middle sections.
 *
 * and then, when this was built:
 *
 * > When active, it should replace the middle sections of the UI (i.e. right of
 * > the spine, left of the doc).
 *
 * So this is the third implementation of the slot ChatPanel.tsx describes, and
 * it needed no new layout arithmetic at all — `fitView({ modeBand: true })` in
 * layout.ts already knew about the slot rather than about chat.
 *
 * ## The one thing this deliberately does not do
 *
 * **Mark up the prose on its own initiative.** The version this was borrowed
 * from put a dotted underline and a small book icon on every term, inline, on
 * every article, always. That is the prose acquiring marks the author did not
 * write, at the model's suggestion rather than the reader's — a small violation
 * of [principle 5](../../docs/project/vision.md#principles), and the thing our
 * own review of their feature said to drop
 * (docs/project/original-version/glossary.md § What we'd do differently).
 *
 * What happens instead: **selecting a term underlines its occurrences**, and
 * only while it is selected. Greg's call, 2026-08-25, choosing that over "jump
 * only" — the underline is reader-initiated, so the principle holds, and it
 * answers the question the list otherwise raises on every entry, which is
 * *where does this piece actually use that*.
 *
 * ## The scores, and the condition attached to them
 *
 * `difficulty` and `centrality` are the model's judgment of how hard a term is
 * and how much of the argument rests on it. Our review of their version said to
 * drop both, on the grounds that ranking terms for the reader is the model
 * doing the reader's prioritising. Greg kept them, with a condition: **never
 * sort by them silently.**
 *
 * On **2026-08-26** he overrode the first half of that condition and kept the
 * second. The default order is now `prioritised`, which is a ranking nobody
 * asked for — so everything here is about making it not a silent one:
 *
 * - it uses the two scores for **one decision only**, in or out, because a
 *   product of two noisy 0–1 scores groups well and ranks badly;
 * - **the order is first use**, the reader's own order through the piece, so
 *   the model has chosen nothing about the sequence;
 * - **both numbers are on every row**, and never the product, which is our
 *   arithmetic rather than the model's judgment;
 * - **the one number in the rule is the reader's**, on a slider in the panel
 *   with its value and its effect beside it — the last thing here that was a
 *   judgment made on the reader's behalf, and now the thing they set;
 * - **the foot line says how many the bar is holding back**, in every state
 *   including none and all, so nothing goes quietly;
 * - when there is nothing to gate at all, the whole of it **falls back to first
 *   use** and the control is not offered.
 *
 * **It grouped rather than hid until 2026-09-03**, with a *"worth knowing
 * first"* heading over the survivors and *"the rest"* under them. Greg looked
 * at it and said hiding would be clearer, and that the other threshold modes
 * should work the same way; the shared rule is now in threshold.ts, and the
 * argument the grouping rested on is answered in its docstring.
 *
 * The four designs this was chosen from, and the two things it is a bet on, are
 * in docs/plans/260826b-glossary-prioritised-order.md.
 */
import { useState } from "react";
import {
  ExternalLink,
  Globe,
  Info,
  LoaderCircle,
  RotateCcw,
  Search,
  TextSearch,
  TriangleAlert,
} from "lucide-react";
import type { BlockId, GlossaryEntry, GlossaryLookup, Job } from "../types.js";
import type { TermSort } from "./params.js";
import { BlockRef } from "./BlockRef.js";
import { ScoreBars } from "./ScoreBars.js";
import { BlockNav, nudgeTo } from "./BlockNav.js";
import { Tooltip } from "./Tooltip.js";
/* One `hostOf`, not four. src/urls.ts has said since 2026-08-26 that the copies
   in this file, CommentDialog and ChatPanel should converge on it "when somebody
   is next in those files" — the hover card (ProseHoverCard.tsx) made this the
   second caller of the private copy, which is the moment to stop copying it.
   The behaviours differ on an unparseable URL: the shared one answers "" so the
   caller can say "that page", where this copy answered with the whole URL.
   Unreachable here — `safeUrl` parsed it server-side before it was stored. */
import { hostOf, isWebUrl } from "../urls.js";
import {
  applyThreshold,
  hiddenNote,
  survivesThreshold,
  type ThresholdResult,
} from "./threshold.js";
import type { LookKept, UseGlossary } from "./useGlossary.js";
import type { StepFailure } from "./useStepJob.js";
import { builtButEmpty, codeOfMessage } from "../messages.js";
import { MAX_ASKED_TERM } from "../asked-term.js";
import { JobProgress } from "./JobProgress.js";
import { ModeSurface } from "./ModeSurface.js";
import { UseProfile, WrittenForYou } from "./WrittenForYou.js";
import { useRenderCount } from "./perf.js";

/**
 * **The owner's half of this panel** — the read's status, the job writing it,
 * the three verbs and the per-entry web lookup.
 *
 * Absent for a visitor, and that is the seam — `GlossaryAccess` below is what
 * makes "absent" a thing the compiler enforces. Since slice 1b a visitor gets the
 * real glossary: it arrives inside `GET /api/public/article/:slug`, so the list
 * below is the same list drawn by the same components. What a visitor has no
 * equivalent of is everything in this type — there is no request to be loading
 * or to have failed, no job to poll, no button that spends, and no lookup,
 * because a lookup is the owner's own research and lives in a table the public
 * graph cannot reach at all.
 *
 * **One panel with its data injected, rather than an owner's panel and a
 * visitor's panel.** Two components for one list is how the two drift into two
 * designs for one thing, which a browser pass caught once already in a drawer
 * heading. Only the *hooks* need two components, and they are one level up in
 * App.tsx. reader-capability.ts says why a boolean could not have done it.
 *
 * **`owner.glossary` is the artefact, and the `glossary` prop is the list to
 * draw.** They are the same object on the owner's path and they must be. Until
 * 2026-09-05 `Foot` read the artefact for the provenance line under the list —
 * the generator, the version and the pass count, every one of them dropped by a
 * visitor's projection. That line is gone (see `Foot`), so **nothing reads the
 * artefact any more**: `owner.glossary` survives here only as the *is there one
 * yet* test for whether to draw the foot at all. The list has one source and it
 * is the prop.
 */
export type GlossaryOwner = UseGlossary;

/** A completed lookup whose row a concurrent glossary rewrite removed. */
function keptWithoutEntry(
  owner: UseGlossary | null,
  entries: readonly GlossaryEntry[],
): LookKept | null {
  const kept = owner?.lookKept;
  if (!kept) return null;
  return entries.some((entry) => entry.id === kept.id) ? null : kept;
}

/**
 * **Who is reading, and the list they get — one prop, so the two cannot
 * disagree.**
 *
 * These used to be two independent props, `glossary` and `owner`, which made
 * `{ glossary: <a visitor's list>, owner: <a real owner hook> }` a legal thing
 * to write: it typechecks, and it renders the lookup box and the buttons that
 * spend to somebody who does not own the article. Nothing wrote it and a test
 * asserts nobody does, but the test is the only thing that was stopping it.
 *
 * So the rule from reader-capability.ts is reproduced one level down: **the
 * visitor arm has no `owner` field to be empty, so there is nothing for a later
 * edit to read.**
 *
 * The list is typed as its entries rather than as `Glossary`, because that is
 * all this panel and its `Foot` ever read — and because a visitor's
 * `PublicGlossaryEntry` is a `GlossaryEntry` with the lookup absent
 * (src/public-types.ts), so both fit without a cast and neither needs a second
 * component.
 *
 * **The asymmetry is deliberate.** An owner can be looking at a piece with no
 * glossary yet — that is an ordinary state, and it is what the offer to build
 * one is for. A visitor never mounts this panel without the list, because
 * `visitorGap` answers *not built* and the band says so instead of rendering
 * (src/web/visitor.ts).
 *
 * **`owner?: never` is load-bearing, and it is not tidiness.** Without it the
 * union catches only a *fresh object literal* at the call site, because that is
 * the only place TypeScript applies excess-property checking. Build the same
 * object in a variable first and `access={that}` typechecks with an owner hook
 * riding along inside a visitor's arm — which is precisely how a guard like
 * this turns out to be worth nothing. Both forms were tried against `tsc`
 * before this line was added, and only the literal was caught; with it, both
 * are. There is a `never` on each of the other two panels for the same reason.
 */
export type GlossaryAccess =
  | { kind: "owner"; owner: GlossaryOwner; glossary: { entries: GlossaryEntry[] } | null }
  | { kind: "visitor"; glossary: { entries: GlossaryEntry[] }; owner?: never };

interface Props {
  access: GlossaryAccess;
  /** The selected term, from `?term=`. Null is a list nobody has picked from. */
  termId: string | null;
  onTerm(id: string | null): void;
  sort: TermSort;
  onSort(sort: TermSort): void;
  /**
   * Where the reader has put the threshold, or null for "hasn't touched it" —
   * which is `PRIORITY_GATE`. The distinction is kept all the way from the URL
   * (`gateParam` in params.ts) so that the default stays one number in one file.
   */
  gate: number | null;
  onGate(gate: number | null): void;
  /** Jump the article to a block, exactly as a gist cell does. */
  onJump(id: BlockId): void;
  /**
   * **Hand the reader to Chat**, for a term the article does not contain.
   *
   * The glossary defines terms *from the piece* and will not be talked out of
   * it, so a word the piece never uses has no answer here — and chat is the one
   * surface in this app that may answer from outside the article. Absent for a
   * visitor, who has no chat.
   *
   * **Given the term, and it goes with the reader.** Called with the term the
   * box actually sent (`UseGlossary.askTerm`); `Reader` turns it into a question
   * in a fresh conversation's composer, sent only when the reader presses Send
   * — Greg, 2026-09-11, *"fresh"*. Until then it was a bare mode switch and the
   * reader typed the word twice. `askAboutTerm` in src/web/chat-handoff.ts, and
   * `ChatHandoff` in src/web/modes/conversation/ConversationModes.tsx.
   */
  onAskChat?: ((term: string) => void) | undefined;
}

export function GlossaryPanel({
  access,
  termId,
  onTerm,
  sort,
  onSort,
  gate: chosenGate,
  onGate,
  onJump,
  onAskChat,
}: Props) {
  useRenderCount("GlossaryPanel");
  const owner = access.kind === "owner" ? access.owner : null;
  const glossary = access.glossary;
  /* `effectiveSort` and not `sort`: `prioritised` is the default, so it arrives
     on glossaries whose scores cannot support it, and everything below — the
     list, the SortBar's pressed state, the numbers on each row — has to agree
     about what order the list is actually in. One call, one answer, passed
     down. */
  const all = glossary?.entries ?? [];
  const gate = chosenGate ?? PRIORITY_GATE;
  const order = effectiveSort(all, sort);
  const shown = glossary ? sortEntries(all, order, gate) : [];
  const orphanedLookup = keptWithoutEntry(owner, all);

  /**
   * Whether the next run should use the profile.
   *
   * Seeded from what the list on screen was written with — `profiled` — so the
   * box is already in the state the reader last chose and nothing has to
   * remember it between visits: the artefact does. `useState`'s initialiser
   * rather than an effect, because it is the starting value and re-seeding it
   * every time a poll returns would fight a reader who had just unticked it.
   *
   * With no glossary yet, `profiled` is false and the default is `true` — the
   * profiled run is the one this app now offers.
   */
  const [withProfile, setWithProfile] = useState(() => (glossary ? (owner?.profiled ?? false) : true));

  return (
    <ModeSurface
      label="Glossary"
      feature="gloss"
      /* **A fragment, not a conditional** — and that is the whole trap of this
          migration. Both children below are gated on `glossary`, so while the
          list is still coming this row is empty; a `head={glossary && …}` would
          hand the surface `null` and it would render no `.band-head` at all,
          deleting a row that is on screen today. The fragment is always
          present, and the conditionals live inside it. */
      head={
        <>
          {/* The mode's name went on 2026-09-05 — the Dock says it, and saying
              it twice was the clutter Greg asked us to clear (§ Stage 5 of
              docs/plans/260905d-declutter-the-reading-view-top-bars.md). The
              row stays, because what follows is a count rather than a name. */}
          {glossary && (
            <span className="gloss-count">
              {glossary.entries.length} {glossary.entries.length === 1 ? "term" : "terms"}
            </span>
          )}
          {/* A label rather than a control, and on the head line rather than in
              a banner: it is provenance, not a warning. The glossary already
              made this exact choice once — "a label instead of a warning
              triangle" — and the reason holds. src/web/WrittenForYou.tsx. */}
          {/* Provenance about the owner's own run, so a visitor sees none of it:
              `profileHash` never leaves the server (src/public-types.ts). */}
          {glossary && owner && (
            <WrittenForYou
              written={owner.profiled}
              changed={owner.profileChanged}
              slug={owner.slug}
            />
          )}
        </>
      }
      /* Pinned under the scroller rather than at the end of it, which is what
          `foot` is for. The guard is the one it had as a trailing child: the
          run row belongs to an owner whose glossary has arrived. */
      foot={
        glossary && (owner === null || owner.status === "ready") && owner?.glossary ? (
          <Foot
            job={owner.job}
            starting={owner.starting}
            failed={owner.failed}
            onMore={owner.more}
            onCancel={owner.cancel}
            withProfile={withProfile}
            onWithProfile={setWithProfile}
            hasProfile={owner.hasProfile}
            slug={owner.slug}
          />
        ) : null
      }
    >

      {/* **Above the list and above the sort**, because it is the way in rather
          than a way of arranging what is already there — and because a reader
          who typed a word wants to see what came back without scrolling past
          twenty-four terms to find it.

          Owner only, and not marked-not-hidden: it spends money on a model call
          and the endpoint is owner-only, so for a visitor it is not a control
          they have lost but one that has never applied to them. The band's own
          sentence already says what a shared link does not carry. */}
      {owner && <AskATerm owner={owner} onJump={onJump} onAskChat={onAskChat} />}

      {/* Sorting is only a question once there is a list, and each option is
          only offered once the model actually returned what it needs — an older
          glossary may have no scores at all, and offering a sort that would
          silently do nothing is worse than not offering it. `SortBar` returns
          nothing when fewer than two survive that. */}
      {glossary && glossary.entries.length > 1 && (
        <SortBar entries={all} sort={order} onSort={onSort} />
      )}

      {/* Only in the order it belongs to. It is the one control here that sets
          a number rather than picking from a list, and a number that means
          nothing in the other three orders would just be furniture. */}
      {glossary && order === "prioritised" && (
        <GateSlider entries={all} gate={gate} moved={chosenGate !== null} onGate={onGate} />
      )}

      {owner?.error && <p className="gloss-error">{owner.error}</p>}

      {orphanedLookup && (
        <p className="gloss-quiet">
          The answer{orphanedLookup.name ? ` for ${orphanedLookup.name}` : ""} was saved, but
          that term is no longer in the glossary, so it is not shown here.
        </p>
      )}

      {owner?.status === "loading" && <p className="gloss-quiet">Looking for a glossary…</p>}

      {/* **A visitor's list is already here or it is not**, so there is no
          loading state and no offer to build one — a piece with no glossary
          never mounts this panel at all, because `visitorGap` answers
          *not-built* and the band says so instead (src/web/visitor.ts). What is
          left is the one state absence cannot express: a glossary somebody ran
          that came back with nothing in it. src/messages.ts. */}
      {!owner && glossary?.entries.length === 0 && (
        <p className="gloss-quiet">{builtButEmpty("A glossary")}</p>
      )}

      {owner?.status === "none" && (
        <div className="gloss-empty">
          <p>Nobody has found the terms for this one yet.</p>
          <p className="gloss-hint">
            One model call over the whole article, and it takes tens of seconds. Found once and
            kept — you will not be asked again unless the article changes.
          </p>
          <div className="gloss-run">
            {/* Beside the button that spends, not in the head with the label.
                Unticking this and pressing Find is exactly "check/uncheck and
                it regenerates without this prompt" — it just does not pretend
                to be free. src/web/WrittenForYou.tsx. */}
            <UseProfile
              checked={withProfile}
              onChange={setWithProfile}
              hasProfile={owner.hasProfile}
              slug={owner.slug}
              disabled={owner.job !== null}
              automatic={owner.automatic}
            />
            <Progress
              job={owner.job}
              starting={owner.starting}
              failed={owner.failed}
              stalled={owner.stalled}
              onRun={() => owner.find(withProfile)}
              onCancel={owner.cancel}
              label="Find the terms"
            />
          </div>
        </div>
      )}

      {glossary && (owner === null || owner.status === "ready") && (
        <>
          {/* The article has moved and the list has not. Said plainly, at the
              top, because every entry below it is now a claim about a version
              of the piece that no longer exists — and the occurrences in
              particular will point at blocks that may not be there. The button
              needs no `force`: the step's own freshness check already knows
              this glossary is out of date, so an ordinary run rewrites it. */}
          {/* Two different facts, and they were nearly one. `stale` is *the
              article moved underneath these terms* — every entry below is a
              claim about a piece that no longer exists, and the occurrences in
              particular will point at blocks that may not be there.

              `outdated` is *the article is the same and we would write these
              differently now*, which is what bumping `PROMPT_VERSION` means.
              It got its own flag because it was briefly nobody's: `isStale`
              compares source hashes and nothing else, so the `glossary/2`
              rewrite marked exactly zero glossaries as anything, and the panel
              went on showing pre-rewrite entries with no banner and no offer.

              Stale wins when both are true — it is the one that makes the
              occurrence links wrong, and two banners stacked is a wall. */}
          {owner?.stale ? (
            <div className="gloss-stale">
              <p>
                <TriangleAlert size={13} />
                These terms describe an older version of the article.
              </p>
              <div className="gloss-run">
                <UseProfile
                  checked={withProfile}
                  onChange={setWithProfile}
                  hasProfile={owner.hasProfile}
                  slug={owner.slug}
                  disabled={owner.job !== null}
                  automatic={owner.automatic}
                />
                <Progress
                  job={owner.job}
                  starting={owner.starting}
                  failed={owner.failed}
                      stalled={owner.stalled}
                  onRun={() => owner.find(withProfile)}
                  onCancel={owner.cancel}
                  label="Find them again"
                />
              </div>
            </div>
          ) : owner?.outdated ? (
            <div className="gloss-stale">
              <p>
                <TriangleAlert size={13} />
                These were written before entries said where each half came from. Finding them
                again splits each one into what the article means and what the model knows.
              </p>
              <div className="gloss-run">
                <UseProfile
                  checked={withProfile}
                  onChange={setWithProfile}
                  hasProfile={owner.hasProfile}
                  slug={owner.slug}
                  disabled={owner.job !== null}
                  automatic={owner.automatic}
                />
                <Progress
                  job={owner.job}
                  starting={owner.starting}
                  failed={owner.failed}
                      stalled={owner.stalled}
                  onRun={() => owner.find(withProfile)}
                  onCancel={owner.cancel}
                  label="Find them again"
                />
              </div>
            </div>
          ) : null}

          {/* One list again, in every order. It was a `div` wrapping two headed
              `ol`s from 2026-08-26 until 2026-09-03, when the threshold started
              hiding what is below it instead of grouping it — with nothing to
              contrast, "worth knowing first" was a heading over the whole list.
              The `div` stays as the scroller, because that is the element the
              sticky heading needed and the one the CSS scrolls. */}
          <div className="gloss-list">
            <ol className="gloss-list-items">
              {shown.map((entry) => (
                <Term
                  key={entry.id}
                  entry={entry}
                  selected={entry.id === termId}
                  /* Whichever scores the list is ordered by are shown on
                     every row. An order the reader chose but cannot see the
                     basis of is the thing the objection to these scores was
                     actually about — and a default order they did not
                     choose needs it more, not less. */
                  showScore={order}
                  /* An unscored entry got here without clearing anything, and
                     in an unheaded list a row with no numbers otherwise reads
                     as though it had. A `title` and nothing visible: stage 1 of
                     the plan found no unscored entry in any data we hold, and a
                     badge would be furniture for a state nobody has. */
                  unscored={order === "prioritised" && priorityOf(entry) === undefined}
                  /* **`false` for a visitor, because a visitor's payload
                     cannot say.** It carries no `stale` and is not going to —
                     see the prop — so the two claims this gates are withheld
                     from a shared link rather than made on an assumption. The
                     button is not drawn for a visitor at all, so what they lose
                     is one sentence on a row with no occurrences. */
                  occurrencesFitTheArticle={owner ? !owner.stale : false}
                  /* `null` for a visitor, and the button is not drawn: a
                     lookup is a model call somebody pays for, and the
                     answer it keeps is the owner's own research. */
                  look={owner?.look ?? null}
                  looking={owner?.looking === entry.id}
                  lookBusy={(owner?.looking ?? null) !== null}
                  lookDraft={owner?.lookDraft?.id === entry.id ? owner.lookDraft.text : null}
                  /* The failure belongs to the request's entry, not whichever
                     row the reader selected while that request was running. */
                  lookFailed={
                    owner?.lookFailed?.id === entry.id ? owner.lookFailed.message : null
                  }
                  onSelect={() => {
                    // Pressing the selected term again clears it, which is
                    // what takes the underlines back out of the prose.
                    // There is no other affordance for that, and a
                    // selection you cannot cancel is a mode inside a mode.
                    if (entry.id === termId) return onTerm(null);
                    onTerm(entry.id);
                    const first = entry.blocks[0];
                    if (first) onJump(first);
                  }}
                  onJump={onJump}
                />
              ))}
            </ol>
          </div>
        </>
      )}
    </ModeSurface>
  );
}

/**
 * The list the panel draws — document, one of the two scores, or prioritised.
 *
 * Descending on both scores, because "hardest first" and "most central first"
 * are the questions people actually have — nobody opens a glossary looking for
 * the easiest word in it. A missing score sorts last rather than as zero: an
 * entry the model declined to score is not an entry it scored as trivial, and
 * treating the two the same is the small lie that makes a sort untrustworthy.
 *
 * **`prioritised` is the one that returns fewer entries than it was given.** It
 * is not a sort at all any more: it is first-use order with what is below the
 * bar taken out, which is the whole of the 2026-09-03 change. One call to
 * `visibleEntries`, so what this returns and what the count beside the slider
 * says cannot come apart.
 *
 * Pure and exported, because it is the only part of this file with a right
 * answer — see the `sortEntries` block of tests/glossary.test.ts.
 */
export function sortEntries(
  entries: GlossaryEntry[],
  sort: TermSort,
  gate = PRIORITY_GATE,
): GlossaryEntry[] {
  if (sort === "document") return entries;
  if (sort === "prioritised") return visibleEntries(entries, gate).visible;
  const value = (entry: GlossaryEntry): number | undefined =>
    sort === "difficulty" ? entry.difficulty : entry.centrality;
  return [...entries]
    .map((entry, i) => ({ entry, i, score: value(entry) }))
    .sort((a, b) => {
      if (a.score === undefined && b.score === undefined) return a.i - b.i;
      if (a.score === undefined) return 1;
      if (b.score === undefined) return -1;
      // The index tie-break keeps document order inside a group of equal
      // scores, so the list does not reshuffle for no visible reason.
      return b.score === a.score ? a.i - b.i : b.score - a.score;
    })
    .map((x) => x.entry);
}

/* ------------------------------------------------------------ prioritised --
   The default order, added 2026-08-26 at Greg's request:

   > let's add a "Prioritised" order (that should be the default) that somehow
   > takes into account importance, centrality, and order.

   and given a bar the reader can move, later the same day:

   > Add a small threshold-slider to the Glossary UI (set to a sensible default)

   The whole design is in docs/plans/260826b-glossary-prioritised-order.md. The four
   things worth having in front of you while reading this code:

   1. **The two scores multiply, they do not add.** What the reader wants
      ordered is the cost of *not* knowing a term, which is "how likely it is to
      stop me" times "how much of the argument stops with it". A sum gets both
      ends wrong: a very central, very easy word ("attention", in a piece about
      attention) scores high and needs no priority, and a very hard, very
      peripheral one scores high and is exactly the distraction a priority list
      exists to keep off the top.

   2. **A product of two noisy 0–1 model scores groups well and ranks badly.**
      Models emit clumped scores, so a continuous composite invents distinctions
      that are not in the data. So the product decides one thing — shown, or
      hidden — and the order of what is shown is first use, which is the
      reader's own order and not a judgment at all.

   3. **The one number in it is the reader's to set.** `PRIORITY_GATE` was
      always described in this file as a guess with no feedback loop behind it.
      The slider is the feedback loop: the guess is now a starting position
      rather than a verdict, it is on screen with its own value beside it, and
      moving it is one drag.

   4. **Nothing it does is silent.** When the gate hides nothing, the foot line
      says so in words rather than the reader having to infer it from an
      unchanged list. What the order does *not* do is drop out of itself; see
      `effectiveSort` for why the slider reverses that argument.

   5. **It hides rather than groups**, from 2026-09-03 — Greg's call, having
      read the two-group version. threshold.ts holds the rule and the argument. */

/**
 * The gate's **starting** position: `difficulty × centrality`, both required.
 *
 * `0.30` is about `0.6 × 0.5` — the model called it more than half load-bearing
 * *and* more than half likely to stop you. On the one real glossary we have it
 * keeps two terms of eight, which is the size of list this is aiming at.
 *
 * An **absolute** starting point rather than a relative "top third",
 * deliberately, and the reason is what each does when it is wrong. If the
 * model's scores run hot or cold, an absolute gate degenerates to hiding
 * nothing — that is, to plain first-use order, which is what this list did
 * before. A relative gate would hide exactly two thirds whatever the scores
 * said, which is inventing a ranking that is not in the data.
 *
 * It is a default rather than a constant now: `?gate=` overrides it, and the
 * parameter deliberately has no default of its own so that "absent" keeps
 * meaning *nobody has touched this*. See `gateParam` in params.ts.
 */
export const PRIORITY_GATE = 0.3;

/**
 * How far the slider moves in one step, and therefore how precise `?gate=` gets.
 *
 * `0.01` because the whole usable range is short — a product of two scores the
 * model rarely puts above 0.8 apiece lands under 0.7 — so a coarser step would
 * skip past the boundary the reader is hunting for. Two decimal places is also
 * exactly what `gateParam` serializes, so what you drag to is what the URL says.
 */
export const GATE_STEP = 0.01;

/** How many steps span 0-1, and therefore the grid `?gate=` is written on. */
const GATE_STEPS = Math.round(1 / GATE_STEP);

/**
 * **The largest position of the slider at or below a score.**
 *
 * One helper for both ends of the feature — the top of the track (`gateMax`)
 * and the gate that reveals a term (`gateToReveal`) — because they have to
 * agree: `canPrioritise` is derived from the first and would otherwise offer an
 * order the second could not act on.
 *
 * **The arithmetic has to survive binary floating point, and the obvious
 * spelling does not.** `Math.floor(score / GATE_STEP)` loses a whole step
 * wherever the quotient lands a hair under an integer — `0.58 / 0.01` is
 * `57.99999999999999` and `0.57 / 0.01` is `56.99999999999999` — so a term
 * scored `0.57` got a track ending at `0.56`, which is a position above its own
 * score, and a reveal gate a step lower than the reader asked for. So: round
 * the quotient to a sane number of places *before* flooring, and divide by 100
 * rather than multiplying by `0.01`, since `57 * 0.01` is `0.5700000000000001`
 * and `57 / 100` is exactly the double `0.57` that `gateParam` round-trips.
 *
 * Never above its argument, which is the property the two callers lean on: the
 * term a number was computed from always survives that number.
 */
export function floorToGateStep(score: number): number {
  const steps = Math.floor(Math.round((score / GATE_STEP) * 1e9) / 1e9);
  return steps / GATE_STEPS;
}

/** `difficulty × centrality`, or nothing at all if either is missing. */
export function priorityOf(entry: GlossaryEntry): number | undefined {
  if (entry.difficulty === undefined || entry.centrality === undefined) return undefined;
  return entry.difficulty * entry.centrality;
}

/**
 * The bar applied to the glossary, once: the terms to draw, and how many went.
 *
 * **Everything the panel prints comes out of this one result** — the list, the
 * `N of M` beside the slider, the foot line, and whether the list is empty. A
 * count that disagrees with the list under it is the failure the shared module
 * exists to make impossible; see threshold.ts for the argument and for why an
 * unscored entry survives every position of the bar.
 */
export function visibleEntries(
  entries: readonly GlossaryEntry[],
  gate: number,
): ThresholdResult<GlossaryEntry> {
  return applyThreshold(entries, gate, priorityOf);
}

/**
 * Can this glossary be prioritised **at all** — is there anything to gate?
 *
 * **Does the top of the track hide something.** That is the question, and the
 * reason it is phrased against the track rather than against the scores is the
 * grid: the slider can only stop on a hundredth (`GATE_STEP`) and the track
 * ends at the top score floored to one (`gateTop`), so two distinct scores are
 * not enough on their own. Priorities of `0.501` and `0.509` differ, and every
 * position the reader can reach — including the far right, `0.50` — shows both.
 * Scores that all round down to `0.00` are the same case from the other end.
 * Offering a prioritised order there draws a slider that visibly does nothing,
 * which is the exact state this question exists to prevent, and it is what the
 * first version of this predicate did (GPT Sol's review, 2026-09-03).
 *
 * It used to be *one score and something to compare it against*, which was
 * right while the leftovers formed a visible second group; then *two distinct
 * scores*, which was right about the unscored and wrong about the grid.
 * `[0.90, unscored]` was true under the first, because the unscored entry was
 * "the rest"; now the unscored entry always survives and nothing the reader can
 * do hides anything.
 *
 * Note what this is *not*: it is not "does the current gate hide anything",
 * which is a question about one position of the bar. Offering the order is the
 * first question — and a bar that happens to hide nothing right now is one drag
 * from hiding something, which is why `effectiveSort` does not fall back on it.
 * `gateTop` and not `gateMax` for the same reason: an off-range `?gate=` in a
 * link is folded into the *track* so the thumb has somewhere to sit, but it must
 * not be what decides whether the order exists.
 */
export function canPrioritise(entries: readonly GlossaryEntry[]): boolean {
  const top = gateTop(entries);
  for (const entry of entries) {
    const p = priorityOf(entry);
    if (p !== undefined && p < top) return true;
  }
  return false;
}

/**
 * The right-hand end of the slider **as the data alone decides it**: the largest
 * product this glossary contains, floored to a position the slider can stop on.
 * Zero when nothing is scored, or when every score is under one hundredth.
 *
 * Split out from `gateMax` below because `canPrioritise` must ask this one and
 * not that one — neither the current `?gate=` nor the one-step floor on the
 * rendered track is a fact about the glossary. See there.
 *
 * Derived from the data rather than fixed at 1.00, because a fixed track would
 * be mostly dead. Real products cluster low — two scores of 0.7 make 0.49 — so
 * on a 0–1 track the top two thirds would show every glossary in full and every
 * one would be adjusted in the same narrow strip at the left. Ending the track
 * at the top term's own score means both ends mean something: hard left shows
 * everything, hard right shows exactly the costliest term (plus any the model
 * did not score, which survive everywhere — threshold.ts).
 *
 * Rounded **down** to the step, not up, through `floorToGateStep` and its
 * floating-point care. Products overshoot — `0.8 × 0.8` is `0.6400000000000001`
 * — and a maximum a whisker above the top term's score is a right-hand end that
 * hides the costliest term too, which is the one thing that end must not do. It
 * is also what `canPrioritise` leans on: because the track's top always shows
 * the top term, a glossary whose scores all sit within one step of the top has
 * no position of the bar that hides anything.
 *
 * `gateMax` folds in the current `gate` on top of that, so a `?gate=` beyond
 * this glossary's range still has somewhere to sit on the track rather than
 * pinning the thumb at a number it does not hold. A link like that can still
 * hide the top term — deliberately: the value the reader was sent stands, and
 * the all-hidden foot line says so and says the way back.
 */
export function gateTop(entries: readonly GlossaryEntry[]): number {
  let top = 0;
  for (const entry of entries) {
    const p = priorityOf(entry);
    if (p !== undefined && p > top) top = p;
  }
  return floorToGateStep(top);
}

export function gateMax(entries: readonly GlossaryEntry[], gate: number): number {
  /* One step at least, so an unscored glossary still has a track to render
     rather than a zero-width one. The slider is not drawn for it anyway, and
     the floor is deliberately *not* in `gateTop`: it is a fact about rendering
     an input, and letting it into the data-derived top would make
     `canPrioritise` answer true for a glossary whose every score rounds to
     `0.00` — a list where the only thing the track can do is show all or hide
     all, which is exactly the no-op the question is there to refuse. */
  return Math.max(gateTop(entries), gate, GATE_STEP);
}

/**
 * The gate that would put this term on screen, or null if nothing should move.
 *
 * **"In the glossary" on a prose hover card is a deliberate request to reveal a
 * term**, and it writes `?term=`. Once the bar hides rather than groups, doing
 * only that on a below-bar term opens the band on nothing at all — the panel
 * has been asked to select a row it is not drawing. So `App.tsx` lowers the
 * gate to the term's own priority first.
 *
 * **Lowering rather than dropping to `document` order**, so the reader stays in
 * the order they chose, and the slider moves visibly: nothing is done behind
 * their back.
 *
 * **Only in the order that has a gate**, which is why this takes the sort and
 * the whole list rather than one entry. `?sort=document&gate=0.80` is a gate
 * nothing is hiding anything with — no slider is on screen — and lowering it
 * there would set a threshold the reader never chose and never saw, waiting for
 * them the next time they pick prioritised. `effectiveSort` and not `sort`, so
 * a glossary that falls back out of prioritised is left alone too. GPT Sol's
 * third finding on the built code, 2026-09-03.
 *
 * Floored to the step, never rounded, through `floorToGateStep`. `gateParam`
 * serialises two decimal places, so a priority of `0.615` written out as `0.62`
 * would come back as a gate *above* the term it was set to reveal — which is
 * the one value it must not be. The same helper, and therefore the same grid,
 * as `gateTop` above.
 */
export function gateToReveal(
  entries: readonly GlossaryEntry[],
  id: string,
  sort: TermSort,
  gate: number,
): number | null {
  if (effectiveSort(entries, sort) !== "prioritised") return null;
  const entry = entries.find((e) => e.id === id);
  const p = entry ? priorityOf(entry) : undefined;
  if (p === undefined || survivesThreshold(p, gate)) return null;
  return floorToGateStep(p);
}

/**
 * The order actually in force, which is not always the one in the URL.
 *
 * `?sort=prioritised` is the default, so it arrives on glossaries with no
 * scores at all — nothing to gate, no slider worth showing, and a label that
 * would claim a judgment nothing supports. Those fall back to `document`, and
 * `SortBar` does not offer the control. An old glossary behaves exactly as it
 * did before this order existed.
 *
 * **What no longer falls back, as of the slider (2026-08-26):** a glossary that
 * has scores but whose *current* gate hides nothing. That used to collapse to
 * `document` too. The slider reverses the argument, in both directions:
 *
 * - it would strand the reader. Drag the bar past the top term and the mode
 *   would cancel itself, taking the slider with it, and there would be no way
 *   back to the thing you were adjusting.
 * - it would hide the mechanism at the one moment the mechanism is the answer.
 *   A list nothing is hidden from is not silent here: the bar is on screen with
 *   its number and its count, and the foot line says in words how many are
 *   hidden, including when the answer is none.
 *
 * That is a different question from `canPrioritise`, which is about the whole
 * glossary rather than one position of the bar.
 */
export function effectiveSort(entries: readonly GlossaryEntry[], sort: TermSort): TermSort {
  if (sort !== "prioritised") return sort;
  return canPrioritise(entries) ? "prioritised" : "document";
}

/**
 * The foot line: how many terms the bar is holding back, and the way back.
 *
 * Greg, 2026-09-03, having looked at the two-group version: *"I think it would
 * be clearer if it only showed the stuff above threshold (with an indication
 * below perhaps that 'N hidden because they're below the X threshold')."* So
 * *"worth knowing first"* / *"the rest"* are gone, and this sentence is what
 * replaced them.
 *
 * **Never null.** The old `gateNote` spoke only at the two ends, which made an
 * absent line ambiguous; this one is present wherever the slider is, saying
 * "Nothing is hidden" when that is the answer. A control that visibly does
 * nothing is the failure this codebase keeps writing down
 * (docs/reusable/silent-success.md).
 *
 * **It takes the counts, not the list**, so the sentence and the `N of M` above
 * it come out of the same `visibleEntries` call rather than two passes that
 * could disagree. All this adds to the shared sentence is the noun — but the
 * noun and the argument for the copy want a home in the panel that says it.
 */
export function gateNote(hidden: number, total: number): string {
  return hiddenNote(hidden, total, { one: "term", many: "terms" });
}

/** One number to put on a row, with the name of what it is. */
export interface RowScore {
  key: "difficulty" | "centrality";
  value: number;
}

/**
 * The numbers to put on a row: none, one, or both.
 *
 * **A function rather than a ternary at the call site, because the ternary was
 * wrong** and wrong in the one way this feature cannot afford. It read
 * `showScore === "difficulty" ? entry.difficulty : entry.centrality`, so a
 * `showScore` of `null` — the list in document order — fell through to the
 * `centrality` branch and printed the model's ranking beside every term in a
 * list that was not ranked by it.
 *
 * That is precisely the thing the condition on keeping these scores forbids:
 * the objection was never to the numbers existing, it was to the model's
 * prioritising arriving unasked. Found in the browser rather than by a test,
 * which is why there is now a test.
 *
 * The rule it keeps, now that a composite is involved: **a row shows exactly
 * the numbers its position was decided on, and shows none if its position could
 * not be decided on them.** So `prioritised` shows both — never the product,
 * which is our arithmetic dressed up as the model's judgment and a number the
 * reader can neither interpret nor check — and an entry missing either score
 * shows neither, which is what "this one could not be gated" looks like.
 */
/**
 * What each score measures, in the words the reader gets — in the tooltip, and
 * in the sentence a screen reader reads out of the bars' label.
 *
 * The wording is the same shape as the sort buttons' own titles, deliberately:
 * a reader who pressed *hardest* and then points at a bar should meet the same
 * sentence twice rather than two descriptions of one thing.
 */
const SCORE_LABEL: Record<RowScore["key"], string> = {
  difficulty: "Difficulty — how likely this term is to stop a reader",
  centrality: "Centrality — how much of the argument rests on it",
};

export function rowScores(entry: GlossaryEntry, sort: TermSort | null): RowScore[] {
  const d = entry.difficulty;
  const c = entry.centrality;
  if (sort === "difficulty") return d === undefined ? [] : [{ key: "difficulty", value: d }];
  if (sort === "centrality") return c === undefined ? [] : [{ key: "centrality", value: c }];
  if (sort === "prioritised") {
    if (d === undefined || c === undefined) return [];
    return [
      { key: "difficulty", value: d },
      { key: "centrality", value: c },
    ];
  }
  return [];
}

/* ------------------------------------------------------- what an entry says --
   Rewritten 2026-08-26. Greg, looking at the entry for a person the article
   quotes once:

   > it's pretty weak! It adds almost nothing to the user's knowledge of Leslie
   > Lamport, nor does it add any useful explanatory gloss to help understand
   > the article itself. […] And "Goes beyond what the article says" is
   > vague/confusing - either be clearer, or indicate in the glossary entry
   > itself clearly […] which bits are/not from the article.

   Both halves of that have the same answer, and it is a field split rather
   than a better badge. See docs/plans/260826d-glossary-entries-worth-reading.md. */

/** One labelled section of an open entry. The label IS the provenance. */
export interface ProseSection {
  key: "senseHere" | "background";
  label: string;
  text: string;
}

export interface EntryProse {
  /** The one line a closed row shows. Empty only for an entry we would not store. */
  lead: string;
  /** The open row, labelled. Empty for an entry written before `glossary/2`. */
  sections: ProseSection[];
  /** True when this entry has the old single blended field and renders the old way. */
  legacy: boolean;
}

/**
 * What to put on a row, and under which label.
 *
 * **The lead is `senseHere` if there is one and `background` if there is not**,
 * and that single line is what makes the design self-correcting. The model is
 * told to leave `senseHere` out rather than restate a page the reader is
 * looking at — so for a person simply quoted it writes background only, and the
 * informative sentence is the one that reaches the closed row. The panel never
 * has to know what kind of term it is looking at.
 *
 * **Old entries render exactly as they did.** `glossary/1` wrote one `gloss`
 * that blended what the article means with what the model knows, and there is
 * no honest way to label a blend — putting it under "in this piece" would
 * attribute the model's own knowledge to the article, which is the one
 * direction of error this whole change exists to prevent. So it stays
 * unlabelled, keeps its `detail` and its warning badge, and stops being a
 * problem the moment somebody presses "Find them again" — which the panel is
 * already offering, because bumping the prompt version made every old glossary
 * read as stale.
 */
export function entryProse(entry: GlossaryEntry): EntryProse {
  const sections: ProseSection[] = [];
  if (entry.senseHere) {
    sections.push({ key: "senseHere", label: "in this piece", text: entry.senseHere });
  }
  if (entry.background) {
    sections.push({ key: "background", label: "background", text: entry.background });
  }
  if (sections.length === 0) {
    return { lead: entry.gloss ?? "", sections: [], legacy: true };
  }
  return { lead: sections[0]!.text, sections, legacy: false };
}

/** Which sorts this particular glossary can actually offer. */
function SortBar({
  entries,
  sort,
  onSort,
}: {
  entries: GlossaryEntry[];
  sort: TermSort;
  onSort(sort: TermSort): void;
}) {
  const options: { key: TermSort; label: string; title: string }[] = [
    /* Offered when some position of the bar would hide something — the same
       rule the two score sorts below follow, which is that a control that would
       visibly do nothing is worse than one that isn't there. It is a question
       about the whole glossary, not about where the bar happens to be: a bar
       that hides nothing right now is one drag from hiding something, and an
       option that appeared and vanished under the reader's hand mid-drag would
       be worse than either. See `canPrioritise` and `effectiveSort`. */
    ...(canPrioritise(entries)
      ? [
          {
            key: "prioritised" as const,
            label: "prioritised",
            title:
              "Only the hard and load-bearing terms, in the order the article introduces them — the threshold below decides how many",
          },
        ]
      : []),
    {
      key: "document",
      label: "first use",
      title: "In the order the article introduces them",
    },
    ...(entries.some((e) => e.difficulty !== undefined)
      ? [
          {
            key: "difficulty" as const,
            label: "hardest",
            title: "The model's judgment of how likely each term is to stop a reader",
          },
        ]
      : []),
    ...(entries.some((e) => e.centrality !== undefined)
      ? [
          {
            key: "centrality" as const,
            label: "most central",
            title: "The model's judgment of how much of the argument rests on each term",
          },
        ]
      : []),
  ];
  if (options.length < 2) return null;

  return (
    /* biome-ignore lint/a11y/useSemanticElements: <fieldset> is for form
       controls and wants a <legend>; these are three toggle buttons that
       change how a list is ordered, and `role="group"` with an accessible name
       is exactly what ARIA has for that. */
    <div className="gloss-sort" role="group" aria-label="Order the terms by">
      <span className="gloss-sort-label">order</span>
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          className={`gloss-sort-btn${sort === option.key ? " on" : ""}`}
          aria-pressed={sort === option.key}
          title={option.title}
          onClick={() => onSort(option.key)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The bar itself, with the reader's hand on it.
 *
 * Greg, 2026-08-26: *"Add a small threshold-slider to the Glossary UI (set to a
 * sensible default)"*. The sensible default is `PRIORITY_GATE`, and everything
 * else here is about the slider not being a mystery dial:
 *
 * - **the number is on screen**, because `0.42` is meaningless as a thumb
 *   position and meaningful as a product of two scores the rows also show;
 * - **the count is on screen**, `2 of 8`, which is the thing the reader
 *   actually cares about and the only feedback that survives a drag that does
 *   not happen to move anybody;
 * - **the track ends where the data does** (`gateMax`), so no part of it is
 *   dead and both ends mean something;
 * - **it says how many it is holding back** (`hiddenNote`), in every state
 *   including none and all, which is the silent-success failure this codebase
 *   keeps catching itself in;
 * - **it can be put back**, without the reader having to remember 0.30.
 *
 * A native `<input type="range">` rather than anything built: it is draggable,
 * arrow-key steppable, announced by screen readers and touch-friendly for free,
 * and `accent-color` is the whole of the styling it needs.
 */
function GateSlider({
  entries,
  gate,
  moved,
  onGate,
}: {
  entries: GlossaryEntry[];
  gate: number;
  moved: boolean;
  onGate(gate: number | null): void;
}) {
  /* **One pass, and every number here comes out of it.** The list above, the
     `N of M` and the foot line have to agree, and the way they cannot disagree
     is for there to be one result rather than a filter beside a counter. */
  const { visible, hiddenCount } = visibleEntries(entries, gate);
  const note = gateNote(hiddenCount, entries.length);
  const count = `${visible.length} of ${entries.length}`;

  return (
    <div className="gloss-gate">
      <div className="gloss-gate-row">
        <label className="gloss-gate-label" htmlFor="gloss-gate">
          threshold
        </label>
        <span className="gloss-gate-value">
          {gate.toFixed(2)} · {count}
        </span>
        {/* Only once there is something to undo. A reset that is always there
            is a permanent invitation to a state you are already in. */}
        {moved && (
          <button
            type="button"
            className="gloss-gate-reset"
            title={`Back to ${PRIORITY_GATE.toFixed(2)}`}
            aria-label={`Reset the threshold to ${PRIORITY_GATE.toFixed(2)}`}
            onClick={() => onGate(null)}
          >
            <RotateCcw size={11} />
          </button>
        )}
      </div>
      <input
        id="gloss-gate"
        className="gloss-gate-range"
        type="range"
        min={0}
        max={gateMax(entries, gate)}
        step={GATE_STEP}
        value={gate}
        title="How high a term has to score to stay on screen: the model's difficulty × its centrality. Left shows more terms, right fewer."
        /* The thumb's position is a number nobody can hear. This is what makes
           it audible, and it is the count rather than the product because the
           count is what the reader is aiming at. **"showing", not
           "promoting"** — an unscored term is shown without being promoted. */
        aria-valuetext={`${gate.toFixed(2)}, showing ${count} terms`}
        onChange={(e) => onGate(Number.parseFloat(e.target.value))}
      />
      {/* Always, never conditionally: present wherever the slider is, absent
          wherever it is not. A line that is sometimes missing for a *different*
          reason teaches the reader nothing, and an empty list under a slider is
          otherwise ambiguous between "there is nothing here" and "you have
          hidden it all". */}
      <p className="gloss-gate-note">{note}</p>
    </div>
  );
}

/**
 * One term. Closed it is a name and a line; open it is everything we have.
 *
 * The whole entry is a button rather than a name-sized one, because the target
 * in an 18rem band wants to be as big as it can be, and there is nothing else
 * inside a closed row to click.
 */
function Term({
  entry,
  selected,
  showScore,
  unscored,
  occurrencesFitTheArticle,
  look,
  looking,
  lookBusy,
  lookDraft,
  lookFailed,
  onSelect,
  onJump,
}: {
  entry: GlossaryEntry;
  selected: boolean;
  showScore: TermSort | null;
  /**
   * This row survived the bar without being scored, so say so — quietly.
   *
   * A `title` and nothing visible. GPT Sol suggested a restrained label *or* a
   * tooltip; the tooltip alone is what stage 1's diagnosis supports, since no
   * unscored entry was found in any data we can inspect. It reveals no
   * composite score, so the rule that only the model's raw numbers reach the
   * screen still holds.
   */
  unscored: boolean;
  /**
   * **We know that this list was written against the article on screen**, so
   * what it says about where a term is used describes what the reader can see.
   *
   * It gates the two claims this row makes out of `entry.blocks`: that the
   * article does not use these words, and that checking them on the web is
   * therefore impossible. `entry.blocks` was computed against whichever
   * extraction the list was written for — a glossary is carried into every new
   * revision — so where the list is stale an empty one says nothing at all
   * about the article in front of the reader. Saying it anyway is the bug this
   * row was reported for, one revision along.
   *
   * **Positive, and `false` where the answer is unknown rather than no.** A
   * visitor's payload carries no freshness at all and deliberately cannot: the
   * public graph may not reach `isStale` (tests/public-imports.test.ts), and a
   * visitor could not act on the answer anyway. Phrased as `stale` with a
   * `?? false` default, *not knowing* silently licensed the claim; phrased this
   * way it withholds it, which costs a visitor one explanatory sentence on the
   * rows that have no occurrences and buys them never being told the words in
   * front of them are absent. GPT Sol, 2026-09-04, both rounds.
   */
  occurrencesFitTheArticle: boolean;
  /** `null` for a visitor: there is no button, because there is nothing to spend. */
  look: ((id: string) => Promise<void>) | null;
  /** A lookup is running for *this* term. */
  looking: boolean;
  /** A lookup is running for some term — one at a time, so every button waits. */
  lookBusy: boolean;
  /** This term's lookup as it arrives, or what arrived before it broke. */
  lookDraft: string | null;
  lookFailed: string | null;
  onSelect(): void;
  onJump(id: BlockId): void;
}) {
  const scores = rowScores(entry, showScore);
  const prose = entryProse(entry);

  /**
   * **The article does not use any of this term's names**, and we are in a
   * position to say so.
   *
   * Two conditions, and the second is the one that was missing. No recorded
   * occurrence *and* a list we know was written against this article: only then
   * is an empty `entry.blocks` a statement about the article rather than about
   * the list. See `occurrencesFitTheArticle`. Server-side the same distinction
   * chooses between `[gl-not-quoted]` and `[gl-stale]` (src/term-lookup.ts).
   */
  const unquoted = entry.blocks.length === 0 && occurrencesFitTheArticle;

  /**
   * Which occurrence the ‹ › stepper is on, for this term.
   *
   * Local to the row, so it resets when the reader selects a different term —
   * which is right, because "3 of 5" would otherwise mean a place in a list
   * that is no longer on screen. It survives collapsing and re-opening the same
   * row, which is also right: coming back to a term you were part-way through
   * should not send you to the top of the article.
   *
   * A block id is a usable identity **here and not in the ideas panel**, and
   * the difference is worth knowing: `entry.blocks` is computed by
   * `findOccurrences`, which pushes each block at most once, so the ids are
   * unique. An idea's occurrences are quoted passages and two of them can sit
   * in one paragraph, which is why that side keys on `Found.key` instead.
   */
  const [atBlock, setAtBlock] = useState<BlockId | null>(null);

  return (
    <li
      className={`gloss-term${selected ? " on" : ""}`}
      /* Which entry this row is, for the one reader that has to find it from
         outside the panel: G from a paragraph puts the focus here (TermJump.tsx). */
      data-term-id={entry.id}
      {...(unscored && {
        title: "Not scored for prioritising — shown regardless of the threshold",
      })}
    >
      <button
        type="button"
        className="gloss-term-btn"
        aria-expanded={selected}
        onClick={onSelect}
      >
        <span className="gloss-term-head">
          <span className="gloss-name">{entry.name}</span>
          {/* Not shown for `term`, which is the default and says nothing. The
              chip earns its space when it tells you this is a person or a book
              rather than a piece of vocabulary. */}
          {entry.kind !== "term" && entry.kind !== "other" && (
            <span className="gloss-kind">{entry.kind}</span>
          )}
          {/* One number under `hardest` or `most central`, both under
              `prioritised`, none in first-use order. Never the product: that is
              our arithmetic, not the model's judgment, and a number the reader
              can neither interpret nor check is the thing the condition on
              keeping these scores was written against. */}
          {/* **Drawn, not printed, since 2026-08-31** — Greg: *"Prefer to use UI
              (e.g. a little sparkline/bar rather than numbers) plus tooltip
              instead of numbers ... Same goes for Glossary etc."*

              `d·72 c·85` was read rather than skimmed, and it was competing for
              an 18rem row with the term and its gloss. A bar is a length, and
              lengths compare down a column without being parsed. The numbers
              are in the tooltip and in the bars' `aria-label`, so nothing is
              lost — and the rule this panel is built around still holds
              exactly: a row shows the scores its position was decided on, and
              never the product it was gated on. src/web/ScoreBars.tsx, shared
              with QuotesPanel so the two cannot drift into two treatments of
              one idea. */}
          <ScoreBars
            className="gloss-score"
            scores={scores.map((s) => ({ key: s.key, label: SCORE_LABEL[s.key], value: s.value }))}
          />
        </span>
        {/* Hidden while the entry is open, because the open state shows the
            same words again with a label on them. One line closed, the labelled
            structure open — no sentence appears twice, and the label does the
            provenance work rather than a badge underneath it. */}
        {!selected && <span className="gloss-gloss">{prose.lead}</span>}
      </button>

      {selected && (
        <div className="gloss-open">
          {/* Labelled sections, and the label is the whole provenance story:
              everything under "in this piece" is from the article, everything
              under "background" is the model's own knowledge. That is the
              answer to "which bits are/not from the article" — all of this one,
              none of that one — and it needs no marks inside the prose, which
              would mean markup in a stored string and a restricted renderer to
              show it. See the plan doc for why inline marking was rejected. */}
          {prose.sections.map((section) => (
            <div key={section.key} className={`gloss-part gloss-part-${section.key}`}>
              <p className="gloss-part-label">
                {section.label}
                {section.key === "background" && (
                  <Tooltip
                    content="The article doesn't say this — it's what the model knows about the term. Nothing here has been checked against a source."
                    placement="top"
                  >
                    <span
                      className="gloss-part-hint"
                      /* The same call CommentDialog's search badge makes, and for the
                         same reason: without it the only way to read this caption is
                         to hover it, so removing the tabIndex would take accessibility
                         away rather than add it. */
                      // biome-ignore lint/a11y/noNoninteractiveTabindex: focus opens the tooltip
                      tabIndex={0}
                      role="note"
                      aria-label="Where this section comes from"
                    >
                      <Info size={10} />
                    </span>
                  </Tooltip>
                )}
              </p>
              <p className="gloss-part-text">{section.text}</p>
              {/* The canonical link lives INSIDE the background section, because
                  checking the background is the only thing it is for. It is the
                  model's guess at a page rather than a source it visited — the
                  glossary call does not search — which is what the tooltip
                  says. */}
              {section.key === "background" && entry.url && (
                /* `rel="noreferrer"` as well as `noopener`: the article's own
                   URL is a reading history, and a model-supplied link should not
                   be handed ours as a referrer. The scheme was checked
                   server-side — `safeUrl` in src/glossary.ts — because a
                   `javascript:` href here would be a script injection with a
                   very short path. */
                <p className="gloss-link">
                  <Tooltip content={`Where to check this: ${entry.url}`} placement="top">
                    <a href={entry.url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink size={11} />
                      {hostOf(entry.url)}
                    </a>
                  </Tooltip>
                </p>
              )}
            </div>
          ))}

          {/* What the web said, kept apart from what the model remembered. The
              two are never merged: a reader who cannot tell the checked answer
              from the recalled one has lost the thing the labels above exist to
              give them. */}
          <Looked
            entry={entry}
            look={look}
            looking={looking}
            busy={lookBusy}
            unquoted={unquoted}
            draft={lookDraft}
            failed={lookFailed}
          />

          {entry.aliases.length > 0 && (
            <p className="gloss-aliases">also: {entry.aliases.join(", ")}</p>
          )}

          {/* Everything from here to the occurrence list is `glossary/1` only —
              one blended field, its paragraph, its badge and its bare link. Kept
              rendering rather than migrated, because a blend cannot be labelled
              honestly. `entryProse` says why. */}
          {prose.legacy && entry.detail && <p className="gloss-detail">{entry.detail}</p>}

          {prose.legacy && entry.fromOutside && (
            <p className="gloss-outside">
              <TriangleAlert size={11} />
              Goes beyond what the article says.
            </p>
          )}

          {prose.legacy && entry.url && (
            <p className="gloss-link">
              <a href={entry.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={11} />
                {hostOf(entry.url)}
              </a>
            </p>
          )}

          {/* Where the piece actually uses it. An empty list is not hidden: it
              means the model named a term this article does not use in those
              words, which is worth seeing rather than smoothing over. */}
          {entry.blocks.length > 0 ? (
            <p className="gloss-where">
              <span className="gloss-where-label">
                {entry.blocks.length === 1 ? "used in" : `used in ${entry.blocks.length} places`}
              </span>
              {entry.blocks.map((id) => (
                <BlockRef key={id} id={id} onJump={onJump} />
              ))}
              {/* Greg, 2026-08-26: *"a way in both Ideas and Glossary modes to
                  jump to prev/next exemplifying block"*. The chips have always
                  been able to take you to any one of them; what was missing was
                  moving *along* without going back to the panel to aim. Returns
                  nothing for a single occurrence. */}
              <BlockNav
                targets={entry.blocks.map((id) => ({ id, blockId: id }))}
                /* **`?? entry.blocks[0]`, and that is not a default — it is
                   where the reader actually is.** Selecting a term jumps to its
                   first use (see `onSelect` above), so by the time this control
                   is on screen they are standing on occurrence one. Without the
                   fallback the counter read "– / 3" beside a highlighted first
                   use, and the reader's first press of › appeared to do nothing
                   because it moved them to the passage they were already
                   looking at.

                   Derived rather than seeded into `atBlock` by an effect: there
                   is no state to get out of step, and "nothing stepped to yet"
                   and "on the first" are the same fact here precisely because
                   selecting jumps. Ideas reaches the same place from the other
                   end, by opening the first passage as it goes to it.
                   Confirmed in a browser, 2026-08-27. */
                currentId={atBlock ?? entry.blocks[0] ?? null}
                onGo={(id, blockId) => {
                  setAtBlock(id as BlockId);
                  /* Nudge rather than jump: stepping between neighbours should
                     leave a reader alone when the next one is already in front
                     of them. Pressing a chip above still always moves. */
                  nudgeTo(blockId, onJump);
                }}
                noun="use"
              />
            </p>
          ) : (
            /* **`unquoted`, not `entry.blocks.length === 0`.** Unless we know
               the list was written against this article, an empty occurrence
               list is a fact about some other extraction, and this sentence is a
               claim about the article on screen — so it is not ours to make. For
               an owner the stale banner at the top of the panel is already
               saying the true thing, and a second sentence here would be that
               banner said twice; a visitor gets no banner and no claim either,
               which is the honest end of a payload that carries no freshness.

               The last clause is why the Check-the-web button above is
               disabled, and it is said here rather than beside the button so it
               is said once. src/messages.ts § `GLOSSARY_TERM_NOT_QUOTED`. */
            unquoted && (
              <p className="gloss-nowhere">
                These exact words do not appear in the article. The definition may still be right;
                the term was named rather than quoted — but there is no passage to check it
                against on the web.
              </p>
            )
          )}
        </div>
      )}
    </li>
  );
}

/**
 * **A box that finds a term in the article and explains it.**
 *
 * Asked for, in these words:
 *
 * > I would like to be able to type into a search box in the glossary for a
 * > particular term and for it to look for that term and add it to the
 * > glossary. And maybe it should be a tiny bit robust in the spelling or
 * > something if I type it wrong.
 * >
 * > — a reader, 2026-09-04, `[SPIDERYARN-READING2-Y]`
 *
 * Two things it deliberately does not do, and the hint under the box says the
 * first one out loud rather than letting the reader find out:
 *
 * - **It adds nothing to the list.** The glossary is one JSON document that a
 *   *Find more terms* run rewrites and that a shared link publishes whole, so a
 *   reader-added entry would be merged away by the first and handed to
 *   strangers by the second — src/types.ts § `AskedTermAnswer`. Saying "not
 *   added to the list" in the hint is what stops the answer's disappearance
 *   from reading as a bug.
 * - **It does not correct spelling.** The tolerance is `term-match.ts`'s
 *   folding of case, plurals and possessives, and no more. When it finds
 *   nothing there is **no "did you mean…"**: it says which of three things it
 *   established and offers chat, which may answer from outside the piece.
 *
 * **The refusal is the server's own sentence, verbatim**, and it carries a
 * `[gl-ask-…]` code. Three of them, because there are three facts —
 * docs/postmortems/260904c-the-glossary-said-the-term-was-not-there.md is what
 * a single sentence over several causes costs, and it was written about this
 * exact code path the day before.
 */
function AskATerm({
  owner,
  onJump,
  onAskChat,
}: {
  owner: UseGlossary;
  onJump(id: BlockId): void;
  onAskChat?: ((term: string) => void) | undefined;
}) {
  const [term, setTerm] = useState("");
  const { ask, asking, askDraft, asked, askFailed, askTerm, clearAsked } = owner;

  return (
    <div className="gloss-ask">
      <form
        className="gloss-ask-row"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(term);
        }}
      >
        {/* `type="search"`, so a phone offers the right keyboard and the browser
            draws its own clear affordance.

            `maxLength` is the server's number, and it is **not quite the
            server's rule**: this counts raw UTF-16 code units as typed, where
            `parseAskedTerm` counts them after NFC and whitespace collapsing. So
            forty decomposed `é`s plus a letter is eighty-one here and forty-one
            there — the box refuses a term the route would take. That is the
            harmless direction and it is the one an `input` can express; the
            check that matters runs on both sides. ⟨Sol⟩ */}
        <input
          className="gloss-ask-input"
          type="search"
          /* Enter submits this form, so the soft keyboard may say so. */
          enterKeyHint="search"
          value={term}
          maxLength={MAX_ASKED_TERM}
          placeholder="Look up a term…"
          aria-label="Look up a term in this article"
          onChange={(e) => {
            setTerm(e.target.value);
            /* The previous answer goes the moment the box changes. It belongs to
               a word that is no longer in it, and an answer sitting under a
               different term is the panel telling the reader something untrue.
               **Unconditionally, and that is the fix rather than the tidy-up:**
               `if (asked || askFailed)` was the first version, and during a
               request both are null — so the one moment there is something to
               disown was the one moment this did nothing, and the reply landed
               under whatever the reader had typed since. `clearAsked` bumps a
               generation for exactly this. GPT Sol's review. */
            clearAsked();
          }}
        />
        <button
          type="submit"
          className="gloss-btn"
          /* Disabled on the same rule the server refuses on, so the button is
             never a request that could only fail. Whitespace alone is an empty
             box. */
          disabled={asking || term.trim().length === 0}
          title="Finds these words in the article and explains the passage they are in. One model call."
        >
          {asking ? <LoaderCircle size={12} className="cmt-spinner" /> : <TextSearch size={12} />}
          {asking ? "Looking…" : "Look up"}
        </button>
      </form>

      {/* **The deferral, said before it is noticed.** A reader who typed a term
          and got an answer would otherwise reasonably expect a new row, and its
          absence would read as a failure rather than as the design. */}
      <p className="gloss-ask-hint">
        Finds the words in this article and explains the passage. Not added to the list.
      </p>

      {/* Until the first words land. After that the words are the progress, and
          a sentence about waiting beside them would be describing the past. */}
      {asking && !askDraft?.text && (
        <p className="gloss-look-wait">
          The whole piece goes to the model, and it may search the web as well, so this can take up
          to a minute.
        </p>
      )}

      {askFailed && (
        <div className="gloss-ask-failed">
          <p className="gloss-error">{askFailed}</p>
          {/* **The handoff, and it is a real one.** The glossary explains what
              the piece says and this word is not in the piece, so there is no
              answer here at any price. Chat is the surface that may go outside
              the article, and offering it is the difference between a dead end
              and a door.

              **Only when the article was actually searched**, which is what the
              `gl-ask-` code means. A malformed term — control characters pasted
              in, the one refusal the box's own guards do not catch — is not a
              question chat can answer either, and *"a term cannot contain
              control characters. Ask in chat"* would be the panel offering a
              door out of a typo. Read off the code rather than off the sentence,
              docs/project/copy.md § The bracketed code.

              **It carries `askTerm`, not `term`**: the word the article was
              searched for, as it was sent, rather than whatever the box holds
              when the button is pressed. Every `gl-ask-` refusal comes from the
              server, so a request was sent and `askTerm` is set whenever the
              code is — the null check is the compiler's, not a second rule. */}
          {onAskChat && askTerm !== null && codeOfMessage(askFailed)?.startsWith("gl-ask-") && (
            <button type="button" className="gloss-btn" onClick={() => onAskChat(askTerm)}>
              Ask in chat
            </button>
          )}
        </div>
      )}

      {/* **The answer as it arrives, drawn as unfinished.** Where it was found —
          the server's quote, the article's characters — and the text so far,
          with no provenance line and no sources: *checked* and the hosts it
          cited are facts of a finished answer, and this one is not finished
          until the stream says `done`. After a failure it stays under the
          failure's sentence, marked as cut short rather than quietly passed
          off as complete. docs/plans/260910g-stream-glossary-answers-as-they-arrive.md. */}
      {askDraft && !asked && (
        <div className="gloss-ask-answer">
          <p className="gloss-ask-found">
            <strong>{askDraft.quote}</strong>
            <BlockRef id={askDraft.blockId} onJump={onJump} />
          </p>
          {askDraft.text && (
            <div className="gloss-look on">
              <p className="gloss-part-label">{asking ? "arriving…" : "unfinished"}</p>
              <p className="gloss-part-text">{askDraft.text}</p>
            </div>
          )}
        </div>
      )}

      {asked && (
        <div className="gloss-ask-answer">
          {/* **The piece's own words, not the reader's.** Where they differ — a
              capital, a plural — the article wins, because that is the passage
              the model was asked about. Showing the reader's string here would
              be the panel quoting something it did not use. */}
          <p className="gloss-ask-found">
            <strong>{asked.quote}</strong>
            <BlockRef id={asked.blockId} onJump={onJump} />
          </p>
          <LookupAnswer lookup={asked.lookup} />
        </div>
      )}
    </div>
  );
}

/**
 * The web's answer for one term, or the button that asks for it.
 *
 * Greg, 2026-08-26: *"provide web citations (e.g. clickable links with
 * hover-tooltips for sources) if we're using the web"* — the conditional is
 * doing real work in that sentence, and this component is where the condition
 * becomes visible. The batch call that writes an entry **does not** search; its
 * `background` is the model's memory and its `url` is a guess at a canonical
 * page. So until somebody presses this, the honest thing to show is a button
 * rather than a badge claiming a check nobody ran.
 *
 * ## Three things it says that a simpler version would not
 *
 * **`searches: 0` is drawn, not hidden.** The model decides per call whether to
 * look anything up, so an answer with no searches is a real outcome — *I
 * already knew this* — and it is indistinguishable from a broken tool unless
 * something says which. Same call CommentDialog's search badge makes, and the
 * reason its comment gives: the absence of a search is a fact about the answer.
 *
 * **Sources are host names with the title in the tooltip.** The band is 18rem.
 * A page title is the useful thing to read and the wrong thing to lay out, so
 * the host is on the line and the title is one hover away — which is exactly
 * what was asked for, and it is `Tooltip.tsx` doing it rather than a `title=`
 * attribute, so it works on focus too.
 *
 * **The date is there.** An answer from the web is an answer about the web on
 * one day, and a lookup from a month ago is a different object from one from a
 * minute ago.
 */
function Looked({
  entry,
  look,
  looking,
  busy,
  unquoted,
  draft,
  failed,
}: {
  entry: GlossaryEntry;
  look: ((id: string) => Promise<void>) | null;
  looking: boolean;
  busy: boolean;
  /**
   * The lookup as it arrives, or what arrived before it broke — drawn as
   * unfinished, **never** as the entry's answer: no *checked* line, no
   * sources. Only the stream's `done`, sent after the save, puts a lookup on
   * the entry. docs/plans/260910g-stream-glossary-answers-as-they-arrive.md.
   */
  draft: string | null;
  /**
   * The article names this term rather than quoting it — **and the list is in a
   * position to say so.** `Term` computes it; the second half of that sentence
   * is the whole reason it is not `entry.blocks.length === 0` read here.
   */
  unquoted: boolean;
  /** **Not a `StepFailure`.** A web lookup is a request, not a job — there is
      nothing on the queue to retry and the only control the term has ever had
      is the Check-the-web button itself, which simply comes back. See
      `worthRetrying` in src/messages.ts § The two places that deliberately do
      not ask. */
  failed: string | null;
}) {
  const lookup = entry.lookup;

  if (!lookup) {
    /* **Nothing at all for a visitor**, rather than a disabled button. The
       marked-not-hidden rule is about controls a reader would otherwise go
       looking for; this one they have never seen, and a dead globe on every row
       of a list they can read perfectly well is furniture. The band's own
       sentence already tells them what a shared link does not carry. */
    if (!look) return null;
    /* **A term the article never quotes cannot be checked, and the button now
       says so before it is pressed rather than after.** A lookup is `explain`
       with a different selection: it needs a passage of the piece to anchor the
       question to, and an entry with no occurrences has none — so this button
       could only ever fail, every time, for as long as the entry exists. It
       failed with a sentence naming the term, which a reader reported as the app
       denying the entry was there (src/messages.ts § `GLOSSARY_TERM_NOT_QUOTED`).

       **`unquoted` is decided in `Term`, not here**, because it takes a second
       fact this component does not have: whether we know the list was written
       against this article. Where we do not, an empty `entry.blocks` says
       nothing, and a button disabled on the strength of it would be the same
       wrong claim in a different medium.

       **Marked, not hidden**, and the reason is the `gloss-nowhere` sentence
       further down this same entry — one place, not two. The `title` is a
       best-effort second copy of it: a disabled button does not reliably raise a
       native tooltip, which is exactly why the sentence and not the tooltip is
       where the explanation lives. Hiding the button would be the wrong call for
       the reason `worthRetrying` gives about this control — it is the only route
       a term has ever had to a lookup — and disabling it takes away nothing that
       worked. */
    return (
      <div className="gloss-look">
        <button
          type="button"
          className="gloss-btn"
          /* Disabled while any lookup runs, not just this one. Each is a model
             call somebody pays for, and a panel that fires five because five
             rows were clicked spends money on a mis-click. */
          disabled={busy || unquoted}
          title={
            unquoted
              ? "A check on the web is anchored to a passage of the article, and this term is named rather than quoted anywhere in it."
              : "One model call, with a web search if it decides it needs one. Kept afterwards."
          }
          onClick={() => void look(entry.id)}
        >
          {looking ? <LoaderCircle size={12} className="cmt-spinner" /> : <Globe size={12} />}
          {looking ? "Checking…" : "Check the web"}
        </button>
        {/* The wait needs saying, not just spinning through. This call sends the
            whole article and may run a web search on top, so it can sit for the
            better part of a minute — long enough that a bare spinner reads as
            stuck. The search panel already had this and this did not, which is
            the only reason they differed.

            "Up to a minute", not "a few seconds", which is what this said for
            about an hour. The comment directly above already said "the better
            part of a minute" — so the code and the copy disagreed in the same
            screenful, and the copy was the optimistic one. Under-promising a
            wait is the version that makes a reader think it has hung.

            Both sentences earn their place: the first says why it is slow, so
            the wait is expected rather than suspicious; the second says the
            reader can leave, which is the thing that actually makes waiting
            bearable and is true — the answer is stored against the entry, not
            held in this component, and the server finishes the lookup even if
            the reader closes the band (`streamTermLookup` in src/routes.ts).
            Same promise the search panel makes.

            Shown only until the first words land, since 2026-09-10: after that
            the words are the progress. */}
        {looking && !draft && !failed && (
          <p className="gloss-look-wait">
            The whole piece goes to the model, and it may search the web as well, so this can take
            up to a minute. You can carry on reading — the answer is saved against this term either
            way.
          </p>
        )}
        {/* The failure first, then what arrived under it — the box's order,
            for the same reason: the sentence says what the text is. */}
        {failed && <p className="gloss-error">{failed}</p>}
        {draft && (
          <div className="gloss-look on">
            <p className="gloss-part-label">
              {looking && !failed ? "arriving…" : "unfinished"}
            </p>
            <p className="gloss-part-text">{draft}</p>
          </div>
        )}
      </div>
    );
  }

  return <LookupAnswer lookup={lookup} />;
}

/**
 * **One checked answer, drawn.** The provenance line, the prose, and the hosts
 * it cited.
 *
 * Its own component since 2026-09-04, when the *Look up a term* box arrived
 * with the identical thing to draw: the box is `explain` with a phrase instead
 * of an entry, so it comes back as a `GlossaryLookup` and gets the same
 * treatment. A near-copy would have been two places to keep the "asked, not
 * checked" distinction honest, and that distinction is the one thing here that
 * a rewrite has already had to fix once.
 */
function LookupAnswer({ lookup }: { lookup: GlossaryLookup }) {
  const sources = lookup.citations.filter((c) => isWebUrl(c.url));

  return (
    <div className="gloss-look on">
      {/* **"checked" only when something was actually checked.** The model
          decides per call whether to search, so a lookup can come back with
          `searches: 0` — a real answer, and a memory one. Heading that
          "checked" and admitting otherwise in a tooltip is a provenance claim
          the reader has to hover to disprove, which is the same shape as the
          warning badge this panel spent a rewrite removing. Found in review. */}
      <p className="gloss-part-label">
        {lookup.searches > 0 ? "checked" : "asked, not checked"}
        <Tooltip
          content={
            lookup.searches > 0 ? (
              <>
                <strong>Searched the web.</strong> {lookup.searches}{" "}
                {lookup.searches === 1 ? "search" : "searches"} on{" "}
                {new Date(lookup.at).toLocaleDateString()}, by {lookup.model}. The sources below are
                what it cited.
              </>
            ) : (
              <>
                <strong>No web search.</strong> {lookup.model} judged it already knew, on{" "}
                {new Date(lookup.at).toLocaleDateString()}. It decides per question, so this is a
                choice rather than a setting — and it means this answer is memory too.
              </>
            )
          }
          placement="top"
        >
          <span
            className={`gloss-globe ${lookup.searches > 0 ? "on" : "off"}`}
            /* The same call the comment dialog's badge makes: focus is what
               makes the tooltip reachable without a mouse, and without it the
               only way to learn whether this answer was checked is to hover. */
            // biome-ignore lint/a11y/noNoninteractiveTabindex: focus opens the tooltip
            tabIndex={0}
            role="img"
            aria-label={
              lookup.searches > 0
                ? `Searched the web ${lookup.searches} times`
                : "Answered without searching the web"
            }
          >
            <Globe size={11} />
          </span>
        </Tooltip>
      </p>
      <p className="gloss-part-text">{lookup.answer}</p>

      {sources.length > 0 && (
        <ul className="gloss-sources">
          {sources.map((c) => (
            <li key={c.url}>
              {/* The title in the tooltip and the host on the line. `rel` carries
                  `noreferrer` as well as `noopener` for the reason the canonical
                  link above does: the article's own URL is a reading history. */}
              <Tooltip content={c.title ?? c.url} placement="top">
                <a href={c.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={10} />
                  {hostOf(c.url)}
                </a>
              </Tooltip>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The one thing you can do to a finished list: ask for another pass.
 *
 * **It used to be two buttons and a line of provenance**, and all three went on
 * 2026-09-05 because Greg read the foot as a reader would:
 *
 * > we can probably get rid of Start again button and the "claude-sonnet-5 ·
 * > glossary/3 · one pass" at the bottom, those are all confusing and
 * > unnecessary.
 *
 * **"Start again" was a DELETE and then a run**, needed because running the
 * step again *appends* (src/glossary.ts § `generateGlossary`) and there was
 * otherwise no way to say "this list is wrong". It went for three reasons. The
 * glossary was the only one of the modes carrying a reset — ideas, quotes and
 * the timeline all replace on re-run, so re-running one already *is* starting
 * again (src/routes.ts, beside the `ideas` route). Since the threshold hides
 * rather than groups, *too long, too noisy* is the slider's job and costs no
 * model call (docs/plans/260903c-threshold-sliders-hide-below-threshold-items.md).
 * And the list is still recoverable without it: `existingFor` refuses to append
 * when the source, the prompt version or the profile differs, so an edit, a
 * prompt bump or the checkbox below rewrites the list — and inherits the ids,
 * so the reader's `?term=` links survive it.
 *
 * The cost was paid on every visit — a destructive button, an inline confirm
 * and a `danger` style in a band meant to stay quiet — for an action used
 * roughly never. `DELETE /api/glossary/:slug` and its tests stay; it is the
 * Postgres-safe half, and the Metadata page is where this belongs if anybody
 * ever misses it. ⟨Fable⟩
 *
 * **The provenance line said `generator · version · N passes`.** The argument
 * for `passes` was that it was the only way to see that *Find more* had done
 * anything. That stopped being true when the head grew a term count and the
 * threshold row grew *n of m*: both move when a pass lands, and both are the
 * number the reader was actually waiting for. The generator and the version are
 * pipeline facts — the public projection already drops them for a visitor
 * (src/public-types.ts) — and they are still in the artefact and the export.
 */
function Foot({
  job,
  starting,
  failed,
  onMore,
  withProfile,
  onWithProfile,
  hasProfile,
  slug,
  onCancel,
}: {
  job: Job | null;
  /**
   * **The POST has gone and the poll has not seen the job yet** — `useStepJob.ts`
   * § `starting`, which exists for exactly the gap this foot used to fall into.
   *
   * Without it the branch below was `if (job)`, so between the press and the
   * job appearing the foot drew *Find more* again, enabled, next to a live
   * checkbox. Pressing twice deduplicates server-side, but **toggling the
   * checkbox in that gap does not**: the profile flag is part of the work key,
   * so the second press is a differently-keyed job and a second paid call.
   * The empty state above has always passed this; the foot never did. ⟨Sol⟩
   */
  starting: boolean;
  failed: StepFailure | null;
  onMore(useProfile?: boolean): Promise<void>;
  withProfile: boolean;
  onWithProfile(next: boolean): void;
  hasProfile: boolean;
  /** For the profile panel's per-article half. src/web/ProfilePanel.tsx. */
  slug: string;
  onCancel(id: string): void;
}) {
  if (job || starting) {
    return (
      <div className="gloss-foot">
        <Progress
          job={job}
          starting={starting}
          failed={null}
          /* Not reachable from here: `stalled` is about a job of ours the queue
             has stopped advancing, and the surface that warns about it is the
             shelf card — useStepJob.ts § `stalled`. */
          stalled={false}
          onRun={() => onMore(withProfile)}
          onCancel={onCancel}
          label="Find more"
        />
      </div>
    );
  }

  return (
    <div className="gloss-foot">
      <div className="gloss-actions">
        {/* **The common case, and the first version missed it.** The checkbox
            was on the empty state and the two stale banners, so a reader with
            a perfectly current glossary — which is most readers, most of the
            time — never saw it at all. Found in a browser, not by a test.
            src/web/WrittenForYou.tsx. */}
        <UseProfile
          checked={withProfile}
          onChange={onWithProfile}
          hasProfile={hasProfile}
          slug={slug}
        />
        <button
          type="button"
          className="gloss-btn"
          title="Another model call, told what it has already found, looking for the quieter terms"
          onClick={() => void onMore(withProfile)}
        >
          <Search size={12} />
          Find more
        </button>
      </div>

      {failed && <p className="gloss-error">{failed.message}</p>}
    </div>
  );
}

/**
 * The glossary's run button. Everything but the three constants below is in
 * `JobProgress`, which the summary panel and the thread page share.
 */
function Progress(props: {
  job: Job | null;
  starting: boolean;
  failed: StepFailure | null;
  stalled: boolean;
  onRun(): Promise<void>;
  onCancel(id: string): void;
  label: string;
}) {
  return (
    <JobProgress {...props} step="glossary" icon={<Search size={13} />} runningLabel="Finding…" />
  );
}
