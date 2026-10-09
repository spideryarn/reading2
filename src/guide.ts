/**
 * **The guide's pieces of context that no other conversation gets**: our
 * words for the modes, how much the reader has used Spideryarn before, and
 * (since plan 261008a) which of its *Button* modes are already made.
 *
 * The guide is the conversation about how to read this piece with Spideryarn
 * (`GUIDE_SYSTEM` in src/converse.ts,
 * docs/plans/261007j-the-guide-a-conversation-about-how-to-read-this.md). Both
 * pieces are pure and live here rather than in converse.ts so that a test can
 * pin them without a prompt around them.
 *
 * They go on opposite sides of the cache breakpoint, and that is the point of
 * keeping them apart:
 *
 * - **The mode words are the same for every reader and every article**, so
 *   they sit in the system prompt, above the breakpoint, as stable bytes
 *   (docs/project/prompt-caching.md).
 * - **The experience line changes per reader and over time**, so it rides in
 *   the final user message beside the profile, below the breakpoint, and never
 *   in the system prompt (GPT Sol's F7 on the plan above). So does the
 *   already-made line, which changes per article and over time.
 */
import { keysOpenFree, type MadeArtefact, modeActsAlone } from "./acts-alone.js";
import catalogue from "./command-pick-catalogue.generated.json" with { type: "json" };

/* ------------------------------------------------------- the mode words -- */

interface CatalogueRow {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly kind: string;
  readonly generates: boolean;
  readonly contexts: readonly string[];
}

/** The context every mode a reader can open on their own article is listed under. */
const OWNER_ARTICLE = "owner-article";
/** The same, with the experimental switch off: a mode missing here is experimental. */
const EXPERIMENTAL_OFF = "owner-article-experimental-off";

/**
 * **What the guide is told about each mode, in our words** — the label and
 * description the command bar shows, from the generated catalogue
 * (src/command-pick-catalogue.generated.json), for its `mode` and `submode`
 * rows on the reader's own article.
 *
 * In the catalogue's order, which is the bottom bar's, so the bytes depend on
 * nothing but that file: a regenerated catalogue is the only thing that moves
 * them. A sub-mode follows its mode. A mode that only shows with experimental
 * features on says so, because the reader may not see it in their bar.
 *
 * **Each ordinary one carries its button**, since stage 2 of the plan: the
 * `mode` proposal's token with the row's own catalogue key already encoded
 * (`modeToken`), so the model copies a token rather than spelling one. An
 * experimental one carries none, and the section says to name it in words:
 * whether the reader can open it is the switch's to say, and a token the
 * reader's page refuses is drawn as its raw brackets
 * (src/web/chat-commands.ts § `chipFor`). The page resolves every key against
 * what it can open now in any case; this only keeps the stray brackets down.
 */
export function modeWordsSection(rows: readonly CatalogueRow[] = catalogue): string {
  const ours = rows.filter(
    (row) => (row.kind === "mode" || row.kind === "submode") && row.contexts.includes(OWNER_ARTICLE),
  );
  const modes = ours.filter((row) => row.kind === "mode");
  const lines: string[] = [];
  for (const mode of modes) {
    const name = mode.id.slice("mode:".length);
    lines.push(`- ${mode.label}${experimental(mode)}: ${mode.description}.${button(mode)}`);
    for (const sub of ours) {
      if (sub.kind !== "submode" || !sub.id.startsWith(`submode:${name}:`)) continue;
      lines.push(`  - ${mode.label} › ${sub.label}${experimental(sub)}: ${sub.description}.${button(sub)}`);
    }
  }
  return `WHAT SPIDERYARN CAN SHOW THEM

These are the modes, in our own words. The reader opens one from the bottom bar
under the article, or by typing its name into the command bar (⌘K on a Mac,
Ctrl K elsewhere). A mode shows beside the article; it never replaces it. Use
these names exactly, so the reader can find what you mean. "(experimental)"
means the reader sees it only once they have turned on experimental features on
their profile page.

When you suggest a mode, you may put its button on a line of its own, after the
sentence saying what it would do for them: suggesting where to go is answering
here, so this is one of the times a button needs no asking. Write a mode's
button only by copying the token printed beside it, exactly. A mode with no
token printed beside it — every "(experimental)" one — has no button, however
well it fits: name it in words, and never spell a token for it yourself.

A quick search is worth offering unasked: when their reason for reading names a
topic, a method or a term they will want to find all of in the piece, offer it
as a search step under NEXT STEPS, where they can change the words first, not
as a button in your answer.

In this conversation, unlike the rule above, some actions you may take
yourself: the ones that only move the reader. They are a mode marked "Opens at
once:" and a jump-first. When your answer ends, the page does the first of
those in it for the reader, and any others stay buttons. So when one is the
right next step, write it on a line of its own as the last thing in your
answer, write at most one, and say you have done it ("I've opened Structure for
you, so you can see how the parts fit"; "I've taken you to where the method
starts"). Everything else stays an offer the reader presses — a mode marked
"Button:", which makes something new or changes their saved searches, a quick
search, a find, and the rest above — so for those, do not ask "Want me to open
it?" and do not say you have done it. The one exception: a mode marked
"Button:" that the line ALREADY MADE FOR THIS ARTICLE, beside their message,
names is already made, so opening it makes nothing, and in that answer it opens
at once like a mode marked "Opens at once:".

${lines.join("\n")}`;
}

