/**
 * Starting a new agent session from the dashboard — `POST /api/sessions/new`.
 *
 * Greg, 2026-09-08: *"Add a 'New session' button with a text input box that
 * kicks off a new session (perhaps using `gjd-remote new-claude` so that I can
 * still see/control it with that?)"* — and the parenthesis is the design.
 *
 * **IT SHELLS OUT TO `gjd-remote new-claude`, AND THAT IS NOT LAZINESS.** A
 * session's identity — `CLAUDE_SESSION_ID`, `GJD_KIND`, `GJD_REPO`,
 * `GJD_REMOTE_DIR` — is pinned into the **tmux environment** at launch, and it
 * is the only place it lives. `collect.ts` reads it back from there and
 * `status.ts` classifies on it, so a session started by any other means (a bare
 * `tmux new-session`, a `claude` under `nohup`) shows up on this very dashboard
 * as a **bare shell** — measured 2026-09-08 — which then makes it unsteerable,
 * because steer.ts refuses a shell on purpose. Reusing the tool is what makes
 * the thing we start visible to the page that started it, and killable with
 * `gjd-remote kill`. It is also the house rule:
 * docs/project/overseer-direction.md § Principles, "Reuse `gjd-remote`,
 * don't fork it".
 *
 * **THE PROMPT IS PROSE, NOT AN ARGUMENT — AND THAT TOOK TWO FIXES, NOT ONE.**
 * It is arbitrary text a person typed into a web page, and it goes to
 * `gjd-remote new-claude -p -`, which reads it from **stdin** — a pipe we
 * write, with `execFile` and an argument array, no shell anywhere in the chain.
 * So there is nothing to quote and nothing to escape: not for our exec, not for
 * the local shell, not for the ssh, not for the remote `tmux`.
 *
 * That was as far as this comment used to go, and **it was false end to end**
 * (GPT Sol's F10). gjd-remote writes the prompt to a file on the box and the
 * job runs `claude --session-id UUID "$(cat -- prompt)"` — so on the box the
 * prompt IS one argv word, and until 2026-09-08 there was no `--` in front of
 * it, which made a prompt beginning `--dangerously-skip-permissions` a **Claude
 * flag**. The separator is now in `scripts/gjd-remote.ts`, one line above the
 * `$(cat)`, and `tests/fleet-new-route.test.ts` guards it from here, because
 * this file is where the promise is made. Measured, not assumed:
 * `claude … -p --nonexistent-flag` answers "unknown option", and the same line
 * with `--` gets past parsing to the session-id check.
 *
 * Two things are still true and are not defects we can fix here: the prompt is
 * one argument of the remote `claude` process, so **any process running as greg
 * on the box can read it** out of `/proc`; and a prompt is only ever as private
 * as the box it runs on. What we can keep out of the *name*, we do — see
 * `webProvisionalName`.
 *
 * **NO AUTHENTICATION, SO THE ORIGIN IS THE CSRF DEFENCE.** Reachability over
 * the tailnet is the whole access control (overseer-direction.md § Access),
 * which is fine for a page you have to be on the tailnet to load, and not fine
 * at all for a *form post* — any page in any tab of a browser that can reach
 * this server could otherwise start Claude sessions on this box forever. So a
 * mutation here requires a same-origin `Origin` header and a JSON content type,
 * both of which a cross-site form cannot produce. See `checkRequest`.
 *
 * **ONE AT A TIME, WITH A COOLDOWN, AND NOT AT ALL WHEN THE BOX IS UNWELL.**
 * This is the only route in the tool that can consume the machine: each call
 * starts a Claude process that will run for hours. This box hit load average
 * 391 with the OOM killer firing on 2026-09-08. A stuck finger on a button, or
 * a client that retries a slow request, must not be able to make thirty of
 * them. Three details carry that, and each of them is a bug that was here:
 *
 *  - **The slot is claimed after the body is read, not before** (Sol's F9). The
 *    check used to sit in front of `await readBody`, so two requests could both
 *    find it empty, both finish their bodies, and both launch — and the first
 *    to finish then cleared a slot the second was still holding. The claim is
 *    now the last thing before the launch, with no `await` between the recheck
 *    and the assignment, and a finishing launch releases the slot **only if the
 *    slot is still its own**.
 *  - **`unknown` health is refused, exactly like `critical`** (Sol's F12).
 *    `unknown` is what a box that cannot fork, or whose commands time out,
 *    reports — which is to say it is the *symptom of the thing the gate is for*,
 *    and admitting it was failing open.
 *  - **A launch we lost the answer to holds the door shut longer.** A timeout
 *    kills our process group, which takes the local `tsx` and its `ssh` with
 *    it, but a tmux session the box has already created goes on running and no
 *    signal from here can reach it (Sol's F20). So `maybeStarted` earns a much
 *    longer cooldown than an ordinary finish: not a guarantee of one at a time,
 *    but the honest approximation, and the client says out loud that something
 *    may be out there.
 *
 * **THE DIRECTORY GOES THROUGH gjd-remote's OWN ADMISSION** (Sol's F13). This
 * route used to pass `-d <dir>` always, including for the ordinary repo — and
 * `-d` is deliberately gjd-remote's *escape hatch*: an arbitrary path it cannot
 * identify, so it skips the repo's setup status and starts the session outside
 * the setup lock. That let the dashboard start an agent in a checkout a
 * `gjd-remote setup` was in the middle of rewriting. The default now passes no
 * `-d` at all and runs the child **with its cwd set to the requested
 * directory**, which is how gjd-remote identifies a repo by its git origin: it
 * then asks the box which checkout carries that origin, reads the setup status,
 * and creates the session under the lock. `-d` is still available, as
 * `unsafeDir: true`, and it is named that way so nobody reaches for it by
 * accident. The cost is that the box, not the caller, chooses the directory —
 * so the record carries `startedDir`, and says so when it is not what was asked
 * for.
 *
 * **THREE STATES, NEVER TWO.** `new-claude` takes tens of seconds — six ssh
 * round trips, a `sessions()` listing, a setup-admission handshake — so the
 * request cannot wait for it without holding a connection open for a minute and
 * teaching the client to treat a timeout as a failure when a session was in
 * fact created. It returns **202 with a launch record** and the launch runs on;
 * the record moves `starting` → `started` | `failed`, and `GET
 * /api/sessions/new` is where the client reads it. The state that matters most
 * is the one a two-state design would have to lie about: **`failed` with
 * `maybeStarted: true`**, which is what a timeout or an unreadable answer
 * leaves behind. docs/reusable/silent-success.md.
 *
 * NO IMPORT SIDE EFFECTS, the same rule status.ts, steer.ts and page.ts are
 * written to: everything here is a function, `realIo()` builds its dependencies
 * per call, and the module-level launch register belongs to an instance created
 * by `createNewSessionRoutes()` rather than to the module. Importing this file
 * from a test must not touch the box.
 *
 * `console.log` rather than src/log.ts, deliberately — see the header of
 * server.ts. **The prompt text is never logged**, only its size: it is a
 * person's private instruction to their agent, and this file's log goes to a
 * terminal several other agents can read.
 */
