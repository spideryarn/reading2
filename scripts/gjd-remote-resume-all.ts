/**
 * `resume-all` — one new iTerm2 tab per session on the box, each attached to its own.
 *
 * Coming back to the laptop after a night, the box holds a handful of sessions
 * and getting into all of them is `gjd-remote resume <name>` in a tab you opened
 * by hand, over and over. This does that.
 *
 * Split out from gjd-remote.ts for the same reason as its siblings: gjd-remote.ts
 * calls main() at import time, so nothing in it can be unit-tested. The
 * AppleScript here is built as static text with the data carried in `argv`, so
 * the scripts themselves can be asserted on without a terminal —
 * tests/gjd-remote-resume-all.test.ts.
 *
 * ## Why AppleScript here, when the tab colour deliberately is not
 *
 * gjd-remote-tab.ts writes an escape sequence to its OWN stdout, and says at
 * length why that beats AppleScript: it runs in the tab it is colouring, so
 * there is no tab to address and nothing to get wrong. That reasoning does not
 * carry to this command, which has to open tabs it is not running in. There is
 * no escape sequence for "open a tab", so AppleScript it is, with every trap in
 * docs/reusable/iterm.md applying.
 *
 * The colour still comes from gjd-remote-tab.ts and not from here. Each new tab
 * is handed the ordinary `gjd-remote resume <name>` command line, and that
 * paints itself violet exactly as it does when you type it yourself. One
 * mechanism, one place it can be wrong.
 *
 * ## The two shapes of script, and which may be retried
 *
 * A walk over `every window`/`every tab` can be invalidated mid-flight by a peer
 * closing a tab, which aborts the whole script with -1719 (iterm.md § A walk can
 * be invalidated mid-flight). The fix there is to retry the script — and that is
 * only safe for a script that reads. Retrying a script that CREATES a tab gives
 * you two tabs for one session.
 *
 * So the walks (resolve, select) are read-only and retryable, and the one
 * mutating script addresses the window directly by id — `window id 456`, no
 * enumeration — so the failure that needs a retry cannot arise in it.
 */

/** iTerm's session ids, and the only shape we will treat as one. */
const UUID = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;

export const isSessionUuid = (s: string): boolean => UUID.test(s);

/**
 * The UUID half of `ITERM_SESSION_ID` (`w<N>t<N>p<N>:UUID`), or undefined.
 *
 * The `w5t11` half is a window/tab coordinate frozen when the shell started and
 * it tracks nothing; the UUID after the colon is the session's real identity.
 *
 * Empty unless the whole value matches that shape, because the obvious
 * self-check fails OPEN on an empty string: `[ "$sid" != "$me" ]` with an empty
 * `me` approves everything. Nothing here compares against a value this returned
 * without checking it exists first.
 */
export function selfSessionUuid(env: NodeJS.ProcessEnv): string | undefined {
  const raw = env.ITERM_SESSION_ID;
  if (!raw) return undefined;
  const m = /^w\d+t\d+p\d+:(.+)$/.exec(raw.trim());
  const uuid = m?.[1];
  return uuid && UUID.test(uuid) ? uuid : undefined;
}

/**
 * Why we must not drive iTerm from here, or undefined if we may.
 *
 * Same shape of reasoning as canColourTab() in gjd-remote-tab.ts, and one extra
 * condition: this needs to know WHICH window is ours, so a missing or malformed
 * ITERM_SESSION_ID is fatal rather than cosmetic.
 *
 * `ITERM_SESSION_ID` and `TERM_PROGRAM` are ordinary inherited variables. Inside
 * tmux they name the tab the tmux server was started from; across ssh they
 * describe the machine you came from. Either way the identity in the
 * environment is not the terminal in front of you, and opening a dozen tabs in
 * somebody else's window is not a mistake you can take back.
 *
 * The TTY check is not needed for AppleScript to work — it is here because
 * opening ten tabs is an interactive act, and a script or a hook that reached
 * this by accident should be told so rather than obeyed.
 */
export function openTabsRefusal(env: NodeJS.ProcessEnv, isTty: boolean): string | undefined {
  if (!isTty) return "stdout is not a terminal";
  if (env.TERM_PROGRAM !== "iTerm.app") return "this terminal is not iTerm";
  if (env.TMUX || env.STY) return "inside tmux or screen, where ITERM_SESSION_ID names another tab";
  if (env.SSH_CONNECTION || env.SSH_TTY) return "over ssh, where ITERM_SESSION_ID describes the machine you came from";
  if (env.CI) return "CI, where there are no tabs";
  if (!selfSessionUuid(env)) return "ITERM_SESSION_ID is unset or malformed, so I cannot tell which window is mine";
  return undefined;
}

/**
 * Walk every visible window/tab/session with `win`, `tb` and `ss` bound to BODY.
 *
 * `visible` filters out the husk a closed window leaves behind — tabs = 0,
 * still in the `windows` collection, and `close` on it does nothing.
 *
 * Written once rather than three times, exactly as iterm.md does it: the
 * triple-nested `repeat` is where the syntax traps live and one copy of it is
 * one place to get them right.
 */
function walk(body: string): string {
  return [
    "  repeat with win in windows",
    "    if visible of win then",
    "      repeat with tb in (tabs of win)",
    "        repeat with ss in (sessions of tb)",
    body,
    "        end repeat",
    "      end repeat",
    "    end if",
    "  end repeat",
  ].join("\n");
}

