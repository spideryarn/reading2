/**
 * The ideas, in the band between the spine and the prose — the sixth mode.
 *
 * The glossary next door answers *what does this word mean*. This answers *what
 * do I have to understand*, and the unit is a proposition rather than a noun.
 * Full design in docs/plans/260826ac-ideas-mode.md; the two things to know before
 * changing anything here are both about honesty rather than layout.
 *
 * ## An assumed idea is a hypothesis, and the heading has to say so
 *
 * A block id proves **the passage exists**. It does not prove that the claimed
 * assumption is the author's — and a confident sentence with a real anchor next
 * to it reads as if it did. That is the failure this mode is most exposed to:
 * an assumed idea can launder the model's own reading of the piece through the
 * article's own ids, which is worse than a wrong glossary entry because the
 * machinery around it looks like evidence.
 *
 * So the occurrence heading for an assumed idea is *"the model thinks these
 * passages rely on it"*, not *"assumed in"*. Same instinct as the glossary's
 * label-not-badge provenance: name whose claim it is, in the place the reader
 * is already looking, rather than adding a warning triangle that treats the
 * model's contribution as a hazard.
 *
 * ## The analogy is the model's, and the article's own analogy is banned
 *
 * `analogy` gets the treatment `background` gets in a glossary entry — its own
 * labelled section, so the provenance is the label rather than a badge. The
 * prompt separately forbids handing back the *author's* comparison, which the
 * first run did on `data/writes`: it offered the essay's own gym analogy as its
 * own. It read perfectly well and credited the model with the author's
 * thinking.
 *
 * ## What this panel does NOT own
 *
 * The marks in the prose and the lanes in the rail. `IdeasBand` in App.tsx
 * resolves the selected idea into `Found[]` and pushes it up, for the same
 * reason `SearchBand` does — see the comment there, and note in particular that
 * ideas must not share search's `found` state.
 */
import { Lightbulb, TriangleAlert } from "lucide-react";
import type { Idea } from "../types.js";
import type { UseIdeas } from "./useIdeas.js";
import type { Found } from "./search-hits.js";
import { BlockNav, nudgeTo } from "./BlockNav.js";
import { BlockRef } from "./BlockRef.js";
import { builtButEmpty } from "../messages.js";
import { JobProgress } from "./JobProgress.js";
import { ModeSurface } from "./ModeSurface.js";
import { AboutMade } from "./BandAbout.js";
import { ReadError } from "./ReadError.js";
import { RewriteWaiting } from "./RewriteWaiting.js";
import { WrittenForYou } from "./WrittenForYou.js";
import type { BlockId } from "../types.js";
import { useRenderCount } from "./perf.js";
import { BandWaiting } from "./BandWaiting.js";

/**
 * **The owner's half of this panel** — the read's status, the job finding the
 * ideas, and the one verb.
 *
 * Absent for a visitor — see `IdeasAccess` below. The list itself arrives inside
 * `GET /api/public/article/:slug` since slice 1b, so it is the same list drawn
 * by the same rows; what a visitor has no equivalent of is everything here.
 * GlossaryPanel.tsx § GlossaryOwner has the argument for one panel with its
 * data injected rather than two panels for one list.
 */
export type IdeasOwner = UseIdeas;

/**
 * **Who is reading, and the list they get — one prop, so the two cannot
 * disagree.** The argument is in GlossaryPanel.tsx § GlossaryAccess, including
 * why the owner's list is nullable and the visitor's is not.
 */
export type IdeasAccess =
  | { kind: "owner"; owner: IdeasOwner; ideas: { ideas: Idea[] } | null }
  | { kind: "visitor"; ideas: { ideas: Idea[] }; owner?: never };

interface Props {
  access: IdeasAccess;
  /** Which idea is open, from `?idea=`. */
  ideaId: string | null;
  onIdea(id: string | null): void;
  /** The selected idea's occurrences, resolved — the same array the prose marks. */
  found: Found[];
  /** Which occurrence the reader last landed on, by `Found.key`. */
  openKey: string | null;
  onOpenKey(key: string | null): void;
  onJump(id: BlockId): void;
}

