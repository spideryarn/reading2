/**
 * **Which Storage project the next command is about to read — or write.**
 *
 * Shared by `scripts/check-buckets.ts` (which reports, and with `--apply`
 * repairs) and `scripts/deploy.ts` (which refuses to ship on drift), so the two
 * cannot come to disagree about what "production" means.
 *
 * ## The accident this exists to prevent
 *
 * `check-buckets.ts` calls `loadEnvLocal()`, and `.env.local` deliberately beats
 * the shell (src/env.ts, and the reason is a good one). So the invocation its
 * own header documented for years —
 *
 *     SUPABASE_URL=<remote> SUPABASE_SERVICE_ROLE_KEY=<key> npx tsx scripts/check-buckets.ts
 *
 * — could not reach production on any machine with a `.env.local`. It printed
 * `✓ every declared bucket matches the running project`, exit 0, **about the
 * Docker container**. Measured 2026-09-03, not reasoned about. Anybody who ran
 * the check to ask whether production had drifted was told it had not, while it
 * had: the `sources` bucket on production has said `{application/pdf,
 * text/html}` since 2026-08-27 and every `image/jpeg` upload has thrown a 415.
 * docs/postmortems/260828a-the-config-file-is-not-the-bucket.md, and
 * docs/plans/260903j-illustrated-415-and-one-click-paint.md.
 *
 * The check written to catch a class of silent success was an instance of it
 * (docs/reusable/silent-success.md).
 *
 * ## So the target is a flag, and it is always printed
 *
 * `--prod` reads `.env.prod` through the shared `readEnvProd` — the same escape
 * hatch `scripts/check-owner-identity.ts` and `scripts/stripe-target.ts` use,
 * and for the same reason. And **every mode prints the project it reached**,
 * above the verdict, including the safe local ones: a line that appears only
 * when something is dangerous is a line nobody has ever read. AGENTS.md says to
 * read the `Target:` line rather than the success line, which needs there to be
 * one.
 *
 * The judgement — where a bucket and the file disagree — is `bucketDrift` in
 * ./deploy-checks.ts, which is pure and tested against fixtures. This file
 * chooses the project, fetches, and writes.
 */
import { bucketDrift, declaredBuckets } from "./deploy-checks.js";
import type { DeclaredBucket, RunningBucket } from "./deploy-checks.js";

/** A Storage project to talk to, and where its credentials came from. */
export interface StorageTarget {
  url: string;
  /** Never printed, never logged, never put in an error message. */
  key: string;
  /** Human-readable provenance — a `.env.prod` path, or the environment. */
  from: string;
}

/** What `readEnvProd()` returns, restated so this file does not import for a type alone. */
export type EnvProd = { file: string; values: Record<string, string> } | null;

/**
 * Which project, over injected inputs — the part worth testing.
 *
 * Split from the scripts for the reason `chooseTargetUrl` is split from
 * `resolveTargetUrl` in src/env.ts: the real thing reads the real `.env.prod`
 * and the real `process.env`, so a test driven through it would be testing this
 * machine rather than the rule. And the rule is the part that was wrong.
 *
 * @param prod  whether `--prod` was passed
 * @param env   `process.env`, **after** `loadEnvLocal()` has run
 * @param found `readEnvProd()`, or `null` when `--prod` was not asked for
 * @returns the target, or `null` when nothing is configured at all — which is a
 *   legitimate laptop and not an error, but must be reported loudly by the
 *   caller rather than passed over.
 * @throws when `--prod` was asked for and cannot be honoured. **Refusing is the
 *   whole job.** A `--prod` that quietly fell back to `.env.local` would print a
 *   verdict about the Docker container in the shape of a verdict about
 *   production — and with `--apply`, would write to it.
 */
export function chooseStorage(opts: {
  prod: boolean;
  env: Readonly<Record<string, string | undefined>>;
  found: EnvProd;
}): StorageTarget | null {
  if (opts.prod) return productionStorage(opts.found);
  const url = opts.env.SUPABASE_URL?.trim();
  const key = opts.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return { url, key, from: ".env.local or the shell environment" };
}

/**
 * The production half of `chooseStorage`, which is the half that can refuse.
 *
 * Separate so that a caller who has already decided on production — the deploy
 * gate, which has no other mode — gets a `StorageTarget` rather than a
 * `StorageTarget | null` it has to cast away. A cast at that seam would be a
 * type assertion nothing can check, over exactly the value that decides which
 * project gets written to.
 */
