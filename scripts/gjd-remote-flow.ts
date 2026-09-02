/**
 * The decisions `gjd-remote` makes about clones, configs and setup runs — as
 * pure functions and as generated shell, with nothing that talks to a network
 * in it.
 *
 * **Why this file exists.** `scripts/gjd-remote.ts` calls `main()` at import
 * time, so nothing in it can be unit-tested at all; GPT Sol's Stage 2 review
 * (finding 11) named six pieces of exactly the logic you would want red tests
 * for — the clone transaction, the staging sweep, the config comparison, the
 * setup gate, the box-read protocol — and every one of them lived there. They
 * live here now, and `tests/gjd-remote-flow.test.ts` reddens them.
 *
 * Three kinds of thing are in here, and they share one rule: **a value the box
 * sends is not trusted until a parser has said so.**
 *
 *  1. **The box-read protocol** — `BOX_OK` first, `BOX_END` last, one line per
 *     field, each field exactly once, and base64 for anything a person wrote.
 *     A reply that stops in the middle looks exactly like a complete one until
 *     you require its last line, which is Sol's finding 5.
 *  2. **The setup specification** — what a repo's setup would actually DO,
 *     rather than the string it is spelled with. `./.gjd-remote/setup` is the
 *     same command whatever the file says, and comparing the commands alone let
 *     two different scripts compare equal (finding 4).
 *  3. **The gates** — verdict × lock × `--force` for `gjd-remote setup`, and
 *     verdict × lock for a session about to start. Both return a decision
 *     rather than printing one, so the matrix in the review is a table a test
 *     can walk.
 *
 * The generated shell is here for the same reason as
 * `scripts/gjd-remote-tmux.ts`'s: the tests RUN it, under the laptop's own
 * bash, against temporary directories. So it is POSIX rather than GNU —
 * `base64 | tr -d` and not `base64 -w0` — because a wire format whose two ends
 * are only ever tested against each other's assumptions is one neither end can
 * see is broken.
 */
import { createHash } from "node:crypto";
import type { RepoConfig, SetupScriptState, SetupSource } from "./gjd-remote-config.js";
import type { SetupVerdict } from "./gjd-remote-setup.js";

/**
 * Whether a setup for this repo is running RIGHT NOW, as the box answers it.
 *
 * It lives here rather than in scripts/gjd-remote.ts because both gates read
 * it, and both of them are tested. `noflock` is not a nuance: it means the box
 * cannot serialise anything, and the gate below refuses on it.
 */
export type LockState = "none" | "free" | "held" | "noflock";

export const LOCK_STATES: readonly LockState[] = ["none", "free", "held", "noflock"];

/** Single-quote for the box's shell. A fourth copy of the one in
 *  scripts/gjd-remote.ts, which cannot export it because that file runs
 *  `main()` on import — the same reason the repo and setup modules have theirs. */
function shq(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}

// ------------------------------------------------------- the box-read protocol

/** First line of a whole reply. */
export const BOX_OK = "GJDBOXOK";
/** LAST line of a whole reply, and the one that makes truncation visible.
 *  Without it, a stream cut after the final field is byte-for-byte a complete
 *  answer — GPT Sol's Stage 2 finding 5. */
export const BOX_END = "GJDBOXEND";
/** A refusal the script MEANT, exiting 0 so that a non-zero ssh status keeps
 *  its one meaning: the box could not be asked. */
export const BOX_ERR = "GJDBOXERR";

export type BoxRead = { ok: true; fields: ReadonlyMap<string, string> } | { ok: false; why: string };

/**
 * The fields of one box read, or the reason there are none.
 *
 * `want` is the exact set of field names the caller expects. Every one must
 * appear exactly once, nothing else may appear, and the reply must be framed by
 * both sentinels. That is four ways to notice a reply that is not whole, and
 * the cheapest of them — the terminal sentinel — is the one that catches the
 * truncation that matters.
 *
 * A field's value is whatever followed its name and one space, verbatim: the
 * callers below base64 anything a person could have written, so this never has
 * to guess about spaces or empties.
 */
export function parseBoxRead(stdout: string, want: readonly string[]): BoxRead {
  const lines = stdout.split("\n").map((l) => l.replace(/\r$/, ""));
  // A trailing newline is ordinary; anything else after the end sentinel is not.
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const err = lines.find((l) => l === BOX_ERR || l.startsWith(`${BOX_ERR} `));
  if (err !== undefined) {
    const why = err.slice(BOX_ERR.length).trim();
    return { ok: false, why: why || "the box refused, and said nothing about why" };
  }
  if (lines[0] !== BOX_OK) {
    return { ok: false, why: `the box's reply did not start with ${BOX_OK}, so it is not a whole one` };
  }
  if (lines[lines.length - 1] !== BOX_END) {
    return { ok: false, why: `the box's reply did not end with ${BOX_END}, so it was cut short` };
  }

  const body = lines.slice(1, -1);
  const fields = new Map<string, string>();
  for (const line of body) {
    const at = line.indexOf(" ");
    const key = at === -1 ? line : line.slice(0, at);
    const value = at === -1 ? "" : line.slice(at + 1);
    if (!want.includes(key)) return { ok: false, why: `the box's reply had a line I did not ask for: '${key}'` };
    if (fields.has(key)) return { ok: false, why: `the box's reply had two '${key}' lines, and I will not choose` };
    fields.set(key, value);
  }
  const missing = want.filter((k) => !fields.has(k));
  if (missing.length > 0) {
    return { ok: false, why: `the box's reply was missing ${missing.length === 1 ? "a field" : "fields"}: ${missing.join(", ")}` };
  }
  return { ok: true, fields };
}