/**
 * **The keys a guide's `mode` next step may name** (plan 261009s): the rows
 * `modeWordsSection` prints a button token beside, so not the experimental
 * ones, which it tells the model to name in words (GPT Sol's F3). The page's
 * `chipFor` still decides whether this reader can open one now.
 */
export function guideModeKeys(rows: readonly CatalogueRow[] = catalogue): ReadonlySet<string> {
  return new Set(
    rows
      .filter(
        (row) =>
          (row.kind === "mode" || row.kind === "submode") && row.contexts.includes(OWNER_ARTICLE) && experimental(row) === "",
      )
      .map((row) => row.id),
  );
}

/**
 * **The same modes, for a spoken guide** (plan 261009i): the labels and our
 * descriptions with no token beside any of them, since a voice has nowhere to
 * put a button and a model shown `[cmd:…]` in its instructions may read the
 * brackets aloud. The same rows and order as `modeWordsSection`.
 */
export function spokenModeWords(rows: readonly CatalogueRow[] = catalogue): string {
  const ours = rows.filter(
    (row) => (row.kind === "mode" || row.kind === "submode") && row.contexts.includes(OWNER_ARTICLE),
  );
  const lines: string[] = [];
  for (const mode of ours.filter((row) => row.kind === "mode")) {
    const name = mode.id.slice("mode:".length);
    lines.push(`- ${mode.label}${experimental(mode)}: ${mode.description}.`);
    for (const sub of ours) {
      if (sub.kind !== "submode" || !sub.id.startsWith(`submode:${name}:`)) continue;
      lines.push(`  - ${mode.label} › ${sub.label}${experimental(sub)}: ${sub.description}.`);
    }
  }
  return `WHAT SPIDERYARN CAN SHOW THEM

The modes, in our own words. The reader opens one from the bottom bar under the
article. Say a mode's name exactly as written here, so they can find it.
"(experimental)" means they see it only once they have turned on experimental
features on their profile page.

${lines.join("\n")}`;
}

/**
 * **The `mode` proposal's token for one catalogue row** — `[cmd:mode:<key>]`
 * with the key percent-encoded the way src/web/command-proposal.ts §
 * `formatProposalToken` encodes it. A key is lower-case letters, `-` and `:`
 * (command-match.ts § `commandId`), so `:` is the one character to encode.
 * tests/chat-command-chips-prompt.test.ts runs every token through the real
 * parser, so a key that ever needed more would fail there.
 */
export function modeToken(key: string): string {
  return `[cmd:mode:${key.replaceAll(":", "%3A")}]`;
}

/**
 * ` Opens at once: [cmd:mode:…]` for an ordinary row the guide may open
 * without a press, ` Button: [cmd:mode:…]` for one it may not, nothing for an
 * experimental one. The split is `modeActsAlone` (src/acts-alone.ts), the rule
 * the page applies when it does the opening (plan 261007p).
 */