import { execFile, type ExecFileOptionsWithStringEncoding } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { collectHealth, type HealthLevel } from "./health.js";
import { addressableHost } from "./origin.js";

// ---------------------------------------------------------------------------
// The limits. Constants rather than magic numbers, each with the reason it has
// the value it has.
// ---------------------------------------------------------------------------

/**
 * 32 KiB of prompt. gjd-remote itself refuses over 96 KiB, because the box
 * assembles the prompt into a single `execve` argument and Linux caps one
 * argument at ~128 KiB — so ours is deliberately *lower* than the tool's, and
 * the refusal a person meets is this one, in a browser, rather than a
 * subprocess dying with a message nobody sees.
 */
export const MAX_PROMPT_BYTES = 32 * 1024;

/** The request body, capped well above the prompt so the reason is legible. */
export const MAX_BODY_BYTES = 64 * 1024;

/** tmux/gjd-remote's own rule: lower-case letters, digits, hyphens, max 41. */
const SLUG = /^[a-z0-9][a-z0-9-]{0,40}$/;

/** A directory a session may be started in, unless FLEET_NEW_DIR_ROOTS says otherwise. */
const DEFAULT_DIR_ROOTS = ["/home/greg"];

// ---------------------------------------------------------------------------
// The wire shapes.
// ---------------------------------------------------------------------------

/**
 * What the client sends. Only `prompt` is required.
 *
 * **`name` null does not mean "no name" any more, and that is a trade we made
 * with our eyes open** (Sol's F11). Sending no name at all is what lets Claude
 * title the conversation and `gjd-remote ls` adopt that title — but gjd-remote
 * then derives its own placeholder from **the first five words of the prompt**,
 * which it prints, writes to `~/.gjd-remote/log` and hangs on the session for
 * everyone to read. A prompt typed into a web form is the last text that should
 * become a public label, so a launch with no name gets `webProvisionalName()`
 * instead: a name carrying nothing but a clock. See that function for what it
 * costs.
 */
export type NewSessionRequest = {
  prompt: string;
  dir: string;
  /** null means "we will mint an opaque one" — see above, and `webProvisionalName`. */
  name: string | null;
  /**
   * Pass `-d <dir>` — gjd-remote's unverified escape hatch, which skips repo
   * setup status and the setup lock. False, the default, uses the verified
   * origin path instead. Named for what it is so nobody sets it by accident.
   */
  unsafeDir: boolean;
};

export type LaunchState = "starting" | "started" | "failed";

/** One attempt, from the moment it is accepted to whatever became of it. */
export type LaunchRecord = {
  /** Ours, not the box's — the handle the client polls with. */
  id: string;
  state: LaunchState;
  /**
   * The tmux session name: what the caller asked for, or the opaque one this
   * route minted for them (`webProvisionalName`). Since F11 it is known before
   * the launch starts and is never null in practice — the type keeps the null
   * because the wire and `interpretRun`'s read-it-back path still allow one,
   * and a client that has to handle it anyway is not made worse by saying so.
   */
  name: string | null;
  /** What was ASKED for. In repo mode the box may choose another — `startedDir`. */
  dir: string;
  /**
   * Which admission path this launch took: `repo` is gjd-remote's verified
   * origin resolution, under the setup lock; `dir` is the `-d` escape hatch.
   */
  resolution: "repo" | "dir";
  /**
   * The directory the box says it actually started in, once it has said so.
   * Null while starting, and null afterwards when the output did not carry it.
   * In repo mode this is the box's checkout for the origin, which is not
   * necessarily `dir` — a worktree resolves to the checkout it belongs to.
   */
  startedDir: string | null;
  /** The prompt's size. Never the prompt. */
  promptBytes: number;
  requestedAt: string;
  finishedAt: string | null;
  /** Why it failed, in a sentence for a person. Null unless `state` is failed. */
  error: string | null;
  /**
   * **A FAILURE THAT MAY HAVE STARTED SOMETHING.** True when we lost the answer
   * rather than got a refusal — a timeout, a launcher that vanished mid-run. The
   * honest reading is "look at the fleet list, and kill it if it is there", and
   * a client that renders `failed` as "nothing happened" is wrong on exactly
   * these.
   */
  maybeStarted: boolean;
  /** Anything true but awkward — a start whose name we could not read back. */
  note: string | null;
};

/** Everything the client needs to draw the button's state. */
export type NewSessionStatus = {
  ok: true;
  /** A launch is in flight; a second POST would be refused. */
  busy: boolean;
  /** Milliseconds until a POST would be accepted; 0 when it would be now. */
  retryAfterMs: number;
  /** Newest first, capped — this is a live view, not a history. */
  launches: LaunchRecord[];
};

// ---------------------------------------------------------------------------
// Pure request parsing. No I/O, no clock — every one of these is a decision
// about a string, and every one of them is tested.
// ---------------------------------------------------------------------------

export type Refusal = { ok: false; status: number; why: string };
export type Parsed<T> = { ok: true; value: T } | Refusal;