/**
 * base64 back to text, or the reason it is not text.
 *
 * Round-tripped, because `Buffer.from` ignores whatever it cannot decode: a
 * stream cut in the middle of a field would otherwise come back as a shorter
 * string that parses perfectly well and says something else.
 */
export function decodeBoxField(b64: string, what: string): { ok: true; text: string } | { ok: false; why: string } {
  const text = Buffer.from(b64, "base64").toString("utf8");
  if (Buffer.from(text, "utf8").toString("base64") !== b64) {
    return { ok: false, why: `${what} did not survive the trip from the box intact` };
  }
  return { ok: true, text };
}

// ------------------------------------------------------------ one checkout

/**
 * Everything about ONE directory on the box, asked strictly.
 *
 * The inventory answers for everything under `~/code` and deliberately hides
 * `clone`'s staging directories, so it cannot be used to check the tree a clone
 * has just made. This can, and it carries the two extra facts that the
 * inventory has no use for: the `.git` inode, which is how a re-clone at the
 * same path is told from the checkout that was there before, and the branch and
 * subject that `clone` prints back at you.
 */
export type CheckoutProbe = {
  exists: boolean;
  isSymlink: boolean;
  isDir: boolean;
  isCheckout: boolean;
  /** `git remote get-url origin`, verbatim, or undefined when there is none. */
  origin: string | undefined;
  /** The resolved commit, or undefined when `HEAD` does not resolve — which is
   *  what an interrupted clone leaves behind. */
  head: string | undefined;
  branch: string | undefined;
  subject: string | undefined;
  realpath: string | undefined;
  /** The inode of `.git`, as a string because it is only ever compared. */
  gitInode: string | undefined;
};

const PROBE_FIELDS = ["exists", "symlink", "dir", "checkout", "origin", "head", "branch", "subject", "real", "inode"] as const;

export function checkoutProbeScript(dir: string): string {
  return `
    PATH="$PATH:/usr/local/bin:/usr/bin:/bin"
    command -v git >/dev/null 2>&1 || { echo '${BOX_ERR} git is not on this box'; exit 0; }
    command -v base64 >/dev/null 2>&1 || { echo '${BOX_ERR} base64 is not on this box'; exit 0; }
    e() { printf %s "$1" | base64 | tr -d "\\n"; }
    p=${shq(dir)}
    if [ -e "$p" ] || [ -L "$p" ]; then ex=1; else ex=0; fi
    if [ -L "$p" ]; then lnk=1; else lnk=0; fi
    if [ -d "$p" ]; then isdir=1; else isdir=0; fi
    real=$(cd "$p" 2>/dev/null && pwd -P) || real=
    co=0; origin=; head=; branch=; subject=; inode=
    if [ -n "$real" ]; then
      top=$(git -C "$real" rev-parse --show-toplevel 2>/dev/null || true)
      if [ -n "$top" ] && [ "$top" = "$real" ]; then
        co=1
        origin=$(git -C "$real" remote get-url origin 2>/dev/null || true)
        head=$(git -C "$real" rev-parse --verify -q HEAD 2>/dev/null || true)
        branch=$(git -C "$real" rev-parse --abbrev-ref HEAD 2>/dev/null || true)
        subject=$(git -C "$real" log -1 --pretty=%s 2>/dev/null | tr -d '\\n' || true)
        inode=$(ls -di "$real/.git" 2>/dev/null | awk '{print $1}' || true)
      fi
    fi
    printf '${BOX_OK}\\n'
    printf 'exists %s\\n' "$ex"
    printf 'symlink %s\\n' "$lnk"
    printf 'dir %s\\n' "$isdir"
    printf 'checkout %s\\n' "$co"
    printf 'origin %s\\n' "$(e "$origin")"
    printf 'head %s\\n' "$(e "$head")"
    printf 'branch %s\\n' "$(e "$branch")"
    printf 'subject %s\\n' "$(e "$subject")"
    printf 'real %s\\n' "$(e "$real")"
    printf 'inode %s\\n' "$inode"
    printf '${BOX_END}\\n'`;
}