/**
 * argv: my session UUID. Prints `<window id>\t<uuid of the selected tab's session>`.
 *
 * Both halves are read here, in one pass, because they are wanted for the same
 * reason: everything after this addresses my window by its id, and puts the
 * keyboard back where it was.
 *
 * The selected tab is captured as its session's UUID rather than as a tab
 * object, because AppleScript objects do not survive between `osascript`
 * processes — and it is captured BEFORE any tab is created, because
 * `create tab` selects the new tab, after which `current tab` is already the
 * new one and restoring it is a no-op that looks exactly like a working
 * restore (iterm.md § Creating a tab steals the keyboard).
 *
 * `character id 9` for the tab character, never `tab`: inside
 * `tell application "iTerm2"` the word `tab` resolves to iTerm's tab CLASS and
 * concatenates the literal string "tab" into your output.
 */
export function resolveScript(): string {
  return [
    "on run argv",
    "  set selfId to item 1 of argv",
    "  set TC to character id 9",
    '  tell application "iTerm2"',
    walk(
      "          if (id of ss) is selfId then\n" +
        "            set here to id of (current session of (current tab of win))\n" +
        "            return ((id of win) as text) & TC & here\n" +
        "          end if",
    ),
    "  end tell",
    '  return ""',
    "end run",
  ].join("\n");
}

export type Here = { windowId: number; selectedSession: string };

/**
 * What {@link resolveScript} said, or undefined if it found nothing.
 *
 * Strict about the shape, and that is the point: osa() folds stderr into
 * stdout, so a permission failure (-1743) arrives here looking like output. A
 * parse that shrugged and returned a window id of NaN would open tabs nowhere.
 */
export function parseHere(out: string): Here | undefined {
  const [id, session, ...extra] = out.trim().split("\t");
  if (extra.length > 0 || !id || !session) return undefined;
  if (!/^\d+$/.test(id) || !UUID.test(session)) return undefined;
  return { windowId: Number(id), selectedSession: session };
}

/**
 * argv: window id, the command line to type, how long to wait first. Prints the
 * new session's UUID.
 *
 * `window id N` addresses the window directly, so there is no enumeration to be
 * invalidated — see the header on why that matters for a script that must never
 * be retried.
 *
 * `write ... text` into an ordinary shell rather than
 * `create tab ... command "…"`, which would run the command AS the session's
 * program. Two reasons, both about what you can see afterwards: a command that
 * dies immediately takes its tab and its error message with it, and the program
 * is not started as a login shell, so `gjd-remote` need not even be on its PATH.
 *
 * The delay is for the shell, not for iTerm: text written into a session that
 * has not yet started reading is typed at nothing. It is a parameter so the
 * tests can pass 0 and not sit there.
 */
export function newTabScript(): string {
  return [
    "on run argv",
    "  set winId to (item 1 of argv) as integer",
    "  set commandText to item 2 of argv",
    "  set waitFor to (item 3 of argv) as number",
    '  tell application "iTerm2"',
    "    set targetWin to window id winId",
    "    set newTab to (create tab with default profile of targetWin)",
    "    set s to current session of newTab",
    "    delay waitFor",
    "    write s text commandText",
    "    return id of s",
    "  end tell",
    "end run",
  ].join("\n");
}

/**
 * argv: a session UUID. Selects the tab holding it. Prints `selected` or `gone`.
 *
 * Idempotent, so it may be retried. "gone" is ordinary rather than an error —
 * the tab you were in when you started may have been closed since.
 *
 * This restore is partial by nature: it returns the WINDOW's selected tab, not
 * a different frontmost window, and if you changed tabs while it worked it
 * overwrites your newer choice.
 */
export function selectScript(): string {
  return [
    "on run argv",
    "  set wanted to item 1 of argv",
    '  tell application "iTerm2"',
    walk(
      "          if (id of ss) is wanted then\n" + "            select tb\n" + '            return "selected"\n' + "          end if",
    ),
    "  end tell",
    '  return "gone"',
    "end run",
  ].join("\n");
}

/** What goes into a fresh tab. `name` is a session slug, already validated. */
export function resumeCommand(bin: string, name: string, transport?: "ssh"): string {
  return `${bin} resume ${name}${transport === "ssh" ? " --ssh" : ""}`;
}

export type Plan = { open: string[]; skipped: { name: string; why: string }[] };

/**
 * Which sessions get a tab, oldest first.
 *
 * Attached sessions are left alone by default, and this is the one product
 * decision in the file. `resume` runs `tmux attach -d`, which DETACHES whatever
 * client is already there — so opening a tab for an attached session would
 * quietly blank the tab you already had it in, or drop a session you are
 * watching from another machine. `--include-attached` says you meant it.
 *
 * Oldest first so the tabs come out in the same order as `gjd-remote ls`, and
 * so the newest session lands nearest the right-hand end where you left it.
 */
export function planTabs(
  list: readonly { name: string; attached: boolean; created: Date }[],
  opts: { includeAttached: boolean },
): Plan {
  const byAge = [...list].sort((a, b) => a.created.getTime() - b.created.getTime());
  const plan: Plan = { open: [], skipped: [] };
  for (const s of byAge) {
    if (s.attached && !opts.includeAttached) {
      plan.skipped.push({ name: s.name, why: "already attached — --include-attached to take it over" });
    } else {
      plan.open.push(s.name);
    }
  }
  return plan;
}