/**
 * Is this request allowed to *mutate* anything?
 *
 * Three checks, and each blocks a real attack rather than a hypothetical one:
 *
 *  - **`content-type: application/json`.** An HTML form can only ever send
 *    `application/x-www-form-urlencoded`, `multipart/form-data` or
 *    `text/plain`, and it cannot set a header. So insisting on JSON is what
 *    stops `<form action="http://box:8787/api/sessions/new">` on any page in
 *    any tab.
 *  - **A same-origin `Origin`.** Browsers attach it to every POST and it cannot
 *    be forged by page script. Missing is refused, not waved through — that
 *    default is how CSRF checks are usually got wrong — and so is the literal
 *    `"null"`, which is what a sandboxed iframe or a `data:` document sends.
 *  - **`sec-fetch-site`, when present.** Modern browsers say plainly where the
 *    request came from. Absent on older ones, so it can only ever refuse.
 *
 * Compared against the request's own `Host`, not against a configured address:
 * this server binds two addresses on purpose (loopback for an ssh forward, the
 * tailnet for a phone) and a hardcoded expectation would break one of them.
 */
export function checkRequest(headers: IncomingHttpHeaders): Parsed<{ origin: string }> {
  const ctype = String(headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
  if (ctype !== "application/json") {
    return { ok: false, status: 415, why: `this route takes application/json, not ${ctype || "an unstated type"}` };
  }

  const host = headers.host;
  if (typeof host !== "string" || host === "") {
    return { ok: false, status: 400, why: "the request had no Host header, so I cannot tell what same-origin means" };
  }

  const origin = headers.origin;
  if (typeof origin !== "string" || origin === "" || origin === "null") {
    return {
      ok: false,
      status: 403,
      why: "this route needs a same-origin Origin header; it has no authentication, so that header is the only thing between it and any page in any tab",
    };
  }
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return { ok: false, status: 403, why: `Origin ${origin} is not a URL` };
  }
  if (parsedOrigin.host !== host) {
    return { ok: false, status: 403, why: `Origin ${origin} is not this server (${host})` };
  }

  // THE HALF THIS ROUTE WAS MISSING, and the route next door had. `Origin`
  // matching `Host` is not enough on its own: a page at `evil.example` whose DNS
  // re-resolves to this box sends both headers saying `evil.example`, they agree
  // perfectly, and the check above passes. `sec-fetch-site` says `same-origin`
  // too, because by the browser's lights it is. Refusing to answer to a name we
  // are never legitimately reached by is the only thing that catches it — and
  // this is the route that STARTS AGENTS, so it had the weaker check of the two.
  if (!addressableHost(parsedOrigin.hostname)) {
    return { ok: false, status: 403, why: `this dashboard is not reached by the name '${parsedOrigin.hostname}'` };
  }

  const site = headers["sec-fetch-site"];
  if (typeof site === "string" && site !== "same-origin" && site !== "none") {
    return { ok: false, status: 403, why: `the browser says this request is ${site}, not same-origin` };
  }

  return { ok: true, value: { origin } };
}

/**
 * A directory a session may be started in.
 *
 * **Normalised-or-refused**: the path must already be its own `path.resolve`,
 * which settles absoluteness, `..`, `.`, doubled and trailing separators in one
 * rule rather than in five checks that each miss a case. Then a root allowlist,
 * because this route has no authentication and "start an agent in `/etc`" is
 * not a thing anyone should be able to ask for. Existence is checked by the
 * caller through the io seam — it is the one part of this that is not pure.
 */
export function checkDir(dir: string, roots: readonly string[]): Parsed<string> {
  if (typeof dir !== "string" || dir === "") return { ok: false, status: 400, why: "dir must be a non-empty string" };
  if (dir.length > 512) return { ok: false, status: 400, why: "dir is implausibly long" };
  // A NUL truncates the path at the syscall while every check above it sees the
  // whole string; a newline breaks any log line that ever carries it.
  if (/[\u0000-\u001F\u007F]/.test(dir)) return { ok: false, status: 400, why: "dir contains a control character" };
  if (!path.isAbsolute(dir) || path.resolve(dir) !== dir) {
    return { ok: false, status: 400, why: `dir must be an absolute, already-normalised path (${path.resolve(dir)})` };
  }
  const inside = roots.some((root) => dir === root || dir.startsWith(root + path.sep));
  if (!inside) return { ok: false, status: 400, why: `dir must be under one of: ${roots.join(", ")}` };
  return { ok: true, value: dir };
}

/**
 * The body, as a request or as the reason it is not one.
 *
 * Every arm is a 400 with a sentence, because the alternative — a throw inside
 * an async handler — is a 500 at best and an unhandled rejection that takes the
 * server down at worst.
 */
export function parseNewSessionBody(
  raw: string,
  opts: { defaultDir: string; roots: readonly string[] },
): Parsed<NewSessionRequest> {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, status: 400, why: "the body is not JSON" };
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, status: 400, why: "the body must be a JSON object" };
  }
  const b = body as Record<string, unknown>;

  if (typeof b["prompt"] !== "string") return { ok: false, status: 400, why: "prompt must be a string" };
  const prompt = b["prompt"];
  if (prompt.trim() === "") return { ok: false, status: 400, why: "prompt is empty" };
  // A NUL would be a lie about the size of what actually reaches the box.
  if (prompt.includes("\u0000")) return { ok: false, status: 400, why: "prompt contains a NUL byte" };
  const promptBytes = Buffer.byteLength(prompt, "utf8");
  if (promptBytes > MAX_PROMPT_BYTES) {
    return {
      ok: false,
      status: 413,
      why: `that prompt is ${Math.round(promptBytes / 1024)}KB and the limit is ${MAX_PROMPT_BYTES / 1024}KB — put the long part in a file in the repo and ask the agent to read it`,
    };
  }

  let name: string | null = null;
  if (b["name"] !== undefined && b["name"] !== null && b["name"] !== "") {
    if (typeof b["name"] !== "string" || !SLUG.test(b["name"])) {
      return { ok: false, status: 400, why: "name must be lower-case letters, digits and hyphens, at most 41 characters" };
    }
    name = b["name"];
  }

  const dirGiven = b["dir"];
  if (dirGiven !== undefined && dirGiven !== null && typeof dirGiven !== "string") {
    return { ok: false, status: 400, why: "dir must be a string" };
  }
  const dirChecked = checkDir(
    dirGiven === undefined || dirGiven === null || dirGiven === "" ? opts.defaultDir : dirGiven,
    opts.roots,
  );
  if (!dirChecked.ok) return dirChecked;

  // A BOOLEAN OR NOTHING. `"false"`, `0` and `"no"` are all truthy-or-falsy in
  // some reading, and this flag turns off a safety check — so anything that is
  // not literally `true` or `false` is a refusal rather than a guess.
  const unsafeGiven = b["unsafeDir"];
  if (unsafeGiven !== undefined && typeof unsafeGiven !== "boolean") {
    return { ok: false, status: 400, why: "unsafeDir must be true or false" };
  }
  const unsafeDir = unsafeGiven === true;

  return { ok: true, value: { prompt, dir: dirChecked.value, name, unsafeDir } };
}