export function productionStorage(found: EnvProd): StorageTarget {
  if (!found) {
    throw new Error(
      "There is no .env.prod in this checkout or the primary one, so there is no way to say " +
        "which project production is. See docs/project/database.md.",
    );
  }
  const url = found.values.SUPABASE_URL?.trim();
  const key = found.values.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const missing = [
    url ? null : "SUPABASE_URL",
    key ? null : "SUPABASE_SERVICE_ROLE_KEY",
  ].filter((n): n is string => n !== null);
  if (missing.length > 0 || !url || !key) {
    throw new Error(`${found.file} has no ${missing.join(" and no ")}.`);
  }

  const notProd = whyNotProductionStorage(url);
  if (notProd) {
    throw new Error(`SUPABASE_URL in ${found.file} is not a production project — ${notProd}.`);
  }

  return { url, key, from: found.file };
}

/**
 * Why this is not a hosted Supabase project, or `null`.
 *
 * **Positively classified**, rather than a list of local spellings to refuse.
 * `scripts/stripe-target.ts` § `whyNotProduction` has the whole argument and the
 * measurements behind it: a guard that refuses what it recognises accepts
 * everything it does not, and `local%68ost` is a hostname `new URL` and `fetch`
 * read differently. Production here is always `https://<ref>.supabase.co`, so
 * that is the shape to require. A custom domain would be refused — loudly,
 * which is the safe direction, and the message says what it wanted.
 */
export function whyNotProductionStorage(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "it is not a parsable URL";
  }
  if (parsed.protocol !== "https:") return `it is ${parsed.protocol}//, not https://`;
  if (!/^[a-z0-9]+\.supabase\.co$/.test(parsed.hostname)) {
    return `its host is ${parsed.hostname}, and a production project is <ref>.supabase.co`;
  }
  return null;
}

/**
 * The one line to read before letting the command continue.
 *
 * The origin, which carries no secret — `URL.origin` drops any userinfo, and the
 * service key never goes near it. Returns a sentence rather than the raw string
 * when it will not parse: a redactor that falls back to printing the original is
 * not a redactor (`withoutPassword` in src/db/ssl.ts).
 */
export function targetLine(target: StorageTarget): string {
  let origin: string;
  try {
    origin = new URL(target.url).origin;
  } catch {
    origin = "(a SUPABASE_URL that is not a parsable URL)";
  }
  return `Target: ${origin}   (from ${target.from})`;
}

/**
 * Every bucket the project is running.
 *
 * The shape guard is not decoration: a body that is not a list would otherwise
 * be compared against the declarations as an empty one, and report every bucket
 * as *missing* — or, on a `{ "message": … }` error body that arrived with a 200,
 * report nothing at all.
 */
