/**
 * **WHO IS THE OVERSEER** — one implementation of the wire-side answer,
 * imported by everything that has to draw it or act on it.
 *
 * The box is meant to have exactly one Overseer: a permanent session supervising
 * all the others (docs/project/overseer.md). Until 2026-09-08 the only thing
 * that made a session the Overseer was its own belief that it was, so two could
 * hold that belief at once and nothing could tell. The claim is now a variable
 * in that session's tmux environment; `scripts/gjd-remote-tmux.ts` reads it off
 * the box, and this file is what the *readers of the snapshot* — the dashboard's
 * header, `overseer status` — agree about.
 *
 * ## Why this is its own file
 *
 * FOUR consumers on two sides of a compilation boundary: `scripts/gjd-remote.ts`
 * through the tmux reader, `tools/fleet/collect.ts`, `scripts/overseer.ts`, and
 * the browser bundle. Nowhere else could hold it. `wire.ts` cannot, because a
 * `const` there would be bundled into the browser and that file's whole job is to
 * be free of anything but types. `collect.ts` and `gjd-remote-tmux.ts` cannot,
 * because both reach `node:child_process` and the client project has no node
 * types. A leaf module with no imports has neither problem — the argument
 * `attempt-clock.ts` makes at length, and the same discipline applies:
 *
 * **No imports, and this file must never acquire one.**
 *
 * It costs one import out of `scripts/` into `tools/`, which is a new direction
 * and was taken knowingly. The alternative was two copies of the truth table
 * below, and that table had already been written two different ways in a single
 * afternoon — GPT Sol's P0-2 caught the second one.
 *
 * ## The absent state is the point
 *
 * `none` is a real answer, not a blank. It is what the box looks like after a
 * reboot — the claim lives in the tmux server's memory and dies with it — and a
 * reader that could not say it out loud would leave the most important state
 * looking like a rendering gap. `contested` is a fault to report and never to
 * pick from: choosing one of two claimants is how both go on believing they are
 * the Overseer.
 */

/**
 * The role string itself, spelled ONCE for the whole repo.
 *
 * `scripts/gjd-remote-tmux.ts` re-exports this rather than declaring its own,
 * which is the reason this module exists at all: the entire exclusivity rule is
 * string equality on this word, across a compilation boundary the compiler
 * cannot bridge, and a divergence would have been silent and total — every claim
 * written by `gjd-remote` reading as `other` on the dashboard, and the header
 * saying *no Overseer* over a row that holds it.
 */
export const OVERSEER_ROLE = "overseer";

/**
 * Whether a session holds a role, or an admission that we could not tell.
 *
 * Declared here and re-exported by `scripts/gjd-remote-tmux.ts`, which is where
 * a role is read off the box.
 *
 * **`cannot-tell` IS NOT DECORATION.** Zero holders and *I could not look* are
 * different facts, and collapsing them into a nullable is how a reader reports a
 * confident, plausible "there is no Overseer" about a box that has one. The
 * concrete producer over the wire is a server that predates the field: it sends
 * no `role` key at all, and `parseRole` below refuses to read that as a denial.
 */
export type SessionRole =
  | { kind: "none" }
  | { kind: "overseer" }
  | { kind: "other"; name: string }
  | { kind: "cannot-tell"; why: string };

/**
 * What a whole snapshot says about the claim. See the header for why `none` and
 * `contested` matter.
 *
 * **The `id` is a tmux handle, and tmux handles are only meaningful within one
 * tmux server generation** — `$7` after a reboot is a different session from `$7`
 * before it, which this repo has already been bitten by. A caller that ACTS on
 * this id must check it against the same snapshot's `tmuxServerPid`, or resolve
 * it again; this type carries the answer, not a licence to type into a pane.
 */
export type OverseerClaim =
  | { kind: "none" }
  | { kind: "one"; name: string; id: string }
  | { kind: "contested"; names: string[] }
  /**
   * `holder` is who we DID see holding it, when there was one — carried as a
   * field rather than folded into `why` because `why` is printed into terminals
   * and a session name is agent-authored text that can contain control
   * characters. Its presence does not weaken the arm: this is still *we cannot
   * say who the Overseer is*, and `holder` is the address, not the answer.
   */
  | { kind: "cannot-tell"; why: string; holder?: { name: string; id: string } };

