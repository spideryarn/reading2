/**
 * The two judgements `scripts/db-corpus-readiness.ts` makes, away from the
 * database that supplies their inputs.
 *
 * Same split, and for the same reason, as `scripts/migration-ledger.ts`: a
 * verdict that can only be exercised by having a corpus in the wrong state is a
 * verdict nobody ever watches fail. Both of these have already been green while
 * being wrong —
 * docs/plans/260831ag-migration-watermark-repair-code-review-sol.md §§ 3-4 —
 * so both are pure here and `tests/corpus-verdict.test.ts` feeds them the
 * shapes they exist to reject.
 */

/** What the corpus is made of. Zero of any of these is a failing answer. */
export interface CorpusCounts {
  articles: number;
  revisions: number;
  refs: number;
}

/**
 * Everything that makes this corpus not ready. Empty means ready.
 *
 * **The count checks are the point.** The two per-row checks are green over an
 * empty corpus by having nothing to fail on, and an empty corpus is exactly
 * what a botched refetch leaves behind — the script's own header said so while
 * printing `✓ ready` over it. Zero articles, zero revisions or zero source
 * references is therefore a failure.
 *
 * It is still **not** enough to catch one article silently skipped. That needs
 * an expected inventory — a count or a slug list to compare against — and there
 * isn't one yet, so this is a floor rather than a proof. GPT Sol, § 3.
 */
export function readinessFailures(
  counts: CorpusCounts,
  orphanedRevisions: number,
  unreadableReferences: number,
): string[] {
  const failures: string[] = [];
  if (orphanedRevisions > 0) {
    failures.push(`${orphanedRevisions} revision(s) have stamped HTML and no extracted HTML`);
  }
  if (unreadableReferences > 0) {
    failures.push(`${unreadableReferences} source reference(s) could not be read back`);
  }
  if (counts.articles === 0) failures.push("there are no articles at all");
  if (counts.revisions === 0) failures.push("there are no article revisions at all");
  if (counts.refs === 0) failures.push("no revision names a source object");
  return failures;
}

/**
 * The two faults `--seed-a-bad-row` plants, inside a transaction it rolls back.
 *
 * `null` means it could not be planted — no revision to break, or no revision
 * naming a source object. That is a control that **could not be run**, which is
 * not the same as one that passed.
 */
export interface Seeds {
  /** The revision given stamped HTML and no extracted HTML, for check 1. */
  orphanedRevision: string | null;
  /** The sha a revision's source reference was repointed at, for check 2. */
  danglingSha: string | null;
}

/** What `--seed-a-bad-row` proved, or failed to. */
export interface ControlVerdict {
  /** Did each check name the exact fault planted for it? */
  sawIt: boolean;
  say: string;
}

/**
 * **Did the negative control actually detect the faults it planted?**
 *
 * This used to be decided by the shared failure counter, so check 1 could miss
 * the seed entirely and the control would still report success as long as check
 * 2 had failed for some unrelated reason — a control that passes without
 * detecting anything, quoted afterwards as evidence that the check works. It is
 * now tied to the seeded identifiers and nothing else. GPT Sol, § 4.
 *
 * **Check 2 has a control now too.** It used to say, honestly, that it had
 * none: proving it would mean deleting an object out of the bucket, and a
 * rollback cannot put that back. But the other half of the reference is a
 * *row*, and repointing it at a sha nothing is stored under produces exactly
 * the dangling reference the check exists for — inside the transaction, undone
 * on the way out. It does not prove detection of the wrong bytes under the
 * right key; the re-hash in `readRawDocument` is what would catch that, and it
 * stays unproven here rather than assumed.
 */
export function controlVerdict(
  seeds: Seeds,
  namedByCheckOne: readonly string[],
  namedByCheckTwo: readonly string[],
): ControlVerdict {
  const couldNotRun: string[] = [];
  if (seeds.orphanedRevision === null) couldNotRun.push("there are no revisions to break for check 1");
  if (seeds.danglingSha === null) couldNotRun.push("no revision names a source object, so check 2 has nothing to break");
  if (couldNotRun.length) {
    return {
      sawIt: false,
      say:
        `✗ Nothing to seed — ${couldNotRun.join("; ")}.\n` +
        "  A control that cannot be run has not passed.",
    };
  }

  const missed: string[] = [];
  if (!namedByCheckOne.includes(seeds.orphanedRevision!)) {
    missed.push(`CHECK 1 DID NOT NAME revision ${seeds.orphanedRevision}`);
  }
  if (!namedByCheckTwo.includes(seeds.danglingSha!)) {
    missed.push(`CHECK 2 DID NOT NAME the dangling reference ${seeds.danglingSha}`);
  }
  if (missed.length) {
    return {
      sawIt: false,
      say:
        `⚠ ${missed.join("\n⚠ ")}\n` +
        "  That check cannot fail, so a green run from it means nothing. Fix it first.",
    };
  }
  return {
    sawIt: true,
    say:
      `Check 1 named revision ${seeds.orphanedRevision} and check 2 named the dangling\n` +
      `reference ${seeds.danglingSha}. Both are the faults this flag planted; both can fail.`,
  };
}
