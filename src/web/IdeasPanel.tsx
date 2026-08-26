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
import { JobProgress } from "./JobProgress.js";
import { UseProfile, WrittenForYou } from "./WrittenForYou.js";
import type { BlockId } from "../types.js";

interface Props extends UseIdeas {
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
  status,
  ideas,
  stale,
  outdated,
  profiled,
  profileChanged,
  hasProfile,
  error,
  job,
  failed,
  find,
  cancel,
  ideaId,
  onIdea,
  found,
  openKey,
  onOpenKey,
  onJump,
}: Props) {
  /* Seeded from what the list on screen was written with, so the box is already
     in the state the reader last chose and nothing has to remember it between
     visits: the artefact does. `useState`'s initialiser rather than an effect,
     because re-seeding on every poll would fight a reader who just unticked it. */
  const [withProfile, setWithProfile] = useState(() => (ideas ? profiled : true));

  const all = ideas?.ideas ?? [];
  const run = (label: string) => (
    <div className="gloss-run">
      <UseProfile
        checked={withProfile}
        onChange={setWithProfile}
        hasProfile={hasProfile}
        disabled={job !== null}
      />
      <JobProgress
        job={job}
        failed={failed}
        onRun={() => find(withProfile)}
        onCancel={cancel}
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
        {ideas && <WrittenForYou written={profiled} changed={profileChanged} />}
      </div>

      {error && <p className="gloss-error">{error}</p>}

      {status === "loading" && <p className="gloss-quiet">Looking for the ideas…</p>}

      {status === "none" && (
        <div className="gloss-empty">
          <p>Nobody has found the ideas for this one yet.</p>
          <p className="gloss-hint">
            One model call over the whole article, and it takes tens of seconds. Found once and
            kept — you will not be asked again unless the article changes.
          </p>
          {run("Find the ideas")}
        </div>
      )}

      {status === "ready" && ideas && (
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
          {stale ? (
            <div className="gloss-stale">
              <p>
                <TriangleAlert size={13} />
                These describe an older version of the article.
              </p>
              {run("Find them again")}
            </div>
          ) : outdated ? (
            <div className="gloss-stale">
              <p>
                <TriangleAlert size={13} />
                These were written by an older version of the prompt.
              </p>
              {run("Find them again")}
            </div>
          ) : null}

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
                        /* Selecting jumps to the first occurrence, always,
                           unlike the stepper below which leaves you alone if
                           the target is already on screen. Pressing a row is
                           arriving somewhere; stepping is moving between
                           neighbours. The glossary already jumps on select. */
                        const first = idea.occurrences[0];
                        if (first) onJump(first.blockId);
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

          {/* Below the list, not above it: this is the thing you reach for
              after reading them and disagreeing, not before. */}
          {!stale && !outdated && <div className="ideas-again">{run("Find them again")}</div>}
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
              title="The model's own comparison. The article does not use it."
            >
              <p className="gloss-part-label">One way to picture it</p>
              <p className="gloss-part-text">{idea.analogy}</p>
            </div>
          )}

          <div className="ideas-where">
            <p className="gloss-part-label">
              {/* The heading is the whole of "this is a hypothesis". An assumed
                  idea is BY DEFINITION not in the article, so "assumed in"
                  would claim the passages say something they do not. */}
              {assumed ? "The model thinks these passages rely on it" : "Where the piece states it"}
              <span className="gloss-count">{found.length || idea.occurrences.length}</span>
            </p>

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