export function parseCheckoutProbe(stdout: string): { ok: true; probe: CheckoutProbe } | { ok: false; why: string } {
  const got = parseBoxRead(stdout, [...PROBE_FIELDS]);
  if (!got.ok) return got;
  const flag = (k: string): boolean | undefined => {
    const v = got.fields.get(k);
    return v === "1" ? true : v === "0" ? false : undefined;
  };
  const exists = flag("exists");
  const isSymlink = flag("symlink");
  const isDir = flag("dir");
  const isCheckout = flag("checkout");
  if (exists === undefined || isSymlink === undefined || isDir === undefined || isCheckout === undefined) {
    return { ok: false, why: "the box answered something other than 0 or 1 for one of its yes/no fields" };
  }
  const text: Record<string, string | undefined> = {};
  for (const k of ["origin", "head", "branch", "subject", "real"] as const) {
    const raw = got.fields.get(k) ?? "";
    if (raw === "") {
      text[k] = undefined;
      continue;
    }
    const decoded = decodeBoxField(raw, `the ${k} of that directory`);
    if (!decoded.ok) return decoded;
    text[k] = decoded.text === "" ? undefined : decoded.text;
  }
  const inode = got.fields.get("inode") ?? "";
  if (inode !== "" && !/^[0-9]+$/.test(inode)) {
    return { ok: false, why: `the box said that checkout's .git inode is '${inode}', which is not a number` };
  }
  return {
    ok: true,
    probe: {
      exists,
      isSymlink,
      isDir,
      isCheckout,
      origin: text.origin,
      head: text.head,
      branch: text.branch,
      subject: text.subject,
      realpath: text.real,
      gitInode: inode === "" ? undefined : inode,
    },
  };
}

// ------------------------------------------------------- the setup specification

/**
 * What setting this repo up would actually DO, rather than what it is spelled
 * with — and the thing two copies of a repo are compared on.
 *
 * GPT Sol's Stage 2 finding 4: comparing the resolved commands let three real
 * disagreements compare equal, because in each of them the COMMAND is a
 * constant. `./.gjd-remote/setup` is the same eight characters whatever the
 * script contains; `npm ci && npm run setup` is the same words whatever
 * `package.json` puts behind `npm run setup`; and a source or a warning
 * changing means a different file is being ignored. So the fingerprint carries
 * the contents, by hash, of whichever file the command actually reaches.
 *
 * Raw TOML equality was the other option and is too strict: a comment or a
 * blank line is not a change to what runs.
 */
export type SetupSpec = {
  setup: string | null;
  source: SetupSource | "none";
  check: string | null;
  warnings: readonly string[];
  /** sha256 of `.gjd-remote/setup`, when that is the command being run. */
  scriptSha256: string | null;
  /** The `package.json` `scripts.setup` body, when the npm convention is what
   *  resolved. The body itself rather than a hash: it is short, and printing it
   *  is how somebody sees what actually differs. */
  packageSetup: string | null;
};

/** Everything about the files around a config that the config itself does not
 *  carry. Both sides gather these — the laptop from disk, the box in its
 *  config read — so that neither has to assume anything about the other. */
export type SetupSpecFiles = {
  /** sha256 of `.gjd-remote/setup` if that file exists at all, else null. */
  scriptSha256: string | null;
  /** The toplevel `package.json`'s `scripts.setup`, if there is one. */
  packageSetup: string | null;
};

export function setupSpec(cfg: RepoConfig, files: SetupSpecFiles): SetupSpec {
  const source = cfg.setup.source;
  return {
    setup: source === "none" ? null : cfg.setup.command,
    source,
    check: cfg.check?.command ?? null,
    warnings: [...cfg.warnings],
    // Carried only when it is the file that would RUN. A repo with a
    // non-executable `.gjd-remote/setup` and an npm convention has the script's
    // bytes as an irrelevance, and a difference in an irrelevance is not a
    // difference worth stopping a clone for — the warning that it is being
    // ignored is what carries that, and warnings are compared.
    scriptSha256: source === "script" ? files.scriptSha256 : null,
    packageSetup: source === "npm-convention" ? files.packageSetup : null,
  };
}

/** sha256 of some bytes, hex. The whole digest: it is compared, and only its
 *  first twelve are ever printed. */
export function sha256(text: string | Buffer): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Which parts of two specifications disagree, in the order a person would want
 * to read them. Empty means they agree.
 *
 * Each entry is a field name, what the first side said, and what the second
 * did — so the caller can print both and let the reader decide, rather than
 * announcing that "the config differs" and leaving them to diff it themselves.
 */
export type SpecDifference = { field: string; a: string; b: string };

export function diffSetupSpec(a: SetupSpec, b: SetupSpec): readonly SpecDifference[] {
  const out: SpecDifference[] = [];
  const say = (v: string | null) => v ?? "(none)";
  if (a.setup !== b.setup) out.push({ field: "setup", a: say(a.setup), b: say(b.setup) });
  if (a.source !== b.source) out.push({ field: "source", a: a.source, b: b.source });
  if (a.check !== b.check) out.push({ field: "check", a: say(a.check), b: say(b.check) });
  if (a.scriptSha256 !== b.scriptSha256) {
    out.push({ field: `${".gjd-remote/setup"} contents`, a: shortSha(a.scriptSha256), b: shortSha(b.scriptSha256) });
  }
  if (a.packageSetup !== b.packageSetup) {
    out.push({ field: "package.json scripts.setup", a: say(a.packageSetup), b: say(b.packageSetup) });
  }
  const aw = a.warnings.join(" · ");
  const bw = b.warnings.join(" · ");
  if (aw !== bw) out.push({ field: "warnings", a: aw || "(none)", b: bw || "(none)" });
  return out;
}

