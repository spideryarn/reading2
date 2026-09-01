/**
 * Reading the box's tmux sessions — the pure half of `gjd-remote ls`.
 *
 * Separated from scripts/gjd-remote.ts so it can be tested without a network,
 * the same way scripts/gjd-remote-env.ts is. See tests/gjd-remote-tmux.test.ts
 * for the two bugs that made it worth separating.
 */

export type Session = {
  name: string;
  created: Date;
  attached: boolean;
  windows: number;
  /** Claude Code's own generated title for the conversation, once it has one. */
  title: string;
  /** Whether the name is a placeholder we chose, and so may be replaced. */
  provisional: boolean;
  /**
   * `claude --session-id`, pinned into the tmux environment at launch, or null
   * for a session that has no Claude in it (`new-shell`, or one made by hand).
   *
   * This is the join key to what Claude Code says about itself — see
   * `parseAgents` — and it is the ONLY one that works, because `ls` renames a
   * provisional session to Claude's own title and the name it had at launch is
   * then gone.
   *
   * Not guaranteed to be a uuid: it is whatever is in that session's tmux
   * environment, and `sessionState` is where that is checked. See
   * `parseSessionLine` for why the check is not here.
   */
  claudeId: string | null;
  /** What the box can see running inside this session. See `SessionProc`. */
  proc: SessionProc;
};

/**
 * What is actually running in the session's pane, asked of the process table
 * rather than of anything that reports on itself.
 *
 *  - **claude** — a `claude --session-id <this uuid>` is a child of the pane.
 *    Not "a claude": the uuid is matched, so a neighbouring session's process
 *    cannot answer for this one.
 *  - **wait** — the pane is still running one of our own job scripts (its path
 *    is under `gjd-remote/jobs/`) and that script has a live `sleep` child, with
 *    this many seconds left on it. Both halves are needed. The sleep alone is
 *    not enough: once Claude exits the job `exec`s a login shell, and somebody
 *    typing `sleep 900` into it would otherwise be reported as a scheduled job
 *    that had never started.
 *  - **none** — neither. The pane has no Claude of ours in it.
 *  - **unknown** — the box could not be asked. NOT folded into `none`: they are
 *    the same emptiness, and this whole file exists because that emptiness
 *    keeps getting read as an answer.
 */
export type SessionProc =
  | { kind: "claude" }
  | { kind: "wait"; secondsLeft: number }
  | { kind: "none" }
  | { kind: "unknown" };

/**
 * What Claude Code says about one of its own sessions.
 *
 * `busy | idle | waiting` are the three `claude agents --json` prints today
 * (verified against 2.1.251 on the box, 2026-09-01). A fourth would arrive as
 * `unknown` rather than as a guess — see `sessionState`.
 */
export type AgentStatus = "busy" | "idle" | "waiting";

/**
 * The state a person actually wants off `gjd-remote ls`: is this one finished,
 * is it thinking, is it stuck on a question only they can answer, or has it not
 * started yet.
 *
 * `unknown` carries its reason because the alternative — showing a blank, or
 * quietly picking the most likely of the others — is the failure this repo
 * keeps writing comments about. A state nobody can determine must look
 * different from a state that was determined.
 */
export type SessionState =
  | { kind: "needs-you" }
  | { kind: "working" }
  | { kind: "idle" }
  | { kind: "waiting"; secondsLeft: number }
  | { kind: "no-claude" }
  | { kind: "shell" }
  | { kind: "unknown"; why: string };

/**
 * The fields tmux itself knows, in the order the parser expects.
 *
 * `#{session_id}` leads, and it is the field doing the real work: it is tmux's
 * own handle (`$0`, `$3`), digits after a dollar and nothing else, so the shell
 * can split it off the front of a record with no risk of a session NAME
 * containing the separator and shifting every later field. It is also immutable
 * across the rename `ls` performs.
 *
 * There is deliberately NO `#{pane_pid}` here, and there used to be. It
 * resolves to the active pane of the session's CURRENT window, so a Claude in a
 * second window or a split was invisible — and an invisible Claude that is also
 * absent from `claude agents --json` reads as a session with no Claude in it.
 * `tmux list-panes -a` gives every pane of every session in one command, which
 * is both correct and no more round trips.
 *
 * These are handed to `tmux ls -F`, which takes NO target and fills every field
 * for every session in one command. The first version asked for them per
 * session with `tmux display -p -t "=$name"` instead — and `display` takes a
 * target *pane*, where the `=` exact-match prefix is only recognised on the
 * session part if a colon follows. Without the colon tmux 3.4 printed `||`,
 * three empty fields, and exited 0. Nothing looked wrong: `ls` just quietly
 * showed every session as attached and aged 56 years.
 *
 * `tmux ls -F` is not merely the fixed version of that, it is the version where
 * the mistake is unavailable — there is no target to get wrong, and it costs
 * one tmux invocation instead of one per session.
 */
