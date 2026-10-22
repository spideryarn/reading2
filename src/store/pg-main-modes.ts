/**
 * **The main-mode jobs, queued on a transaction somebody else holds** — the one
 * loop both callers share, so the list, the order, the profile and the stamps
 * cannot drift between them.
 *
 * Two callers, each deciding *whether* for its own reason:
 *
 * - an import's first full publication (`queueMainModesIn`,
 *   src/store/pg-revisions.ts), which reads the owner's *Generate the main
 *   modes* switch first — plan 261004h;
 * - a new gift (`prepareGiftArticleIn`, src/store/pg-gift-prep.ts), which does
 *   not: Greg's "by default" is about the articles he gives, his import switch
 *   about his own reading — plan 261021j § D2.
 *
 * **Why a file of its own**: the gift path must not import pg-revisions.ts,
 * the publication path, to reach a loop; and that file must not import the
 * gift path. Both import this leaf instead.
 */

import { eq } from "drizzle-orm";

import { autoModePosts } from "../auto-mode-steps.js";
import type { getDb } from "../db/client.js";
import { readerProfiles } from "../db/schema.js";
import { renderProfile } from "../profile.js";
import type { OwnerId, StepName } from "../types.js";
import { enqueueSuccessorIn, type SuccessorOutcome } from "./pg-successor.js";

type Db = ReturnType<typeof getDb>;
/** A transaction, spelled the way src/store/pg-successor.ts spells it. */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * The main-mode jobs in the order they are queued: the ones that read nothing,
 * then the rest (`autoModePosts`, src/auto-mode-steps.ts). One function so the
 * insert loop and every log line index the same list.
 */
export function autoModeJobs(): StepName[][] {
  const { together, after } = autoModePosts();
  return [...together, ...after];
}

/** The owner's `reader_profiles` row as these callers need it; no row is `undefined`. */
export async function readerProfileOf(
  tx: Tx,
  ownerId: string,
): Promise<{ profile: string | null; autoModesOffAt: Date | null } | undefined> {
  const [reader] = await tx
    .select({ profile: readerProfiles.profile, autoModesOffAt: readerProfiles.autoModesOffAt })
    .from(readerProfiles)
    .where(eq(readerProfiles.ownerId, ownerId))
    .limit(1);
  return reader;
}

/**
 * **Queue one job per main-mode request, unforced, on `tx`**, one microsecond
 * apart in `autoModeJobs()` order, and answer one outcome per request in that
 * order.
 *
 * The profile is rendered **here**, from the owner's "about you" and this
 * article's purpose, exactly as `resolveProfile` (src/routes.ts) renders it
 * for a press, and left off when there is none — so a reader's own identical
 * press, and the other caller's identical job, have the same work key and
 * collapse onto one row rather than queueing twice.
 *
 * `notBefore`: a job these must sort after (`enqueueSuccessorIn`) — the labels
 * job, for a publication. Absent for a gift, which has no predecessor of its
 * own: whatever is already queued on the article claims first anyway, by
 * `created_at`.
 *
 * `replacementScope`: gifts pass the revision they found under the article
 * lock. If an identical unscoped job already owns a draft, it may be based on
 * an older revision and unable to publish; queue one revision-scoped
 * replacement rather than reporting that holder as the gift's preparation.
 * Imports omit it, preserving their established `boundToOlderBase` outcome.
 */
export async function enqueueMainModesIn(
  tx: Tx,
  article: { readonly ownerId: string; readonly slug: string; readonly purpose: string | null },
  readerProfile: string | null,
  notBefore?: string,
  replacementScope?: string,
): Promise<SuccessorOutcome[]> {
  const profile = renderProfile({ profile: readerProfile, purpose: article.purpose });
  const queued: SuccessorOutcome[] = [];
  for (const [i, steps] of autoModeJobs().entries()) {
    const ask = {
      ownerId: article.ownerId as OwnerId,
      slug: article.slug,
      steps,
      ...(profile ? { profile } : {}),
      after: i + 1,
      ...(notBefore !== undefined ? { notBefore } : {}),
    };
    const first = await enqueueSuccessorIn(tx, ask);
    queued.push(
      first.kind === "boundToOlderBase" && replacementScope !== undefined
        ? await enqueueSuccessorIn(tx, { ...ask, scope: replacementScope })
        : first,
    );
  }
  return queued;
}