/**
 * A placeholder name for a launch nobody named — and it says nothing about the
 * prompt, which is the whole point.
 *
 * gjd-remote's own placeholder is `slugify(first five words of the prompt)`,
 * which is a good name when you typed the prompt into your own terminal and a
 * **leak** when you typed it into a web form: it goes on the tmux session, into
 * `gjd-remote ls` for every agent on the box, into `~/.gjd-remote/log`, and
 * onto this dashboard. "my private instruction about the acquisition" becomes a
 * session called `my-private-instruction-about-the`. Sol's F11.
 *
 * **WHAT IT COSTS, PLAINLY.** Passing a name at all makes gjd-remote treat the
 * session as non-provisional: it launches `claude --name <ours>`, sets
 * `GJD_PROVISIONAL=0`, and `adoptTitles()` in `gjd-remote ls` therefore never
 * renames it to Claude's own title for the work. So a web-launched session
 * keeps this clock-shaped name for its whole life. That is a real loss —
 * Greg asked for Claude's title specifically — and the fix is a change in
 * gjd-remote (a way to say "this name is provisional") rather than one here,
 * because only gjd-remote can set that flag. Until then: privacy wins, because
 * a name is forever and a title is a convenience.
 *
 * The clock is the box's local time, matching gjd-remote's own `timestampName`,
 * and the six hex characters are what stop two launches in the same second
 * colliding — a duplicate name is a refusal from tmux, not a merge.
 */
export function webProvisionalName(nowMs: number, entropy: string): string {
  const d = new Date(nowMs);
  const p = (n: number): string => String(n).padStart(2, "0");
  const day = `${p(d.getFullYear() % 100)}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  const time = `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `web-${day}-${time}-${entropy.replace(/[^a-z0-9]/g, "").slice(0, 6) || "x"}`;
}

/**
 * The argv for one launch, after the script path.
 *
 * `-p -` is the whole point: the prompt arrives on stdin, so no part of it is
 * ever an argument. `--no-attach` because there is no terminal here to attach
 * to — without it gjd-remote would try, and what it does then depends on
 * whether it can open `/dev/tty`, which is not a thing to leave to chance in a
 * server. The name is a positional and is simply absent when we have none.
 *
 * **`-d` IS THE UNSAFE MODE AND IS ABSENT BY DEFAULT** (Sol's F13). gjd-remote
 * reads an explicit `--dir` as "an arbitrary path, possibly not a repo at all",
 * and so skips the repo's setup status and the setup lock — the very checks
 * that stop a session starting in a tree a `gjd-remote setup` is rewriting.
 * Without it, gjd-remote identifies the repo from **the child's cwd**, which
 * `launch()` sets to the requested directory; that is why this argv can be
 * silent about the directory without losing it.
 */
export function newClaudeArgs(
  script: string,
  req: { name: string | null; dir: string; unsafeDir: boolean },
): string[] {
  return [
    script,
    "new-claude",
    ...(req.name === null ? [] : [req.name]),
    ...(req.unsafeDir ? ["-d", req.dir] : []),
    "-p",
    "-",
    "--no-attach",
  ];
}

/** Terminal colour, gone — gjd-remote writes to a pipe but still colours. */
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * The session's name, out of what gjd-remote said.
 *
 * Two places say it, and we try both: the green `✓ started 'name'` at the end,
 * and the bold `gjd-remote new-claude <name> → host:dir` header at the start.
 * We ask for it rather than choosing it, because a launch with no `name` in the
 * request gets a *provisional* name gjd-remote derives from the prompt — and
 * that name is what the fleet list will show until Claude titles itself.
 */
export function parseStartedName(stdout: string): string | null {
  const clean = stripAnsi(stdout);
  const started = /✓ started '([^']+)'/.exec(clean);
  if (started?.[1]) return started[1];
  const header = /^gjd-remote new-claude (\S+)/m.exec(clean);
  return header?.[1] ?? null;
}

/**
 * The directory the box actually started in, out of gjd-remote's header line.
 *
 * `gjd-remote new-claude <name> → greg@1.2.3.4:/home/greg/code/spideryarn2` —
 * and the part after the FIRST colon is the path, because the host half can
 * carry a `user@`, an IPv6 address or neither, and the path cannot carry a
 * colon before its leading slash.
 *
 * This matters only since `-d` stopped being the default: in repo mode the box
 * resolves the origin to a checkout of its own choosing, which for a worktree
 * is the checkout it belongs to rather than the worktree. An absolute path or
 * nothing — a relative one would be a misparse, not a directory.
 */
export function parseStartedDir(stdout: string): string | null {
  const m = /^gjd-remote new-claude \S+ → (.+)$/m.exec(stripAnsi(stdout));
  const rest = m?.[1]?.trim();
  if (rest === undefined) return null;
  const colon = rest.indexOf(":");
  const dir = colon === -1 ? rest : rest.slice(colon + 1);
  return dir.startsWith("/") ? dir : null;
}