export const SESSION_FIELDS =
  "#{session_id}|#{session_created}|#{session_attached}|#{session_windows}|#{session_name}";

/** Printed last, and only if everything before it worked. See buildSessionScript. */
export const SESSION_SENTINEL = "GJDOK";

/**
 * The two ways the script can answer "what does Claude Code say about itself?".
 *
 * There are two words rather than one-and-silence on purpose: silence is what a
 * box with no sessions gives, and it is also what a broken `claude` gives, and
 * telling those apart is the difference between "nothing is running" and "every
 * row on this screen is a guess".
 */
export const AGENTS_OK = "GJDAGENTS";
export const AGENTS_FAIL = "GJDAGENTSFAIL";

/**
 * How many session rows tmux gave the script, printed before any of them.
 *
 * This is here because of a bug that had been in `ls` since it was written and
 * that nothing caught: `rows=$(tmux ls …)` strips the trailing newline, the
 * loop was fed `printf '%s' "$rows"`, and `read` returns false on an
 * unterminated final line — so its body never ran for the LAST session. Ten
 * sessions on the box, nine on screen, in alphabetical order, for weeks. Found
 * by GPT Sol on 2026-09-01 and reproduced immediately; see
 * docs/postmortems/260901b-the-session-that-was-never-listed.md.
 *
 * The `printf` is fixed. The count is here so that the whole CLASS of it — any
 * future way of losing a row between tmux and the parse — is a loud failure
 * instead of a shorter list, because a short list is indistinguishable from a
 * correct one and every caller reads absence as permission.
 */
export const ROW_COUNT = "GJDROWS";

