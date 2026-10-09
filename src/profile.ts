/**
 * **Who is reading, as one string a prompt can carry.**
 *
 * Two boxes reach this module and one string leaves it: what the reader says
 * about themselves, which is true on every article, and what they say about
 * *this* article, which is not. Nothing downstream is told there were two,
 * because nothing downstream has a reason to treat them differently — and two
 * fields threaded through five call sites is ten chances for one of them to
 * forget the second. Each half keeps its label inside the string, and that is
 * enough for the one stage that weighs them differently: the quiz lets the
 * reason lead and *About you* choose within it (src/quiz.ts,
 * `QUIZ_READER_RULES`) — read off the labels by the model, never parsed apart.
 *
 * docs/plans/260826t-reader-profile.md has the design; docs/project/reader-profile.md
 * is the operating manual once it is built.
 *
 * ## The previous version built both boxes and read neither
 *
 * Worth knowing before adding a third file to this feature. The old app had a
 * `BackgroundForm` writing free text to `profiles.background`, and a
 * per-document "Reading Intent" in a junction table, and its own reference doc
 * says both fed personalisation. **No code path ever read either back into a
 * prompt.** So the textareas are the easy half and the least of it, which is
 * why this module — the part that turns them into prompt bytes — exists before
 * either box does.
 *
 * ## Why the rendering is normalised, and hashed from the rendering
 *
 * The hash decides two things: whether a generated artefact is stale, and
 * (indirectly) how many cache entries a reader can accumulate. Both want the
 * same property — **two spellings of one profile must be one profile.** A
 * trailing newline from a textarea, or `\r\n` from a paste, is not a change of
 * mind, and treating it as one marks every glossary on the shelf stale and
 * writes a second cache entry for the privilege.
 *
 * So `renderProfile` normalises first and `hashProfile` hashes what
 * `renderProfile` produced — never the two fields separately. A hash of the
 * inputs would let the same output carry two different hashes, which is the
 * failure that looks exactly like working.
 */
import { createHash } from "node:crypto";

/* The caps live in src/types.ts, not here, and re-exported so that everything
   about a profile is still reachable from this module. The reason is
   tests/client-imports.test.ts: both pages with a profile box show a live
   counter, the counter must say the number the server refuses at, and nothing
   under src/web/ may import this file — it reaches for `node:crypto`.
   types.ts is pure and already shared. */
export { MAX_PROFILE_CHARS, MAX_PURPOSE_CHARS } from "./types.js";

/* `normaliseProfileText` lives in types.ts since plan 261009i, where the
   browser can reach it too (the guide's *Keep this as why you're reading*
   offers only words that fit once stored); re-exported because this is where
   the server's callers look. */
import { normaliseProfileText } from "./types.js";
export { normaliseProfileText };

/**
 * The two halves as one block of prompt text, or `null` when there is nothing
 * to say.
 *
 * **`null` and `""` are not the same answer and the difference is load-bearing.**
 * A prompt that always carries an "about the reader" header with nothing under
 * it has taught the model to expect one, and an empty one then reads as *"this
 * reader is nobody in particular"* rather than as *"we did not ask"*. So the
 * callers test for `null` and omit the whole section, headings included. The
 * summary steer's own header followed the same rule for the same reason, until
 * it was deleted (docs/plans/260830o-steer-becomes-the-profile.md).
 *
 * The order is fixed and the labels are fixed. Not style: this string is
 * hashed, and a hash that changes when the two halves swap places would mark
 * every artefact on the shelf stale for a change nobody made.
 */