function button(row: CatalogueRow): string {
  if (experimental(row) !== "") return "";
  return modeActsAlone(row.id, row.generates)
    ? ` Opens at once: ${modeToken(row.id)}`
    : ` Button: ${modeToken(row.id)}`;
}

function experimental(row: CatalogueRow): string {
  return row.contexts.includes(EXPERIMENTAL_OFF) ? "" : " (experimental)";
}

/* ----------------------------------------------------- the already-made line -- */

/**
 * **Which of the *Button* modes are already made for this article**, as the
 * line beside the reader's message, or `""` when none is (or the read failed:
 * the model then treats them as buttons, the safe direction). Plan
 * docs/plans/261008a-guide-opens-glossary-and-summary-when-already-made.md.
 *
 * Below the cache breakpoint like `experienceLine`, because it changes per
 * article and over time; the system prompt's sentence about it is static.
 * Each key is named as `modeWordsSection` names its row, so the model can find
 * the token printed beside it. The route sends the same snapshot to the page
 * on the `done` frame (`opensFree`, src/web/guide-acts.ts), so its act and the
 * model's sentence use one decision.
 */
export function madeLine(made: readonly MadeArtefact[] | null | undefined, rows: readonly CatalogueRow[] = catalogue): string {
  if (made === null || made === undefined) return "";
  const names: string[] = [];
  for (const key of keysOpenFree(made)) {
    const row = rows.find((r) => r.id === key && r.contexts.includes(OWNER_ARTICLE));
    if (row === undefined) continue;
    if (row.kind === "submode") {
      const parent = rows.find((r) => r.kind === "mode" && key.startsWith(`submode:${r.id.slice("mode:".length)}:`));
      names.push(parent === undefined ? row.label : `${parent.label} › ${row.label}`);
    } else names.push(row.label);
  }
  return names.length === 0 ? "" : `ALREADY MADE FOR THIS ARTICLE: ${names.join("; ")}.`;
}

/* --------------------------------------------------- the experience line -- */

/**
 * **How much the reader has used Spideryarn**, as a bucket and never a count.
 *
 * Measured as the other articles on their shelf they have opened at least once
 * (`ShelfStore.articlesOpenedBefore`): opening is closer to Greg's *"how many
 * articles they've already read"* than having added one. Bucketed because the
 * prompt needs the shape of it, not the number, and a coarse value is less of
 * the reader sent to a provider.
 */
export type GuideExperience = "none" | "a-few" | "many";

/** The most other articles opened that still count as "a few". */
export const A_FEW_ARTICLES = 5;

/**
 * The bucket for a count. **Throws on anything that is not a whole number at
 * least zero**, because a count arrives from the database and a driver that
 * hands back `"3"` instead of `3` is a bug to hear about, not a value to guess
 * at (src/store/pg-admin.ts § `.mapWith` has the trap).
 */
export function experienceOf(opened: number): GuideExperience {
  if (typeof opened !== "number" || !Number.isInteger(opened) || opened < 0) {
    throw new TypeError(`experienceOf: expected a whole number of articles, got ${typeof opened}`);
  }
  if (opened === 0) return "none";
  return opened <= A_FEW_ARTICLES ? "a-few" : "many";
}

/**
 * The line beside the question. `""` for no bucket, so a caller can join it
 * unconditionally — `profileSection`'s contract.
 */
export function experienceLine(experience: GuideExperience | null | undefined): string {
  switch (experience) {
    case null:
    case undefined:
      return "";
    case "none":
      return "HOW MUCH THEY HAVE USED SPIDERYARN: they have opened no other article still on their shelf.";
    case "a-few":
      return `HOW MUCH THEY HAVE USED SPIDERYARN: they have opened a few other articles still on their shelf (between one and ${A_FEW_ARTICLES}).`;
    case "many":
      return `HOW MUCH THEY HAVE USED SPIDERYARN: they have opened many other articles still on their shelf (more than ${A_FEW_ARTICLES}).`;
    default: {
      const unknown: never = experience;
      throw new Error(`unknown experience: ${String(unknown)}`);
    }
  }
}
