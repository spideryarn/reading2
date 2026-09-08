/**
 * The recent messages of one Claude session, for the dashboard's detail pane.
 *
 * Greg, 2026-09-08: *"if I click on a session, show much more information about
 * it in the right column, e.g. input it requires from me, the recent messages,
 * and anything else that might be useful"*. This module is the "recent
 * messages" half.
 *
 * ## READ THE TAIL, NOT THE FILE
 *
 * Transcripts on this box run to 33 MB (`225d6eb2….jsonl`, measured 2026-09-08)
 * and there are ~40 live sessions. `gjd-remote ls` greps whole transcripts and
 * costs 10–12 seconds, and not doing that is most of why this dashboard exists.
 * So this opens the file, seeks to the end, and walks **backwards** in chunks
 * until it has enough complete JSONL records, then stops. `maxBytes` caps it
 * absolutely, so a session whose tail is nothing but tool traffic costs a
 * bounded read rather than the whole file. Nothing is ever held in memory but
 * the chunks actually walked.
 *
 * ## THE PATH IS NOT DERIVABLE FROM THE DIRECTORY, AND THAT IS NOT A SLUG BUG
 *
 * Transcripts live at `~/.claude/projects/<slug>/<uuid>.jsonl`, where `<slug>`
 * is a slugified cwd. The slug rule itself is simple (see `slugifyDir`) — but
 * slugifying `row.meta.dir` finds the file for only **7 of the 30** live
 * sessions that have a uuid at all (measured against `/api/state`, 2026-09-08).
 *
 * The reason is not lossiness. It is that **`meta.dir` is where the session was
 * launched and the transcript follows where it went.** A session started in the
 * primary checkout and then sent into a worktree by `EnterWorktree` writes a
 * `{"type":"relocated","relocatedCwd":…}` record and its transcript file moves
 * to the *worktree's* slug directory, while `meta.dir` still says the primary —
 * confirmed on `3dbdbfcb…`, whose file sits under
 * `…--claude-worktrees-changelog-toc-and-opensource` with 84 `relocated`
 * records and two distinct `cwd` values inside. That is the ordinary case on
 * this box, not an edge case, because CLAUDE.md tells every agent to work in a
 * worktree.
 *
 * So the design is: **the uuid is the identity and the directory is only a
 * hint.** Try the slugified dir first (one `stat`), and on a miss scan the
 * project directories for `<uuid>.jsonl` — 27 directories, 405 entries, **1.3 ms**
 * measured, because it stats candidates and opens nothing. A uuid was found
 * under exactly one slug for all 244 transcripts on this box, so the scan has
 * nothing to choose between; where it ever does it takes the most recently
 * written and reports how many it saw, rather than letting `readdir` order pick.
 * Getting the slug rule slightly wrong therefore costs a few milliseconds, not a
 * wrong answer, which is the right place for a guess to live.
 *
 * ## SAYING SO WHEN WE CANNOT FIND IT
 *
 * `readRecentMessages` returns a discriminated union and **never an empty array
 * standing in for a failure**. "This agent has said nothing", "this session has
 * no conversation to read", "the file is not there" and "the file would not
 * read" are four different facts, and only the first is about the agent. That is
 * the house rule — docs/reusable/silent-success.md, and the long comments in
 * `tools/fleet/state.ts` about `collectedAt: null` — and it is the same failure
 * shape as an empty list meaning "none", "not asked yet" or "asked and failed".
 * Even the `found` arm carries `reachedStartOfFile`, so "only three turns"
 * cannot be confused with "we stopped reading after three".
 *
 * ## EVERY STRING OUT OF HERE IS UNTRUSTED
 *
 * This is agent-authored text, and the agent may have been summarising a web
 * page, a PR comment or a paste that was actively hostile. The consumer renders
 * it in a browser. **Nothing here is escaped and nothing here is markup** — the
 * `text` fields are plain strings, deliberately with no HTML, no markdown
 * wrapper and no ellipsis character bolted onto a truncated string, so that the
 * React client stays the one and only escaping layer and never has a reason to
 * reach for `dangerouslySetInnerHTML`. C0 control characters are scrubbed (see
 * `plainText`) because they are terminal noise rather than content, not as a
 * security measure. If a consumer ever renders this as HTML, that is the bug.
 *
 * ## NO IMPORT SIDE EFFECTS
 *
 * Nothing at module scope reads the environment, the home directory or the
 * disk. `server.ts` binds ports at import time and that is exactly why
 * `state.ts` and `config.ts` exist as separate modules; importing `page.ts` from
 * a test once bound port 8787 and took the suite from 4s to 19s. The projects
 * directory is resolved inside the call, from an argument that defaults to
 * `$HOME`.
 */
import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// The shape that goes over the wire
// ---------------------------------------------------------------------------

/**
 * Who produced a turn — and the distinctions here are the ones that were
 * verified on disk, not the ones the JSONL `role` field offers.
 *
 * **`role: "user"` is very often not a person.** Across two real transcripts the
 * `origin.kind` values on user records were `human` (64), `task-notification`
 * (319), `peer` (4) and `auto-continuation` (2) — so a pane that renders every
 * user record as "Greg said" is wrong about it more than four times out of five,
 * and would attribute another agent's message, or a subagent's completion
 * notice, to him. Each of those is a separate member here for that reason.
 *
 * `compact-summary` and `injected` are the two that matter most: both are
 * machine-written text wearing `role: "user"`. A compaction summary opens
 * "This session is being continued from a previous conversation…" and is the
 * single most convincing wrong answer this module could give — it reads exactly
 * like a person recapping the task.
 */