/** The tail of a subprocess's noise, for a person, bounded. */
export function lastWords(text: string, lines = 4, max = 600): string {
  const clean = stripAnsi(text)
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== "");
  const tail = clean.slice(-lines).join(" · ");
  return tail.length > max ? tail.slice(0, max) + "…" : tail;
}

export type RunResult = {
  /** The exit code, or null when it died on a signal or never ran. */
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** Set when the process could not be run at all (ENOENT and friends). */
  spawnError: string | null;
};

/** What became of one launch, as a decision rather than a guess. */
export type Outcome =
  | { kind: "started"; name: string | null; dir: string | null; note: string | null }
  | { kind: "failed"; why: string; maybeStarted: boolean };

/**
 * A finished subprocess, read honestly.
 *
 * The interesting arm is the timeout. gjd-remote creates the tmux session
 * *before* it prints anything conclusive, so a run we killed at four minutes
 * may well have left a live session behind — saying "failed, nothing happened"
 * would be the exact lie this file's header is about. It reports
 * `maybeStarted`, and the client is expected to say so out loud.
 */
export function interpretRun(r: RunResult, requestedName: string | null, requestedDir: string): Outcome {
  if (r.spawnError !== null) {
    return { kind: "failed", why: `could not run gjd-remote: ${r.spawnError}`, maybeStarted: false };
  }
  if (r.timedOut) {
    return {
      kind: "failed",
      why: "gjd-remote new-claude did not finish in time and was killed — a session MAY still have been created; check the fleet list and `gjd-remote kill` it if it is there",
      maybeStarted: true,
    };
  }
  if (r.code !== 0) {
    const said = lastWords(r.stderr) || lastWords(r.stdout) || "it said nothing";
    return {
      kind: "failed",
      why: `gjd-remote exited ${r.code === null ? "on a signal" : r.code}: ${said}`,
      // gjd-remote's own refusals happen before the session exists, but not all
      // of them do: it explicitly reports "the session MAY exist" when the box's
      // answer was unreadable, and it dies after `tmux new-session` if
      // `confirmStarted` cannot see it. So a non-zero exit that says so is not
      // a promise that nothing was made.
      maybeStarted: /MAY exist|may still|gjd-remote kill/i.test(stripAnsi(r.stdout + r.stderr)),
    };
  }
  const name = requestedName ?? parseStartedName(r.stdout);
  const dir = parseStartedDir(r.stdout);
  // Both notes, when both are true. A launch that started somewhere else under
  // a name we could not read is exactly the one worth being told twice about,
  // and a `??` between them would have shown only the first.
  const notes = [
    name === null
      ? "it started, but I could not read the session's name out of gjd-remote's output — find it in the fleet list"
      : null,
    dir !== null && dir !== requestedDir
      ? `it started in ${dir}, not ${requestedDir} — the box resolves a repo by its git origin, so a worktree lands in the checkout it belongs to`
      : null,
  ].filter((n): n is string => n !== null);
  return { kind: "started", name, dir, note: notes.length === 0 ? null : notes.join(" · ") };
}

// ---------------------------------------------------------------------------
// The io seam. Everything that touches the box is behind this, so a test can
// drive the whole route without starting a Claude on a machine that already
// has thirty-seven of them.
// ---------------------------------------------------------------------------

export type RunRequest = {
  bin: string;
  args: string[];
  cwd: string;
  /** Written to the child's stdin and then closed. This is where the prompt goes. */
  stdinText: string;
  timeoutMs: number;
};

export type NewSessionIo = {
  run(req: RunRequest): Promise<RunResult>;
  dirExists(dir: string): boolean;
  /** The box's own verdict, so a machine that is falling over is not asked to do more. */
  healthLevel(): HealthLevel;
  now(): number;
  log(line: string): void;
};

/** The repo this file is in — `tools/fleet/` is two levels down from its root. */
export function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/**
 * How to run gjd-remote, without depending on PATH.
 *
 * `node node_modules/tsx/dist/cli.mjs` is exactly what `npx tsx` ends up doing,
 * minus npx's resolution step — and minus the chance that a server started from
 * systemd has a PATH with no npm on it. The npx fallback is for a checkout with
 * no local tsx, where it is at least a legible failure.
 */
export function launcher(root: string): { bin: string; prefix: string[] } {
  const local = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
  if (existsSync(local)) return { bin: process.execPath, prefix: [local] };
  return { bin: "npx", prefix: ["tsx"] };
}

/** How long a killed process group gets to die politely before SIGKILL. */
const GRACE_MS = 5_000;

/**
 * The real thing.
 *
 * `execFile` with an ARRAY, never a shell string: nothing here is ever parsed
 * by `sh`, so the directory and the name cannot become commands however they
 * are spelled. The prompt is not even here — it goes down the pipe below.
 *
 * **THE TIMEOUT IS OURS, NOT `execFile`'s, AND IT KILLS A PROCESS GROUP.**
 * `execFile`'s own `timeout` signals the direct child only — which here is
 * `node tsx`, whose `ssh` goes on running, holding the connection the launch
 * needs and the slot this route counts (Sol's F20). So the child is spawned
 * `detached`, giving it a process group of its own, and the deadline sends
 * SIGTERM to `-pid`: tsx and its ssh together. SIGKILL follows if the group is
 * still there.
 *
 * What it still cannot reach is a tmux session the box has already created —
 * that is a process on another machine with no parent here, and no signal from
 * this function will ever touch it. That is why a timeout is
 * `maybeStarted: true` and buys a long cooldown rather than an ordinary one.
 */
