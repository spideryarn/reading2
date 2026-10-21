/**
 * **Get a mode ready in the background, without opening it** — the server half
 * of the guide's `prepare` step. Plan docs/plans/261019p-guide-chat-plainer.md
 * § Stage 2b, after Greg's reply to q-y4p2ct (*"the Guide has the option to do
 * A … if it's not confident that the user will want it, it just does B"*).
 *
 * One function for both presses: the reader's on *Get Skim ready* (B), and the
 * one the page makes itself for a step the guide marked `now` (A), whose
 * once-a-conversation claim the route makes first (`POST /api/guide-prepare`).
 *
 * It starts **the job the mode's own band would**, through `enqueue`, which
 * already refuses an article this reader does not own or a minimal paper, and
 * hands back an identical job already queued. Nothing here opens a mode.
 *
 * - **Made already: nothing is queued.** A mode written for an older profile is
 *   left as it is; its own notice says so, and a regeneration would replace
 *   what the reader may already have read.
 * - **Skim is the one exception** — Greg's *"generate a Skim-route based on
 *   what they're saying"* (`spya-yt2v73`): a route planned for another profile,
 *   whose notice the reader has not sent away for this one, is planned again
 *   with `skim` forced, which is the banner's *Plan it again*.
 * - **Not made: the steps the band would post.** Skim's Quotes and Ideas only
 *   when missing or stale, as `quotesFirst` and `ideasFirst` in
 *   src/web/useSkim.ts (GPT Sol's F2 on the plan): naming them otherwise lets
 *   `stepIsDone` re-buy and replace a reader's Quotes or profiled Ideas.
 */
import { enqueue } from "./jobs.js";
import { preparable } from "./preparable-modes.js";
import { hashProfile } from "./profile.js";
import { profileNoticeKey, routeProfileIsStale } from "./skim.js";
import {
  loadGlossary,
  loadIdeas,
  loadQuiz,
  loadQuotes,
  loadSimpleSummary,
  loadSkim,
  loadTweets,
} from "./store/index.js";
import { ArtefactNotMadeYet } from "./store/artefact-not-made-yet.js";
import type { Job, StepName } from "./types.js";

/** What a press did: started a job, or found the mode made. */
export type Prepared = { status: "started"; job: Job } | { status: "ready" };

/** Whether the mode's own read finds something: `null` is not made yet. */
async function made<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (err) {
    if (err instanceof ArtefactNotMadeYet) return null;
    throw err;
  }
}

/** The read whose answer says whether the step's artefact is there. Skim's has its own branch below. */
function loaderFor(step: "simple" | "tweets" | "glossary" | "quotes" | "ideas" | "quiz"): (slug: string) => Promise<unknown> {
  switch (step) {
    case "simple":
      return loadSimpleSummary;
    case "tweets":
      return loadTweets;
    case "glossary":
      return loadGlossary;
    case "quotes":
      return loadQuotes;
    case "ideas":
      return loadIdeas;
    case "quiz":
      return loadQuiz;
    default: {
      const never: never = step;
      throw new Error(`no loader for ${String(never)}`);
    }
  }
}

/**
 * Start the mode named by `key`, or say it is made. `profile` is the reader's,
 * resolved by the route as `POST /api/jobs` resolves it, so the job is made for
 * who is reading now. Throws for a key off the list (400): the route checks
 * first, so that is a bug.
 */
export async function prepareMode(slug: string, key: string, profile: string | null): Promise<Prepared> {
  const entry = preparable(key);
  if (entry === undefined) throw Object.assign(new Error("That mode cannot be prepared."), { status: 400 });
  const queue = async (steps: StepName[], force?: StepName[]): Promise<Prepared> => ({
    status: "started",
    job: await enqueue({ slug, steps, ...(force ? { force } : {}), ...(profile ? { profile } : {}) }),
  });

  const step = entry.step;
  if (step !== "skim") {
    if ((await made(() => loaderFor(step)(slug))) !== null) return { status: "ready" };
    return queue([step]);
  }

  const route = await made(() => loadSkim(slug));
  if (route !== null) {
    const nowHash = profile ? hashProfile(profile) : null;
    const stale = routeProfileIsStale(route.skim.profileHash, nowHash);
    const dismissed = route.profileNoticeDismissedFor === profileNoticeKey(route.skim.generatedAt, nowHash);
    return stale && !dismissed ? queue(["skim"], ["skim"]) : { status: "ready" };
  }
  const [quotes, ideas] = await Promise.all([made(() => loadQuotes(slug)), made(() => loadIdeas(slug))]);
  return queue([
    ...(quotes === null || quotes.stale ? (["quotes"] as const) : []),
    ...(ideas === null || ideas.stale ? (["ideas"] as const) : []),
    "skim",
  ]);
}