const shortSha = (s: string | null) => (s === null ? "(no script)" : `${s.slice(0, 12)}…`);

/** One line saying what would run, for a prompt or a report. */
export function describeSpec(spec: SetupSpec): string {
  if (spec.source === "none") return "(none known)";
  const bits: string[] = [spec.source];
  if (spec.scriptSha256 !== null) bits.push(`sha ${spec.scriptSha256.slice(0, 12)}`);
  if (spec.check !== null) bits.push(`check: ${spec.check}`);
  return `${spec.setup}   (${bits.join(", ")})`;
}

// ------------------------------------------------------------------ the gates

/**
 * May `gjd-remote setup` start a run, given what the box already says?
 *
 * The whole of GPT Sol's verdict × lock matrix, in one place that a test can
 * walk. Two of its cells were wrong in the version this replaces:
 *
 *  - **`noflock` refuses everything.** It used to start a job that hit exit 78
 *    half a second later, inside a pane that then vanished — a refusal wearing
 *    a green tick. There is no lock to be had on that box, and running without
 *    one is the concurrency this whole design exists to prevent.
 *  - **A held lock refuses `--force` too**, and always did; it is here so that
 *    the table says so out loud rather than leaving it to the reader.
 *
 * `wrong-checkout` STARTS rather than refusing, and that is deliberate: it
 * means the status file is about some other tree, so there is no evidence about
 * this one and running setup is exactly the remedy. Refusing it would name
 * `gjd-remote setup` as the fix for `gjd-remote setup`.
 */
export type SetupGateDecision =
  | { kind: "start"; note: string | null }
  | { kind: "already-ready"; why: string }
  | { kind: "refuse"; why: string; remedy: string | null };

export function setupGateDecision(v: SetupVerdict, lock: LockState, force: boolean): SetupGateDecision {
  if (lock === "noflock") {
    return {
      kind: "refuse",
      why:
        "flock is not installed on the box, so a setup cannot be serialised — and two setups in one checkout " +
        "is the thing the lock exists to stop.\n  The job itself refuses for the same reason (exit 78), so --force will not help.",
      remedy: "gjd-remote ssh 'sudo apt-get install -y util-linux'   # then try again",
    };
  }
  if (lock === "held") {
    return {
      kind: "refuse",
      why: "a setup for this repo is running on the box right now, so nothing was started.",
      remedy: "gjd-remote setup --status   # wait for it, then look",
    };
  }
  if (v.kind === "in-progress") {
    if (!force) {
      return {
        kind: "refuse",
        why: `${v.why}, but nothing holds the box-side lock (${lock}), so that attempt died without writing a verdict.`,
        remedy: "gjd-remote setup --force   # run it again",
      };
    }
    return { kind: "start", note: `--force: attempt ${v.attempt} left a 'started' status and nothing holds the lock; running again` };
  }
  if (v.kind === "success") {
    if (force) return { kind: "start", note: null };
    return { kind: "already-ready", why: v.why };
  }
  return { kind: "start", note: v.why };
}

/**
 * May a SESSION start in a checkout the box already has?
 *
 * **The plan's end state is to refuse anything but `success`, and this does
 * not** — on purpose, and it is the open question in
 * docs/plans/260902h-gjd-remote-works-from-whichever-repo-you-are-in.md.
 * `~/code/spideryarn2` was set up by hand long before this tool existed, so it
 * is `never-run` and always will be until somebody runs `npm ci` in a tree that
 * ten live sessions are working in. Refusing would stop all ten.
 *
 * Two things do refuse, because both mean the tree in front of you is not the
 * tree the status is about:
 *
 *  - **a setup holding the lock** — an agent started in a tree mid-`npm ci`
 *    gets a half-built repo and blames the repo;
 *  - **`wrong-checkout`** — the status is about another slug, another
 *    directory, or a `.git` that no longer exists, which is Sol's finding 7:
 *    delete a checkout and clone it again at the same path and the old success
 *    still sits there.
 */
export type FoundGateDecision = { kind: "go" } | { kind: "warn"; line: string } | { kind: "refuse"; why: string };

export function foundGateDecision(v: SetupVerdict, lock: LockState): FoundGateDecision {
  if (v.kind === "success") return { kind: "go" };
  if (v.kind === "wrong-checkout") {
    return {
      kind: "refuse",
      why:
        `${v.why}\n` +
        `  Nothing about this tree has been proved, and a status about another one is worse\n` +
        `  than none: it is evidence pointing somewhere else.\n  ${v.remedy}`,
    };
  }
  if (v.kind === "in-progress" && lock === "held") {
    return {
      kind: "refuse",
      why:
        `${v.why}, and it holds the box-side lock — a setup for this repo is running RIGHT NOW.\n` +
        `  Starting a session in a tree mid-install gives an agent a half-built repo.\n` +
        `  gjd-remote setup --status   # wait for it, then try again`,
    };
  }
  if (v.kind === "never-run") {
    return { kind: "warn", line: "setup status: never run through gjd-remote — 'gjd-remote setup' to record it" };
  }
  return { kind: "warn", line: `setup status: ${v.why}` };
}