/**
 * The remote script: list the sessions, then for each one add the two variables
 * we pinned into its tmux environment at launch, its name, and the latest title
 * Claude has given the conversation.
 *
 * TWO THINGS HERE ARE LOAD-BEARING.
 *
 * The SENTINEL. `tmux ls | while read` exits 0 with no output when tmux is
 * missing, broken, or unreachable — verified on the box by running it with tmux
 * off the PATH — which is byte-for-byte what a box with no sessions looks like.
 * Every command draws a conclusion from that emptiness: `ls` says "no
 * sessions", `new` decides the name is free, `resume` says there is nothing to
 * attach to. So the script ends by printing GJDOK, and a reply without it is a
 * failure rather than an empty box. tmux's own "no server running" is the one
 * genuine empty case and is translated, not passed on.
 *
 * BASE64 for the name and the title. They are the only free text in the record
 * — one chosen by whoever made the session, one written by Claude — and a `|`
 * in either would shift every field after it. Encoding them means the wire
 * format has no free text in it at all, so there is no input that can make the
 * parse quietly wrong. `base64 -w0` is GNU, which the Ubuntu box has.
 *
 * The name is pulled off the tmux line with parameter expansion rather than a
 * second `tmux display` call, and it is LAST in the format for that reason:
 * `\${rest#*|}` takes everything after the numeric fields, so a name that
 * itself contains a `|` survives whole instead of shifting the record. Going
 * back to `display -p -t` for it would reintroduce the target-pane trap this
 * whole module exists because of.
 *
 * ## The two questions `ls` asks on top of that
 *
 * **What Claude Code says about itself.** `claude agents --json` prints one
 * record per live session — `sessionId`, `pid`, `cwd`, `status` — and status is
 * `busy`, `idle` or `waiting`, where `waiting` means a permission prompt is on
 * screen with nobody answering it. One call for the whole box, about a second,
 * no TTY needed. It joins to us by `sessionId`, which is the uuid we already
 * pin into the tmux environment at launch.
 *
 * **This is deliberately not screen-scraping.** Reading the state off the pane
 * with `capture-pane` and matching Claude's spinner glyphs works today and was
 * the first version of this: the panes really do say `✽ Herding… (2m 32s …)`
 * while working and `✻ Sautéed for 1h 13m · done 10:29 AM` when finished. It
 * was thrown away on the research, not on taste. `cmux`, which orchestrates
 * terminal agents for a living, records terminal-UI scraping as its single
 * largest source of bugs — 46-odd detection issues, every one of them arriving
 * the day Claude changed how it draws a spinner. `claude agents --json` is
 * first-party, is documented as being "for scripting", and cannot drift with
 * the rendering. Hooks (`PermissionRequest`, `Stop`) are more precise still and
 * are what the tmux-dashboard projects use, but they have to be configured
 * before a session starts, so they cannot answer for the eleven sessions
 * already running on the box — which is the whole job of `ls`.
 *
 * The PATH is widened first, the way the job script in cmdNewClaude widens its
 * own and for the same reason: a non-interactive ssh sources neither `.bashrc`
 * nor `.bash_profile`, so it gets a stock PATH. Two things about how:
 *
 *  - It ADDS rather than replaces. `claude` installed under nvm or
 *    `~/.local/bin` is only findable through the inherited PATH, and losing it
 *    to a tidier one would turn every row on a working box into `unknown`.
 *  - The standard directories go on the END, so the inherited PATH still wins.
 *    That is the right way round on the merits — a `claude` the box's own
 *    environment resolves to is the one its sessions are running — and it is
 *    also what makes tests/gjd-remote-tmux.test.ts able to run this script
 *    against stub binaries, which is how the dropped-row bug is now held shut.
 *
 * FAILS CLOSED, and this one is worth being careful about: if the agents call
 * comes back empty because `claude` is missing, too old for `--json`, or simply
 * broken, then every session looks like one with no Claude in it — a confident,
 * plausible, wrong answer on every row, which is this file's recurring bug. So
 * the script says `AGENTS <base64>` when it worked and `AGENTSFAIL <why>` when
 * it did not, and the two are told apart rather than inferred from emptiness.
 * The JSON is base64'd for the same reason the name and title are: it is the
 * only free text in the record, and it is full of separators.
 *
 * **What is actually running in each session** comes from ONE checked snapshot
 * of the whole process table, plus `tmux list-panes -a` for every pane in every
 * session, and the two are joined per session in awk. Three things about that
 * shape, and each is a bug the first version had:
 *
 *  - **Every pane, not `#{pane_pid}`.** That field is the active pane of the
 *    session's CURRENT window, so a Claude in a second window or a split was
 *    simply not seen — and a session that is not seen and not in the agents
 *    list reads as one with no Claude in it.
 *  - **The pane itself counts, not only its children.** `new-claude` wraps
 *    Claude in a job script, so on this box `claude` is always the pane's child
 *    — but `tmux new-window 'claude …'` makes it the pane process, whose parent
 *    is the tmux server. Found by building exactly that session while testing
 *    the fix above: the probe said `none` about a session with a live Claude in
 *    it, which is the failure this probe exists to prevent, one level up.
 *  - **The snapshot's exit status is checked, once.** The first version ran
 *    `ps --ppid <pid>` per session and threw the status away, and `ps` exits 1
 *    for "no children" — the ordinary case — so a `ps` that failed for any
 *    other reason was indistinguishable from a pane with nothing under it. GPT
 *    Sol ran the generated script with a `ps` returning 2 and got `none`.
 *  - **`wait` needs the sleep AND its parent.** The sleep's parent must be one
 *    of our own job scripts (`/gjd-remote/jobs/`). Once Claude exits the job
 *    `exec`s a login shell, and somebody typing `sleep 900` into it would
 *    otherwise be reported as a scheduled job that had never started.
 *
 * The remaining wait comes from the sleep itself — its argument minus its
 * elapsed seconds. The alternative was to read the deadline out of this
 * laptop's own log, where `--wait` already records `waitUntilMs`. The sleep
 * wins because it is the clock the wait is actually measured against, and
 * because it answers for a session launched from another machine, which the log
 * cannot.
 */
