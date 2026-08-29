/**
 * The ideas, in the band between the spine and the prose — the sixth mode.
 *
 * The glossary next door answers *what does this word mean*. This answers *what
 * do I have to understand*, and the unit is a proposition rather than a noun.
 * Full design in docs/plans/ideas-mode.md; the two things to know before
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
import { useState } from "react";
import { Lightbulb, TriangleAlert } from "lucide-react";
import type { Idea } from "../types.js";
import type { UseIdeas } from "./useIdeas.js";
import type { Found } from "./search-hits.js";
import { BlockNav, nudgeTo } from "./BlockNav.js";
import { BlockRef } from "./BlockRef.js";
import { builtButEmpty } from "../messages.js";
import { JobProgress } from "./JobProgress.js";
import { UseProfile, WrittenForYou } from "./WrittenForYou.js";
import type { BlockId } from "../types.js";
import { useRenderCount } from "./perf.js";

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
  /* Seeded from what the list on screen was written with, so the box is already
     in the state the reader last chose and nothing has to remember it between
     visits: the artefact does. `useState`'s initialiser rather than an effect,
     because re-seeding on every poll would fight a reader who just unticked it. */
  const [withProfile, setWithProfile] = useState(() => (ideas ? (owner?.profiled ?? false) : true));

  const all = ideas?.ideas ?? [];
  /* **Returns nothing for a visitor**, which is what makes every call site
     below one line rather than a conditional: this whole block is a profile
     tick and a button that spends a model call, and a visitor has neither. */
  const run = (label: string) =>
    owner && (
      <div className="gloss-run">
        <UseProfile
          checked={withProfile}
          onChange={setWithProfile}
          hasProfile={owner.hasProfile}
          disabled={owner.job !== null}
        />
        <JobProgress
          job={owner.job}
          failed={owner.failed}
          onRun={() => owner.find(withProfile)}
          onCancel={owner.cancel}
          label={label}
          step="ideas"
          icon={<Lightbulb size={13} />}
          runningLabel="Finding…"
        />
      </div>
    );

  return (
    <aside className="mode-band gloss ideas" aria-label="Ideas">
      <div className="gloss-head">
        <Lightbulb size={14} className="gloss-head-icon" />
        <h2>Ideas</h2>
        {ideas && (
          <span className="gloss-count">
            {all.length} {all.length === 1 ? "idea" : "ideas"}
          </span>
        )}
        {/* A label rather than a control, and on the head line rather than in a
            banner: it is provenance, not a warning. It matters more here than
            anywhere else it appears — a changed profile does not merely re-pitch
            these, it changes what "assumed" means. */}
        {/* Provenance about the owner's own run: `profileHash` never leaves the
            server, so a visitor sees none of it. src/public-types.ts. */}
        {ideas && owner && (
          <WrittenForYou written={owner.profiled} changed={owner.profileChanged} />
        )}
      </div>

      {owner?.error && <p className="gloss-error">{owner.error}</p>}

      {owner?.status === "loading" && <p className="gloss-quiet">Looking for the ideas…</p>}

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
              {run("Find them again")}
            </div>
          ) : owner?.outdated ? (
            <div className="gloss-stale">
              <p>
                <TriangleAlert size={13} />
                These were written by an older version of the prompt.
              </p>
              {run("Find them again")}
            </div>
          ) : null}

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

          {/* Below the list, not above it: this is the thing you reach for
              after reading them and disagreeing, not before. */}
          {owner && !owner.stale && !owner.outdated && (
            <div className="ideas-again">{run("Find them again")}</div>
          )}
        </>
      )}
    </aside>
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
                    <span className="ideas-quote">
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