export function realIo(): NewSessionIo {
  return {
    run: (req) =>
      new Promise<RunResult>((resolve) => {
        let settled = false;
        const done = (r: RunResult): void => {
          if (settled) return;
          settled = true;
          resolve(r);
        };
        // OUR OWN FLAG, not `err.killed`: the callback cannot tell a deadline
        // we enforced from a SIGTERM somebody else sent, and reporting an
        // outside kill as "timed out" would be a sentence about the wrong
        // thing.
        let deadlinePassed = false;
        // A NAMED VARIABLE RATHER THAN AN INLINE OBJECT, because of the last
        // field: `execFile` hands its options straight to `spawn`, so
        // `detached` works — but @types/node leaves it out of
        // `ExecFileOptions`, and an inline object would be an excess-property
        // error. Widening the type here says "the runtime takes this, the
        // declaration is short of it" instead of casting the call.
        const options: ExecFileOptionsWithStringEncoding & { detached: boolean } = {
          cwd: req.cwd,
          // No `timeout:` — see the header above; ours is below and it is
          // aimed at the group.
          killSignal: "SIGTERM",
          encoding: "utf8",
          // gjd-remote is chatty and a failing ssh can be chattier.
          maxBuffer: 8 * 1024 * 1024,
          // Its own process group, which is the only thing that makes the
          // kill below reach the ssh underneath.
          detached: true,
        };
        const child = execFile(
          req.bin,
          req.args,
          options,
          (err, stdout, stderr) => {
            clearTimeout(deadline);
            clearTimeout(hardStop);
            const e = err as (Error & { code?: number | string; killed?: boolean; signal?: string }) | null;
            const spawnError = e !== null && typeof e.code === "string" ? `${e.code}: ${e.message}` : null;
            done({
              code: e === null ? 0 : typeof e.code === "number" ? e.code : null,
              stdout,
              stderr,
              timedOut: deadlinePassed,
              spawnError,
            });
          },
        );
        const pid = child.pid;
        /** SIGTERM to the whole group, falling back to the one child we know of. */
        const killGroup = (signal: NodeJS.Signals): void => {
          try {
            if (pid === undefined) throw new Error("no pid");
            // The MINUS is the entire point: a bare pid signals tsx and leaves
            // the ssh. `detached` above is what makes -pid a group of its own
            // and not this server's.
            process.kill(-pid, signal);
          } catch {
            try {
              child.kill(signal);
            } catch {
              /* it is already gone, which is the outcome we wanted */
            }
          }
        };
        let hardStop: NodeJS.Timeout | undefined;
        const deadline = setTimeout(() => {
          deadlinePassed = true;
          killGroup("SIGTERM");
          hardStop = setTimeout(() => killGroup("SIGKILL"), GRACE_MS);
          hardStop.unref();
        }, req.timeoutMs);
        // Neither timer may hold the process open: a server that cannot exit
        // because a launch is pending is a worse bug than a launch that ends
        // unpoliced.
        deadline.unref();
        // THE PROMPT, AND THE ONLY PLACE IT TRAVELS. An EPIPE here means the
        // child died before reading it, which the exit handler above will
        // report properly — so it must not become an unhandled error event.
        child.stdin?.on("error", () => {});
        child.stdin?.end(req.stdinText, "utf8");
      }),
    dirExists: (dir) => {
      try {
        return statSync(dir).isDirectory();
      } catch {
        return false;
      }
    },
    // Without the vmstat sample: it costs three seconds of waiting, and the
    // question here ("is the box on fire?") is answered by load, memory and
    // swap fullness, all of which are sub-100ms.
    healthLevel: () => collectHealth({ includeSwapActivity: false }).verdict.level,
    now: () => Date.now(),
    log: (line) => console.log(line),
  };
}

// ---------------------------------------------------------------------------
// The route.
// ---------------------------------------------------------------------------

export type NewSessionOptions = {
  io?: NewSessionIo;
  /** Where a request with no `dir` starts. */
  defaultDir?: string;
  /** Directories a session may be started under. */
  roots?: readonly string[];
  /** How long to wait for `new-claude` before killing it. */
  timeoutMs?: number;
  /** How long after a launch finishes before another is allowed. */
  cooldownMs?: number;
  /**
   * The cooldown after a launch whose answer we LOST — a timeout, a launcher
   * that vanished. Much longer, because a session may be running that nothing
   * here can see or stop: Sol's F20.
   */
  uncertainCooldownMs?: number;
  /** Refuse when the box reports `critical` — or `unknown`, which is not better. */
  gateOnHealth?: boolean;
  /** The repo whose `scripts/gjd-remote.ts` we run, and the child's cwd. */
  root?: string;
};

export type NewSessionRoutes = {
  /** Mount at `/api/sessions/new`; it dispatches on the method itself. */
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
  /** The launch register, for a test or for the Overseer later. Newest first. */
  launches(): LaunchRecord[];
};

/** How many attempts we remember. A live view, not a history — the store is the Overseer's job. */
const KEEP = 20;