export function buildSessionScript(opts: { agents: boolean } = { agents: false }): string {
  // Only `ls` shows states, and `claude agents --json` costs about 0.65s of
  // process startup — median of five, 1.20s against 1.85s for the whole script,
  // measured on the box on 2026-09-01. Every other caller — `new-claude`
  // checking a name is free, `resume`, `kill` — wants the list and nothing else,
  // and must neither pay for it nor be able to hang on it. GPT Sol found this:
  // an earlier version ran it unconditionally while its own comment claimed
  // only `ls` did.
  const agentsBlock = opts.agents
    ? `
    if ! command -v claude >/dev/null 2>&1; then
      echo '${AGENTS_FAIL} claude is not on the PATH a non-interactive ssh gets'
    elif agents=$(claude agents --json 2>/dev/null) && [ -n "$agents" ]; then
      printf '${AGENTS_OK} %s\\n' "$(printf '%s' "$agents" | base64 -w0)"
    else
      echo '${AGENTS_FAIL} claude agents --json printed nothing (too old for it?)'
    fi`
    : "";

  return `
    PATH="$PATH:/usr/local/bin:/usr/bin:/bin"
    command -v tmux >/dev/null 2>&1 || { echo 'GJDERR tmux is not on this box'; exit 3; }
    snap=$(ps -eo pid=,ppid=,etimes=,args= 2>/dev/null) && [ -n "$snap" ] || snap=
    panes=$(tmux list-panes -a -F '#{session_id} #{pane_pid}' 2>/dev/null) || panes=
    rows=$(tmux ls -F '${SESSION_FIELDS}' 2>&1) || case "$rows" in
      *'no server running'*|*'No such file or directory'*) rows='' ;;
      *) echo "GJDERR tmux ls failed: $rows"; exit 3 ;;
    esac${agentsBlock}
    if [ -z "$rows" ]; then n=0; else n=$(printf '%s\\n' "$rows" | wc -l); fi
    printf '${ROW_COUNT} %s\\n' "$n"
    printf '%s\\n' "$rows" | while IFS= read -r row; do
      [ -n "$row" ] || continue
      sid=\${row%%|*};    rest=\${row#*|}
      created=\${rest%%|*}; rest=\${rest#*|}
      attached=\${rest%%|*}; rest=\${rest#*|}
      windows=\${rest%%|*}
      name=\${rest#*|}
      id=$(tmux show-environment -t "$sid" CLAUDE_SESSION_ID 2>/dev/null | cut -d= -f2-)
      prov=$(tmux show-environment -t "$sid" GJD_PROVISIONAL 2>/dev/null | cut -d= -f2-)
      case "$prov" in 0|1) ;; *) prov=1 ;; esac
      mine=$(printf '%s\\n' "$panes" | awk -v s="$sid" '$1==s { print $2 }')
      if [ -z "$snap" ] || [ -z "$mine" ]; then
        proc='?'
      else
        proc=$(printf '%s\\n' "$snap" | awk -v panes="$mine" -v id="$id" '
          BEGIN { n=split(panes, p, "\\n"); for (i=1; i<=n; i++) if (p[i] != "") pane[p[i]]=1 }
          { a=$4; for (i=5; i<=NF; i++) a = a " " $i; A[$1]=a; E[$1]=$3; P[$1]=$2 }
          END {
            for (q in P) if ((pane[q] || pane[P[q]]) && id != "" && index(A[q], "--session-id " id)) { print "claude"; exit }
            for (q in P) if (pane[P[q]] && index(A[P[q]], "/gjd-remote/jobs/")) {
              split(A[q], w, " ")
              if (w[1] == "sleep" && w[2] ~ /^[0-9]+$/) { r = w[2] - E[q]; if (r > 0) { print "wait:" r; exit } }
            }
            print "none"
          }')
        case "$proc" in claude|none|wait:[1-9]*) ;; *) proc='?' ;; esac
      fi
      title=""
      if [ -n "$id" ]; then
        f=$(ls -1 "$HOME"/.claude/projects/*/"$id".jsonl 2>/dev/null | head -1)
        [ -n "$f" ] && title=$(grep -o '"aiTitle":"[^"]*"' "$f" 2>/dev/null | tail -1 | cut -d'"' -f4)
      fi
      printf '%s|%s|%s|%s|%s|%s|%s|%s|%s\\n' "$sid" "$created" "$attached" "$windows" "$prov" \\
        "$id" "$proc" "$(printf '%s' "$name" | base64 -w0)" "$(printf '%s' "$title" | base64 -w0)"
    done
    echo ${SESSION_SENTINEL}`;
}

/**
 * Ask the box how many keys tmux binds — the remote half of `doctor`'s `tmux`
 * check. Two numbers, because they can disagree and the disagreement is the
 * interesting state.
 *
 * `conf` is what a FRESH tmux server makes of `~/.tmux.conf`, on a throwaway
 * socket. `live` is what the server actually holding the sessions is doing
 * right now. They come apart because **a tmux server reads its config once, at
 * start**, and this one outlives provisioning by weeks: re-provisioning a live
 * box rewrites the file and changes nothing about the keyboard until somebody
 * runs `source-file`. That is a silent success — every visible check passes and
 * Ctrl-B is still eaten — so it gets its own number rather than an assumption.
 *
 * `live=none` rather than `live=0` when no server is running, and that is the
 * whole reason this is not one `grep -c`. `tmux list-keys` with no server prints
 * its complaint to stderr and nothing to stdout, so `grep -c` says 0 — which is
 * exactly the answer a perfectly configured box gives. The good state and the
 * "there was nothing to ask" state would be the same byte. Same shape as the
 * sentinel in buildSessionScript, for the same reason.
 *
 * The socket carries the shell's pid so two `doctor` runs cannot kill each
 * other's probe server halfway through counting.
 */
