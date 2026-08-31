/**
 * The directory the filesystem store hangs `data/` and `output/` off.
 *
 * One function, called at the moment a path is needed, so that everything which
 * decides it — an environment variable, whether this is a deployment, which job
 * is running — is read then rather than frozen at import.
 *
 * ## The bug this replaces
 *
 * src/store/artifacts-fs.ts and src/store/import.ts each held
 *
 *     const ROOT = path.resolve(import.meta.dirname, "..", "..");
 *
 * at module scope. Two levels above `src/store/` is the repository root, which
 * is right, and it stays right until `vite.api.config.ts` bundles both modules
 * into `api-dist/vercel.js` — where two levels up is **`/var`**. Every deployed
 * article import failed at step 1 with
 *
 *     ENOENT: no such file or directory, mkdir '/var/data'
 *
 * and fixing the arithmetic would not have helped: on Vercel the whole
 * filesystem is read-only except `/tmp`. src/vercel.ts § *Where this file is,
 * and where it runs from* names the same trap for the database CA certificate,
 * which production works around with `PGSSLROOTCERT`.
 *
 * So the root is **found**, not counted — `findRepoRoot` walks up for a
 * `package.json` — and counting levels must not come back. A walk gives the
 * same answer from `src/store/`, from `tests/`, and from a bundle at any depth;
 * arithmetic gives a different wrong answer for each.
 *
 * ## Why the deployed root is scoped by job, and not by owner
 *
 * `/tmp` is per-instance, not per-invocation: a warm Lambda serves the next
 * request with the previous one's files still there. GPT Sol found what an
 * owner-scoped root does with that. Job A builds artefacts for URL A and then
 * fails. Nothing was published, so the slug still reads free. Job B — a
 * **different URL** — is handed that slug, finds A's files warm in `/tmp`,
 * finds them valid and parseable, skips those steps, and publishes A's content
 * under B's request. Every check involved reports success
 * (docs/reusable/silent-success.md).
 *
 * A job id in the path makes it impossible rather than unlikely. The price is
 * that a retry gets a new job id and repays for the work already done, and that
 * is the right way round: paying twice is a cost, serving the wrong article is
 * a defect.
 *
 * ## Deployed with no job is an error, deliberately
 *
 * There are two answers available in that state and both are wrong. A jobless
 * `/tmp/spideryarn/<owner>/` is the collision above with one fewer level. The
 * repository root is `/var`, which is unwritable, so a *write* would fail
 * loudly — but a *read* would quietly find nothing and report an article that
 * exists as absent.
 *
 * `GET /api/source/:slug` (src/routes.ts) **was** a real caller in exactly that
 * state, and stopped being one on 2026-08-31: `sendSource` went through
 * `sourceStore` (src/store/index.ts), so on a deployment it reads the article's
 * source document out of Postgres and the `sources` bucket and never asks this
 * function anything. docs/plans/finish-the-database-move.md, stage 1.
 *
 * The refusal stays, and it is not now decorative. Anything else that reaches a
 * path outside `runInJob()` on a deployment lands here, and the two answers
 * available to it are still the two wrong ones — so it must go on failing with
 * a sentence naming the problem rather than answering wrongly.
 */

import { existsSync } from "node:fs";
import path from "node:path";

import { currentJobId } from "../job-scope.js";
import { currentOwnerId } from "../owner.js";

/**
 * The override, which wins everywhere.
 *
 * For tests that want a scratch tree, and for operations — pointing a local
 * import at a copy of `data/` without moving anything. It is checked before the
 * deployment question, so it is also the escape hatch if a deployed job ever
 * genuinely needs a fixed root.
 */
export const DATA_ROOT_ENV = "SPIDERYARN_DATA_ROOT";

/** Where a deployed instance is allowed to write at all. */
const SCRATCH = "/tmp/spideryarn";

/** The marker that says "this directory is the repository". */
const MARKER = "package.json";

/** Who and what a deployed root is scoped to. */
export interface JobScope {
  readonly ownerId: string;
  readonly jobId: string;
}