// ------------------------------------------------------------ the clone transaction

/**
 * `clone`'s staging prefix, checked by EXACT BASENAME.
 *
 * GPT Sol's Stage 2 finding 2: the old guard was a shell `case` on the whole
 * path, matching any path with the prefix anywhere in it — including
 * `/home/greg/code/.gjd-remote-staging-x/src/anything`, an innocent child of a
 * staging directory, which the one `rm -rf` in the tool would then have run
 * against.
 */
export const STAGING_PREFIX_FLOW = ".gjd-remote-staging-";

export function isStagingBasename(dir: string): boolean {
  const base = (dir.replace(/\/+$/, "") || "/").split("/").pop() ?? "";
  return base.startsWith(STAGING_PREFIX_FLOW) && base.length > STAGING_PREFIX_FLOW.length;
}

export type CloneTransaction = {
  /** Where the finished checkout must end up. */
  dest: string;
  /** The staging name, beside it, that nothing else looks at. */
  staging: string;
  /** The lock every clone of this destination serialises on. */
  lockPath: string;
  locksDir: string;
  /** The https URL asked for, compared to what git records. */
  url: string;
  /** `~/gjd-remote/setup/<owner>--<name>.json`, archived on a fresh clone. */
  statusPath: string;
};

/** The steps the box reports, in the order it does them. */
export const CLONE_TAG = "GJDCLONE";

/**
 * One locked, atomic, non-destructive clone.
 *
 * **Everything happens inside one lock**, which is Sol's finding 1: the old
 * version checked the destination from the laptop and moved into it several
 * seconds later, and `test -e` followed by `mv -T` is a TOCTOU check whichever
 * shell runs it. Two `new-shell`s racing on a repo the box has never had is not
 * exotic — it is two agents starting at once.
 *
 * **The staging name is RESERVED with `mkdir` before git is told about it**
 * (finding 2). `mkdir` fails if anything is there, so a success is proof we
 * made it — which is what makes the one `rm -rf` in this tool safe to run on
 * the failure path. It is `git clone` into an existing empty directory, which
 * git allows precisely because this is the normal way to do it.
 *
 * **The move is `mv -T -n`**, no-clobber, and then the destination's `.git`
 * inode is compared to the staging tree's: a rename that silently did nothing
 * because something appeared at the destination is otherwise a success with
 * somebody else's checkout at the end of it.
 *
 * **A fresh checkout archives the old setup status** (finding 7, the CLI half).
 * Delete a checkout, clone it again at the same path, and the previous
 * success — same slug, same directory — would otherwise apply to a tree that
 * has never had setup run in it. It is moved aside rather than deleted: it is
 * the only record of what that tree once was.
 */