export function buildBindingsScript(): string {
  return `
    command -v tmux >/dev/null 2>&1 || { echo 'GJDERR tmux is not on this box'; exit 3; }
    if tmux ls >/dev/null 2>&1; then
      live=$(tmux list-keys 2>/dev/null | grep -c bind-key || true)
    else
      live=none
    fi
    sock=gjddoctor$$
    tmux -L "$sock" kill-server 2>/dev/null || true
    tmux -f "$HOME/.tmux.conf" -L "$sock" new-session -d 'sleep 10' >/dev/null 2>&1 || {
      echo 'GJDERR ~/.tmux.conf would not start a tmux server'; exit 3; }
    conf=$(tmux -L "$sock" list-keys 2>/dev/null | grep -c bind-key || true)
    tmux -L "$sock" kill-server 2>/dev/null || true
    printf 'live=%s conf=%s\\n' "$live" "$conf"
    echo ${SESSION_SENTINEL}`;
}

/**
 * The two numbers into a verdict, or an explanation of why there isn't one.
 *
 * FAILS CLOSED. Anything that is not the exact record this asked for is a
 * failure, not a pass — an unparsed reply and a clean box otherwise look alike,
 * which is the bug this whole module keeps being written around.
 */
export function bindingsVerdict(out: string): { ok: boolean; why: string } {
  const lines = out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const errLine = lines.find((l) => l.startsWith("GJDERR"));
  if (errLine) return { ok: false, why: errLine.slice("GJDERR".length).trim() };
  if (!lines.includes(SESSION_SENTINEL)) {
    return { ok: false, why: "the box did not finish counting its key bindings, so the answer may be short" };
  }

  const m = lines.map((l) => /^live=(none|0|[1-9]\d*) conf=(0|[1-9]\d*)$/.exec(l)).find(Boolean);
  if (!m) return { ok: false, why: "could not read the binding counts out of the reply" };
  const live = m[1]!;
  const conf = Number(m[2]!);

  // The file first: it is what every future tmux server on this box will read,
  // so it being wrong outlasts any one server.
  if (conf !== 0) {
    return { ok: false, why: `~/.tmux.conf binds ${conf} keys — re-provision, or see infra/hetzner/provision.sh` };
  }
  if (live !== "none" && Number(live) !== 0) {
    return {
      ok: false,
      // Not "re-provision": provisioning rewrites the file, which is already
      // right. Only source-file reaches a server that is already running.
      why: `the running tmux server still binds ${live} keys — tmux source-file ~/.tmux.conf`,
    };
  }
  return { ok: true, why: live === "none" ? "nothing bound (no server running)" : "nothing bound, file and server agree" };
}

/** base64 back to text, or null if it is not valid base64 of valid UTF-8. */
function decode(b64: string): string | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return null;
  const buf = Buffer.from(b64, "base64");
  // Buffer.from ignores what it cannot read rather than throwing, so the only
  // way to know it read the whole thing is to encode it again and compare.
  if (buf.toString("base64").replace(/=+$/, "") !== b64.replace(/=+$/, "")) return null;
  return buf.toString("utf8");
}

/**
 * One line into a Session, or null if it is not exactly the record we asked for.
 *
 * STRICT, and every clause here is a bug that reached the box. The first
 * version coerced whatever arrived: `Number("")` is 0, so a missing timestamp
 * became 1970; `"" !== "0"` is true, so a missing flag became "attached". A
 * whole fleet of sessions read as attached and 56 years old and nobody noticed,
 * because both columns looked like plausible output.
 *
 * The second version was strict about the fields tmux fills in and still
 * accepted a FOUR-field line, and any junk in the provisional slot silently
 * became `false` — which decides whether `ls` may rename a session out from
 * under its owner. GPT Sol found both. So: the field count is exact, and every
 * field must be one of the values it is allowed to be.
 */
