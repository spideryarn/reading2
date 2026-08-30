/**
 * Where the filesystem store puts things, and why it must be decided at call
 * time rather than at import.
 *
 * Two files derived their root by counting `".."` levels up from their own
 * module directory:
 *
 *     src/store/artifacts-fs.ts   path.resolve(import.meta.dirname, "..", "..")
 *     src/store/import.ts         path.resolve(import.meta.dirname, "../..")
 *
 * Correct in the source tree, where `src/store/` is two below the repository
 * root. Wrong once `vite.api.config.ts` bundles both into
 * `api-dist/vercel.js`, where two levels up is **`/var`** — so every deployed
 * import died at step 1 with
 *
 *     ENOENT: no such file or directory, mkdir '/var/data'
 *
 * and would have gone on failing had it been `/var/task`, because on Vercel
 * only `/tmp` is writable.
 *
 * ## Why the deployed root is scoped by JOB and not by owner
 *
 * GPT Sol found the hole in owner-scoping. `/tmp` survives between invocations
 * on a warm instance. Job A builds artefacts for URL A and then fails; nothing
 * was published, so the slug still reads free; job B — a **different URL** — is
 * handed the same slug, finds A's valid, parseable files warm in `/tmp`, skips
 * those steps, and publishes A's content under B's request. A job id makes that
 * impossible, at the price of a retry repurchasing the work, which is the right
 * way round.
 *
 * ## The case these tests exist for
 *
 * Deployed with no job scope must **throw**. Not a jobless `/tmp` path (that is
 * the collision above, one level up), and not the repository root (that is
 * `/var`, unwritable). `GET /api/source/:slug` in src/routes.ts is a real
 * caller in that state and it is a bug — docs/reusable/silent-success.md is the
 * whole argument for making it loud.
 */
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  chooseDataRoot,
  dataRoot,
  DATA_ROOT_ENV,
  findRepoRoot,
} from "../src/store/data-root.js";
import { fsLocations } from "../src/store/artifacts-fs.js";
import { runInJob } from "../src/job-scope.js";
import { type OwnerId, runAsOwner } from "../src/owner.js";

/* Its own id, claimed by no other suite — tests/fixture-ids.test.ts is the gate
   that says so. Nothing here inserts a row under it; it is only ever a path
   segment. */
const ALICE = "00000000-0000-4000-8000-0000000000da" as OwnerId;
const JOB = "spya-k3m9qt";

/** The real repository root, derived the one way that is not under test. */
const REPO = path.resolve(import.meta.dirname, "..");

/* `.env.local` is loaded into the test process (tests/…, see
   docs/project/testing.md and the loadEnvLocal note in vite.config.ts), so
   neither of these can be assumed unset — they are cleared explicitly and put
   back, rather than assumed. */
let savedVercel: string | undefined;
let savedOverride: string | undefined;

beforeEach(() => {
  savedVercel = process.env.VERCEL;
  savedOverride = process.env[DATA_ROOT_ENV];
  delete process.env.VERCEL;
  delete process.env[DATA_ROOT_ENV];
});