export type TurnSpeaker =
  /** A person typed it into the pane. A steer (`tools/fleet/steer.ts`) also lands here, and deliberately: it *is* typed into the pane, so it is indistinguishable from Greg at the keyboard by anything in the transcript, and claiming otherwise would be a guess. */
  | "human"
  /** The model's own prose. */
  | "assistant"
  /** Another agent, over the peer socket. Not Greg. */
  | "peer"
  /** A subagent finishing, or an auto-continuation. Machinery, not conversation. */
  | "notification"
  /** Claude Code's recap of a conversation that ran out of context, wearing `role: "user"`. */
  | "compact-summary"
  /** A `<system-reminder>`/`<local-command-caveat>` injection wearing `role: "user"`. */
  | "injected"
  /** An API error rendered into the transcript as an assistant turn. */
  | "api-error"
  /** Claude Code's own notes — `system` records that carry text. */
  | "system";

/** One tool call, reduced to what is worth showing. Never its result. */
export type ToolCallSummary = {
  /** The tool's name, e.g. `Bash`, `Edit`. */
  name: string;
  /**
   * One short line about what it was called on — a command, a path — or null
   * when the input had no obvious headline field. Truncated hard; this is a
   * label, not a payload, and it is as untrusted as everything else here.
   */
  detail: string | null;
};

/** One turn of conversation, in a shape a React client can render directly. */
export type TranscriptTurn = {
  speaker: TurnSpeaker;
  /** ISO timestamp from the record, or null — some record kinds carry none. */
  at: string | null;
  /**
   * The turn's text, plain and untrusted, possibly truncated. **Never markup.**
   * An assistant turn that only called tools has an empty string here and a
   * non-empty `toolCalls`; that is a real state, not a missing one.
   */
  text: string;
  /** True when `text` was cut. Paired with `fullChars` so the client can say by how much. */
  truncated: boolean;
  /** Length of the untruncated text, in JS characters. */
  fullChars: number;
  /**
   * The tools this turn called, by name. See `TOOL_CALLS_ARE_NOT_MESSAGES`
   * below for why the results are not here.
   */
  toolCalls: ToolCallSummary[];
  /** The record's own uuid, for a React key that survives a refresh. Null if absent. */
  uuid: string | null;
};

/** Why we have no messages, when the reason is that there is no file to read. */
export type NotFoundReason =
  /** The session has no conversation uuid — not a Claude, or a legacy session that never pinned one. */
  | "no-claude-session-id"
  /** The uuid is not a uuid. Refused rather than joined into a path. */
  | "malformed-claude-session-id"
  /** `~/.claude/projects` itself could not be listed. */
  | "no-projects-directory"
  /** Looked in the slugified directory and then in every project directory; no such transcript. */
  | "no-transcript-file";

/**
 * The answer. Branch on `kind` before you touch anything else.
 *
 * There is deliberately no arm that returns turns *and* an error, and no arm
 * whose emptiness has to be interpreted: `not-found` and `unreadable` both carry
 * a `why` written for a person to read on a phone.
 */
export type RecentMessages =
  | {
      kind: "found";
      /** Absolute path actually read, so a puzzling answer can be checked by hand. */
      path: string;
      /** How the file was located. `scan` means `meta.dir` was stale — the ordinary case for a session that entered a worktree. */
      via: "slug-guess" | "scan";
      /** Newest last, so a client can render top-to-bottom and scroll to the end. */
      turns: TranscriptTurn[];
      /**
       * True when the walk reached byte 0. **This is what stops "3 turns" from
       * being ambiguous:** false means we stopped on `limit` or `maxBytes` and
       * there is more above, true means the session really has said this much
       * and no more.
       */
      reachedStartOfFile: boolean;
      /** Bytes actually read off disk. Compare with `fileBytes`; that ratio is the point of this module. */
      bytesRead: number;
      /** The whole file's size, from `stat`. */
      fileBytes: number;
      /**
       * When the transcript was last written, ISO.
       *
       * **THE ONE CHECK ON THE HAZARD THIS MODULE CANNOT SEE FROM INSIDE.**
       * `row.claudeSessionId` comes from `CLAUDE_SESSION_ID` in the tmux
       * session's environment, set once when the session is created
       * (`tmux new-session -e CLAUDE_SESSION_ID=…`, scripts/gjd-remote.ts) and
       * never updated afterwards — it is set even for a scheduled session whose
       * pane is still running `sleep` and has never started Claude at all,
       * which is how three rows on this box resolve to no transcript.
       *
       * So if a pane is re-used for a second conversation — the agent exits and
       * someone starts a fresh `claude`, or resumes a different one — the id
       * still names the FIRST conversation, and this module will faithfully
       * return that conversation's last turns. Nothing about them looks wrong:
       * real messages, well formed, correctly attributed, about this repo. They
       * are simply not the conversation on screen.
       *
       * Being handed the id, this module cannot detect that. A consumer can: a
       * transcript last written hours ago, against a row the collector calls
       * `working`, is that bug rather than a quiet agent. Show this beside the
       * turns and the wrong answer stops being invisible.
       */
      lastModified: string;
      /** See `TranscriptLocation.copies`. Anything but 1 deserves a second look. */
      copies: number;
      /** JSONL lines that parsed. */
      recordsParsed: number;
      /**
       * Lines that did not parse. **Expected to be 0 or 1, and 1 is normal:** a
       * live session is being appended to while we read, so the last line can be
       * a half-written record. Anything higher is worth a look.
       */
      recordsUnparseable: number;
      /**
       * Tool results skipped. Shown so the client can say "and 40 tool results"
       * rather than implying the agent sat silent between two messages.
       */
      toolResultsSkipped: number;
    }
  | { kind: "not-found"; reason: NotFoundReason; why: string }
  | {
      kind: "unreadable";
      /** The path we failed on, when we got far enough to have one. */
      path: string | null;
      why: string;
    };