export function parseSessionLine(line: string): Session | null {
  const parts = line.split("|");
  // Exactly nine: id, created, attached, windows, provisional, claude id, wait
  // remaining, name, title. Not "at least nine" — a tenth field means the record
  // is not the one this function was written against, and guessing which is
  // which is how the last two bugs happened. Neither free-text field can
  // contribute a separator, because both arrive base64-encoded.
  if (parts.length !== 9) return null;
  const [sid, created, attached, windows, prov, claudeId, procField, nameB64, titleB64] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];

  // tmux's own session handle: a dollar and digits. Nobody is shown it, but if
  // it is not that shape then the record did not come from tmux.
  if (!/^\$\d+$/.test(sid)) return null;

  // A tmux timestamp is seconds since the epoch and is never 0 for a live
  // session. Number("") is 0 and Number(undefined) is NaN — both must fail here
  // rather than downstream, where they become a date.
  // Digits only, checked as a STRING before it is a number: `Number("17e9")`
  // is a perfectly good integer and tmux has never emitted one, so accepting it
  // means accepting something that did not come from tmux.
  if (!bounded(created)) return null;
  const stamp = Number(created);
  // Bounded is not enough on its own: this is multiplied by 1000, and a value
  // that is a safe integer in seconds need not be one in milliseconds. Sol
  // passed 1000000000000000 through the first version and got a Date whose
  // getTime() is NaN, which the AGE column rendered as `NaNd`. The check is on
  // the thing actually constructed.
  if (!Number.isFinite(new Date(stamp * 1000).getTime())) return null;

  if (attached !== "0" && attached !== "1") return null;
  // Junk here used to become `false`, and this flag decides whether `ls` may
  // rename a session out from under whoever named it.
  if (prov !== "0" && prov !== "1") return null;

  if (!bounded(windows)) return null;
  const windowCount = Number(windows);

  // NOT CHECKED FOR BEING A UUID, and that is deliberate. Everything else in
  // this record comes from tmux; this one comes from a tmux environment
  // variable, which anybody can set to anything by hand. Rejecting the line
  // would put it in `unreadable`, and `sessions()` refuses to hand back a list
  // it knows is short — so one mistyped variable on one session would take
  // down `ls`, `new-claude` and `resume` for the whole box. `sessionState`
  // checks the shape instead, where the cost of a bad one is that single row
  // saying `unknown`. (A `|` inside it still fails, on the field count above.)

  const proc = parseProc(procField);
  if (proc === null) return null;

  const name = decode(nameB64);
  const title = decode(titleB64);
  if (name === null || title === null || name === "") return null;

  return {
    name,
    created: new Date(stamp * 1000),
    attached: attached === "1",
    windows: windowCount,
    // A session that has never run Claude legitimately has no title, so an
    // empty one is information rather than damage.
    title: title.trim(),
    provisional: prov === "1",
    claudeId: claudeId === "" ? null : claudeId,
    proc,
  };
}

/**
 * The four shapes the process probe is allowed to have, and nothing else.
 *
 * A token this reader was not written against is a broken record, not a shrug:
 * it decides whether a session is reported as scheduled, running or gone, and
 * quietly rounding an unrecognised one to `none` is how a row would claim
 * "no claude" about a session with a Claude in it.
 */
function parseProc(field: string): SessionProc | null {
  if (field === "claude") return { kind: "claude" };
  if (field === "none") return { kind: "none" };
  if (field === "?") return { kind: "unknown" };
  const m = /^wait:([1-9]\d{0,8})$/.exec(field);
  if (!m) return null;
  return { kind: "wait", secondsLeft: Number(m[1]) };
}

/**
 * A digit string tmux is allowed to have printed.
 *
 * Bounded, and that is Sol's point rather than paranoia: `/^[1-9]\d*$/` accepts
 * four hundred digits, `Number` turns that into `Infinity`, and `new
 * Date(Infinity)` is an Invalid Date that `age()` renders as `NaNm`. Nine
 * digits is larger than any pid, window count or epoch second this will see.
 */
const bounded = (v: string) => /^[1-9]\d{0,15}$/.test(v) && Number.isSafeInteger(Number(v));

/** A uuid as `claude --session-id` mints them, and nothing else. */
const SESSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * `claude agents --json` into a status per session id.
 *
 * The array is Claude Code's, not ours, so every field is checked — and ONE BAD
 * RECORD FAILS THE WHOLE REPLY rather than being skipped. That is Sol's
 * correction to the first version, which skipped them, and it matters because
 * of what schema drift looks like: rename `sessionId` to `session_id` in some
 * later Claude Code and every record is skipped, leaving a perfectly healthy
 * EMPTY MAP — and an empty map means "no Claude is running anywhere", which is
 * a confident wrong answer on every row at once. A short list of statuses is
 * indistinguishable from a correct one, which is the rule the session parse
 * already lives by.
 *
 * A `status` this version has never heard of is kept as the raw string, so
 * `sessionState` can say "I do not know what that means" instead of quietly
 * rounding it to `idle`.
 */
export function parseAgents(json: string): Map<string, string> | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(raw)) return null;
  const out = new Map<string, string>();
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return null;
    const o = item as Record<string, unknown>;
    const id = o.sessionId;
    const status = o.status;
    if (typeof id !== "string" || !SESSION_UUID.test(id)) return null;
    if (typeof status !== "string" || status === "") return null;
    // Claude Code contradicting itself about one session. It has not happened,
    // and if it starts, "last one wins" is a coin flip on a row that decides
    // whether somebody is being waited on.
    if (out.has(id)) return null;
    out.set(id, status);
  }
  return out;
}