export function cloneTransactionScript(t: CloneTransaction): string {
  return `
    PATH="$PATH:/usr/local/bin:/usr/bin:/bin"
    command -v git >/dev/null 2>&1 || { echo '${BOX_ERR} git is not on this box'; exit 0; }
    command -v base64 >/dev/null 2>&1 || { echo '${BOX_ERR} base64 is not on this box'; exit 0; }
    command -v flock >/dev/null 2>&1 || { echo '${BOX_ERR} flock is not on this box, so a clone cannot be serialised'; exit 0; }
    e() { printf %s "$1" | base64 | tr -d "\\n"; }
    dest=${shq(t.dest)}
    staging=${shq(t.staging)}
    url=${shq(t.url)}
    status=${shq(t.statusPath)}
    mkdir -p ${shq(t.locksDir)} 2>/dev/null || true
    exec 9>>${shq(t.lockPath)} || { echo '${BOX_ERR} I could not open the clone lock'; exit 0; }
    flock -n 9 || { echo '${BOX_ERR} another clone of that destination is running on the box right now'; exit 0; }
    printf '${BOX_OK}\\n'
    # RE-RESOLVED under the lock, not before it: whatever the laptop saw a
    # second ago, this is the answer that the move will act on.
    if [ -e "$dest" ] || [ -L "$dest" ]; then
      printf 'step taken\\n'; printf '${BOX_END}\\n'; exit 0
    fi
    mkdir -p "$(dirname "$dest")" 2>/dev/null || true
    # Reserved, not just named: mkdir is atomic and fails if anything is there,
    # so from here on we know this directory is ours to remove.
    if ! mkdir "$staging" 2>/dev/null; then
      printf 'step staging-taken\\n'; printf '${BOX_END}\\n'; exit 0
    fi
    GIT_TERMINAL_PROMPT=0 git clone "$url" "$staging" >&2
    rc=$?
    if [ "$rc" != 0 ]; then
      # Ours to sweep, and only as far as we are sure: an empty directory goes,
      # a tree git got some way into stays for somebody to look at.
      if rmdir "$staging" 2>/dev/null; then swept=removed; else swept=kept; fi
      printf 'step clone-failed\\n'
      printf 'code %s\\n' "$rc"
      printf 'swept %s\\n' "$swept"
      printf '${BOX_END}\\n'; exit 0
    fi
    top=$(git -C "$staging" rev-parse --show-toplevel 2>/dev/null || true)
    real=$(cd "$staging" 2>/dev/null && pwd -P) || real=
    got=$(git -C "$staging" remote get-url origin 2>/dev/null || true)
    head=$(git -C "$staging" rev-parse --verify -q HEAD 2>/dev/null || true)
    bad=
    if [ -z "$top" ] || [ "$top" != "$real" ]; then bad=not-a-checkout; fi
    if [ -z "$bad" ] && [ -z "$head" ]; then bad=no-head; fi
    if [ -z "$bad" ] && [ "$got" != "$url" ]; then bad=wrong-remote; fi
    if [ -n "$bad" ]; then
      printf 'step verify-failed\\n'
      printf 'why %s\\n' "$bad"
      printf 'origin %s\\n' "$(e "$got")"
      printf '${BOX_END}\\n'; exit 0
    fi
    before=$(ls -di "$staging/.git" 2>/dev/null | awk '{print $1}' || true)
    # -T (treat the destination as a name, never a directory to move INTO) is
    # GNU-only, and the box is Linux, so the box always takes the first branch.
    # BSD mv has -n but not -T, and these tests RUN this script on a Mac — a
    # transaction nothing could execute is one nothing could redden. The
    # guarantee does not rest on the flag either way: the inode comparison below
    # is what proves the destination IS the tree we verified, and it catches the
    # move-inside-an-existing-directory case that -T exists to prevent.
    if mv --version >/dev/null 2>&1; then mvopts="-T -n"; else mvopts="-n"; fi
    if ! mv $mvopts -- "$staging" "$dest" 2>/dev/null; then
      printf 'step move-failed\\n'; printf '${BOX_END}\\n'; exit 0
    fi
    after=$(ls -di "$dest/.git" 2>/dev/null | awk '{print $1}' || true)
    # -n means mv can decline and still exit 0 on some coreutils, so the tree at
    # the destination has to BE the tree we verified, not merely be there.
    if [ -z "$after" ] || [ "$before" != "$after" ]; then
      printf 'step move-declined\\n'
      printf 'before %s\\n' "$before"
      printf 'after %s\\n' "$after"
      printf '${BOX_END}\\n'; exit 0
    fi
    stale=none
    if [ -f "$status" ]; then
      if mv -- "$status" "$status.stale-$(date -u +%Y%m%dT%H%M%SZ)" 2>/dev/null; then stale=archived; else stale=stuck; fi
    fi
    printf 'step ok\\n'
    printf 'inode %s\\n' "$after"
    printf 'origin %s\\n' "$(e "$got")"
    printf 'head %s\\n' "$(e "$head")"
    printf 'stale %s\\n' "$stale"
    printf '${BOX_END}\\n'`;
}

export type CloneOutcome =
  | { kind: "ok"; inode: string; origin: string; head: string; stale: "archived" | "none" | "stuck" }
  | { kind: "taken" }
  | { kind: "staging-taken" }
  | { kind: "clone-failed"; code: string; swept: "removed" | "kept" }
  | { kind: "verify-failed"; why: string; origin: string }
  | { kind: "move-failed" }
  | { kind: "move-declined"; before: string; after: string };

/**
 * The transaction's own report, or the reason we do not have one. Every arm
 * names a step that happened, so "it did not work" is never the whole answer.
 *
 * `refused` separates the two ways there is no report, because they need
 * opposite advice: the box declining to start — no lock, no git, no `base64` —
 * means NOTHING was made and there is nothing to go and look at, while a reply
 * this parser cannot believe means something may have happened and both paths
 * have to be named.
 */
export type CloneParse = { ok: true; outcome: CloneOutcome } | { ok: false; refused: boolean; why: string };