export type RecentMessagesOptions = {
  /** `row.claudeSessionId` — the conversation uuid. Null is a first-class answer, not an error to throw. */
  claudeSessionId: string | null;
  /**
   * `row.meta.dir` — the session's launch directory. **A hint that makes the
   * lookup one `stat` instead of a scan, and nothing more.** Pass null and the
   * scan does the whole job.
   */
  dir: string | null;
  /** How many turns to return. Default 12. */
  limit?: number;
  /**
   * Hard cap on bytes read from the tail. Default 1 MiB, which held 30+ turns on
   * every transcript measured. This is the guarantee that a 33 MB file cannot
   * cost 33 MB.
   */
  maxBytes?: number;
  /** Where a turn's text is cut. Default 2000 characters. */
  maxTextChars?: number;
  /** `~/.claude/projects` by default. An argument so tests need no fake home. */
  projectsDir?: string;
};

const DEFAULT_LIMIT = 12;
const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_MAX_TEXT_CHARS = 2000;
/** Read granularity. Big enough that a typical answer is one or two reads. */
const CHUNK_BYTES = 256 * 1024;
/** A tool-call `detail` is a label; this is generous for one. */
const MAX_TOOL_DETAIL_CHARS = 200;

// ---------------------------------------------------------------------------
// Finding the file
// ---------------------------------------------------------------------------

/**
 * The slug rule, as read off this box rather than out of the docs.
 *
 * Every non-alphanumeric character becomes `-`. Verified by constructing the
 * candidate for all 40 live sessions and checking the file was there: it holds
 * for every session whose cwd had not moved since launch.
 *
 * **The rule is only checked against paths made of `/`, `.`, `-` and
 * alphanumerics**, because that is all this box has — no directory here contains
 * a space or an underscore, so a narrower rule (`/` and `.` only) fits the same
 * evidence and I cannot separate them from data. That is written down rather
 * than smoothed over, and it is safe to be wrong about precisely because
 * `findTranscript` falls back to a scan: a bad guess costs a millisecond.
 */
export function slugifyDir(dir: string): string {
  return dir.replace(/[^a-zA-Z0-9]/g, "-");
}

/** Only a real uuid may be joined into a path. `..` must never reach `path.join`. */
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isClaudeSessionId(value: string): boolean {
  return UUID_RE.test(value);
}

export type TranscriptLocation =
  | {
      kind: "found";
      path: string;
      via: "slug-guess" | "scan";
      /**
       * How many project directories held a file with this uuid. Always 1 in
       * practice (244 of 244 measured on this box); anything higher means a
       * stale copy is lying about somewhere, and the newest was taken.
       */
      copies: number;
    }
  | { kind: "not-found"; reason: NotFoundReason; why: string };

/**
 * Where this conversation's transcript actually is.
 *
 * Exported separately from `readRecentMessages` because the resolution is the
 * half that was wrong on 23 of 30 live sessions, and it deserves to be testable
 * without a transcript to read.
 */
export async function findTranscript(
  projectsDir: string,
  claudeSessionId: string,
  dir: string | null,
): Promise<TranscriptLocation> {
  if (!isClaudeSessionId(claudeSessionId)) {
    return {
      kind: "not-found",
      reason: "malformed-claude-session-id",
      // Deliberately does not echo the value into the message: it is untrusted
      // and this string is rendered.
      why: "the session's conversation id is not a uuid, so there is no transcript path to look at",
    };
  }
  const filename = `${claudeSessionId}.jsonl`;

  // 1. The cheap guess. One stat, and right whenever the session has not moved.
  if (dir !== null && dir !== "") {
    const guess = path.join(projectsDir, slugifyDir(dir), filename);
    if ((await statFile(guess)) !== null) {
      return { kind: "found", path: guess, via: "slug-guess", copies: 1 };
    }
  }

  // 2. The authority. `readdir` only — nothing is opened, so this stays ~1 ms.
  let slugs: string[];
  try {
    slugs = await readdir(projectsDir);
  } catch (err) {
    return {
      kind: "not-found",
      reason: "no-projects-directory",
      why: `could not list ${projectsDir}: ${errText(err)}`,
    };
  }
  // EVERY slug is checked, not just up to the first hit, and the newest wins.
  //
  // A uuid was under exactly one slug for all 244 transcripts on this box, so
  // this loop almost always has nothing to choose between. But "almost always"
  // is the wrong guarantee here: returning the FIRST match makes the answer
  // depend on `readdir` order, which is neither sorted nor stable — so the day a
  // copy is left behind under an old slug (a relocation that copied instead of
  // moving, a restored backup) the dashboard would show a stale conversation,
  // plausibly, and possibly a different one on the next refresh. Twenty-odd
  // extra `stat`s buy a deterministic answer, and the newer file is the right
  // one by any reading.
  let best: { path: string; mtimeMs: number } | null = null;
  let matches = 0;
  for (const slug of slugs) {
    const candidate = path.join(projectsDir, slug, filename);
    const info = await statFile(candidate);
    if (info === null) continue;
    matches += 1;
    if (best === null || info.mtimeMs > best.mtimeMs) {
      best = { path: candidate, mtimeMs: info.mtimeMs };
    }
  }
  if (best !== null) return { kind: "found", path: best.path, via: "scan", copies: matches };

  return {
    kind: "not-found",
    reason: "no-transcript-file",
    why:
      `no transcript for this conversation in ${projectsDir} (looked in all ${slugs.length} project ` +
      "directories, not just the one its launch directory implies) — the session may not have written one yet",
  };
}