/**
 * What is actually going on in this session.
 *
 * TWO SOURCES, AND NEITHER IS TRUSTED ALONE. `claude agents --json` is the only
 * thing that can tell busy from idle from parked-on-a-question, and it is
 * first-party — but **being absent from it does not mean not running**. That is
 * measured, not feared: on 2026-09-01, twice, a session started with `--dir ~`
 * had a live `claude --session-id <uuid>` for at least 35 seconds and `agents
 * --json` matched it zero times, while the same launch inside the repo checkout
 * matched within 25 seconds. So the JSON says *listed*, not *running*
 * (docs/plans/260901a-gjd-remote-wait-duration-and-ssh-command.md). The process
 * table is the second source, and it is what stops an unlisted session being
 * reported as a dead one.
 *
 * THE ORDER IS THE DESIGN, and every clause is a pair of states that would
 * otherwise be told apart wrongly:
 *
 *  - **shell** first, because a session with no Claude in it was never going to
 *    appear in the agents list, and running it through the rest would report
 *    every `new-shell` as a Claude that had exited.
 *  - **a hand-set id** cannot join to anything, and saying so is not the same
 *    as saying there is no Claude here.
 *  - **waiting** before the agents list is consulted, so `--wait` still reports
 *    a countdown on a box where `claude agents` is broken or missing. The
 *    evidence is our own job script still running with a live `sleep` under it;
 *    a Claude cannot be running in the same pane at the same time.
 *  - **unknown** whenever the agents call failed. Without this clause a box
 *    where `claude` is missing shows a screen of confident "no claude" — right
 *    by accident for none of the rows, and indistinguishable from the truth.
 *  - **the three live states** come from Claude Code itself. `waiting` is the
 *    one worth having: it means a permission prompt is on screen and the
 *    session will sit there until somebody answers it. Verified on the box on
 *    2026-09-01 against a session parked on "Do you want to proceed?".
 *  - **a status we do not recognise** is `unknown`, not a guess. A future
 *    Claude Code could add one, and the wrong half of that coin flip is a
 *    session reported as finished while it waits for you.
 *  - **running but not listed** is the measured case above, and it is the
 *    reason this function takes a process probe at all.
 *  - **no-claude** is the last word rather than "exited" because it is the one
 *    that is true in every case that reaches it: Claude exited, or the job
 *    never got that far. `gjd-remote log` is where "did it ever run?" is
 *    answered properly, and it has the evidence for it.
 *  - **a probe we could not run** is its own answer, never folded into
 *    no-claude.
 */
export function sessionState(s: Session, agents: Map<string, string> | null): SessionState {
  if (s.claudeId === null) return { kind: "shell" };
  // Somebody set CLAUDE_SESSION_ID by hand to something that is not a session
  // id. It cannot join to anything, so there is nothing to say about this row —
  // but there IS a session, and reporting it as a shell would be a claim rather
  // than an admission.
  if (!SESSION_UUID.test(s.claudeId)) {
    return { kind: "unknown", why: "its CLAUDE_SESSION_ID is not a Claude session id" };
  }

  if (s.proc.kind === "wait") return { kind: "waiting", secondsLeft: s.proc.secondsLeft };

  if (agents === null) return { kind: "unknown", why: "the box could not say what Claude is doing" };

  const status = agents.get(s.claudeId);
  if (status === "waiting") return { kind: "needs-you" };
  if (status === "busy") return { kind: "working" };
  if (status === "idle") return { kind: "idle" };
  // Anything still here is a status Claude Code has and this version has not.
  // Not a guess: the wrong half of that coin flip is a session reported as
  // finished while it sits waiting for somebody.
  if (status !== undefined) {
    return { kind: "unknown", why: `Claude Code calls this '${status}', which this version does not know` };
  }

  if (s.proc.kind === "claude") {
    return { kind: "unknown", why: "its Claude is running, but Claude Code did not list it" };
  }
  if (s.proc.kind === "unknown") {
    return { kind: "unknown", why: "the box could not look at what is running in it" };
  }
  return { kind: "no-claude" };
}

/**
 * Seconds into something a person reads at a glance: `45s`, `12m`, `3h52m`, `1d4h`.
 *
 * Two units at most, and the small one is dropped once the big one is large
 * enough that nobody cares — `3h52m` is worth the extra characters, `1d4h17m`
 * is not.
 */