export function createNewSessionRoutes(options: NewSessionOptions = {}): NewSessionRoutes {
  const io = options.io ?? realIo();
  const root = options.root ?? repoRoot();
  const defaultDir = options.defaultDir ?? process.env["FLEET_NEW_DIR"] ?? root;
  const roots =
    options.roots ??
    (process.env["FLEET_NEW_DIR_ROOTS"]?.split(",").map((s) => s.trim()).filter(Boolean) ?? DEFAULT_DIR_ROOTS);
  const timeoutMs = options.timeoutMs ?? Number(process.env["FLEET_NEW_TIMEOUT_MS"] ?? 240_000);
  const cooldownMs = options.cooldownMs ?? Number(process.env["FLEET_NEW_COOLDOWN_MS"] ?? 60_000);
  const uncertainCooldownMs =
    options.uncertainCooldownMs ?? Number(process.env["FLEET_NEW_UNCERTAIN_COOLDOWN_MS"] ?? 15 * 60_000);
  const gateOnHealth = options.gateOnHealth ?? true;

  /** Newest first. */
  const records: LaunchRecord[] = [];
  /** The single slot. Not a counter: one at a time is the rule, so it is one variable. */
  let inFlight: LaunchRecord | null = null;
  /**
   * When the next launch may start, as a MOMENT rather than a duration — because
   * the wait is not one length: an ordinary finish buys `cooldownMs`, and a
   * launch whose answer we lost buys `uncertainCooldownMs` (Sol's F20).
   *
   * NEGATIVE INFINITY, not 0. "Nothing has finished yet" must mean "no wait",
   * and `0` only accidentally does — it means "the epoch", which is a long time
   * ago on a real clock and a moment ago on an injected one. A fresh instance
   * refusing its first launch is the kind of thing that shows up only under a
   * fake clock, which is where it showed up.
   */
  let nextAllowedAt = Number.NEGATIVE_INFINITY;
  /** Why we are cooling down, in a sentence, for the refusal to carry. */
  let cooldownWhy = "";

  const retryAfterMs = (): number => {
    if (inFlight !== null) return cooldownMs;
    const left = nextAllowedAt - io.now();
    return left > 0 ? left : 0;
  };

  function status(): NewSessionStatus {
    return { ok: true, busy: inFlight !== null, retryAfterMs: retryAfterMs(), launches: records.slice(0, KEEP) };
  }

  /**
   * Run the launch, and record what became of it. Never throws: this is called
   * without an `await`, so a throw would be an unhandled rejection that could
   * take the whole server down with it.
   */
  async function launch(record: LaunchRecord, req: NewSessionRequest): Promise<void> {
    const { bin, prefix } = launcher(root);
    const args = [...prefix, ...newClaudeArgs(path.join(root, "scripts", "gjd-remote.ts"), req)];
    const startedAt = io.now();
    let outcome: Outcome;
    try {
      // THE CWD IS THE TARGET DIRECTORY, NOT THE SERVER'S REPO, and in repo
      // mode it is load-bearing: gjd-remote identifies the repo from the git
      // origin of the directory it is standing in, and that identification is
      // what earns the setup-status check and the setup lock (Sol's F13).
      // `dirExists` has already said it is there.
      const result = await io.run({ bin, args, cwd: req.dir, stdinText: req.prompt, timeoutMs });
      outcome = interpretRun(result, req.name, req.dir);
    } catch (err) {
      // The seam itself broke, which is not a thing the real one does — but a
      // rejection swallowed here would leave a record stuck on `starting` and
      // the slot held forever.
      outcome = {
        kind: "failed",
        why: `the launcher threw: ${err instanceof Error ? err.message : String(err)}`,
        maybeStarted: true,
      };
    }
    const tookMs = io.now() - startedAt;
    record.finishedAt = new Date(io.now()).toISOString();
    if (outcome.kind === "started") {
      record.state = "started";
      record.name = outcome.name;
      record.startedDir = outcome.dir;
      record.note = outcome.note;
      io.log(
        `new-session ${record.id} started ${record.name ?? "(name unread)"} in ${Math.round(tookMs / 1000)}s` +
          ` at ${record.startedDir ?? "(dir unread)"}`,
      );
    } else {
      record.state = "failed";
      record.error = outcome.why;
      record.maybeStarted = outcome.maybeStarted;
      io.log(
        `new-session ${record.id} failed after ${Math.round(tookMs / 1000)}s` +
          `${outcome.maybeStarted ? " (MAY have started something)" : ""}: ${outcome.why}`,
      );
    }
    // Last, and in this order: the slot is released only once the record says
    // what happened, so a status read can never see "not busy" beside a record
    // that still says "starting".
    //
    // **ONLY IF THE SLOT IS STILL OURS** (Sol's F9). Before the claim was made
    // atomic, two launches could be live at once and the first to finish
    // cleared the second's slot from under it — so the second ran unpoliced and
    // a third could start beside it. That claim is now impossible to lose
    // fairly, and this check is what makes the impossible LOUD rather than
    // silent: if the slot has somebody else's launch in it, the bug is
    // upstream, and stamping over it would erase the evidence.
    if (inFlight === record) {
      const uncertain = record.state === "failed" && record.maybeStarted;
      nextAllowedAt = io.now() + (uncertain ? uncertainCooldownMs : cooldownMs);
      cooldownWhy = uncertain
        ? `the last launch's answer was lost and a session MAY be running that nothing here can see — check the fleet list`
        : `a session was started less than ${Math.round(cooldownMs / 1000)}s ago`;
      inFlight = null;
    } else {
      io.log(
        `new-session ${record.id} finished, but the slot is held by ${inFlight?.id ?? "nothing"} — leaving it alone; ` +
          `two launches were live at once, which should not be possible`,
      );
    }
  }

  /**
   * Is the single slot free right now?
   *
   * Synchronous, cheap, and called TWICE on purpose: once before the body is
   * read, so a client hammering the button is refused at the cheapest possible
   * point, and once immediately before the claim, because the first answer is
   * stale the moment the handler awaits anything (Sol's F9). Neither call may
   * await, and nothing may await between the second call and `inFlight = …`.
   */
  function slotRefusal(): { refusal: Refusal; extra: Record<string, unknown> } | null {
    if (inFlight !== null) {
      return {
        refusal: {
          ok: false,
          status: 429,
          why: "a session is already starting; one at a time, because each one is a Claude process on a box that fell over today",
        },
        extra: { retryAfterMs: retryAfterMs(), busy: true },
      };
    }
    const wait = retryAfterMs();
    if (wait > 0) {
      return {
        refusal: { ok: false, status: 429, why: `${cooldownWhy}; wait ${Math.ceil(wait / 1000)}s` },
        extra: { retryAfterMs: wait, busy: false },
      };
    }
    return null;
  }

  async function post(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const allowed = checkRequest(req.headers);
    if (!allowed.ok) return refuse(res, allowed);

    const early = slotRefusal();
    if (early !== null) {
      io.log(`new-session refused before reading the body: ${early.refusal.why}`);
      return refuse(res, early.refusal, early.extra);
    }

    const body = await readBody(req, MAX_BODY_BYTES);
    if (!body.ok) return refuse(res, body);

    const parsed = parseNewSessionBody(body.value, { defaultDir, roots });
    if (!parsed.ok) {
      io.log(`new-session refused: ${parsed.why}`);
      return refuse(res, parsed);
    }
    const want = parsed.value;

    if (!io.dirExists(want.dir)) {
      io.log(`new-session refused: ${want.dir} is not a directory on this box`);
      return refuse(res, { ok: false, status: 400, why: `${want.dir} is not a directory on this box` });
    }

    // THE BOX GETS A VETO. Gated on `critical` rather than `strained`: strained
    // is this machine's ordinary weekday (load 27 across 16 cores as this was
    // written, verdict "ok"), and a gate that is always closed is a gate
    // somebody removes. Critical means load over 4x the cores, available memory
    // under 5%, or swap at the cliff — the state in which starting another
    // Claude is how the OOM killer gets to choose which agent dies.
    //
    // AND `unknown` IS REFUSED TOO, which it was not (Sol's F12). `unknown` is
    // what health.ts reports when load, memory and swap could ALL not be read —
    // a box that cannot fork, or whose commands time out, which is a symptom of
    // the exact condition this gate exists for. Admitting it was failing open
    // at the one moment the gate mattered. The two get different sentences
    // because they are different situations for the person reading them.
    if (gateOnHealth) {
      const level = io.healthLevel();
      if (level === "critical" || level === "unknown") {
        io.log(`new-session refused: the box reports ${level}`);
        return refuse(res, {
          ok: false,
          status: 503,
          why:
            level === "critical"
              ? "the box is critical (load, memory or swap) — starting another Claude now is how the OOM killer gets to choose which agent dies. Try again when the dashboard's health line is calmer."
              : "I could not read this box's load, memory OR swap, which is what a machine too busy to fork looks like — so I am not starting anything. Try again, or look at the health line.",
        });
      }
    }

    const record: LaunchRecord = {
      id: randomUUID(),
      state: "starting",
      // MINTED HERE WHEN THE CLIENT DID NOT NAME IT, rather than left to
      // gjd-remote, whose placeholder is the first five words of the prompt.
      // webProvisionalName says what that costs.
      name: want.name ?? webProvisionalName(io.now(), randomUUID().replace(/-/g, "")),
      dir: want.dir,
      resolution: want.unsafeDir ? "dir" : "repo",
      startedDir: null,
      promptBytes: Buffer.byteLength(want.prompt, "utf8"),
      requestedAt: new Date(io.now()).toISOString(),
      finishedAt: null,
      error: null,
      maybeStarted: false,
      note: null,
    };

    // THE CLAIM, AND NOTHING MAY AWAIT BETWEEN THE RECHECK AND IT (Sol's F9).
    // The check at the top of this function was true before `await readBody`,
    // and a second request can have arrived, parsed and launched since then.
    const late = slotRefusal();
    if (late !== null) {
      io.log(`new-session refused after reading the body: ${late.refusal.why}`);
      return refuse(res, late.refusal, late.extra);
    }
    inFlight = record;

    records.unshift(record);
    records.length = Math.min(records.length, KEEP);
    // The size, the directory and the name — never the text. It is a person's
    // instruction to their agent, and this log is read by other agents.
    io.log(
      `new-session ${record.id} starting: dir=${record.dir} (${record.resolution}) name=${record.name} promptBytes=${record.promptBytes}`,
    );

    // NOT AWAITED, and that is the design — see the header. `void` rather than
    // a bare call so the intent is legible and the lint rule stays satisfied.
    void launch(record, { ...want, name: record.name });

    sendJson(res, 202, { ok: true, launch: record, retryAfterMs: cooldownMs });
  }

  return {
    async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
      const url = (req.url ?? "").split("?")[0] ?? "";
      if (url.replace(/\/+$/, "") !== "/api/sessions/new") {
        sendJson(res, 404, { ok: false, error: "not found" });
        return;
      }
      if (req.method === "GET") {
        sendJson(res, 200, status());
        return;
      }
      if (req.method !== "POST") {
        res.setHeader("allow", "GET, POST");
        sendJson(res, 405, { ok: false, error: `${req.method ?? "that method"} is not allowed here` });
        return;
      }
      try {
        await post(req, res);
      } catch (err) {
        // A 500 that says what happened, rather than a socket that hangs. The
        // slot is deliberately NOT released here: nothing above can throw after
        // it is taken.
        const why = err instanceof Error ? err.message : String(err);
        io.log(`new-session request failed unexpectedly: ${why}`);
        if (!res.headersSent) sendJson(res, 500, { ok: false, error: why });
        else res.end();
      }
    },
    launches: () => records.slice(),
  };
}