/** `stat`, or null for anything that is not a readable regular file. */
async function statFile(p: string): Promise<{ mtimeMs: number } | null> {
  try {
    const s = await stat(p);
    return s.isFile() ? { mtimeMs: s.mtimeMs } : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Reading the tail
// ---------------------------------------------------------------------------

/**
 * One JSONL line, still raw. `null` when it did not parse.
 *
 * Exported as `TranscriptRecord` at the bottom of the file for consumers that
 * need the record and not the turn — see `readRawTail`.
 */
type RawRecord = Record<string, unknown>;

type TailRead = {
  /** Oldest first, so the coalescing pass below can run in transcript order. */
  records: RawRecord[];
  reachedStartOfFile: boolean;
  bytesRead: number;
  fileBytes: number;
  /** The file's mtime, ISO — see `lastModified` on the `found` arm. */
  lastModified: string;
  recordsParsed: number;
  recordsUnparseable: number;
};

/**
 * Walk backwards from EOF, collecting complete JSONL records until `enough`
 * says stop, byte 0 is reached, or `maxBytes` is spent.
 *
 * **Chunk boundaries are handled by never decoding across one.** Only the bytes
 * between two newlines are turned into a string, and 0x0A cannot occur inside a
 * UTF-8 multi-byte sequence, so a chunk boundary can split a character but never
 * a line we actually decode. The leading fragment of each chunk is carried
 * forward and joined to the next chunk instead.
 *
 * **A half-written final line is expected, not exceptional.** These files are
 * being appended to by a running agent while we read them, so the last record
 * can be truncated mid-object. It is counted in `recordsUnparseable` and skipped;
 * it must never fail the read, which is the whole point of parsing line by line
 * rather than parsing the tail as a document.
 */
async function readTail(
  filePath: string,
  maxBytes: number,
  enough: (records: RawRecord[]) => boolean,
): Promise<TailRead> {
  const fh = await open(filePath, "r");
  try {
    const info = await fh.stat();
    const fileBytes = info.size;
    const lastModified = info.mtime.toISOString();
    let pos = fileBytes;
    let bytesRead = 0;
    let parsed = 0;
    let unparseable = 0;
    /** Newest first while we walk; reversed at the end. */
    const records: RawRecord[] = [];
    /** Bytes of the line that straddles the low edge of what we have read. */
    let carry = Buffer.alloc(0);
    let reachedStartOfFile = fileBytes === 0;

    /**
     * Whether the bytes after the file's final newline have been dealt with.
     *
     * An explicit flag rather than `carry.length === 0`, which is what it was
     * and which is wrong whenever the first chunk read contains no newline at
     * all: `carry` is non-empty by the second iteration, so the branch that
     * consumes the file's last (unterminated) record never runs and the newest
     * record in the file is silently dropped. A record-sized hole at exactly
     * the end of the tail is the one place nobody would notice it.
     */
    let tailConsumed = false;

    const take = (line: string): boolean => {
      const rec = parseLine(line);
      if (rec === null) {
        if (line.trim() !== "") unparseable += 1;
        return false;
      }
      parsed += 1;
      records.push(rec);
      return true;
    };

    // WHY THE BUDGET IS A `break` AND NOT PART OF THE `while` CONDITION.
    //
    // Guarding first means `remaining >= 1` by the time `want` is computed, so
    // `want >= 1`, so `pos` strictly decreases on every iteration that reads
    // anything — the loop's termination is readable off these four lines rather
    // than off the interaction between the condition and the arithmetic.
    //
    // The arrangement it replaced (`while (pos > 0 && bytesRead < maxBytes)`,
    // with `want` taking `maxBytes - bytesRead` as one of its minimums) also
    // terminated, but only just: a deliberate mutation that dropped the byte cap
    // from the condition made `maxBytes - bytesRead` negative, `pos -= want`
    // then INCREASED `pos`, and the suite HUNG instead of going red. That is a
    // bad failure mode for a cap — a hang is the one result a test run cannot
    // tell you anything about — and it is worth four lines to keep the two
    // concerns apart. (This does not make removing the cap safe; it makes the
    // code that is here say plainly why it stops.)
    while (pos > 0) {
      const remaining = maxBytes - bytesRead;
      if (remaining <= 0) break;
      const want = Math.min(CHUNK_BYTES, pos, remaining);
      const buf = Buffer.alloc(want);
      pos -= want;
      await fh.read(buf, 0, want, pos);
      bytesRead += want;
      if (pos === 0) reachedStartOfFile = true;

      const region = carry.length > 0 ? Buffer.concat([buf, carry]) : buf;
      // Segment boundaries within this region, by byte.
      const ends: number[] = [];
      for (let i = 0; i < region.length; i++) if (region[i] === 0x0a) ends.push(i);

      if (ends.length === 0) {
        // Not one complete line in hand yet — a single record longer than the
        // chunk. Keep accumulating; the post-loop block below handles the case
        // where this is also the start of the file.
        carry = region;
        continue;
      }

      // Everything after the final newline is the file's last record, which is
      // unterminated because the file has no trailing newline or because an
      // agent is mid-write. Only reachable once.
      const lastEnd = ends[ends.length - 1] as number;
      if (!tailConsumed) {
        tailConsumed = true;
        if (lastEnd < region.length - 1) take(region.subarray(lastEnd + 1).toString("utf8"));
      }

      // Complete lines, newest first. Segment i spans (ends[i-1], ends[i]).
      for (let i = ends.length - 1; i >= 1; i--) {
        const start = (ends[i - 1] as number) + 1;
        const end = ends[i] as number;
        take(region.subarray(start, end).toString("utf8"));
        if (enough(records)) {
          records.reverse();
          // Not `reachedStartOfFile`: we stopped on `enough`, and the bytes
          // below this segment are unread whatever `pos` says.
          return {
            records,
            reachedStartOfFile: false,
            bytesRead,
            fileBytes,
            lastModified,
            recordsParsed: parsed,
            recordsUnparseable: unparseable,
          };
        }
      }

      // The bytes before the first newline belong to a record whose start is
      // below `pos`. Carry them into the next chunk.
      carry = region.subarray(0, ends[0] as number);
    }

    // Reaching byte 0 makes whatever is left in `carry` a complete first record
    // rather than a fragment. Done here, once, so it covers both ways the loop
    // can end at the start of the file.
    if (reachedStartOfFile && carry.length > 0) take(carry.toString("utf8"));

    records.reverse();
    return {
      records,
      reachedStartOfFile,
      bytesRead,
      fileBytes,
      lastModified,
      recordsParsed: parsed,
      recordsUnparseable: unparseable,
    };
  } finally {
    await fh.close();
  }
}

function parseLine(line: string): RawRecord | null {
  const t = line.trim();
  if (t === "") return null;
  try {
    const v: unknown = JSON.parse(t);
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as RawRecord) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Records → turns
// ---------------------------------------------------------------------------

/**
 * TOOL_CALLS_ARE_NOT_MESSAGES — the decision, and why.
 *
 * In a real 33 MB transcript the block census was 2718 `tool_use`, 2718
 * `tool_result`, 1353 `thinking` and only 1017 assistant `text` blocks beside
 * 280 typed user turns. **Tool traffic is roughly 80% of the volume and none of
 * it is what Greg means by "the recent messages".** Returning it would mean a
 * tail read that spends its byte budget on `grep` output and shows two messages,
 * and a phone screen full of file listings.
 *
 * So: tool *results* are dropped entirely, and tool *calls* survive only as a
 * name and a one-line detail attached to the assistant turn that made them.
 * Three reasons for keeping that much:
 *
 * 1. "What is this agent doing right now" is often answered by `Bash: npm test`
 *    and by nothing else on screen — an assistant turn that only called tools
 *    would otherwise render as blank.
 * 2. The name is agent-chosen from a fixed set; the *result* is the part that
 *    may contain a hostile web page, and it is the part not returned.
 * 3. It keeps the count honest: `toolResultsSkipped` is reported, so the client
 *    can say "and 40 tool results" instead of implying silence.
 *
 * The turn's `text` and its `toolCalls` are separate fields rather than one
 * concatenated string, so a client can render tools as a quiet line under the
 * prose, and so nothing has to be re-parsed out of a blob later.
 *
 * `thinking` blocks are dropped too: they are not messages, they are the largest
 * blocks in the file after tool results, and their `signature` field is
 * kilobytes of base64 per block.
 */
const TOOL_CALLS_ARE_NOT_MESSAGES = true;

/**
 * Cut text to `max` characters without splitting a surrogate pair.
 *
 * The lone-surrogate case is not theoretical politeness: a string cut through
 * the middle of an emoji serialises to invalid UTF-8 over the wire, and this
 * payload is JSON on its way to a browser.
 */
function cut(text: string, max: number): { text: string; truncated: boolean; fullChars: number } {
  const fullChars = text.length;
  if (fullChars <= max) return { text, truncated: false, fullChars };
  let end = max;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1; // trailing high surrogate
  return { text: text.slice(0, end), truncated: true, fullChars };
}

/**
 * Plain text, and only plain text.
 *
 * Scrubs C0 control characters other than newline and tab. These arrive from
 * terminal output that an agent pasted into its own prose, and they are noise
 * rather than content — but note what this is *not*: it is not escaping, and it
 * is not a security boundary. The consumer must treat the result as untrusted
 * and let React escape it. Nothing here produces or preserves markup.
 */
function plainText(raw: string): string {
  // Written with \u escapes on purpose: typing these characters literally puts
  // raw control bytes (a NUL among them) into the source, which makes the file
  // read as binary to grep and to every tool that greps for you.
  return raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function obj(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * What a user-role record actually is.
 *
 * The `role` field says `user` for all of them and means it for almost none —
 * see `TurnSpeaker`. The checks are ordered by how badly a miss would read:
 * a compaction summary attributed to Greg is the worst, so it is first.
 */
function speakerOfUserRecord(rec: RawRecord): TurnSpeaker {
  if (rec["isCompactSummary"] === true) return "compact-summary";
  // `origin.kind` is consulted BEFORE `isMeta`, and that order was a bug once.
  // A peer message carries BOTH — a real cross-session message from another
  // agent is flagged `isMeta: true` because Claude Code injected it, and
  // `origin.kind: "peer"` because another agent wrote it (verified on
  // `real-peer-message.jsonl`). Checking `isMeta` first labelled every peer
  // message "injected", which reads as boilerplate to be skipped rather than as
  // another agent talking to this one. The more specific field wins.
  const origin = obj(rec["origin"]);
  const kind = origin === null ? null : str(origin["kind"]);
  if (kind === "peer") return "peer";
  if (kind === "task-notification" || kind === "auto-continuation") return "notification";
  if (kind === "human") return "human";
  if (rec["isMeta"] === true) return "injected";
  // No origin at all. Observed on records that predate the field. "human" is the
  // right guess for a string-content user record, and the alternatives would be
  // labelled by one of the branches above.
  return "human";
}

type Draft = {
  speaker: TurnSpeaker;
  at: string | null;
  texts: string[];
  toolCalls: ToolCallSummary[];
  uuid: string | null;
  /** `message.id` — assistant records sharing one are a single API turn split across lines. */
  messageId: string | null;
};

/**
 * Turn raw records into turns, oldest first.
 *
 * **One assistant turn is often several JSONL lines.** In the measured
 * transcript 1497 of 2806 `message.id`s appeared on more than one line, up to
 * four — Claude Code writes the `thinking` block, the `text` block and each
 * `tool_use` as separate records that share an id. Taking "the last 12 records"
 * would therefore show far fewer than 12 turns and would split one reply into
 * three bubbles. They are coalesced by `message.id` here.
 */
export function recordsToTurns(
  records: RawRecord[],
  maxTextChars: number,
): { turns: TranscriptTurn[]; toolResultsSkipped: number } {
  const drafts: Draft[] = [];
  let toolResultsSkipped = 0;

  for (const rec of records) {
    // A subagent's conversation. Modern Claude Code writes these to a
    // `subagents/` subdirectory instead, but older transcripts interleave them
    // into the main file — and interleaved, they read as the main agent saying
    // things it never said. Dropped on sight.
    if (rec["isSidechain"] === true) continue;

    const type = str(rec["type"]);
    if (type !== "user" && type !== "assistant" && type !== "system") continue;

    const at = str(rec["timestamp"]);
    const uuid = str(rec["uuid"]);

    if (type === "system") {
      // Most `system` records are bookkeeping: `turn_duration` alone was 401 of
      // 645 across two transcripts, and none of `turn_duration`,
      // `compact_boundary`, `bridge_status` carries anything a person reads.
      // Only ones with actual content become turns.
      const content = str(rec["content"]);
      if (content === null || content.trim() === "") continue;
      pushText(drafts, "system", at, uuid, null, plainText(content));
      continue;
    }

    const message = obj(rec["message"]);
    if (message === null) continue; // `attachment`-shaped records and friends.
    const messageId = str(message["id"]);
    const content = message["content"];

    if (type === "user") {
      const speaker = speakerOfUserRecord(rec);
      if (typeof content === "string") {
        if (content.trim() === "") continue;
        pushText(drafts, speaker, at, uuid, messageId, plainText(content));
      } else if (Array.isArray(content)) {
        for (const block of content) {
          const b = obj(block);
          if (b === null) continue;
          const bt = str(b["type"]);
          if (bt === "tool_result") {
            // Dropped — see TOOL_CALLS_ARE_NOT_MESSAGES.
            toolResultsSkipped += 1;
            continue;
          }
          if (bt === "text") {
            const t = str(b["text"]);
            if (t !== null && t.trim() !== "") pushText(drafts, speaker, at, uuid, messageId, plainText(t));
          }
          // `image` and anything unknown: no text to show, and nothing invented.
        }
      }
      continue;
    }

    // assistant
    const speaker: TurnSpeaker = rec["isApiErrorMessage"] === true ? "api-error" : "assistant";
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      const b = obj(block);
      if (b === null) continue;
      const bt = str(b["type"]);
      if (bt === "text") {
        const t = str(b["text"]);
        if (t !== null && t.trim() !== "") pushText(drafts, speaker, at, uuid, messageId, plainText(t));
      } else if (bt === "tool_use" && TOOL_CALLS_ARE_NOT_MESSAGES) {
        const name = str(b["name"]) ?? "tool";
        pushTool(drafts, speaker, at, uuid, messageId, {
          name: plainText(name).slice(0, 60),
          detail: toolDetail(b["input"]),
        });
      }
      // `thinking`: dropped. See TOOL_CALLS_ARE_NOT_MESSAGES.
    }
  }

  const turns: TranscriptTurn[] = drafts.map((d) => {
    const joined = d.texts.join("\n\n");
    const { text, truncated, fullChars } = cut(joined, maxTextChars);
    return {
      speaker: d.speaker,
      at: d.at,
      text,
      truncated,
      fullChars,
      toolCalls: d.toolCalls,
      uuid: d.uuid,
    };
  });
  return { turns, toolResultsSkipped };
}

/**
 * Append to the open draft when it is the same API turn, else start a new one.
 *
 * A draft only continues when the `messageId` matches and is non-null. Two
 * consecutive records with no id are two turns, because there is nothing saying
 * otherwise and merging on adjacency alone would glue a human's two messages
 * into one.
 */
function openDraft(
  drafts: Draft[],
  speaker: TurnSpeaker,
  at: string | null,
  uuid: string | null,
  messageId: string | null,
): Draft {
  const last = drafts[drafts.length - 1];
  if (last !== undefined && messageId !== null && last.messageId === messageId && last.speaker === speaker) {
    return last;
  }
  const fresh: Draft = { speaker, at, texts: [], toolCalls: [], uuid, messageId };
  drafts.push(fresh);
  return fresh;
}

function pushText(
  drafts: Draft[],
  speaker: TurnSpeaker,
  at: string | null,
  uuid: string | null,
  messageId: string | null,
  text: string,
): void {
  openDraft(drafts, speaker, at, uuid, messageId).texts.push(text);
}

function pushTool(
  drafts: Draft[],
  speaker: TurnSpeaker,
  at: string | null,
  uuid: string | null,
  messageId: string | null,
  call: ToolCallSummary,
): void {
  openDraft(drafts, speaker, at, uuid, messageId).toolCalls.push(call);
}

/**
 * A one-line label for a tool call's input.
 *
 * Reads the field the tool itself puts the headline in, in a fixed order, and
 * gives up rather than stringifying the whole input object — a `Write` call's
 * input contains the entire file, and a `Bash` call's `command` is the only part
 * anybody wants. Truncated hard, and as untrusted as any other string here.
 */
function toolDetail(input: unknown): string | null {
  const o = obj(input);
  if (o === null) return null;
  for (const key of ["command", "description", "file_path", "path", "pattern", "query", "url", "prompt"]) {
    const v = str(o[key]);
    if (v !== null && v.trim() !== "") return cut(plainText(v), MAX_TOOL_DETAIL_CHARS).text;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The entry point
// ---------------------------------------------------------------------------

/**
 * The last few turns of one session's conversation.
 *
 * Reads the tail of the transcript and nothing else. Branch on `kind`: a
 * `found` with `turns: []` means the session genuinely has no conversational
 * turns in the range read (check `reachedStartOfFile` before saying "has said
 * nothing"), and is a different fact from `not-found`.
 */
export async function readRecentMessages(opts: RecentMessagesOptions): Promise<RecentMessages> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxTextChars = opts.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS;
  // Resolved here rather than at module scope: importing this file must not read
  // the environment. See the module comment.
  const projectsDir = opts.projectsDir ?? path.join(homedir(), ".claude", "projects");

  if (opts.claudeSessionId === null || opts.claudeSessionId === "") {
    return {
      kind: "not-found",
      reason: "no-claude-session-id",
      why: "this session has no conversation id, so there is no transcript to read — it may not be a Claude session, or it predates the launcher pinning one",
    };
  }

  const located = await findTranscript(projectsDir, opts.claudeSessionId, opts.dir);
  if (located.kind === "not-found") return located;

  let tail: TailRead;
  try {
    tail = await readTail(located.path, maxBytes, (records) => countTurnsCheaply(records) > limit);
  } catch (err) {
    return {
      kind: "unreadable",
      path: located.path,
      why: `could not read the transcript: ${errText(err)}`,
    };
  }

  const { turns, toolResultsSkipped } = recordsToTurns(tail.records, maxTextChars);
  // `enough` deliberately overshoots — it estimates turns without building them
  // — so the exact trim happens here, after coalescing, where the count is real.
  const kept = turns.slice(Math.max(0, turns.length - limit));

  return {
    kind: "found",
    path: located.path,
    via: located.via,
    turns: kept,
    // Only honest if we did not trim: dropping turns means there IS more above.
    reachedStartOfFile: tail.reachedStartOfFile && kept.length === turns.length,
    bytesRead: tail.bytesRead,
    fileBytes: tail.fileBytes,
    lastModified: tail.lastModified,
    copies: located.copies,
    recordsParsed: tail.recordsParsed,
    recordsUnparseable: tail.recordsUnparseable,
    toolResultsSkipped,
  };
}

/**
 * A cheap estimate of how many turns the records hold, to decide when to stop
 * reading.
 *
 * **THIS COUNTS TURNS, NOT RECORDS, AND THE DIFFERENCE IS A BUG I SHIPPED FOR
 * AN HOUR.** Counting records looks like a safe over-estimate — surely records
 * ≥ turns — and it is the opposite. One API turn is written as up to four
 * records sharing a `message.id`, and a user record holding nothing but
 * `tool_result` blocks is not a turn at all. Stopping at "13 records" therefore
 * delivered **6 turns to a caller that asked for 12**, on every one of the 23
 * live sessions measured, and the returned payload looked perfectly healthy
 * while doing it — no error, no flag, just less conversation than was asked for.
 *
 * So this groups by `message.id` the way `recordsToTurns` does, and skips the
 * record kinds that yield no turn. It is still an estimate — an assistant record
 * that is pure `thinking` is counted and produces nothing — but it now errs
 * towards reading one chunk too many, which costs 256 KB and is the direction
 * that cannot silently shortchange the caller.
 */
function countTurnsCheaply(records: RawRecord[]): number {
  const ids = new Set<string>();
  let withoutId = 0;
  for (const rec of records) {
    if (rec["isSidechain"] === true) continue;
    const type = str(rec["type"]);
    if (type !== "user" && type !== "assistant") continue;
    const message = obj(rec["message"]);
    if (message === null) continue;
    if (type === "user" && isToolResultOnly(message["content"])) continue;
    const id = str(message["id"]);
    // No id means nothing can merge with it, so it is its own turn — which is
    // also what `openDraft` decides.
    if (id === null) withoutId += 1;
    else ids.add(id);
  }
  return ids.size + withoutId;
}

/** A user record that is only tool results carries no message and becomes no turn. */
function isToolResultOnly(content: unknown): boolean {
  if (!Array.isArray(content) || content.length === 0) return false;
  return content.every((block) => {
    const b = obj(block);
    return b !== null && str(b["type"]) === "tool_result";
  });
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// The raw tail, for consumers that need records rather than turns
// ---------------------------------------------------------------------------

/**
 * One raw JSONL record, exactly as it was written.
 *
 * `TranscriptTurn` is the shape for *showing a person the conversation*, and it
 * deliberately throws almost everything else away: `recordsToTurns` drops every
 * `tool_result` block on sight and reduces a `tool_use` to a name and a
 * one-line label. That is right for the detail pane and useless for anything
 * asking a question ABOUT the machinery — `tools/fleet/pause.ts` needs a
 * `CronCreate`'s `tool_use.id`, its cron expression, and the `toolUseResult`
 * carried on the tool_result record that follows it, and all three are gone by
 * the time a turn exists.
 *
 * So this is a second *view* of the same tail read, not a second tail reader.
 */
export type TranscriptRecord = RawRecord;

export type RawTailOptions = {
  /** `row.claudeSessionId` — the conversation uuid. Null is an answer, not an error. */
  claudeSessionId: string | null;
  /** `row.meta.dir`, a hint that saves a scan. See `RecentMessagesOptions.dir`. */
  dir: string | null;
  /**
   * Hard cap on bytes read from the tail, and the ONLY stopping condition:
   * unlike `readRecentMessages` there is no "enough turns" predicate here,
   * because a caller counting tool calls cannot express what it wants in turns.
   * So this reads back exactly `maxBytes` (or to byte 0, whichever comes first)
   * and `reachedStartOfFile` says which happened.
   */
  maxBytes: number;
  /** `~/.claude/projects` by default. An argument so tests need no fake home. */
  projectsDir?: string;
};

export type RawTail =
  | {
      kind: "found";
      path: string;
      /** Oldest first, the same order `recordsToTurns` expects. */
      records: TranscriptRecord[];
      /**
       * **The field that stops a negative from being ambiguous.** A caller that
       * ignores it is making the mistake this dashboard has made repeatedly:
       * "I read 32KB and found no `CronCreate`" is not "this session has no
       * pending wake-up".
       */
      reachedStartOfFile: boolean;
      bytesRead: number;
      fileBytes: number;
      lastModified: string;
      recordsParsed: number;
      /** 0 or 1 is normal — a live transcript's final line is often half-written. */
      recordsUnparseable: number;
    }
  | { kind: "not-found"; reason: NotFoundReason; why: string }
  | { kind: "unreadable"; path: string | null; why: string };

/** The tail of one session's transcript, as records rather than as turns. */
export async function readRawTail(opts: RawTailOptions): Promise<RawTail> {
  const projectsDir = opts.projectsDir ?? path.join(homedir(), ".claude", "projects");

  if (opts.claudeSessionId === null || opts.claudeSessionId === "") {
    return {
      kind: "not-found",
      reason: "no-claude-session-id",
      why: "this session has no conversation id, so there is no transcript to read — it may not be a Claude session, or it predates the launcher pinning one",
    };
  }

  const located = await findTranscript(projectsDir, opts.claudeSessionId, opts.dir);
  if (located.kind === "not-found") return located;

  try {
    // `() => false`: never stop early. The byte budget is the whole contract.
    const tail = await readTail(located.path, opts.maxBytes, () => false);
    return {
      kind: "found",
      path: located.path,
      records: tail.records,
      reachedStartOfFile: tail.reachedStartOfFile,
      bytesRead: tail.bytesRead,
      fileBytes: tail.fileBytes,
      lastModified: tail.lastModified,
      recordsParsed: tail.recordsParsed,
      recordsUnparseable: tail.recordsUnparseable,
    };
  } catch (err) {
    return { kind: "unreadable", path: located.path, why: `could not read the transcript: ${errText(err)}` };
  }
}