export function formatWait(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const mins = Math.floor(s / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return mins % 60 === 0 ? `${hours}h` : `${hours}h${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return hours % 24 === 0 ? `${days}d` : `${days}d${hours % 24}h`;
}

/**
 * The one control line about Claude Code, read into a status map or an excuse.
 *
 * EXACTLY ONE, OR NONE — never two, and never one of each. Two answers to one
 * question is a reply that has been interleaved with something, and picking one
 * of them is picking at random. None is legitimate: `ls` is the only caller
 * that asks, so every other command's reply has no line here at all.
 */
function readAgents(
  lines: string[],
): { agents: Map<string, string> | null; agentsWhy: string | null } | { failure: string } {
  if (lines.length > 1) return { failure: "the box answered twice about what Claude is doing" };
  const line = lines[0];
  if (line === undefined) return { agents: null, agentsWhy: null };
  if (line === AGENTS_FAIL || line.startsWith(`${AGENTS_FAIL} `)) {
    return { agents: null, agentsWhy: line.slice(AGENTS_FAIL.length).trim() || "the box did not say why" };
  }
  const decoded = decode(line.slice(AGENTS_OK.length).trim());
  const parsed = decoded === null ? null : parseAgents(decoded);
  // A reply that says it worked and then cannot be read is a failure, not an
  // empty list. An empty list is a real and common answer — a box with tmux
  // sessions but no Claude in any of them — so the two cannot share a
  // representation.
  if (parsed === null) return { agents: null, agentsWhy: "could not read what the box said about Claude's sessions" };
  return { agents: parsed, agentsWhy: null };
}

/**
 * Every session, or an explanation of why the answer cannot be trusted.
 *
 * FAILS CLOSED twice over, and both matter. Without the sentinel, a tmux that
 * is missing or broken reads as a box with no sessions. Without `unreadable`,
 * one bad line quietly shortens the list — and callers reason about a list from
 * its absences: `cmdNew` decides a name is free when it is taken, `resume` with
 * no name attaches to the wrong "most recent". A short list is
 * indistinguishable from a correct one, so it must not be produced.
 */
export function parseSessions(out: string): {
  sessions: Session[];
  unreadable: string[];
  failure: string | null;
  /** Status by session id, or null when the box could not be asked (or was not). */
  agents: Map<string, string> | null;
  /** Why `agents` is null, for saying so out loud. Null when it is not, and
   *  null when the caller did not ask for it. */
  agentsWhy: string | null;
} {
  const lines = out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const bad = (failure: string) => ({ sessions: [], unreadable: [], agents: null, agentsWhy: null, failure });

  const errLine = lines.find((l) => l.startsWith("GJDERR"));
  if (errLine) return bad(errLine.slice("GJDERR".length).trim());

  // THE SENTINEL MUST BE THE LAST WORD, not merely present. Sol's point: a
  // reply that signs off and then keeps talking is a reply something else got
  // into, and taking the lines before the signature and ignoring the rest is
  // reading half of a message that has already gone wrong.
  const end = lines.length - 1;
  if (end < 0 || lines[end] !== SESSION_SENTINEL) {
    return bad(
      lines.includes(SESSION_SENTINEL)
        ? "the box printed something after it had finished listing its sessions, so the reply is not the one this asked for"
        : "the box did not finish listing its sessions (no completion marker), so the list may be short",
    );
  }
  const body = lines.slice(0, end);

  // The control lines are pulled out first, because they are not session
  // records and must not be counted as unreadable ones — an unreadable line is
  // fatal to the whole listing, by design.
  // Marker plus a space, or the marker alone — never merely "starts with".
  // `startsWith(AGENTS_FAIL)` accepted `GJDAGENTSFAILURE bogus` and read its
  // reason as "URE bogus", which fails safely and is still not what this says
  // it does. Sol's point.
  const marked = (l: string, m: string) => l === m || l.startsWith(`${m} `);
  const control = body.filter((l) => marked(l, AGENTS_OK) || marked(l, AGENTS_FAIL) || marked(l, ROW_COUNT));

  const counts = control.filter((l) => marked(l, ROW_COUNT));
  if (counts.length !== 1) return bad(`the box gave ${counts.length} row counts, and this needs exactly one`);
  // Built from the constant rather than spelling it again: a second copy of a
  // marker is a copy that stops matching the day somebody renames the first.
  const declared = new RegExp(`^${ROW_COUNT} (0|[1-9]\\d{0,4})$`).exec(counts[0] as string);
  if (!declared) return bad(`could not read the box's row count out of '${counts[0]}'`);

  const said = readAgents(control.filter((l) => !marked(l, ROW_COUNT)));
  if ("failure" in said) return bad(said.failure);
  const { agents, agentsWhy } = said;

  const sessions: Session[] = [];
  const unreadable: string[] = [];
  for (const line of body) {
    if (control.includes(line)) continue;
    const s = parseSessionLine(line);
    if (s) sessions.push(s);
    else unreadable.push(line);
  }

  // The count tmux gave against the count that arrived. This is the guard that
  // would have caught the dropped last row for the whole life of the script —
  // see ROW_COUNT — and it catches the next way of losing one too.
  const seen = sessions.length + unreadable.length;
  if (seen !== Number(declared[1])) {
    return bad(`tmux listed ${declared[1]} session(s) and ${seen} reached this laptop, so the list is not the box's`);
  }

  return { sessions, unreadable, failure: null, agents, agentsWhy };
}