/** The least a row has to be for this file to have an opinion about it. */
export type RoleBearing = { id: string; name: string; role: SessionRole };

/**
 * One row's role, off the wire.
 *
 * **AN ABSENT KEY IS `cannot-tell`, NEVER `none`.** The field was added without
 * a schema bump — deliberately, since every consumer ignores what it does not
 * know — so a server from before it says nothing about roles, and nothing is not
 * a denial. Anything present but unrecognised goes the same way: it is a reading
 * that could not be made, and rendering it as *no Overseer* would state a fact
 * nobody has.
 *
 * Nothing here can MINT a claim: only the exact `overseer` arm produces one.
 */
export function parseRole(v: unknown): SessionRole {
  if (v === undefined || v === null) {
    return { kind: "cannot-tell", why: "this server does not report session roles" };
  }
  if (typeof v !== "object" || Array.isArray(v)) {
    return { kind: "cannot-tell", why: "the role field was not an object" };
  }
  const record = v as Record<string, unknown>;
  const kind = record["kind"];
  if (kind === "none") return { kind: "none" };
  if (kind === OVERSEER_ROLE) return { kind: "overseer" };
  if (kind === "other") {
    const name = record["name"];
    return typeof name === "string" && name !== ""
      ? { kind: "other", name }
      : { kind: "cannot-tell", why: "a role with no name" };
  }
  if (kind === "cannot-tell") {
    const why = record["why"];
    return { kind: "cannot-tell", why: typeof why === "string" && why !== "" ? why : "this session's role could not be read" };
  }
  return { kind: "cannot-tell", why: `a role this build does not know: ${String(kind)}` };
}

/**
 * Whether the reading this claim is computed from can be leant on, and how far.
 *
 * **A ROW LIST IS NOT A SNAPSHOT.** The dashboard drops rows it cannot parse and
 * counts them; it serves the last good rows after a collection fails; and before
 * the first collection it has no rows at all, which is not a box with no
 * sessions. Any of those can hide the holder, so the caller has to say what it
 * is handing over rather than let a short list pass as a complete one.
 *
 * **TWO KINDS OF DOUBT, AND THEY ARE NOT INTERCHANGEABLE** — GPT Sol's second
 * P0, against a version that had only one.
 *
 *  - `rows` — this list is missing some sessions, but it describes NOW. Two
 *    known holders are still two known holders; more rows could only make it
 *    worse, so `contested` survives.
 *  - `moment` — this reading may not describe now at all: a stale snapshot, one
 *    whose collection failed, a page that has lost its connection. **Nothing
 *    survives this**, `contested` included, because two holders in an old
 *    snapshot do not prove two holders now — one of them may have been killed,
 *    which is precisely what somebody staring at a contested box would have
 *    done about it.
 */
export type ReadingCompleteness = { ok: true } | { ok: false; scope: "rows" | "moment"; why: string };

/** Nothing was dropped and nothing is stale. The default for a caller that holds every row. */
export const COMPLETE: ReadingCompleteness = { ok: true };

/**
 * Who holds the claim, across a whole snapshot. **One implementation, because
 * the interesting case was already written two different ways in one afternoon**
 * (GPT Sol's P0-2 on the plan).
 *
 * The truth table, in the order it is applied:
 *
 *  - **two or more known holders → `contested`.** A fault, never a pick, and it
 *    survives an incomplete reading: more rows could only make it worse.
 *  - **any uncertainty, with zero or one known holder → `cannot-tell`.** This is
 *    the arm that catches people. *One holder plus one row we could not read* is
 *    **not** singleton ownership: the unreadable row might be a second claimant,
 *    and the whole promise of this mechanism is that there is exactly one. The
 *    `why` still NAMES the known holder, so a caller that only wants somebody to
 *    prod has not lost the address — it has lost the guarantee, which is what was
 *    actually in doubt.
 *  - **exactly one holder, complete reading → `one`.**
 *  - **zero holders, complete reading → `none`.** A real answer, and the one a
 *    reboot leaves behind.
 */