/**
 * The nearest ancestor of `from` — itself included — holding a `package.json`.
 *
 * `exists` is injected so that the case this function exists for can be tested
 * without a `/var/task` to test it in. A test that only asserts *not `/var`*
 * would pass for `/`, for the starting directory, and for anything else a
 * broken walk could return, so tests/data-root.test.ts asserts the exact
 * answer.
 *
 * **Throws rather than returning `/`.** A filesystem root is a plausible-
 * looking path that every subsequent `mkdir` would try to use, and the failure
 * would surface three layers away as a permissions error on a directory nobody
 * meant to create.
 */
export function findRepoRoot(from: string, exists: (p: string) => boolean = existsSync): string {
  let dir = path.resolve(from);
  for (;;) {
    if (exists(path.join(dir, MARKER))) return dir;
    const up = path.dirname(dir);
    if (up === dir) {
      throw new Error(
        `No ${MARKER} in any directory above ${from}, so there is no repository root to ` +
          `hang data/ and output/ off. Set ${DATA_ROOT_ENV}. See src/store/data-root.ts.`,
      );
    }
    dir = up;
  }
}

/**
 * One path segment, or a clear error.
 *
 * A job id arrives from a URL (`/api/jobs/:id/advance`) and an owner id from a
 * session, and both are concatenated into a filesystem path here. Neither has
 * any business containing a separator or a `..`, so this says so rather than
 * trusting that the minting functions upstream will never change.
 */
function segment(what: string, value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) || value.includes("..")) {
    throw new Error(`Not usable as a directory name: ${what} ${JSON.stringify(value)}`);
  }
  return value;
}

/** Everything the answer depends on, with the two expensive halves left unread. */
export interface RootInputs {
  /** `SPIDERYARN_DATA_ROOT`, if set. Wins over everything below. */
  readonly override?: string | undefined;
  /** Whether this is running somewhere a reader could reach. */
  readonly deployed: boolean;
  /** The job in scope. Consulted **only** when deployed. */
  readonly scope: () => JobScope | null;
  /** The repository root. Consulted **only** when not deployed. */
  readonly repoRoot: () => string;
}

/**
 * The decision itself, with no globals in it — the whole of the logic, testable
 * without an environment.
 *
 * Both inputs are thunks because each is wrong to evaluate in the other's
 * branch: walking for a `package.json` on a deployment finds `/var/task`, which
 * is read-only, and asking for the current owner on a laptop can throw inside a
 * request that has not been authenticated yet (src/owner.ts).
 */
export function chooseDataRoot(inputs: RootInputs): string {
  if (inputs.override) return inputs.override;
  if (!inputs.deployed) return inputs.repoRoot();

  const scope = inputs.scope();
  if (!scope) {
    throw new Error(
      "Deployed with no job in scope, so there is nowhere to put this article's files. " +
        "Only /tmp is writable here and it must be scoped to one job, or a failed job's " +
        "artefacts get served as the next job's. Wrap the work in runInJob() " +
        "(src/job-scope.ts), or set " +
        `${DATA_ROOT_ENV}. See src/store/data-root.ts.`,
    );
  }
  return path.join(
    SCRATCH,
    segment("owner id", scope.ownerId),
    segment("job id", scope.jobId),
  );
}

/**
 * Found once per process, then remembered.
 *
 * Not a module-load constant — nothing runs until somebody asks — but the
 * answer cannot change while the process lives, and `fsLocations` is called on
 * every artefact read of every step of every job. The memo holds no environment
 * variable, so nothing a test sets later is baked into it.
 */
let repoRoot: string | null = null;

function thisRepoRoot(): string {
  repoRoot ??= findRepoRoot(import.meta.dirname);
  return repoRoot;
}

/**
 * Where `data/` and `output/` live, right now.
 *
 * Call it; never hoist it into a `const` at module scope, which is the bug the
 * header describes.
 *
 * `VERCEL` directly rather than `isDeployed()` from src/monitoring.ts, and the
 * difference is one line of that function: `SENTRY_FORCE_LOCAL=1` makes it
 * answer true so a laptop can exercise the error reporter. That is a fine
 * question for Sentry and the wrong one here — it would move a developer's
 * `data/` into `/tmp` and demand a job scope, on a machine where neither is
 * true.
 */
export function dataRoot(): string {
  return chooseDataRoot({
    override: process.env[DATA_ROOT_ENV],
    deployed: Boolean(process.env.VERCEL),
    scope: () => {
      const jobId = currentJobId();
      return jobId === null ? null : { ownerId: currentOwnerId(), jobId };
    },
    repoRoot: thisRepoRoot,
  });
}