/**
 * The default instance, which is what server.ts mounts.
 *
 * Built lazily rather than at import: **no import side effects**, and a test
 * that imports this module must not read the environment or the clock.
 */
let shared: NewSessionRoutes | null = null;
export function newSessionRoutes(): NewSessionRoutes {
  shared ??= createNewSessionRoutes();
  return shared;
}

// ---------------------------------------------------------------------------
// Plumbing.
// ---------------------------------------------------------------------------

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function refuse(res: ServerResponse, r: Refusal, extra: Record<string, unknown> = {}): void {
  if (typeof extra["retryAfterMs"] === "number") {
    res.setHeader("retry-after", String(Math.ceil(extra["retryAfterMs"] / 1000)));
  }
  sendJson(res, r.status, { ok: false, error: r.why, ...extra });
}

/**
 * The body, with a hard cap.
 *
 * The cap is enforced as the bytes arrive rather than after, because the point
 * of it is not to allocate 400MB for a request nobody meant to send. A request
 * that overruns is destroyed: there is no useful conversation left to have with
 * a client that is still sending.
 */
export async function readBody(req: IncomingMessage, maxBytes: number): Promise<Parsed<string>> {
  return new Promise<Parsed<string>>((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const done = (r: Parsed<string>): void => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        done({ ok: false, status: 413, why: `the body is over ${maxBytes} bytes` });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => done({ ok: true, value: Buffer.concat(chunks).toString("utf8") }));
    req.on("error", (err) => done({ ok: false, status: 400, why: `the request stream failed: ${err.message}` }));
    req.on("aborted", () => done({ ok: false, status: 400, why: "the client went away" }));
  });
}