export function overseerClaim(
  rows: readonly RoleBearing[],
  completeness: ReadingCompleteness = COMPLETE,
): OverseerClaim {
  const holders = rows.filter((r) => r.role.kind === "overseer");
  const held = holders[0];

  /* THE MOMENT IS CHECKED BEFORE ANYTHING ELSE, `contested` included. A reading
     that may not describe now cannot support any claim about now — see
     `ReadingCompleteness`. The holder, if we saw one, still travels, so a caller
     is told who it WAS rather than left with nothing. */
  if (!completeness.ok && completeness.scope === "moment") {
    return {
      kind: "cannot-tell",
      why: completeness.why,
      ...(held === undefined ? {} : { holder: { name: held.name, id: held.id } }),
    };
  }

  if (holders.length > 1) return { kind: "contested", names: holders.map((r) => r.name).sort() };

  /* The known holder travels on every `cannot-tell` below, so a caller that only
     wants somebody to prod keeps the address. What it has lost is the guarantee
     that there is nobody else, which is the thing in doubt. It is a FIELD rather
     than words in `why` because these strings are printed into terminals and a
     session name is agent-authored text — see `describeClaim`. */
  const holder = held === undefined ? {} : { holder: { name: held.name, id: held.id } };

  if (!completeness.ok) return { kind: "cannot-tell", why: completeness.why, ...holder };

  const murky = rows.filter((r) => r.role.kind === "cannot-tell");
  const first = murky[0];
  if (first !== undefined && first.role.kind === "cannot-tell") {
    return {
      kind: "cannot-tell",
      why: `${murky.length} session(s) could not be read (${first.role.why})`,
      ...holder,
    };
  }

  if (held !== undefined) return { kind: "one", name: held.name, id: held.id };
  return { kind: "none" };
}

/**
 * **THE ONE WAY A PROGRAM SHOULD ASK A SNAPSHOT WHO THE OVERSEER IS** — the
 * dashboard's `GET /api/state` body in, a claim out, and every reason to
 * disbelieve it already applied.
 *
 * This exists because the first version of `overseer status` read `{rows}` out
 * of that payload by hand and ignored `schema`, `error`, `collectedAt` and age.
 * **The dashboard deliberately serves its last good rows after a collection
 * fails**, so an ad hoc read of it will confidently name an Overseer that died
 * an hour ago — which is worse than saying nothing, because a scheduler would
 * then prod a dead session and report success. GPT Sol's P0-3.
 *
 * Every refusal is `cannot-tell` and never `none`: this function has no way to
 * establish that nobody holds the claim except by reading a whole fresh
 * snapshot, and anything short of that is an absence of evidence.
 *
 * `maxAgeMs` is the caller's, because how stale is too stale depends on what the
 * caller is about to do with the answer.
 */
