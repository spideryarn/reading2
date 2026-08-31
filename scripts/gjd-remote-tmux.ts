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
};

/**
 * The fields tmux itself knows, in the order the parser expects.
 *
 * `#{session_id}` leads, and it is the field doing the real work: it is tmux's
 * own handle (`$0`, `$3`), digits after a dollar and nothing else, so the shell
 * can split it off the front of a record with no risk of a session NAME
 * containing the separator and shifting every later field. It is also immutable
 * across the rename `ls` performs.
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
 */
export function buildSessionScript(): string {
  return `
    command -v tmux >/dev/null 2>&1 || { echo 'GJDERR tmux is not on this box'; exit 3; }
    rows=$(tmux ls -F '${SESSION_FIELDS}' 2>&1) || case "$rows" in
      *'no server running'*|*'No such file or directory'*) rows='' ;;
      *) echo "GJDERR tmux ls failed: $rows"; exit 3 ;;
    esac
    printf '%s' "$rows" | while IFS= read -r row; do
      [ -n "$row" ] || continue
      sid=\${row%%|*};    rest=\${row#*|}
      created=\${rest%%|*}; rest=\${rest#*|}
      attached=\${rest%%|*}; rest=\${rest#*|}
      windows=\${rest%%|*}
      name=\${rest#*|}
      id=$(tmux show-environment -t "$sid" CLAUDE_SESSION_ID 2>/dev/null | cut -d= -f2-)
      prov=$(tmux show-environment -t "$sid" GJD_PROVISIONAL 2>/dev/null | cut -d= -f2-)
      case "$prov" in 0|1) ;; *) prov=1 ;; esac
      title=""
      if [ -n "$id" ]; then
        f=$(ls -1 "$HOME"/.claude/projects/*/"$id".jsonl 2>/dev/null | head -1)
        [ -n "$f" ] && title=$(grep -o '"aiTitle":"[^"]*"' "$f" 2>/dev/null | tail -1 | cut -d'"' -f4)
      fi
      printf '%s|%s|%s|%s|%s|%s|%s\\n' "$sid" "$created" "$attached" "$windows" "$prov" \\
        "$(printf '%s' "$name" | base64 -w0)" "$(printf '%s' "$title" | base64 -w0)"
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
  // Exactly seven: id, created, attached, windows, provisional, name, title.
  // Not "at least seven" — an eighth field means the record is not the one this
  // function was written against, and guessing which is which is how the last
  // two bugs happened. Neither free-text field can contribute a separator,
  // because both arrive base64-encoded.
  if (parts.length !== 7) return null;
  const [sid, created, attached, windows, prov, nameB64, titleB64] = parts as [
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
  if (!/^[1-9]\d*$/.test(created)) return null;
  const stamp = Number(created);

  if (attached !== "0" && attached !== "1") return null;
  // Junk here used to become `false`, and this flag decides whether `ls` may
  // rename a session out from under whoever named it.
  if (prov !== "0" && prov !== "1") return null;

  if (!/^[1-9]\d*$/.test(windows)) return null;
  const windowCount = Number(windows);

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
  };
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
export function parseSessions(out: string): { sessions: Session[]; unreadable: string[]; failure: string | null } {
  const lines = out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const errLine = lines.find((l) => l.startsWith("GJDERR"));
  if (errLine) return { sessions: [], unreadable: [], failure: errLine.slice("GJDERR".length).trim() };

  const end = lines.lastIndexOf(SESSION_SENTINEL);
  if (end === -1) {
    return {
      sessions: [],
      unreadable: [],
      failure: "the box did not finish listing its sessions (no completion marker), so the list may be short",
    };
  }

  const sessions: Session[] = [];
  const unreadable: string[] = [];
  for (const line of lines.slice(0, end)) {
    const s = parseSessionLine(line);
    if (s) sessions.push(s);
    else unreadable.push(line);
  }
  return { sessions, unreadable, failure: null };
}
