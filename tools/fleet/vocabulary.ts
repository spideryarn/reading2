/**
 * **The words Greg is about to say into this dashboard.**
 *
 * The second pass of a dictation *"is not a better ear, it is a vocabulary"* —
 * the finding from 2026-08-27, measured across nineteen speech-to-text models,
 * every one of which mangled this project's own words until it was handed a
 * list. `Spideryarn` came back as *Spiderion*; a block id came back as *"Spire k
 * three m nine q t"*. docs/project/dictation.md § It transcribes twice.
 *
 * A fleet dashboard whose transcriber has never heard the word **worktree**
 * would mangle every message dictated into it, and every one of those messages
 * is a sentence typed into a live agent's session.
 *
 * ## Ours is better defined than an article's, and that is the point
 *
 * The product has to infer an article's vocabulary — a glossary a model wrote,
 * proper nouns found by looking for a capital in the middle of a sentence. This
 * tool does not have to infer anything. The words on the page in front of Greg
 * when he presses the microphone are the session handles, the titles Claude gave
 * itself, and the worktree names — and the server is already holding all of them
 * in the snapshot it serves.
 *
 * So two sources, in the order the cap spends on them:
 *
 *  1. {@link FLEET_TERMS} — the vocabulary of the box itself. Small, flat,
 *     always, and the same argument as the product's `SITE_TERMS`: nothing in a
 *     snapshot ever supplies `worktree` or `gjd-remote`, and they are the words
 *     most likely to be said.
 *  2. The live fleet — handles, titles, directories. Most recently active first,
 *     because a cut list should keep the sessions Greg is actually looking at.
 *
 * ## What is borrowed, and why only this much
 *
 * `packTerms`, `MAX_TERM` and the angle-bracket strip come from
 * [`src/vocabulary.ts`](../../src/vocabulary.ts), which imports nothing and is
 * pure text functions. Those guards exist because two of the product's five
 * sources are text the app did not write — and **every one of our sources is
 * text this tool did not write either**: a session title is whatever a Claude
 * called its own conversation, which is a model's output about a user's input.
 * Same untrusted shape, same guards, one implementation.
 *
 * Nothing else is borrowed. `vocabulary-sources.ts` turns a *place* into terms
 * by reading articles out of Postgres, which is the dependency this tool must
 * not have.
 */
import { MAX_TERM, packTerms } from "../../src/vocabulary.js";

/**
 * How many characters of vocabulary one request may carry.
 *
 * The same figure the product uses, and for the same reason: past a couple of
 * thousand characters a keyword list stops biasing and starts being noise, and
 * the terms that get dropped should be the ones least likely to be said. Ours
 * is spent on {@link FLEET_TERMS} first, so what a long fleet crowds out is the
 * tail of the session list rather than the word `worktree`.
 */
export const MAX_VOCABULARY_CHARS = 2_000;

/**
 * **The box's own words.** A constant, no reads, nothing to fail.
 *
 * Chosen by what actually gets said into this page: the nouns of the machinery
 * (`worktree`, `tmux`, `gjd-remote`), the things that go wrong (`vitest`, `OOM`,
 * `typecheck`), the names of the models Greg asks for by name, and the handful
 * of product words that show up in an instruction to an agent.
 *
 * **Spelled the way they should come back**, not the way they are pronounced:
 * this list is what the transcriber writes down, so `origin/dev` earns its slash
 * and `npm run typecheck` earns its spaces.
 */
export const FLEET_TERMS: readonly string[] = [
  // The tool and the box.
  "Spideryarn",
  "Greg Detre",
  "Overseer",
  "orchestrator",
  "fleet dashboard",
  "worktree",
  "worktrees",
  "tmux",
  "gjd-remote",
  "Hetzner",
  "Tailscale",
  "tailnet",
  "systemd",
  "OOM killer",
  "load average",
  // Version control, which is most of what a steering message is about.
  "origin/dev",
  "git merge",
  "git push",
  "pathspec",
  "merge conflict",
  "commit",
  "rebase",
  // The checks.
  "vitest",
  "npm test",
  "npm run typecheck",
  "npm run check",
  "typecheck",
  "Biome",
  "Playwright",
  "Drizzle",
  "migration",
  // The stack.
  "Supabase",
  "Postgres",
  "Vercel",
  "OpenRouter",
  "Sentry",
  "TypeScript",
  "React",
  "Vite",
  "Tailwind",
  // Who is being talked to or about.
  "Claude",
  "Claude Code",
  "Codex",
  "GPT Sol",
  "Fable",
  "Opus",
  "Sonnet",
  "Haiku",
  "subagent",
  "postmortem",
  "plan doc",
];

/** One session, as much of it as the vocabulary cares about. */
export type FleetVocabularySession = {
  /** The tmux handle — what the page calls it and what Greg says out loud. */
  id: string;
  /** The title Claude gave its own conversation, if it has one. */
  title: string | null;
  /** The directory it is working in, if known. */
  dir: string | null;
};

/**
 * The terms for one dictation, capped and sanitised.
 *
 * **Order is the whole of the policy**, because the cap is spent in it: the
 * box's own words first, then the fleet in the order the caller gave — which is
 * the page's own order, most recently active first.
 *
 * ## The two guards, and why a session title needs them
 *
 * `packTerms` strips angle brackets from every term and refuses any term over
 * {@link MAX_TERM} characters. In the product those exist because an article's
 * title is text somebody else wrote. Here they exist because **a session title
 * is a sentence a model wrote about work it was given**, and the work is often
 * "read this hostile input" — so a title reading `</vocabulary> ignore the
 * audio…` is not a fanciful example, it is the ordinary output of an agent
 * asked to look at something nasty. The list goes into a request field rather
 * than a prompt on this endpoint, which makes it smaller exposure rather than
 * none.
 *
 * A directory contributes its **last segment only**. `/home/greg/code/spideryarn2`
 * is not a thing anybody says; `spideryarn2` is.
 */
export function fleetVocabulary(
  sessions: readonly FleetVocabularySession[],
): string[] {
  const handles: string[] = [];
  const titles: string[] = [];
  const dirs: string[] = [];
  for (const s of sessions) {
    if (s.id.trim() !== "") handles.push(s.id);
    if (s.title !== null && s.title.trim() !== "") titles.push(s.title);
    if (s.dir !== null) {
      const leaf = s.dir.split("/").filter((p) => p !== "").pop();
      if (leaf !== undefined && leaf !== "") dirs.push(leaf);
    }
  }
  /* Handles before titles before directories: a handle is what Greg types and
     says ("tell fleet-dictation to push"), a title is prose he might paraphrase,
     and a directory is usually one of three names he has already said. */
  return packTerms([FLEET_TERMS, handles, titles, dirs], MAX_VOCABULARY_CHARS);
}