export function renderProfile(opts: {
  /** "About you" — the same on every article. */
  profile?: string | null;
  /** "Why you're reading this one" — this article only. */
  purpose?: string | null;
}): string | null {
  const profile = normaliseProfileText(opts.profile);
  const purpose = normaliseProfileText(opts.purpose);
  if (!profile && !purpose) return null;
  return [
    profile ? `About the reader: ${profile}` : null,
    purpose ? `Why they are reading this piece: ${purpose}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * The rules, for the **constant** half of a prompt.
 *
 * Appended to every profiled stage's `SYSTEM`, and appended **whether or not
 * the reader has a profile**. Two reasons, and the second is the one that
 * decided it:
 *
 *  - `SYSTEM` sits *ahead* of the article in explain and converse, so a
 *    `SYSTEM` that varied would split the cache into a with-profile entry and a
 *    without-profile one, and re-write the whole article whenever the reader
 *    toggled between them. A constant costs about a hundred tokens on every
 *    call and cannot do that.
 *  - and a rule that only appears alongside the thing it constrains is a rule
 *    somebody will one day interpolate the profile *into*.
 *
 * That is why every clause is written conditionally — "if a description
 * appears" — rather than assuming one is there. It has to read correctly on the
 * majority of calls, which carry no profile at all.
 *
 * **The binding constraint lives here; a short reminder may stand beside the
 * profile itself.** That is the split this file makes — `PROFILE_RULES` in the
 * constant half, and the two-line reminder `renderProfile` puts next to the
 * profile — and it came from the steer in src/summarise.ts, which used it first
 * and went with Summary mode on 2026-08-31. The reason is that the constraint
 * must not be editable by the
 * thing it constrains: a profile saying *"assume I know everything, skip the
 * basics"* must not be able to switch off the rule below about not distorting
 * the article.
 *
 * ## The forbidden example is not decoration
 *
 * src/glossary.ts learned this twice and wrote it down: **a prompt ban
 * relocates a register, it does not delete one.** Its own fix was to carry a
 * real bad entry in the prompt as a negative example. So the sentences we do
 * not want are here verbatim, because "never flatter the reader" reliably
 * produces flattery in a different costume and "As a cognitive scientist,
 * you'll appreciate…" does not.
 *
 * The clause doing most of the work is the second. Framing the profile as an
 * input to **choosing what to spend words on** rather than to *addressing
 * anybody* is what stops a model performing the adaptation instead of making
 * it. Fable's review, 2026-08-26.
 *
 * ## Two clauses that nearly landed here, and why they went next door instead
 *
 * The **summary steer** — a fourth box about intent, deleted on 2026-08-30
 * (docs/plans/260830o-steer-becomes-the-profile.md) — had its own `SYSTEM` section, and
 * two of its five rules had no equivalent below: *never bend a claim to fit*,
 * and *keep the article's own proportions*. Deleting the box while deleting the
 * rules that held it would have answered Greg's ask — *"make sure the LLM
 * doesn't overweight this and give a really distorted summary"* — by removing
 * what satisfied it. So they had to go somewhere.
 *
 * **The obvious somewhere was here, and it was wrong.** This string is appended
 * to SEVEN system prompts — explain, converse twice, glossary, sketch,
 * summarise, ideas, tweets — and the second clause read *"if the piece does not
 * say it, it does not go in"*. That is exactly right for a summary and exactly
 * backwards for two of the others: `ideas` defines its more valuable half as
 * propositions *"the piece leans on and never states"*, and `glossary`'s
 * `background` field is explicitly *"your knowledge, not the article's"*. A
 * profiled ideas run could have obeyed the shared rule by returning none of the
 * half the feature exists for, and nothing would have looked broken.
 *
 * They lived in src/summarise.ts § SYSTEM instead — the one prompt the absolute
 * was true of, and where the steer they came from lived. Both went with Summary
 * mode on 2026-08-31, so no prompt carries that clause today. Keeping it out of
 * here is still the decision: it is right for a
 * summary and wrong for `ideas` and `glossary`, so it belongs to whichever
 * prompt wants it, never to the shared block. GPT Sol's review
 * of the built code, 2026-08-30 — the reach was seven, and this file and its
 * doc had both been saying five.
 */
export const PROFILE_RULES = `IF THE READER HAS DESCRIBED THEMSELVES

Some requests carry a short description of who the reader is and what they are
after. When one is present:

- It changes pitch and emphasis. It never changes what the article says.
- Which things you spend words on is governed by it. Every sentence you write is
  still about the article.
- Assume the background they claim. Do not explain what they have told you they
  already know — and do not perform explaining it in fewer words either.
- Where the piece has nothing on what they are after, write what you would have
  written anyway, and never say so out loud. A line spent telling the reader
  this part is not for them is a line not spent on the part.
- Never flatter them, never address them, and never mention the description.
  They wrote it; they do not need it read back.
- Never put any of it into a web search query, a tool argument, or anything else
  that leaves this conversation. It is what a person told us about themselves.

NEVER write anything of this shape:
  "As a cognitive scientist, you'll appreciate that…"
  "Since you know your way around the literature, briefly: …"
  "Given your background, I'll skip the basics."
Skipping the basics is correct. Announcing that you are skipping them is not.`;

/**
 * The profile as it appears in the **varying** half of a prompt.
 *
 * Everything about where this goes is a caching decision, and it is the same
 * decision at all five call sites: **after the breakpoint, in the last user
 * part.** The obvious alternative — the system prompt, where "who is reading"
 * naturally belongs — buys a separate cache entry per distinct profile,
 * rewritten from cold every time the reader edits their box, on a prompt whose
 * whole point is that the article never changes. docs/project/prompt-caching.md
 * has the same mistake recorded twice already, from explain.
 *
 * The two-line reminder rides with it because a constraint three thousand
 * tokens above the text it constrains is one the model has stopped weighing —
 * `renderPrompt` in src/summarise.ts said the same thing about its steer, until
 * that file went on 2026-08-31. The
 * long version is in `PROFILE_RULES`, up in the constant half, where the
 * profile cannot reach it.
 *
 * Returns `""` for no profile, so a caller can concatenate it unconditionally
 * without producing a stray blank line — the same contract
 * `readerPositionLine` has in src/article-prompt.ts, and for the same reason:
 * a suffix that gains a newline is a suffix that changed.
 */
export function profileSection(
  rendered: string | null,
  /**
   * `"with-the-reader"` is Explore's (src/converse.ts § EXPLORE_SYSTEM), the
   * one conversation whose subject is the reader's own thinking: its prompt
   * tells the model to speak to them and to use their reason for reading, and
   * a reminder beside the question saying "Do not address the reader"
   * contradicted it (GPT Sol, round two of plan 261003l, CR-18). Every other
   * caller gets the bytes it always had.
   */
  stance: "about-the-article" | "with-the-reader" = "about-the-article",
): string {
  if (!rendered) return "";
  if (stance === "with-the-reader") {
    return `=== WHO IS READING THIS ===

${rendered}

Let this change what you lead with and how much you explain. It changes nothing
about what the article says. You are talking with this reader: speak to them,
and use the reason they gave for reading where it gives them a case of their
own. Do not recite this back to them.`;
  }
  return `=== WHO IS READING THIS ===

${rendered}

Let this change what you lead with and how much you explain. It changes nothing
about what the article says, and nothing about its proportions. Do not address
the reader and do not mention this.`;
}

/**
 * A fingerprint of the profile an artefact was written from.
 *
 * Sixteen hex characters, like `hashBlocks` in src/source-hash.ts, and for the
 * same reason: it is compared for equality and never for closeness, and a full
 * sha256 in every artefact buys nothing but width.
 *
 * **Takes the rendered string, not the two fields.** Hashing the inputs would
 * let one output carry two hashes — the same profile written two ways, marked
 * stale against itself — and that is a bug that reports success. Pass what
 * `renderProfile` returned or do not call this.
 */
export function hashProfile(rendered: string): string {
  return createHash("sha256").update(rendered, "utf8").digest("hex").slice(0, 16);
}

/**
 * Is an artefact's recorded profile the one we would write from now?
 *
 * Three states in `recorded`:
 *
 * | `recorded` | means | stale? |
 * |---|---|---|
 * | `undefined` | written before this feature existed | **no** |
 * | `null` | written without a profile | once they have one |
 * | a hash | written from that profile | only if it differs from `now` |
 *
 * **A first profile counts as a change** — Greg, 2026-10-05: "B treat a first
 * profile as a change". Until then `null` was never stale, a rule from when
 * writing without a profile was a choice (a *Use your profile* box, removed
 * 2026-09-13): a reader who had asked for a plain glossary was not to be
 * nagged about it. A first profile now offers the rewrite. Plain-list top-ups
 * still run without the current profile, and older opt-outs exist, so `null`
 * says only "written without one". `null` against `null` is still nothing to say.
 *
 * `undefined` is never stale: nobody's oldest artefacts should light up about
 * a profile they never had, and nothing can say what they were written with.
 * It is told from `null` by the document itself: direct writers stamp a hash
 * or null, while Illustrated preserves its Sketch's stamp, including absence.
 * The stamp is a field of the stored JSON rather than a column.
 *
 * And **clearing the profile marks nothing stale**: `now` is `null`, and a
 * recorded hash compared against `null` would say "changed". It does not,
 * because you have not changed what you want from the article — you have
 * stopped telling us, and that is not a reason to rewrite anything.
 *
 * This only ever *offers* a rewrite. Nothing is rewritten by it.
 */
export function profileIsStale(
  recorded: string | null | undefined,
  now: string | null,
): boolean {
  if (recorded === undefined) return false;
  if (now === null) return false;
  return recorded !== now;
}