export async function fetchBuckets(url: string, key: string): Promise<RunningBucket[]> {
  const res = await fetch(`${url}/storage/v1/bucket`, {
    headers: { Authorization: `Bearer ${key}`, apikey: key },
  });
  const text = await res.text();
  if (!res.ok) {
    /* The status and Storage's own sentence. Neither contains the key, and the
       body is truncated because an HTML error page from something in front of
       the project is not worth a screenful. */
    throw new Error(`GET /storage/v1/bucket failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const body: unknown = JSON.parse(text);
  if (!Array.isArray(body)) {
    throw new Error(
      `GET /storage/v1/bucket returned ${typeof body}, not a list. Refusing to compare against ` +
        "something this does not understand.",
    );
  }
  return body as RunningBucket[];
}

/**
 * The body that makes a running bucket match its declaration.
 *
 * `PUT`, not `PATCH`: `PUT /storage/v1/bucket/:id` is Storage's update endpoint
 * and it is a partial update — the fields named are set and the rest are left
 * alone. Confirmed against the local project on 2026-09-03 rather than read off
 * a doc.
 */
export function bucketPutBody(declared: DeclaredBucket): {
  public: boolean;
  file_size_limit: number | null;
  allowed_mime_types: readonly string[] | null;
} {
  return {
    public: declared.public,
    file_size_limit: declared.fileSizeLimit,
    allowed_mime_types: declared.allowedMimeTypes,
  };
}

/**
 * What this write would **take away** from the running bucket.
 *
 * ## Why widening and narrowing are not the same command
 *
 * `--apply` exists so the repair is a flag somebody types rather than a `curl`
 * reconstructed from a doc under pressure — which is how these settings drifted
 * in the first place. Nearly always that repair is a *widening*: the file grew a
 * MIME type and the bucket never heard about it, uploads that ought to work are
 * throwing 415s, and making the bucket match the file can only unbreak things.
 *
 * The other direction is a different decision wearing the same clothes. If the
 * bucket permits something the file does not, somebody widened it by hand —
 * quite possibly to get production working — and applying the file **breaks
 * uploads that are working right now**. In that direction the *file* is as
 * likely to be the stale side as the bucket, and nothing here can tell which.
 * So it needs a second flag, `--allow-narrowing`, which is one more thing to
 * type on the day it matters and nothing at all on every other day.
 *
 * `public` counts in **either** direction: `sources` holds readers' own
 * documents (supabase/config.toml), so flipping it open is a privacy event and
 * flipping it closed breaks every read. Neither should be a side effect of
 * running a repair.
 *
 * A bucket whose `allowed_mime_types` is `null` accepts anything, so imposing
 * the file's list on it is a narrowing too — even though it is also the obvious
 * repair for a hand-created bucket. The flag is cheap; guessing is not.
 */
export function narrowings(declared: DeclaredBucket, running: RunningBucket): string[] {
  const losses: string[] = [];

  if (running.public !== declared.public) {
    losses.push(
      `it would become ${declared.public ? "public" : "private"}, and it is ` +
        `${running.public ? "public" : "private"} now`,
    );
  }

  const haveLimit = running.file_size_limit ?? Infinity;
  const wantLimit = declared.fileSizeLimit ?? Infinity;
  if (wantLimit < haveLimit) {
    losses.push(
      `the size limit would drop from ${running.file_size_limit ?? "no limit"} to ` +
        `${declared.fileSizeLimit ?? "no limit"}`,
    );
  }

  const want = declared.allowedMimeTypes;
  const have = running.allowed_mime_types;
  if (want !== null) {
    if (have === null) {
      losses.push(`it accepts any type now, and would accept only ${[...want].sort().join(", ")}`);
    } else {
      const wanted = new Set(want);
      const removed = have.filter((t) => !wanted.has(t)).sort();
      if (removed.length > 0) losses.push(`it would stop accepting ${removed.join(", ")}`);
    }
  }

  return losses;
}

/** Make one bucket match its declaration. Returns the bucket as it reads afterwards. */
export async function putBucket(
  target: StorageTarget,
  declared: DeclaredBucket,
): Promise<RunningBucket> {
  const res = await fetch(`${target.url}/storage/v1/bucket/${encodeURIComponent(declared.name)}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${target.key}`,
      apikey: target.key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(bucketPutBody(declared)),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `PUT /storage/v1/bucket/${declared.name} failed (${res.status}): ${text.slice(0, 300)}`,
    );
  }

  /* Read it back rather than trusting the 200. A request key the API does not
     recognise is dropped in silence — an ordinary REST manner and one this repo
     has been caught by before — so "it said OK" is not "the field was honoured".
     docs/reusable/silent-success.md. */
  const after = (await fetchBuckets(target.url, target.key)).find((b) => b.id === declared.name);
  if (!after) {
    throw new Error(
      `bucket "${declared.name}" is not there after a successful PUT, which should not be possible.`,
    );
  }
  return after;
}

/**
 * The deploy gate's whole judgement, over injected inputs.
 *
 * Here rather than in `scripts/deploy.ts` because that file self-executes: a
 * test cannot import it, so anything living inside it can only be checked by
 * reading its source text, which is the weakest kind of evidence there is.
 * Everything that decides anything is in here, and the deploy script's share is
 * one call.
 *
 * @param configToml the `supabase/config.toml` **of the commit being deployed**,
 *   or `null` when it is not in that commit. The gates run against the sha
 *   rather than the working tree, and the config is no exception: what ships is
 *   the commit.
 */
export async function storageBucketProblems(opts: {
  configToml: string | null;
  found: EnvProd;
  fetchRunning?: (target: StorageTarget) => Promise<RunningBucket[]>;
}): Promise<{ target: string | null; problems: string[] }> {
  if (opts.configToml === null) {
    return {
      target: null,
      problems: ["supabase/config.toml is not in this commit, so there is nothing to compare against"],
    };
  }

  let declared: DeclaredBucket[];
  try {
    declared = declaredBuckets(opts.configToml);
  } catch (err) {
    return { target: null, problems: [(err as Error).message] };
  }
  if (declared.length === 0) {
    return {
      target: null,
      problems: [
        "supabase/config.toml declares no buckets. Either the file moved or the parser stopped " +
          "reading it — scripts/deploy-checks.ts, declaredBuckets.",
      ],
    };
  }

  let target: StorageTarget;
  try {
    target = productionStorage(opts.found);
  } catch (err) {
    return { target: null, problems: [(err as Error).message] };
  }

  const fetcher = opts.fetchRunning ?? ((t: StorageTarget) => fetchBuckets(t.url, t.key));
  let running: RunningBucket[];
  try {
    running = await fetcher(target);
  } catch (err) {
    return { target: targetLine(target), problems: [(err as Error).message] };
  }

  const problems = bucketDrift(declared, running);
  if (problems.length > 0) {
    problems.push(
      "Editing supabase/config.toml does not change a bucket that already exists. Repair it with:",
      "  npx tsx scripts/check-buckets.ts --prod --apply",
    );
  }
  return { target: targetLine(target), problems };
}