afterEach(() => {
  if (savedVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = savedVercel;
  if (savedOverride === undefined) delete process.env[DATA_ROOT_ENV];
  else process.env[DATA_ROOT_ENV] = savedOverride;
});

describe("findRepoRoot", () => {
  /**
   * The bundled case, stated as an exact answer rather than as "not `/var`".
   *
   * Sol's note on the plan: *test exact roots, not merely "is not `/var`"* — a
   * `not.toBe("/var")` passes for `/`, for `/var/task/api-dist` itself, and for
   * anything else the walk could wrongly return.
   */
  it("walks up to the marker, and never counts levels", () => {
    const packageJsonAt = (dir: string) => (p: string) =>
      p === path.join(dir, "package.json");

    expect(findRepoRoot("/var/task/api-dist", packageJsonAt("/var/task"))).toBe("/var/task");
    expect(findRepoRoot("/var/task/api-dist", packageJsonAt("/var/task"))).not.toBe("/var");
    /* Three levels deep instead of two: the same call, a different answer, which
       is the property counting `".."` cannot have. */
    expect(findRepoRoot("/a/b/c/d", packageJsonAt("/a"))).toBe("/a");
    expect(findRepoRoot("/a/b/c/d", packageJsonAt("/a/b/c/d"))).toBe("/a/b/c/d");
  });

  it("throws rather than returning the filesystem root when there is no marker", () => {
    expect(() => findRepoRoot("/var/task/api-dist", () => false)).toThrow(/package\.json/);
  });

  it("finds this repository from this module's own directory", () => {
    expect(findRepoRoot(import.meta.dirname)).toBe(REPO);
    expect(findRepoRoot(path.join(REPO, "src", "store"))).toBe(REPO);
  });
});

describe("chooseDataRoot", () => {
  const repoRoot = () => REPO;
  const none = () => null;
  const scoped = (ownerId: string, jobId: string) => () => ({ ownerId, jobId });

  it("is the repository root when not deployed", () => {
    expect(chooseDataRoot({ deployed: false, scope: none, repoRoot })).toBe(REPO);
  });

  it("is job-scoped under /tmp when deployed", () => {
    expect(
      chooseDataRoot({ deployed: true, scope: scoped(ALICE, JOB), repoRoot }),
    ).toBe(`/tmp/spideryarn/${ALICE}/${JOB}`);
  });

  it("throws when deployed with no job scope", () => {
    expect(() => chooseDataRoot({ deployed: true, scope: none, repoRoot })).toThrow(
      /job/i,
    );
  });

  it("lets the override win everywhere", () => {
    expect(
      chooseDataRoot({ override: "/somewhere/else", deployed: false, scope: none, repoRoot }),
    ).toBe("/somewhere/else");
    expect(
      chooseDataRoot({ override: "/somewhere/else", deployed: true, scope: none, repoRoot }),
    ).toBe("/somewhere/else");
    expect(
      chooseDataRoot({
        override: "/somewhere/else",
        deployed: true,
        scope: scoped(ALICE, JOB),
        repoRoot,
      }),
    ).toBe("/somewhere/else");
  });

  /* A job id reaches this from a URL path (`/api/jobs/:id/advance`) and an
     owner id from a session. Neither has any business containing a separator,
     and a root built by concatenation is exactly where one would matter. */
  it("refuses an id that could climb out of the scratch directory", () => {
    for (const jobId of ["..", "../..", "a/b", "", "."]) {
      expect(() =>
        chooseDataRoot({ deployed: true, scope: scoped(ALICE, jobId), repoRoot }),
      ).toThrow();
    }
    expect(() =>
      chooseDataRoot({ deployed: true, scope: scoped("../x", JOB), repoRoot }),
    ).toThrow();
  });
});

describe("dataRoot", () => {
  it("is the repository root locally, and fsLocations is unchanged", () => {
    expect(dataRoot()).toBe(REPO);
    expect(fsLocations("some-slug").dir).toBe(path.join(REPO, "data", "some-slug"));
    expect(fsLocations("some-slug").htmlFile).toBe(
      path.join(REPO, "output", "some-slug.html"),
    );
  });

  /**
   * Set **after** every module in this file has been imported, which is the
   * whole point: a root resolved at module load cannot be redirected later, and
   * a test that sets the variable in `beforeAll` would pass against that bug.
   */
  it("takes the override at call time, not at import", () => {
    process.env[DATA_ROOT_ENV] = "/tmp/spideryarn-test-override";
    expect(dataRoot()).toBe("/tmp/spideryarn-test-override");
    expect(fsLocations("s").dir).toBe("/tmp/spideryarn-test-override/data/s");
    delete process.env[DATA_ROOT_ENV];
    expect(dataRoot()).toBe(REPO);
  });

  it("is job-scoped when deployed inside a job", () => {
    process.env.VERCEL = "1";
    const root = runAsOwner(ALICE, () => runInJob(JOB, () => dataRoot()));
    expect(root).toBe(`/tmp/spideryarn/${ALICE}/${JOB}`);

    const at = runAsOwner(ALICE, () => runInJob(JOB, () => fsLocations("some-slug")));
    expect(at.dir).toBe(`/tmp/spideryarn/${ALICE}/${JOB}/data/some-slug`);
    expect(at.htmlFile).toBe(`/tmp/spideryarn/${ALICE}/${JOB}/output/some-slug.html`);
  });

  it("gives two jobs two roots, so one cannot read the other's artefacts", () => {
    process.env.VERCEL = "1";
    const a = runAsOwner(ALICE, () => runInJob("spya-aaaaaa", () => fsLocations("same-slug").dir));
    const b = runAsOwner(ALICE, () => runInJob("spya-bbbbbb", () => fsLocations("same-slug").dir));
    expect(a).not.toBe(b);
  });

  it("throws when deployed with no job scope", () => {
    process.env.VERCEL = "1";
    expect(() => dataRoot()).toThrow(/job/i);
    expect(() => fsLocations("some-slug")).toThrow(/job/i);
    /* An owner is not enough: the collision Sol found is between two jobs of the
       SAME owner. */
    expect(() => runAsOwner(ALICE, () => dataRoot())).toThrow(/job/i);
  });

  it("still honours the override when deployed with no job scope", () => {
    process.env.VERCEL = "1";
    process.env[DATA_ROOT_ENV] = "/tmp/spideryarn-test-override";
    expect(dataRoot()).toBe("/tmp/spideryarn-test-override");
  });
});