export function parseCloneTransaction(stdout: string): CloneParse {
  const step = firstField(stdout, "step");
  if (step === undefined) {
    const framed = parseBoxRead(stdout, ["step"]);
    if (framed.ok) return { ok: false, refused: false, why: "the box's reply said nothing about what it did" };
    return { ok: false, refused: sawRefusal(stdout), why: framed.why };
  }
  const want: Record<string, readonly string[]> = {
    taken: ["step"],
    "staging-taken": ["step"],
    "clone-failed": ["step", "code", "swept"],
    "verify-failed": ["step", "why", "origin"],
    "move-failed": ["step"],
    "move-declined": ["step", "before", "after"],
    ok: ["step", "inode", "origin", "head", "stale"],
  };
  const fields = want[step];
  if (fields === undefined) return { ok: false, refused: false, why: `the box said it did '${step}', which means nothing to me` };
  const got = parseBoxRead(stdout, fields);
  if (!got.ok) return { ok: false, refused: sawRefusal(stdout), why: got.why };
  const f = (k: string) => got.fields.get(k) ?? "";
  const text = (k: string): { ok: true; text: string } | { ok: false; why: string } => {
    const raw = f(k);
    if (raw === "") return { ok: true, text: "" };
    return decodeBoxField(raw, `the ${k} the box reported`);
  };

  switch (step) {
    case "taken":
      return { ok: true, outcome: { kind: "taken" } };
    case "staging-taken":
      return { ok: true, outcome: { kind: "staging-taken" } };
    case "clone-failed": {
      const swept = f("swept");
      if (swept !== "removed" && swept !== "kept") return { ok: false, refused: false, why: `the box said it swept '${swept}', which means nothing to me` };
      return { ok: true, outcome: { kind: "clone-failed", code: f("code"), swept } };
    }
    case "verify-failed": {
      const origin = text("origin");
      if (!origin.ok) return { ok: false, refused: false, why: origin.why };
      return { ok: true, outcome: { kind: "verify-failed", why: f("why"), origin: origin.text } };
    }
    case "move-failed":
      return { ok: true, outcome: { kind: "move-failed" } };
    case "move-declined":
      return { ok: true, outcome: { kind: "move-declined", before: f("before"), after: f("after") } };
    default: {
      const origin = text("origin");
      if (!origin.ok) return { ok: false, refused: false, why: origin.why };
      const head = text("head");
      if (!head.ok) return { ok: false, refused: false, why: head.why };
      const stale = f("stale");
      if (stale !== "archived" && stale !== "none" && stale !== "stuck") {
        return { ok: false, refused: false, why: `the box said the old status was '${stale}', which means nothing to me` };
      }
      if (!/^[0-9]+$/.test(f("inode"))) return { ok: false, refused: false, why: `the box said the new checkout's inode is '${f("inode")}'` };
      return { ok: true, outcome: { kind: "ok", inode: f("inode"), origin: origin.text, head: head.text, stale } };
    }
  }
}

/** Did the box say why it was not going to start? A refusal line is one the
 *  script meant, and nothing was made. */
function sawRefusal(stdout: string): boolean {
  return stdout.split("\n").some((l) => l.replace(/\r$/, "").startsWith(BOX_ERR));
}

/** The `step` line, read before the reply is validated against the field set
 *  that step implies. It is the one field whose value decides what the rest of
 *  the reply must be. */
function firstField(stdout: string, key: string): string | undefined {
  for (const raw of stdout.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line === key || line.startsWith(`${key} `)) return line.slice(key.length).trim();
  }
  return undefined;
}

// --------------------------------------------------------------- the log's end

/**
 * Does the laptop's log still owe this attempt a terminal record?
 *
 * GPT Sol's Stage 2 finding 10: `--no-attach`, or detaching while a job runs,
 * leaves a `started` line and nothing else, for ever. A later `setup --status`
 * knows how it went and used to say so only on screen — so the durable record,
 * the one `gjd-remote log` reads, kept a finished run open.
 *
 * Idempotent by attempt, which is the whole point: `--status` can be run ten
 * times and the outcome is written once.
 */
export function needsTerminalSetupRecord(
  records: readonly { cmd?: string | undefined; attempt?: string | undefined; outcome?: string | undefined }[],
  attempt: string,
): boolean {
  let started = false;
  for (const r of records) {
    if (r.cmd !== "setup" || r.attempt !== attempt) continue;
    if (r.outcome === "success" || r.outcome === "failed") return false;
    if (r.outcome === "started") started = true;
  }
  return started;
}

// --------------------------------------------------- a repo's config, on the box

/**
 * Everything the setup specification needs about a checkout ON THE BOX, in one
 * round trip: the config text, whether `.gjd-remote/setup` is there and
 * executable, its sha256, and whether `package.json` has a `setup` script —
 * with its body.
 *
 * The last two are GPT Sol's Stage 2 finding 4. `./.gjd-remote/setup` is the
 * same command whatever the file contains, and `npm ci && npm run setup` is the
 * same words whatever `package.json` puts behind them, so comparing the two
 * machines' COMMANDS let entirely different setups compare equal. What runs is
 * the file, so the file is what travels.
 *
 * The facts are gathered on the box rather than assumed from the laptop because
 * the execute bit and the `package.json` are properties of THAT tree — a
 * `chmod +x` that was never committed is the ordinary way for the two to
 * disagree.
 *
 * It is here, rather than in the CLI beside its caller, because the CLI cannot
 * be tested at all and this is a wire protocol with six fields in it: the first
 * version, written in `gjd-remote.ts`, reported a `package.json` with no
 * `setup` script as unparseable, because the probe's "nothing" and its failure
 * were both the empty string. A test caught that in a second.
 */
export type BoxConfigFields = {
  setupScript: SetupScriptState;
  packageJsonHasSetup: boolean;
  packageSetup: string | null;
  scriptSha256: string | null;
  /** The `config.toml` as text, empty when there is none. */
  configText: string;
};