export function claimFromSnapshot(
  body: unknown,
  opts: { nowMs: number; maxAgeMs: number },
): OverseerClaim {
  const no = (why: string): OverseerClaim => ({ kind: "cannot-tell", why });
  if (typeof body !== "object" || body === null) return no("the dashboard answered something that is not a snapshot");
  const snapshot = body as Record<string, unknown>;

  if (snapshot["schema"] !== 1) {
    return no(`the snapshot says schema ${JSON.stringify(snapshot["schema"])} and this build reads schema 1`);
  }
  // **ONLY `error: null` ESTABLISHES A GOOD COLLECTION.** A missing field and an
  // error that is not a string are both *this payload is not the one this
  // function was written against*, and reading either as "no error" is how a
  // malformed authority field becomes a confident answer. GPT Sol found all
  // three of these accepted. The rows in a payload carrying an error are the
  // LAST GOOD ones, not current ones — that is the whole trap.
  const error = snapshot["error"];
  if (error !== null) {
    return no(
      typeof error === "string"
        ? `the dashboard's last collection failed (${error}), so its rows are not current`
        : `the snapshot's error field is ${JSON.stringify(error)} rather than null or a message, so it cannot be read`,
    );
  }
  const collectedAt = snapshot["collectedAt"];
  if (typeof collectedAt !== "string") return no("the dashboard has never completed a collection");
  const age = opts.nowMs - Date.parse(collectedAt);
  if (!Number.isFinite(age)) return no(`the snapshot's collectedAt is not a time (${String(collectedAt)})`);
  // A FUTURE TIMESTAMP IS NOT A FRESH ONE. `age > maxAgeMs` alone accepts a
  // snapshot stamped next year as the freshest possible reading. Clock skew
  // between two processes on one box is seconds at most, so anything further
  // ahead than that is a payload to disbelieve rather than to trust hardest.
  if (age < -FUTURE_SKEW_MS) {
    return no(`the snapshot is stamped ${Math.round(-age / 1000)}s in the future, which is not a clock this reading can use`);
  }
  if (age > opts.maxAgeMs) {
    return no(`the snapshot is ${Math.round(age / 1000)}s old, past the ${Math.round(opts.maxAgeMs / 1000)}s this reading will trust`);
  }

  const rows = snapshot["rows"];
  if (!Array.isArray(rows)) return no("the snapshot carries no list of sessions, which is not the same as having none");

  // A row without an id is one this reader cannot address, so it is DROPPED and
  // COUNTED rather than silently skipped — a shorter list would otherwise pass
  // as a complete one, and the row most likely to be malformed is as likely as
  // any to be the holder's.
  const bearing: RoleBearing[] = [];
  let dropped = 0;
  for (const row of rows) {
    if (typeof row !== "object" || row === null) {
      dropped++;
      continue;
    }
    const record = row as Record<string, unknown>;
    const id = record["id"];
    const name = record["name"];
    // THE ID IS CHECKED FOR TMUX'S OWN SHAPE, because a caller acts on it. A
    // string that is not `$<digits>` did not come from tmux, and addressing a
    // session by it would address whatever tmux considers current.
    if (typeof id !== "string" || !TMUX_SESSION_ID.test(id) || typeof name !== "string") {
      dropped++;
      continue;
    }
    bearing.push({ id, name, role: parseRole(record["role"]) });
  }

  return overseerClaim(
    bearing,
    dropped === 0
      ? COMPLETE
      : { ok: false, scope: "rows", why: `${dropped} of ${rows.length} rows in the snapshot could not be read` },
  );
}

/** tmux's own session handle. Spelled here rather than imported: this file stays leaf. */
const TMUX_SESSION_ID = /^\$\d+$/;

/**
 * How far ahead of us a snapshot's clock may be before we stop believing it.
 *
 * Two processes on one box, so this is skew and scheduling, not time zones.
 */
const FUTURE_SKEW_MS = 60_000;

/**
 * One line of prose, so the terminal and the page say the same sentence.
 *
 * No colour and no markup: each caller decides how loud to draw it, and the two
 * that shout — `contested` and `cannot-tell` — are told apart by `kind`, not by
 * reading the string.
 *
 * **`safe` IS NOT OPTIONAL FOR A TERMINAL.** Session names are agent-authored
 * text and may contain control characters; `gjd-remote`'s table has had
 * `escapeName` for exactly that reason since before this existed, and GPT Sol
 * found three new paths here that printed a name raw. A caller writing to a
 * terminal passes `escapeName`; a caller rendering into React passes nothing,
 * because React escapes on the way into the DOM. This module cannot import
 * `escapeName` itself — it must stay leaf, see the header.
 */
export function describeClaim(claim: OverseerClaim, safe: (name: string) => string = (n) => n): string {
  switch (claim.kind) {
    case "one":
      return `Overseer: ${safe(claim.name)}`;
    case "none":
      return "no Overseer session";
    case "contested":
      return `${claim.names.length} sessions claim to be the Overseer: ${claim.names.map(safe).join(", ")}`;
    case "cannot-tell":
      return (
        `Overseer unknown — ${claim.why}` +
        (claim.holder === undefined ? "" : ` (${safe(claim.holder.name)} was holding it)`)
      );
    default: {
      const never: never = claim;
      return never;
    }
  }
}