/**
 * The two groups, and their headings.
 *
 * "What you need to bring" leads because a prerequisite is worth having
 * *before* you read and a takeaway is not.
 *
 * **The divider is the model's classification, not a fact.** A piece can assume
 * a broad framework and introduce its own refinement of it, and that idea
 * belongs in both — so the groups are drawn the way everything else the model
 * asserts here is drawn. The plan's first draft called this "a fact about each
 * idea rather than a judgment about it", which was wrong and is corrected
 * there.
 */
const GROUPS = [
  {
    provenance: "assumed" as const,
    heading: "What you need to bring",
    blurb: "The piece leans on these and never states them.",
  },
  {
    provenance: "introduced" as const,
    heading: "What this piece adds",
    blurb: "Ideas you could carry out of it and use elsewhere.",
  },
];

export function IdeasPanel({
  access,
  ideaId,
  onIdea,
  found,
  openKey,
  onOpenKey,
  onJump,
}: Props) {
  useRenderCount("IdeasPanel");
  const owner = access.kind === "owner" ? access.owner : null;
  const ideas = access.ideas;
  const all = ideas?.ideas ?? [];
  /* **Returns nothing for a visitor**, which is what makes every call site
     below one line rather than a conditional: this whole block is a button that
     spends a model call, and a visitor has none. */
  /**
   * @param again whether this is the button offered **beside a list that is
   *   already there**, which is the whole of the difference between the two
   *   verbs. The empty state's button must be `ensure` — the identical,
   *   unforced request the automatic run makes — or a press landing inside the
   *   auto-start window carries a different `work_key`, is not de-duplicated,
   *   and buys a second model call. useIdeas.ts § `ensure`.
   */
  /* A rewrite has finished and its list is not here yet: the forced button
     gives way to a read, never to a second paid run. rewrite-hold.ts. */
  const waiting = owner !== null && owner.rewriting && !owner.job && !owner.starting && !owner.failed;
  const run = (label: string, again = false) =>
    owner &&
    (again && waiting && !owner.error ? (
      <RewriteWaiting line="The new ideas haven't loaded yet." onRead={owner.refresh} className="tw:m-0" />
    ) : (
      <div className="gloss-run">
        <JobProgress
          job={owner.job}
          starting={owner.starting}
          failed={owner.failed}
          stalled={owner.stalled}
          onRun={() => (again ? owner.regenerate() : owner.ensure())}
          /* With `error` set the retry is `ReadError`'s; the button stays held. */
          runDisabled={again && owner.rewriting}
          onCancel={owner.cancel}
          label={label}
          step="ideas"
          icon={<Lightbulb size={13} />}
          runningLabel="Finding…"
        />
      </div>
    ));

  /* What the band's (i) adds after the mode's own words: how many ideas, in
     which group, and who found them. Greg, 2026-10-01 (spya-ucu35y): *"how
     many X (of y) … what model was used"*; plan 261001m. The total was the
     head row's until then; each group's own count stays beside its heading,
     where it labels the group. The provenance is the owner's artefact's — a
     visitor's carries none (src/public-types.ts). */
  const made = owner?.ideas ?? null;
  const assumed = all.filter((i) => i.provenance === "assumed").length;
  const about = ideas ? (
    <>
      <p>
        {all.length === 1 ? "One idea" : `${all.length} ideas`}
        {all.length > 0 ? `: ${assumed} you need to bring, ${all.length - assumed} the piece adds.` : "."}
      </p>
      {made && (
        <AboutMade
          generator={made.generator}
          version={made.version}
          generatedAt={made.generatedAt}
          elapsedMs={made.elapsedMs}
        />
      )}
    </>
  ) : null;

  return (
    <ModeSurface
      label="Ideas"
      feature="gloss ideas"
      mode="ideas"
      about={about}
      /* **The badge is in the band's corner**, beside the (i), since
          2026-10-02 (`ModeSurface`'s `profile`, plan 261002e). It is the
          same icon as in every other mode now, where until then this was the
          one band that said *"written for you"* in words, on the argument
          that a changed profile changes what "assumed" means here. Greg asked
          for the corner to be standardised (spya-hf4svm); the panel the icon
          opens says the same fact in words at its top. A label rather than a
          control, and provenance about the owner's own run: `profileHash`
          never leaves the server, so a visitor sees none of it
          (src/public-types.ts). */
      profile={
        ideas && owner ? (
          <WrittenForYou
            written={owner.profiled}
            changed={owner.profileChanged}
            slug={owner.slug}
            /* The forced run replaces the list (plan 261002b). */
            regenerate={{
              run: () => void owner.regenerate(),
              busy: owner.job !== null || owner.starting || owner.rewriting,
              refresh: () => owner.refresh(),
            }}
          />
        ) : null
      }
      /* **An empty head, kept as the row the corner sits in.** The mode's
          name went on 2026-09-05 — the Dock says it (§ Stage 5 of
          docs/plans/260905d-declutter-the-reading-view-top-bars.md) — the
          count on 2026-10-01, to the band's (i) (plan 261001m), and the badge
          on 2026-10-02, to the corner. Without the row the corner would sit on
          the first group's heading and its count; mode-band.css floors a head
          at the corner's height. */
      // biome-ignore lint/complexity/noUselessFragments: an empty fragment is the point — a head that is not null keeps its row, and the note above says why
      head={<></>}
      /* No standing redo button under the list any more. Greg, 2026-09-29
          (SPIDERYARN-READING2-53): *"Same goes for any other modes that still
          have a "redo this processing" button - let's just rely on the
          Metadata mode for that."* Metadata's *AI processing* has a row
          for this mode; the button inside the stale banner stays, as a
          repair the page is prompting rather than a standing redo.
          docs/plans/260929b-one-place-to-re-run-ai-processing.md.

          The footer itself stays while a current list's job is starting,
          running or failed. It is the only place that job's progress, Stop,
          stall warning and failure can be seen in this mode; idle renders
          nothing, so this does not put the standing button back. Not on a
          stale list, whose banner carries the job; an outdated list has no
          banner (plan 260929c), so its job shows here. And while a rewrite's
          list has not loaded (`waiting`), for the read that brings it in —
          unless `ReadError` above is already offering that read. */
      foot={
        ideas &&
        owner?.status === "ready" &&
        !owner.stale &&
        (owner.job || owner.starting || owner.failed || (waiting && !owner.error)) ? (
          <div className="ideas-again">{run("Find them again", true)}</div>
        ) : null
      }
    >

      {owner?.error && <ReadError error={owner.error} onRetry={owner.retryRead} />}

      {owner?.status === "loading" && <BandWaiting className="gloss-quiet">Looking for the ideas…</BandWaiting>}

      {/* A piece with no ideas never mounts this panel for a visitor —
          `visitorGap` answers *not-built* and the band says so instead. What is
          left is the state absence cannot express: a list somebody ran that came
          back with nothing in it. src/messages.ts § builtButEmpty. */}
      {!owner && all.length === 0 && <p className="gloss-quiet">{builtButEmpty("A list of ideas")}</p>}

      {owner?.status === "none" && (
        <div className="gloss-empty">
          <p>Nobody has found the ideas for this one yet.</p>
          <p className="gloss-hint">
            One model call over the whole article, and it takes tens of seconds. Found once and
            kept — you will not be asked again unless the article changes.
          </p>
          {run("Find the ideas")}
        </div>
      )}

      {ideas && (owner === null || owner.status === "ready") && (
        <>
          {/* Stale wins when both are true: it is the one that makes the
              occurrence links wrong, and two banners stacked is a wall. Same
              rule, and the same two sentences, as the glossary next door.

              **"the article" here includes its sections.** This artefact's
              staleness covers the tree as well as the blocks (src/ideas.ts §
              inputFingerprint), so a piece re-cut into different parts is stale
              even when every paragraph is byte-identical — which is right,
              because the model judged what the argument rests on from the
              skeleton. */}
          {owner?.stale ? (
            <div className="gloss-stale">
              <p>
                <TriangleAlert size={13} />
                These describe an older version of the article.
              </p>
              {run("Find them again", true)}
            </div>
          ) : null}
          {/* No banner for an outdated list (older prompt, same article) —
              Greg, 2026-09-29 (SPIDERYARN-READING2-55): *"it's not worth
              bugging the user about it."* Re-running is in Metadata. Plan
              260929c. */}

          {/* **The scroller, and it was missing.** `.mode-band` is a fixed
              flex column from the controls bar to the dock, and every other
              band puts a `flex: 1; min-height: 0; overflow-y: auto` child
              inside it — `.gloss-list` next door, `.chat-scroll`,
              `.summ-scroll`. This one had the groups as direct children, so
              with one idea open on a 700px window the nine ideas in the second
              group and the Find-them-again button below them were 474px past
              the bottom of the band with no way to reach any of them. Measured
              in a browser, 2026-08-27; invisible from the code, and invisible
              on a tall window with everything collapsed.

              The head and the footer stay outside it, which is the arrangement
              GlossaryPanel already had: the button that regenerates these must
              not be something you have to scroll to. */}
          <div className="ideas-scroll">
            {GROUPS.map(({ provenance, heading, blurb }) => {
              const mine = all.filter((i) => i.provenance === provenance);
              /* No heading over nothing. A piece really can have no unstated
                 premises worth naming, and an empty labelled section says "we
                 looked and found none" in a way an absent one does not — but it
                 says it in the most expensive place on screen, above the ideas
                 that ARE there. */
              if (mine.length === 0) return null;
              return (
                <section key={provenance} className="ideas-group">
                  <h3>
                    {heading}
                    <span className="gloss-count">{mine.length}</span>
                  </h3>
                  <p className="ideas-blurb">{blurb}</p>
                  <ul className="ideas-list">
                    {mine.map((idea) => (
                      <IdeaRow
                        key={idea.id}
                        idea={idea}
                        open={idea.id === ideaId}
                        onSelect={() => {
                          /* Pressing the open one clears it, which is the only
                             way to take the marks back out — a selection you
                             cannot cancel is a mode inside a mode. The glossary
                             next door does exactly this. */
                          if (idea.id === ideaId) return onIdea(null);
                          onIdea(idea.id);
                          /* **The jump lives in `IdeasBand`, not here**, and
                             that is forced rather than chosen. Selecting jumps to
                             the first occurrence — pressing a row is arriving
                             somewhere, unlike the stepper below, which leaves you
                             alone if the target is already on screen — but it has
                             to be the first *resolved* one, and this panel only
                             holds the resolved passages of the idea that is
                             **already** selected. The stored list can name a
                             block a re-extraction removed, so jumping to
                             `idea.occurrences[0]` does nothing at all: the reader
                             presses an idea, the marks appear off screen, and the
                             page sits still. GPT Sol, 2026-08-27. */
                        }}
                        found={idea.id === ideaId ? found : []}
                        openKey={openKey}
                        onOpenKey={onOpenKey}
                        onJump={onJump}
                      />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </>
      )}
    </ModeSurface>
  );
}

function IdeaRow({
  idea,
  open,
  onSelect,
  found,
  openKey,
  onOpenKey,
  onJump,
}: {
  idea: Idea;
  open: boolean;
  onSelect(): void;
  found: Found[];
  openKey: string | null;
  onOpenKey(key: string | null): void;
  onJump(id: BlockId): void;
}) {
  const assumed = idea.provenance === "assumed";
  return (
    <li className={`ideas-item${open ? " open" : ""}`}>
      <button type="button" className="ideas-name" onClick={onSelect} aria-expanded={open}>
        {idea.name}
      </button>

      {open && (
        <div className="ideas-detail">
          {/* `gloss-part-senseHere` and `gloss-part-background` are reused
              rather than re-declared, and not to save two rules: they ARE the
              provenance treatment — a solid rule down the left for what comes
              from the article, a dotted one for what comes from the model. Two
              panels drawing the same distinction two ways would teach the
              reader that it means two different things. */}
          <div className="gloss-part gloss-part-senseHere">
            <p className="gloss-part-label">The idea</p>
            <p className="gloss-part-text">{idea.statement}</p>
          </div>

          {idea.whyYouNeedIt && (
            <div className="gloss-part gloss-part-senseHere">
              <p className="gloss-part-label">
                {assumed ? "Why you need it" : "What it buys you"}
              </p>
              <p className="gloss-part-text">{idea.whyYouNeedIt}</p>
            </div>
          )}

          {/* The model's own frame, labelled as the model's — the same
              treatment `background` gets in a glossary entry, and the same
              reason: provenance is the label, not a badge. The prompt forbids
              handing back the article's own comparison here. */}
          {idea.analogy && (
            <div
              className="gloss-part gloss-part-background"
              /* **It says whose it is, and stops.** This used to end "The
                 article does not use it", which is a claim about the article
                 whose only evidence is a line in the prompt — and the very
                 first real run broke that line, handing back the essay's own
                 gym analogy as the model's. A label that asserts something we
                 have not checked is worse than a label that says less,
                 especially in the one field whose whole job is provenance.
                 GPT Sol, 2026-08-27. */
              title="The model's own comparison, not something quoted from the article."
            >
              <p className="gloss-part-label">One way to picture it</p>
              <p className="gloss-part-text">{idea.analogy}</p>
            </div>
          )}

          <div className="ideas-where">
            {/* **The stepper goes INSIDE the label**, the way it does in the
                glossary's "used in 3 places" line. It was a sibling, and a
                `<span>` sibling in a block context is its own line: the
                stylesheet's `margin-left: auto` had nothing to push against, so
                the arrows sat under the heading at the left margin and spent a
                whole row saying what fits beside four words. */}
            <p className="gloss-part-label">
              {/* The heading is the whole of "this is a hypothesis". An assumed
                  idea is BY DEFINITION not in the article, so "assumed in"
                  would claim the passages say something they do not. */}
              {assumed ? "The model thinks these passages rely on it" : "Where the piece states it"}
              {/* `found.length`, full stop. This was `found.length ||
                  idea.occurrences.length`, and the `||` made the ONE case it
                  was there for — every passage lost to a re-extraction — read
                  as the old nonzero count beside an empty list. A count that
                  disagrees with the rows under it is the panel telling the
                  reader two things. GPT Sol, 2026-08-27. */}
              <span className="gloss-count">{found.length}</span>

              {/* Built from what actually RESOLVED, not from what was stored. After
                  a re-extraction some occurrences no longer find their block or
                  their words, and a counter that counted the stored list would
                  say "2 of 5" and step through three. */}
              <BlockNav
                /* `Found.key` is the occurrence's identity — one idea can be
                   needed twice in the same paragraph, so a block id is not one.
                   Mapped here rather than widening `Found`, because `key` means
                   exactly this already and a second id field on it would be two
                   names for one thing. */
                targets={found.map((f) => ({ id: f.key, blockId: f.blockId }))}
                currentId={openKey}
                onGo={(key, blockId) => {
                  onOpenKey(key);
                  /* `nudgeTo`, not `onJump` — stepping between neighbours leaves
                     the reader alone when the next one is already in front of
                     them. Pressing an occurrence row below always jumps, because
                     that is arriving somewhere rather than moving along. */
                  nudgeTo(blockId, onJump);
                }}
                noun={assumed ? "passage" : "statement"}
              />
            </p>

            <ol className="ideas-occurrences">
              {found.map((f) => (
                <li key={f.key} className={f.key === openKey ? "open" : undefined}>
                  <button
                    type="button"
                    onClick={() => {
                      onOpenKey(f.key);
                      onJump(f.blockId);
                    }}
                  >
                    <span className={`ideas-quote${f.whole ? " ideas-quote-moved" : ""}`}>
                      {f.whole ? "whole paragraph — the exact words have moved" : f.short}
                    </span>
                    {f.reasoning && <span className="ideas-reason">{f.reasoning}</span>}
                  </button>
                  <BlockRef id={f.blockId} onJump={onJump} />
                </li>
              ))}
            </ol>

            {/* Stored but unresolvable. Saying so is the difference between "the
                article changed under this" and "the model found fewer than it
                claimed", and the reader can only tell if we tell them. */}
            {found.length < idea.occurrences.length && (
              <p className="gloss-hint">
                {idea.occurrences.length - found.length} more{" "}
                {idea.occurrences.length - found.length === 1 ? "passage is" : "passages are"} no
                longer in the article.
              </p>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