export function boxConfigScript(o: { dir: string; configDir: string; configFile: string; setupScript: string }): string {
  // No single quotes in it, so `shq` wraps it without a thicket of escapes.
  const pkgProbe =
    `const s=JSON.parse(require("fs").readFileSync("package.json","utf8")).scripts;` +
    `const v=s&&typeof s.setup==="string"?s.setup.trim():"";` +
    `console.log(v?"yes "+Buffer.from(v,"utf8").toString("base64"):"no")`;
  return [
    `PATH="$PATH:/usr/local/bin:/usr/bin:/bin"`,
    `command -v base64 >/dev/null 2>&1 || { printf '${BOX_ERR} base64 is not on this box\\n'; exit 0; }`,
    `cd ${shq(o.dir)} 2>/dev/null || { printf '${BOX_ERR} I cannot enter %s on the box\\n' ${shq(o.dir)}; exit 0; }`,
    `if [ -e ${shq(o.configDir)} ] && [ ! -d ${shq(o.configDir)} ]; then`,
    `  printf '${BOX_ERR} %s on the box is not a directory\\n' ${shq(o.configDir)}; exit 0`,
    `fi`,
    // -f follows symlinks, and so does statSync on the laptop — the two sides
    // must answer the same question or the comparison is theatre.
    `s=absent; h=-`,
    `if [ -f ${shq(o.setupScript)} ]; then`,
    `  if [ -x ${shq(o.setupScript)} ]; then s=executable; else s=not-executable; fi`,
    // sha256sum is the GNU spelling and shasum the BSD one. The box has the
    // first; these tests run this script under the second.
    `  if command -v sha256sum >/dev/null 2>&1; then h=$(sha256sum ${shq(o.setupScript)} | cut -d" " -f1)`,
    `  elif command -v shasum >/dev/null 2>&1; then h=$(shasum -a 256 ${shq(o.setupScript)} | cut -d" " -f1)`,
    `  else h=-; fi`,
    `  [ -n "$h" ] || h=-`,
    `fi`,
    // "no setup script" and "I could not look" must not come out the same way,
    // so the probe says a WORD and never an empty string.
    `p=no; pb=-`,
    `if [ -f package.json ]; then`,
    `  out=$(node -e ${shq(pkgProbe)} 2>/dev/null) || out=bad`,
    `  [ -n "$out" ] || out=bad`,
    `  case "$out" in`,
    `    "yes "*) p=yes; pb=\${out#yes } ;;`,
    `    no) p=no ;;`,
    `    *) p=bad ;;`,
    `  esac`,
    `fi`,
    `c=absent; t=-`,
    `if [ -e ${shq(o.configFile)} ]; then`,
    `  t=$(base64 < ${shq(o.configFile)} | tr -d "\\n") || { printf '${BOX_ERR} I could not read %s on the box\\n' ${shq(o.configFile)}; exit 0; }`,
    `  c=present`,
    `fi`,
    `printf '${BOX_OK}\\n'`,
    `printf 'script %s\\n' "$s"`,
    `printf 'scriptsha %s\\n' "$h"`,
    `printf 'pkg %s\\n' "$p"`,
    `printf 'pkgbody %s\\n' "$pb"`,
    `printf 'config %s\\n' "$c"`,
    `printf 'text %s\\n' "$t"`,
    `printf '${BOX_END}\\n'`,
  ].join("\n");
}

const CONFIG_FIELDS = ["script", "scriptsha", "pkg", "pkgbody", "config", "text"];

export function parseBoxConfig(
  stdout: string,
  dir: string,
): { ok: true; fields: BoxConfigFields } | { ok: false; why: string } {
  const got = parseBoxRead(stdout, CONFIG_FIELDS);
  if (!got.ok) return got;
  const f = (k: string) => got.fields.get(k) ?? "";

  const states: readonly SetupScriptState[] = ["executable", "not-executable", "absent"];
  const setupScript = states.find((s) => s === f("script"));
  if (setupScript === undefined) {
    return { ok: false, why: `the box said the setup script is '${f("script")}', which means nothing to me` };
  }
  const pkg = f("pkg");
  if (pkg === "bad") {
    // The laptop's readRepoConfig throws for exactly this, so refusing here
    // keeps the two sides answering the same question.
    return { ok: false, why: `${dir}/package.json on the box is not valid JSON, so I cannot tell whether it has a setup script` };
  }
  if (pkg !== "yes" && pkg !== "no") {
    return { ok: false, why: `the box said package.json's setup script is '${pkg}', which means nothing to me` };
  }
  let packageSetup: string | null = null;
  if (pkg === "yes") {
    const body = decodeBoxField(f("pkgbody"), `${dir}/package.json's setup script`);
    if (!body.ok) return body;
    packageSetup = body.text;
  }
  const sha = f("scriptsha");
  if (sha !== "-" && !/^[0-9a-f]{64}$/.test(sha)) {
    return { ok: false, why: `the box said the setup script's sha256 is '${sha}', which is not one` };
  }
  const present = f("config");
  if (present !== "present" && present !== "absent") {
    return { ok: false, why: `the box said the config file is '${present}', which means nothing to me` };
  }
  let configText = "";
  if (present === "present") {
    const decoded = decodeBoxField(f("text"), `the config file in ${dir}`);
    if (!decoded.ok) return decoded;
    configText = decoded.text;
  }
  return {
    ok: true,
    fields: {
      setupScript,
      packageJsonHasSetup: pkg === "yes",
      packageSetup,
      scriptSha256: sha === "-" ? null : sha,
      configText,
    },
  };
}
