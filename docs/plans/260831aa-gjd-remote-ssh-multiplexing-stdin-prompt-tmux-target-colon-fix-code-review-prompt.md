# Review the built code (second review — weight this higher than the plan review)

You reviewed the plan for this. This is the code that came out of it. Your plan review is included
below so you can check I actually did what we agreed, and see where I deviated.

Environment: macOS laptop → Ubuntu 24.04 Hetzner box, OpenSSH 9.6p1 server, tmux 3.4, mosh 1.4.0.
TypeScript + ESM, run with tsx, `strict` and `noUncheckedIndexedAccess` on.

## What I want from you

Correctness bugs first, especially anything that FAILS SILENTLY — this codebase's house rule is
"a check you have never seen fail is not evidence", and most of its real bugs have been something
reporting success while doing nothing.

Look hard at:

1. **`sshMasterOpts()` / `closeSshMaster()`.** Process-scoped master, torn down before attach and on
   process exit. Is the lifecycle right? What happens on: die() mid-command, a master that starts
   but whose socket is then removed, two `gjd-remote` processes at once, `attach()` calling
   `closeSshMaster()` and then `moshProbe()` spawning something that wanted the socket, the
   `process.on("exit")` handler running `spawnSync` (is that reliable during exit?).

2. **`writeRemote()`** — replaces scp with `cat >` plus a byte-count check plus an atomic rename.
   I verified the guard rejects a short write. What did I miss? Locale/`wc -c` portability, a
   `remotePath` containing something `shq` does not cover, the `.part` cleanup running on a
   connection that is already gone, `spawnSync`'s `input` and a large prompt (pipe deadlock?),
   binary/UTF-8 edge cases, and whether `mv -f` is actually atomic here.

3. **`interactiveStdin()` / `-p -`.** fd 0 is spent on the heredoc, so I reopen /dev/tty and hand
   that fd to the mosh probe and the attach. Is the fd ever leaked, double-closed, or wrong? Does
   handing a `number` fd to spawnSync's stdio do what I think? I could NOT test the success path —
   my test environment has no controlling terminal, so I only exercised the failure branch.

4. **The fail-closed `parseSessions`.** Does dying on an unreadable line create a worse failure than
   it prevents — e.g. can a legitimate tmux session name containing `|` now brick every command?

5. Anything else wrong, over-built, or that contradicts the plan.

Deviations from your review you should check:
- I did NOT take the "require --no-attach with -p -" v1; I did the /dev/tty reopen instead.
- I DID batch further than you suggested, because the measurements justified it: over an already
  shared connection, scp of a 3-byte file took 3.87s vs ~1.0s for a plain command.
- I dropped the mosh --ssh=ControlPath idea entirely, having confirmed your `-S none` finding at
  /opt/homebrew/bin/mosh line 407.

## Measurements after the change (live box)

- `gjd-remote new --no-attach`: 12.3s → 6.75s (and the 6.75s run was on a WORSE link: 307ms RTT vs 78ms)
- `gjd-remote ls`: 2.8s → 1.9-2.8s
- Per-operation over a shared connection: master handshake 5.12s, each plain command 0.7-1.3s, scp 3.87s

## Verification I actually ran

- The tmux parse regression test was red against the old lenient parse before I wrote the strict one.
- Byte-count guard: forced a mismatch against the live box, got exit 1, nothing at the real path.
- `-p -` round trip: prompt landed byte-exact on the box with `"quotes"`, backticks and `$VARS` intact.
- `ssh -t` with an exhausted-pipe stdin: confirmed "Pseudo-terminal will not be allocated"; `-t -t`
  allocates one but stdin is still the spent pipe.

---

## The scoped diff

```diff
diff --git a/scripts/gjd-remote.ts b/scripts/gjd-remote.ts
index c5c403b..559bc3d 100755
--- a/scripts/gjd-remote.ts
+++ b/scripts/gjd-remote.ts
@@ -16,12 +16,13 @@
  */
 import { execFileSync, spawnSync } from "node:child_process";
 import { parseArgs, styleText } from "node:util";
-import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
+import { existsSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
 import { randomUUID } from "node:crypto";
 import { tmpdir } from "node:os";
 import path from "node:path";
 import { fileURLToPath } from "node:url";
 import { assertPushableName, buildEnvPayload, diffKeys, parseEnv } from "./gjd-remote-env.js";
+import { type Session, buildSessionScript, parseSessions } from "./gjd-remote-tmux.js";
 
 const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
 const USER = "greg";
@@ -54,7 +55,17 @@ const SLUG = /^[a-z0-9][a-z0-9-]{0,40}$/;
  * a host it has no record of, and still REFUSES one whose key has changed,
  * which is the case actually worth refusing.
  */
-const SSH_OPTS = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=accept-new"];
+const SSH_OPTS_INTERACTIVE = ["-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=accept-new"];
+
+/**
+ * BatchMode on top, for the calls nobody is sitting in front of. It turns a
+ * passphrase prompt into a failure, which is right for a helper command and
+ * wrong for a session you are about to type into — hence the two lists. The
+ * interactive paths (`ssh`, `tunnel`, and the ssh fallback for `resume`) used
+ * to pass NO options at all, so a rebuilt box gave them the raw
+ * host-key-verification error the accept-new note above exists to avoid.
+ */
+const SSH_OPTS = ["-o", "BatchMode=yes", ...SSH_OPTS_INTERACTIVE];
 
 const dim = (s: string) => styleText("dim", s);
 const bold = (s: string) => styleText("bold", s);
@@ -77,8 +88,19 @@ function shq(s: string): string {
  * The address comes from Terraform state, never a constant: it changes on every
  * rebuild, and a hardcoded IP would be wrong exactly when you most need it.
  */
+let cachedHost: string | undefined;
+
 function host(): string {
-  if (process.env.GJD_REMOTE_HOST) return process.env.GJD_REMOTE_HOST;
+  // Memoised for the process. HOST() is called on every ssh, scp and mosh, and
+  // `new` makes six of those — six `tofu output` subprocesses to answer a
+  // question whose answer cannot change while we run. It also means an address
+  // that stays consistent across one command even if somebody rebuilds the box
+  // underneath us, which is the behaviour you want when half the work is done.
+  if (cachedHost) return cachedHost;
+  if (process.env.GJD_REMOTE_HOST) {
+    cachedHost = process.env.GJD_REMOTE_HOST;
+    return cachedHost;
+  }
   try {
     const out = execFileSync("tofu", ["-chdir=" + path.join(REPO, "infra/hetzner"), "output", "-json"], {
       encoding: "utf8",
@@ -86,7 +108,8 @@ function host(): string {
     });
     const ip = JSON.parse(out)?.ipv4?.value;
     if (!ip) throw new Error("no ipv4 output");
-    return ip;
+    cachedHost = ip as string;
+    return cachedHost;
   } catch (err) {
     die(
       `could not read the server address from Terraform state (${(err as Error).message}).\n` +
@@ -97,6 +120,67 @@ function host(): string {
 
 const HOST = () => `${USER}@${host()}`;
 
+/**
+ * One SSH connection, shared by every command this process runs.
+ *
+ * The handshake is the whole cost. Measured against the box on 2026-08-31 at a
+ * healthy 78ms round trip: a fresh `ssh … true` takes ~2.0s, of which the
+ * command itself is free — the rest is roughly fifteen network round trips of
+ * key exchange and authentication. `gjd-remote new` opened SIX fresh
+ * connections and so paid it six times, 12.3s before Claude started. On a bad
+ * link (RTT swung from 74ms to 660ms inside one minute) it was 8-10s each.
+ *
+ * So: start one master, run everything down it, tear it down when we are done.
+ *
+ * SCOPED TO THIS PROCESS, deliberately, and this is the decision worth
+ * defending. The obvious alternative is `ControlPersist=10m`, which would also
+ * make the NEXT `gjd-remote` instant. It buys a failure mode that is much worse
+ * than the delay it removes: a master whose TCP connection has been blackholed
+ * by a sleep or a network change still accepts the local mux handshake, and the
+ * client then waits forever for a remote session that will never open —
+ * `ConnectTimeout` does not bound that request. On a tool where every other
+ * pause is the network, an infinite hang is indistinguishable from a slow link.
+ * A master that dies with the command cannot outlive the network it was made
+ * on. GPT Sol's review made this case; the plan doc records it.
+ *
+ * The path lives directly under /tmp because macOS caps a Unix socket path at
+ * 104 bytes and $TMPDIR here is already 48 of them — and OpenSSH first binds
+ * the master at `<path>.<16 random chars>`, so the limit applies to a name 17
+ * bytes longer than the one written here.
+ */
+let masterSocket: string | undefined;
+let masterDir: string | undefined;
+
+function sshMasterOpts(): string[] {
+  if (masterSocket) return ["-o", `ControlPath=${masterSocket}`];
+  // mkdtemp under /tmp, not tmpdir(): see the sun_path note above.
+  const dir = mkdtempSync("/tmp/gjdr-");
+  const sock = path.join(dir, "s");
+  const r = spawnSync("ssh", [...SSH_OPTS, "-o", `ControlPath=${sock}`, "-M", "-N", "-f", HOST()], {
+    encoding: "utf8",
+  });
+  // A master that would not start is not fatal — every command still works on
+  // its own connection, just slowly. Failing here would turn a performance
+  // optimisation into an outage.
+  if (r.status !== 0) return [];
+  masterDir = dir;
+  masterSocket = sock;
+  return ["-o", `ControlPath=${sock}`];
+}
+
+/** Close the shared connection. Safe to call twice, and safe when none was opened. */
+function closeSshMaster(): void {
+  if (!masterSocket) return;
+  spawnSync("ssh", ["-o", `ControlPath=${masterSocket}`, "-O", "exit", HOST()], { stdio: "ignore" });
+  if (masterDir) rmSync(masterDir, { recursive: true, force: true });
+  masterSocket = undefined;
+  masterDir = undefined;
+}
+
+// Covers the ordinary exit and the `process.exit()` inside die() and attach().
+// Without it a -N master would linger with nothing to do and nobody to close it.
+process.on("exit", closeSshMaster);
+
 /**
  * Run a command on the box over ssh and return stdout.
  *
@@ -105,7 +189,7 @@ const HOST = () => `${USER}@${host()}`;
  * the trim would quietly make two different files look identical.
  */
 function ssh(remote: string, opts: { check?: boolean; raw?: boolean } = {}): string {
-  const r = spawnSync("ssh", [...SSH_OPTS, HOST(), remote], { encoding: "utf8" });
+  const r = spawnSync("ssh", [...SSH_OPTS, ...sshMasterOpts(), HOST(), remote], { encoding: "utf8" });
   if (opts.check !== false && r.status !== 0) {
     die(`ssh failed (${r.status}): ${(r.stderr || "").trim() || "no output"}`);
   }
@@ -113,10 +197,51 @@ function ssh(remote: string, opts: { check?: boolean; raw?: boolean } = {}): str
   return opts.raw ? out : out.trim();
 }
 
+/**
+ * Put text on the box, in one round trip, and prove it arrived whole.
+ *
+ * `scp` was the obvious choice and is the slow one: measured over an ALREADY
+ * SHARED connection on 2026-08-31, an scp of a 3-byte file took 3.87s against
+ * ~1.0s for a plain command, because the sftp subsystem does its own handshake
+ * on top. `new -p` did two of them.
+ *
+ * The content goes down the command's stdin instead, so there is no local temp
+ * file, no second protocol, and no quoting — the bytes never touch a command
+ * line. Everything the file needs doing to it rides the same connection.
+ *
+ * The byte count is the part not to drop. `cat > f` exits 0 on a stdin that
+ * ended early, so a connection that dies mid-write leaves a TRUNCATED job
+ * script that still starts a session — which is the wrong-tree failure the
+ * cdGuard below exists to prevent, arriving by another route. Comparing the
+ * size on the box against the size we sent costs nothing, because it happens
+ * inside the same remote command, and it turns a silent half-write into a
+ * refusal. Writing to `.part` and renaming only on success means a failed write
+ * never leaves a plausible-looking file at the real path.
+ */
+function writeRemote(content: string, remotePath: string, opts: { exec?: boolean } = {}): void {
+  const bytes = Buffer.byteLength(content, "utf8");
+  const part = `${remotePath}.part`;
+  const cmd = [
+    `mkdir -p ${shq(path.posix.dirname(remotePath))}`,
+    `cat > ${shq(part)}`,
+    `[ "$(wc -c < ${shq(part)})" -eq ${bytes} ]`,
+    ...(opts.exec ? [`chmod +x ${shq(part)}`] : []),
+    `mv -f ${shq(part)} ${shq(remotePath)}`,
+  ].join(" && ");
+  const r = spawnSync("ssh", [...SSH_OPTS, ...sshMasterOpts(), HOST(), cmd], {
+    input: Buffer.from(content, "utf8"),
+    encoding: "utf8",
+  });
+  if (r.status !== 0) {
+    spawnSync("ssh", [...SSH_OPTS, ...sshMasterOpts(), HOST(), `rm -f ${shq(part)}`], { stdio: "ignore" });
+    die(`writing ${remotePath} failed (${r.status}): ${(r.stderr || "").trim() || `${bytes} bytes did not arrive intact`}`);
+  }
+}
+
 /** Copy one file to the box. Dies on failure — a silent scp is how you get a
  *  box running yesterday's script and a green check that means nothing. */
 function scpTo(local: string, remote: string): void {
-  const r = spawnSync("scp", ["-q", ...SSH_OPTS, local, `${HOST()}:${remote}`], { encoding: "utf8" });
+  const r = spawnSync("scp", ["-q", ...SSH_OPTS, ...sshMasterOpts(), local, `${HOST()}:${remote}`], { encoding: "utf8" });
   if (r.status !== 0) die(`scp to ${remote} failed: ${(r.stderr || "").trim()}`);
 }
 
@@ -132,7 +257,11 @@ function moshProbe(): { ok: boolean; detail: string } {
   // "tcgetattr/ioctl: Operation not supported on socket" — which is what this
   // probe did on EVERY network, while reporting "UDP blocked?". It was never
   // testing reachability at all. stdin must be the real terminal.
-  if (!process.stdin.isTTY) {
+  //
+  // It asks interactiveStdin() rather than fd 0 because `-p -` spends fd 0 on
+  // the prompt; see that function.
+  const keyboard = interactiveStdin();
+  if (keyboard === null || (keyboard === "inherit" && !process.stdin.isTTY)) {
     return { ok: false, detail: "cannot probe without a terminal; assuming ssh" };
   }
   const probe = `stty rows 40 cols 120; exec env LANG=C.UTF-8 mosh ${shq(HOST())} -- true`;
@@ -142,7 +271,7 @@ function moshProbe(): { ok: boolean; detail: string } {
     // handshake starts, and a short timeout reports a blocked network for what
     // was only slowness. Some timeout is required — mosh retries forever.
     timeout: 15_000,
-    stdio: ["inherit", "pipe", "pipe"],
+    stdio: [keyboard, "pipe", "pipe"],
   });
   if (r.status === 0) return { ok: true, detail: "" };
   const out = `${r.stdout ?? ""}${r.stderr ?? ""}`
@@ -190,8 +319,15 @@ function attachCmd(name: string, transport: "mosh" | "ssh"): string {
     `tmux attach -d -t =${name}`;
   return transport === "mosh"
     ? // Without MOSH_TITLE_NOPREFIX every tab reads "[mosh] " before the name.
+      // No ControlPath here: mosh 1.4.0's default --experimental-remote-ip=proxy
+      // appends `-S none` to its own ssh command line AFTER anything we pass in
+      // --ssh, so connection sharing is switched off no matter what we ask for.
+      // /opt/homebrew/bin/mosh line 407. Checked because the plan proposed doing
+      // it, and it would have looked like it worked.
       `MOSH_TITLE_NOPREFIX=1 LANG=C.UTF-8 mosh ${shq(HOST())} -- sh -c ${shq(inner)}`
-    : `ssh -t ${shq(HOST())} ${shq(inner)}`;
+    : // Interactive, so no BatchMode — but a rebuilt box must still not greet
+      // the fallback attach with a raw host-key verification failure.
+      `ssh -t ${SSH_OPTS_INTERACTIVE.join(" ")} ${shq(HOST())} ${shq(inner)}`;
 }
 
 /**
@@ -210,22 +346,24 @@ function chooseTransport(force?: string): "mosh" | "ssh" {
 }
 
 function attach(name: string, force?: string): never {
+  const keyboard = interactiveStdin();
+  if (keyboard === null) {
+    die(
+      "the prompt came in on stdin, so there is no terminal left to attach with.\n" +
+        `  The session is running: 'gjd-remote resume ${name}'.\n` +
+        "  Add --no-attach to say you meant that.",
+    );
+  }
+  // Before the transport is chosen, not after: chooseTransport may spend six
+  // seconds bootstrapping mosh, and the shared connection has no work left. An
+  // attach lasts hours, and a -N master idling beside it for all of them is a
+  // connection nobody is watching on a link that drops.
+  closeSshMaster();
   const transport = chooseTransport(force);
-  const r = spawnSync("sh", ["-c", attachCmd(name, transport)], { stdio: "inherit" });
+  const r = spawnSync("sh", ["-c", attachCmd(name, transport)], { stdio: [keyboard, "inherit", "inherit"] });
   process.exit(r.status ?? 0);
 }
 
-type Session = {
-  name: string;
-  created: Date;
-  attached: boolean;
-  windows: number;
-  /** Claude Code's own generated title for the conversation, once it has one. */
-  title: string;
-  /** Whether the name is a placeholder we chose, and so may be replaced. */
-  provisional: boolean;
-};
-
 /** A tmux session name: lower-case, hyphenated, and never surprising to a shell. */
 function slugify(text: string, fallback: string): string {
   let slug = text
@@ -244,11 +382,25 @@ function slugify(text: string, fallback: string): string {
   return SLUG.test(slug) ? slug : fallback;
 }
 
+/** `yyMMdd-HHmmss` in LAPTOP LOCAL time — the same day-ordering as docs/plans
+ *  file names, and the same clock as the person reading the name. It was UTC,
+ *  which under BST named a session an hour ago.
+ *
+ *  Seconds are in it because two `new` runs a few seconds apart minted the same
+ *  name and tmux refused the second one: "duplicate session: s-0831-1615". */
+function timestampName(prefix: string): string {
+  const now = new Date();
+  const pad = (n: number) => String(n).padStart(2, "0");
+  const day = `${pad(now.getFullYear() % 100)}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
+  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
+  return `${prefix}-${day}-${time}`;
+}
+
 /** A placeholder name, used until Claude has decided what the work is about. */
 function provisionalName(prompt?: string): string {
-  const stamp = new Date().toISOString().slice(5, 16).replace(/[-T:]/g, "").replace(/(\d{4})(\d{4})/, "$1-$2");
   // A prompt makes a better placeholder than a timestamp, and costs nothing.
-  return prompt ? slugify(prompt.split(/\s+/).slice(0, 5).join(" "), `s-${stamp}`) : `s-${stamp}`;
+  const stamp = timestampName("s");
+  return prompt ? slugify(prompt.split(/\s+/).slice(0, 5).join(" "), stamp) : stamp;
 }
 
 function sessions(): Session[] {
@@ -256,34 +408,37 @@ function sessions(): Session[] {
   // pinned into the tmux environment at launch, and the LAST ai-title line from
   // that conversation's transcript — Claude rewrites it as the work becomes
   // clearer, so the last one is the current one.
-  const remote = `
-    for s in $(tmux ls -F '#{session_name}' 2>/dev/null); do
-      stats=$(tmux display -p -t "=$s" '#{session_created}|#{session_attached}|#{session_windows}')
-      id=$(tmux show-environment -t "=$s" CLAUDE_SESSION_ID 2>/dev/null | cut -d= -f2-)
-      prov=$(tmux show-environment -t "=$s" GJD_PROVISIONAL 2>/dev/null | cut -d= -f2-)
-      title=""
-      if [ -n "$id" ]; then
-        f=$(ls -1 "$HOME"/.claude/projects/*/"$id".jsonl 2>/dev/null | head -1)
-        [ -n "$f" ] && title=$(grep -o '"aiTitle":"[^"]*"' "$f" 2>/dev/null | tail -1 | cut -d'"' -f4)
-      fi
-      printf '%s|%s|%s|%s\\n' "$s" "$stats" "$prov" "$title"
-    done`;
-  const out = ssh(remote, { check: false });
-  if (!out) return [];
-  return out.split("\n").flatMap((line) => {
-    const [name, created, attached, windows, prov, ...rest] = line.split("|");
-    if (!name) return [];
-    return [
-      {
-        name,
-        created: new Date(Number(created) * 1000),
-        attached: attached !== "0",
-        windows: Number(windows),
-        title: rest.join("|").trim(),
-        provisional: prov === "1",
-      },
-    ];
-  });
+  //
+  // The script and the parse both live in gjd-remote-tmux.ts, which is where
+  // their tests can reach them. The parse is strict: a line tmux did not fill
+  // in is dropped, not coerced. See tests/gjd-remote-tmux.test.ts for what
+  // coercion did to the AGE and ATT columns.
+  // ssh's exit status is CHECKED, and that is the whole of this line's history:
+  // it used to be `{ check: false }`, so a box that was down, rebuilt, or
+  // unreachable gave empty stdout, an empty list, and `gjd-remote ls` printing
+  // "no sessions." and exiting 0. "No sessions" is the answer least likely to
+  // make anyone look, and every other caller reads absence as permission —
+  // `new` decides the name is free, `resume` picks a most-recent out of nothing.
+  //
+  // What this still cannot tell apart is an idle box from a broken tmux: the
+  // remote script pipes `tmux ls` into a `while` loop, so the loop's exit
+  // status of 0 is all we ever see, whatever tmux did. An explicit sentinel
+  // line for "tmux answered, and there are no sessions" would fix that, but it
+  // belongs in buildSessionScript() in scripts/gjd-remote-tmux.ts, which is
+  // another session's file today. Requested there rather than forked here.
+  const { sessions: list, unreadable } = parseSessions(ssh(buildSessionScript()));
+  // Fail closed. A short list is indistinguishable from a correct one, and
+  // every caller draws a conclusion from absence: `new` decides a name is free,
+  // `resume` with no name picks the "most recent". Neither may act on a list we
+  // know is incomplete.
+  if (unreadable.length > 0) {
+    die(
+      `could not read ${unreadable.length} of the box's tmux sessions, so the list is incomplete:\n` +
+        unreadable.map((l) => `  ${l}`).join("\n") +
+        `\n  'gjd-remote ssh' and 'tmux ls' will show what the box actually has.`,
+    );
+  }
+  return list;
 }
 
 /**
@@ -327,17 +482,25 @@ function age(d: Date): string {
  * `cd`, and a guess about which tree to edit is the expensive kind. `-d ~` still
  * gets you home when that is genuinely what you want.
  *
- * The existence check belongs HERE, before any session is created, and not only
- * because a session that dies on its first line is confusing. It is the half of
- * the guard that can say something useful — by the time the job script runs,
- * nobody is watching. See the job script below for the other half.
+ * The check belongs HERE, before any session is created, and not only because a
+ * session that dies on its first line is confusing. It is the half of the guard
+ * that can say something useful — by the time the job script runs, nobody is
+ * watching. See cdGuard() below for the other half.
+ *
+ * It is `cd`, not `test -d`, and the difference is a real hole: `test -d` only
+ * stats, so a directory with no execute permission passes it and then refuses
+ * every attempt to enter. Asking the question we actually mean costs the same
+ * round trip.
  */
 function sessionDir(given: string | undefined): string {
   const explicit = given !== undefined;
   const dir = remotePath(given ?? REMOTE_REPO(), explicit ? "--dir" : "GJD_REMOTE_REPO");
-  if (spawnSync("ssh", [...SSH_OPTS, HOST(), `test -d ${shq(dir)}`]).status === 0) return dir;
+  const probe = spawnSync("ssh", [...SSH_OPTS, ...sshMasterOpts(), HOST(), `cd ${shq(dir)}`], { encoding: "utf8" });
+  if (probe.status === 0) return dir;
+  const why = (probe.stderr || "").trim().split("\n").at(-1)?.replace(/^bash: line \d+: /, "") ?? "";
   die(
-    `no such directory on the box: ${dir}\n` +
+    `cannot start a session in ${dir} on the box.\n` +
+      (why ? `  the box said: ${why}\n` : "") +
       (explicit
         ? `  --dir is a path on the BOX, not on this laptop.`
         : `  that is where sessions start when you do not say. Either put it there:\n` +
@@ -348,6 +511,66 @@ function sessionDir(given: string | undefined): string {
   );
 }
 
+/** Where a session's command leaves its last words. Read back by
+ *  confirmStarted() once the session is gone and the pane with it. */
+const failNote = (name: string) => `${REMOTE_WORK}/jobs/${name}.fail`;
+
+/**
+ * Say why, on the pane AND in the note, then end the session.
+ *
+ * The message is shq'd rather than interpolated: a path containing `$()` or a
+ * backtick would otherwise become shell syntax at exactly the moment the guard
+ * fires — which is the one moment nobody is watching.
+ *
+ * printf and redirection only, no `tee`: the first version piped through tee,
+ * and a PATH without it — the very kind of broken environment this guard exists
+ * to report — swallowed the note it was trying to leave.
+ */
+function failTo(name: string, msg: string): string {
+  return (
+    `{ m=${shq(msg)}; printf '%s\\n' "$m" >&2; ` + `printf '%s\\n' "$m" > ${shq(failNote(name))}; exit 1; }`
+  );
+}
+
+/**
+ * Get into the directory, or end the session saying so.
+ *
+ * `tmux new-session -c DIR` is not this guard. tmux does NOT fail closed when
+ * it cannot enter `-c`: it falls back to the user's home, then to `/`, and
+ * exits 0 either way. So `-c` alone buys a healthy-looking session in
+ * /home/greg — the same wrong-tree failure `new` was fixed for, reproduced for
+ * `shell` on the box on 2026-08-31 with a `chmod 000` directory, which `test -d`
+ * passes and `cd` refuses.
+ *
+ * sessionDir() has already asked the box whether it can enter this directory,
+ * so reaching the failure branch means it went away in between. Ending the
+ * session is a failure you can see; a session in the wrong tree is not.
+ */
+function cdGuard(name: string, dir: string, what: string): string {
+  return `cd ${shq(dir)} || ${failTo(name, `FATAL: cannot enter ${dir} on the box — refusing to start ${what} somewhere else`)}`;
+}
+
+/**
+ * Did the session survive being started?
+ *
+ * `tmux new-session -d` exits 0 the moment the pane is spawned, so the green ✓
+ * used to be printed before the command in it had had a chance to fail. One
+ * round trip a second later asks the box instead, and if the session is gone,
+ * the note the guard left says why — the pane that printed it does not outlive
+ * it.
+ */
+function confirmStarted(name: string): void {
+  const note = failNote(name);
+  const out = ssh(
+    `sleep 1; if tmux has-session -t =${name} 2>/dev/null; then printf 'alive\\n'; ` +
+      `else cat -- ${shq(note)} 2>/dev/null || ` +
+      `printf '%s\\n' 'it was gone a second after it started, and left no note'; fi`,
+    { check: false },
+  );
+  if (out.trim() === "alive") return;
+  die(`'${name}' did not survive starting:\n  ${out.trim().split("\n").join("\n  ")}`);
+}
+
 function cmdLs(): void {
   const list = adoptTitles(sessions());
   if (list.length === 0) {
@@ -365,6 +588,77 @@ function cmdLs(): void {
   }
 }
 
+/**
+ * `-p -` means "the prompt is on stdin".
+ *
+ * `-p "…"` is fine for a sentence, but the text is prose and the local shell
+ * gets it first: in double quotes zsh still eats `$`, backticks and backslashes,
+ * and a prompt about shell commands is exactly the kind that contains all three.
+ * A heredoc hands the text over with no quoting at all:
+ *
+ *     gjd-remote new -p - <<'EOF'
+ *     anything at all, "quoted" or `backticked`
+ *     EOF
+ *
+ * Everything downstream is unchanged — the prompt already travels as a file.
+ *
+ * The TTY check is not politeness. Without it, a bare `-p -` typed at a terminal
+ * blocks on a read that never returns, and on a tool whose every other pause is
+ * the network, that looks precisely like a slow connection.
+ */
+function resolvePrompt(prompt: string | undefined): string | undefined {
+  if (prompt !== "-") return prompt;
+  if (process.stdin.isTTY) {
+    die(
+      "-p - reads the prompt from stdin, but stdin is a terminal.\n" +
+        "  Pipe it in, or use a heredoc: gjd-remote new -p - <<'EOF' … EOF",
+    );
+  }
+  const text = readFileSync(0, "utf8");
+  // An empty stdin would otherwise start Claude with the empty string as its
+  // first message, which is not what anyone meant by piping in a prompt.
+  if (!text.trim()) die("-p - got nothing on stdin");
+  stdinConsumed = true;
+  return text;
+}
+
+/**
+ * Where an interactive child gets its keyboard from.
+ *
+ * `-p -` and attaching fight over one file descriptor. The heredoc that carries
+ * the prompt IS stdin, so by the time the prompt has been read, fd 0 is an
+ * exhausted pipe — and every later step quietly does the wrong thing with it:
+ * `moshProbe` sees a non-TTY and reports mosh unavailable, then `ssh -t`
+ * declines to allocate a pty ("Pseudo-terminal will not be allocated because
+ * stdin is not a terminal") and tmux attaches to nothing. Both verified against
+ * the box on 2026-08-31. `-t -t` forces the pty but leaves stdin an exhausted
+ * pipe, so tmux sees EOF and detaches immediately — worse, because it looks
+ * like it worked.
+ *
+ * /dev/tty is the controlling terminal regardless of what fd 0 was redirected
+ * to, which is exactly the question being asked. Opened once, reused.
+ *
+ * Returns "inherit" when stdin was never consumed — the ordinary case, where fd
+ * 0 is already the terminal — and null when there is no terminal to be had, so
+ * the caller can say something useful instead of hanging.
+ */
+let stdinConsumed = false;
+let ttyFd: number | null | undefined;
+
+function interactiveStdin(): number | "inherit" | null {
+  if (!stdinConsumed) return "inherit";
+  if (ttyFd === undefined) {
+    try {
+      ttyFd = openSync("/dev/tty", "r");
+    } catch {
+      // No controlling terminal: a cron job, a CI runner, another agent's
+      // subprocess. Nothing to attach to, and nothing has gone wrong yet.
+      ttyFd = null;
+    }
+  }
+  return ttyFd;
+}
+
 /**
  * Create a session and start Claude Code in it.
  *
@@ -396,17 +690,13 @@ function cmdNew(
   // conversation's transcript later, and so how we read back its title.
   const sessionId = randomUUID();
 
-  const promptPath = `/home/${USER}/gjd-remote/prompts/${name}.md`;
-  const jobPath = `/home/${USER}/gjd-remote/jobs/${name}.sh`;
-  ssh(`mkdir -p /home/${USER}/gjd-remote/prompts /home/${USER}/gjd-remote/jobs`);
+  const promptPath = `${REMOTE_WORK}/prompts/${name}.md`;
+  const jobPath = `${REMOTE_WORK}/jobs/${name}.sh`;
+  // The note is removed before the run, never after: one left by an earlier
+  // session of the same name would otherwise be read back as this one's excuse.
+  ssh(`mkdir -p ${REMOTE_WORK}/prompts ${REMOTE_WORK}/jobs && rm -f ${shq(failNote(name))}`);
 
-  const stage = mkdtempSync(path.join(tmpdir(), "gjd-remote-"));
-
-  if (opts.prompt) {
-    const f = path.join(stage, `${name}.md`);
-    writeFileSync(f, opts.prompt, "utf8");
-    scpTo(f, promptPath);
-  }
+  if (opts.prompt) writeRemote(opts.prompt, promptPath);
 
   // Non-interactive ssh sources NEITHER .bashrc NOR .bash_profile, so the job
   // gets a stock PATH. Append, never substitute: `PATH=$PATH || default` only
@@ -426,11 +716,13 @@ function cmdNew(
     // the FATAL line one keystroke from scrolling away — and Claude never
     // started. `gjd-remote ls` showed a session; the tree was the wrong one.
     // Reproduced 2026-08-31 by deleting the directory after the check.
-    //
-    // sessionDir() already checked, so reaching here means the directory went
-    // away in between. Exiting ends the session, which is a failure you can see;
-    // a session in the wrong tree is one you cannot.
-    `cd ${shq(dir)} || { echo "FATAL: ${dir} is gone — refusing to start Claude somewhere else"; exit 1; }`,
+    cdGuard(name, dir, "Claude"),
+    // And the same shape one line lower: `claude` not being on the job's stock
+    // PATH does not stop the script, it falls through to `exec bash -l`. That
+    // is a live session, listed by `ls`, with no Claude in it — which is the
+    // wrong-tree failure again, wearing different clothes.
+    `command -v claude >/dev/null 2>&1 || ` +
+      failTo(name, "FATAL: claude is not on this job's PATH — refusing to leave a session with no Claude in it"),
     // --name only when Greg chose one: passing a placeholder would stop Claude
     // generating a title of its own, which is the thing we actually want.
     [
@@ -447,10 +739,8 @@ function cmdNew(
     ``,
   ].join("\n");
 
-  const jobLocal = path.join(stage, `${name}.sh`);
-  writeFileSync(jobLocal, job, "utf8");
-  scpTo(jobLocal, jobPath);
-  ssh(`chmod +x ${jobPath}`);
+  // exec: true folds the chmod into the same round trip as the write.
+  writeRemote(job, jobPath, { exec: true });
   // The id and the provisional flag live in the tmux session's own environment,
   // so they survive the rename that `ls` may later perform — a mapping file
   // keyed by name would go stale at exactly that moment.
@@ -459,6 +749,7 @@ function cmdNew(
       `-e GJD_PROVISIONAL=${provisional ? 1 : 0} ${shq(`bash ${jobPath}`)}`,
   );
 
+  confirmStarted(name);
   console.log(green(`✓ started '${name}'`) + dim(opts.prompt ? " with a prompt" : ""));
   if (opts.attach) attach(name, opts.transport);
   else console.log(dim(`  gjd-remote resume ${name}`));
@@ -473,7 +764,7 @@ function cmdNew(
  * terminal, which is what you want for a quick look and never for real work.
  */
 function cmdShell(given: string | undefined, opts: { dir?: string | undefined; transport?: string | undefined }): void {
-  const name = given ?? `sh-${new Date().toISOString().slice(5, 16).replace(/[-T:]/g, "").replace(/(\d{4})(\d{4})/, "$1-$2")}`;
+  const name = given ?? timestampName("sh");
   if (!SLUG.test(name)) die(`'${name}' is not a valid name (lower-case letters, digits, hyphens; max 41)`);
 
   const live = sessions();
@@ -485,10 +776,20 @@ function cmdShell(given: string | undefined, opts: { dir?: string | undefined; t
   const dir = sessionDir(opts.dir);
   console.log(bold(`gjd-remote shell ${name}`) + dim(` → ${HOST()}:${dir}`));
 
+  // `-c ${dir}` is NOT the guard, and used to be all there was: tmux falls back
+  // to the home directory when it cannot enter `-c` and still exits 0, so this
+  // command reported a green ✓ over a shell sitting in /home/greg. The explicit
+  // `cd || exit 1` is the same one `new` runs, for the same reason.
+  //
   // GJD_PROVISIONAL=0: a shell has no Claude conversation and so will never
   // have a title to adopt. Marking it settled stops `ls` looking every time.
-  ssh(`tmux new-session -d -s ${name} -c ${shq(dir)} -e GJD_PROVISIONAL=0`);
-  console.log(green(`✓ shell '${name}'`));
+  ssh(`mkdir -p ${REMOTE_WORK}/jobs && rm -f ${shq(failNote(name))}`);
+  ssh(
+    `tmux new-session -d -s ${name} -c ${shq(dir)} -e GJD_PROVISIONAL=0 ` +
+      shq(`${cdGuard(name, dir, "a shell")}; exec bash -l`),
+  );
+  confirmStarted(name);
+  console.log(green(`✓ shell '${name}'`) + dim(` in ${dir}`));
   attach(name, opts.transport);
 }
 
@@ -521,6 +822,20 @@ function cmdPushEnv(opts: { file?: string | undefined }): void {
   if (!existsSync(local)) die(`no such file: ${local}`);
 
   const payload = buildEnvPayload(readFileSync(local, "utf8"));
+  // Refused, not reported. The allowlist stops the file sending a key it should
+  // not; nothing stopped it sending FEWER keys than it appears to — a duplicate
+  // takes the later value, an unclosed quote eats every line after it, and a
+  // line the parser cannot read is skipped. Each of those replaces the box's
+  // env file with a shorter one under a green tick, and the box then fails at
+  // whatever needed the key that went missing.
+  if (payload.problems.length) {
+    die(
+      `${local} is not a file I will push — I would silently drop keys out of it:\n` +
+        payload.problems.map((p) => `  ${p}`).join("\n") +
+        `\n  Fix those lines and run this again. Nothing on the box was touched.` +
+        `\n  (Line numbers only — the contents of a broken line may well be the secret.)`,
+    );
+  }
   if (payload.pushed.size === 0) {
     die(
       `${local} has none of the allowlisted keys — refusing to write an empty env file.\n` +
@@ -570,7 +885,7 @@ function cmdPushEnv(opts: { file?: string | undefined }): void {
   // every credential is sitting in the repo. The chmod after the copy is belt
   // and braces, not the mechanism.
   ssh(`umask 077 && : > ${shq(tmp)}`);
-  const sent = spawnSync("scp", ["-q", ...SSH_OPTS, staged, `${HOST()}:${tmp}`], { encoding: "utf8" });
+  const sent = spawnSync("scp", ["-q", ...SSH_OPTS, ...sshMasterOpts(), staged, `${HOST()}:${tmp}`], { encoding: "utf8" });
   if (sent.status !== 0) {
     ssh(`rm -f ${shq(tmp)}`, { check: false });
     die(`scp failed: ${(sent.stderr || "").trim()}`);
@@ -580,7 +895,21 @@ function cmdPushEnv(opts: { file?: string | undefined }): void {
   // one and never a half-written one.
   ssh(`chmod 600 ${shq(tmp)} && mv -f ${shq(tmp)} ${shq(dest)}`);
 
-  const back = parseEnv(ssh(`cat ${shq(dest)}`, { raw: true }));
+  // BYTES first, meaning second. The readback used to go straight through the
+  // parser, which is the one comparison that cannot see what the parser
+  // overlooks: a trailing junk line, an appended comment, a second copy of a
+  // key. Both sides agreed because both sides had the same blind spot.
+  const raw = ssh(`cat ${shq(dest)}`, { raw: true });
+  if (raw !== payload.text) {
+    const at = [...raw].findIndex((c, i) => c !== payload.text[i]);
+    die(
+      `the bytes on the box are not the bytes that were sent — leaving it for you to look at.\n` +
+        `  sent ${payload.text.length} characters, read back ${raw.length}\n` +
+        `  first difference at character ${at < 0 ? Math.min(raw.length, payload.text.length) : at}\n` +
+        `  (positions only — the file is full of credentials, so nothing from it is printed)`,
+    );
+  }
+  const back = parseEnv(raw);
   const wrong = [...payload.pushed].filter(([k, v]) => back.get(k) !== v).map(([k]) => k);
   const extra = [...back.keys()].filter((k) => !payload.pushed.has(k));
   if (wrong.length || extra.length || back.size !== payload.pushed.size) {
@@ -771,16 +1100,24 @@ function cmdClone(given: string | undefined, opts: { baseFolder?: string | undef
   const before = cloneFacts(base, dest, tokenFile);
   const want = `${repo.owner}/${repo.name}`.toLowerCase();
 
-  // Already there. Success, not an error — but say WHICH repo is sitting there,
-  // because a name collision and a done job look identical from the outside.
+  // Already there — but only success if it is a checkout of the repo that was
+  // ASKED FOR. This used to print the green ✓ and exit 0 for any checkout at
+  // all, adding a red advisory line underneath saying it was a different repo:
+  // a name collision and a done job then looked the same to a caller, to a
+  // script, and to anyone reading the last line.
   if (before.get("checkout") === "yes") {
     const found = remoteSlug(before.get("remote"));
-    console.log(green(`✓ already a checkout — nothing to do`));
-    describeCheckout(before);
     if (found !== want) {
-      console.log(red(`  note: that is ${found ?? "an unrecognised remote"}, not ${want}`));
-      console.log(dim(`  --name or --base-folder if you meant somewhere else`));
+      die(
+        `${dest} on the box is a checkout of a different repository.\n` +
+          `  asked for: ${want}\n` +
+          `  found:     ${found ?? `unrecognised remote '${before.get("remote") || "(none)"}'`}\n` +
+          `  Nothing was cloned and nothing was touched. --name or --base-folder to put\n` +
+          `  ${want} somewhere else.`,
+      );
     }
+    console.log(green(`✓ already a checkout of ${want} — nothing to do`));
+    describeCheckout(before);
     return;
   }
 
@@ -824,7 +1161,7 @@ function cmdClone(given: string | undefined, opts: { baseFolder?: string | undef
   // is worth watching. GIT_TERMINAL_PROMPT=0 so a credential miss fails instead
   // of hanging on a username nobody is there to type.
   const cmd = `mkdir -p ${shq(base)} && GIT_TERMINAL_PROMPT=0 git clone ${shq(repo.url)} ${shq(dest)}`;
-  const r = spawnSync("ssh", [...SSH_OPTS, HOST(), cmd], { stdio: "inherit" });
+  const r = spawnSync("ssh", [...SSH_OPTS, ...sshMasterOpts(), HOST(), cmd], { stdio: "inherit" });
   if (r.status !== 0) {
     die(
       `git clone failed on the box (exit ${r.status}) — git's own output is above.\n` +
@@ -1072,7 +1409,7 @@ function runBrowserSmoke(): { ok: boolean; detail: string } {
   scpTo(local, remote);
   // Chrome starting, two page loads and two screenshots. 20s is the normal
   // shape; the cap is for a browser that has hung rather than failed.
-  const r = spawnSync("ssh", [...SSH_OPTS, HOST(), `node ${shq(remote)}`], { encoding: "utf8", timeout: 120_000 });
+  const r = spawnSync("ssh", [...SSH_OPTS, ...sshMasterOpts(), HOST(), `node ${shq(remote)}`], { encoding: "utf8", timeout: 120_000 });
   const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n").filter(Boolean);
   if (r.status === 0) return { ok: true, detail: out.at(-1)?.replace(/^ok\s+/, "") ?? "" };
   return { ok: false, detail: out.at(-1) ?? `no output (exit ${r.status}, signal ${r.signal})` };
@@ -1085,7 +1422,7 @@ const HELP = `${bold("gjd-remote")} — Claude Code sessions on a server that ne
 ${bold("SESSIONS")}
   ls, (no args)           list sessions, each with Claude's own title for it
   new [name]              start Claude Code and attach
-      -p, --prompt TEXT     give it a first prompt
+      -p, --prompt TEXT     give it a first prompt (${dim("-p -")} reads it from stdin)
       -d, --dir DIR         working directory on the box ${dim(`(default: ${REMOTE_REPO_DEFAULT})`)}
           --no-attach       create it, but stay here
   shell [name]            a persistent shell, no Claude Code
@@ -1140,9 +1477,13 @@ ${bold("WHAT SURVIVES WHAT")}
 
 ${bold("EXAMPLES")}
   gjd-remote new -p "fix the ToC ordering bug"
-      ${dim(`gjd-remote new s-0831-1712 → greg@1.2.3.4:${REMOTE_REPO_DEFAULT}`)}
-      ${dim("✓ started 's-0831-1712' with a prompt")}
+      ${dim(`gjd-remote new s-260831-171205 → greg@1.2.3.4:${REMOTE_REPO_DEFAULT}`)}
+      ${dim("✓ started 's-260831-171205' with a prompt")}
       already in the checkout, and named after whatever Claude decides the work is
+  gjd-remote new -p - <<'EOF'
+      the prompt comes from stdin, so nothing needs escaping — quotes, backticks,
+      dollar signs and newlines all arrive as typed
+      EOF
   gjd-remote new -d ~/code/gjdutils
       an unnamed session in a different repo; it takes a name once Claude has a title
   gjd-remote shell
@@ -1199,7 +1540,7 @@ function main(): void {
         },
       });
       return cmdNew(positionals[0], {
-        prompt: values.prompt,
+        prompt: resolvePrompt(values.prompt),
         dir: values.dir,
         attach: !values["no-attach"],
         transport: values.ssh ? "ssh" : undefined,
@@ -1277,12 +1618,26 @@ function main(): void {
     }
 
     case "ssh":
-      process.exit(spawnSync("ssh", ["-t", HOST()], { stdio: "inherit" }).status ?? 0);
+      process.exit(spawnSync("ssh", ["-t", ...SSH_OPTS_INTERACTIVE, HOST()], { stdio: "inherit" }).status ?? 0);
 
     case "tunnel":
       console.log(dim("open http://localhost:6080/vnc.html — and run `start-vnc` on the box"));
+      console.log(dim("ctrl-c closes the tunnel"));
+      // ExitOnForwardFailure is the whole command. Without it, a local 6080
+      // already in use makes ssh print one line and CARRY ON with no forwarding
+      // — and the shell it opened kept the process alive, so it looked exactly
+      // like a working tunnel until the browser showed you whatever else was
+      // already listening on that port.
+      //
+      // -N because there is nothing to run at the far end. The login shell was
+      // only ever a side effect of not saying so, and it made the failure above
+      // survivable in the first place.
       process.exit(
-        spawnSync("ssh", ["-L", "6080:localhost:6080", HOST()], { stdio: "inherit" }).status ?? 0,
+        spawnSync(
+          "ssh",
+          ["-o", "ExitOnForwardFailure=yes", "-N", "-L", "6080:localhost:6080", ...SSH_OPTS_INTERACTIVE, HOST()],
+          { stdio: "inherit" },
+        ).status ?? 0,
       );
 
     case "-h":
```

### New file in full: scripts/gjd-remote-tmux.ts
```typescript
/**
 * Reading the box's tmux sessions — the pure half of `gjd-remote ls`.
 *
 * Separated from scripts/gjd-remote.ts so it can be tested without a network,
 * the same way scripts/gjd-remote-env.ts is. See tests/gjd-remote-tmux.test.ts
 * for the bug that made it worth separating.
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
 * The four fields tmux itself knows, in the order the parser expects.
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
export const SESSION_FIELDS = "#{session_name}|#{session_created}|#{session_attached}|#{session_windows}";

/**
 * The remote script: list the sessions, then for each one add the two variables
 * we pinned into its tmux environment at launch and the latest title Claude has
 * given the conversation.
 *
 * `show-environment` DOES take a target-session, so `=$name` is right there —
 * this is the one command of the three where the bare `=` form is correct.
 *
 * One round trip. On a link where a single ssh connection costs seconds, the
 * number of round trips is the whole performance story.
 */
export function buildSessionScript(): string {
  return `
    tmux ls -F '${SESSION_FIELDS}' 2>/dev/null | while IFS= read -r row; do
      s=\${row%%|*}
      id=$(tmux show-environment -t "=$s" CLAUDE_SESSION_ID 2>/dev/null | cut -d= -f2-)
      prov=$(tmux show-environment -t "=$s" GJD_PROVISIONAL 2>/dev/null | cut -d= -f2-)
      title=""
      if [ -n "$id" ]; then
        f=$(ls -1 "$HOME"/.claude/projects/*/"$id".jsonl 2>/dev/null | head -1)
        [ -n "$f" ] && title=$(grep -o '"aiTitle":"[^"]*"' "$f" 2>/dev/null | tail -1 | cut -d'"' -f4)
      fi
      printf '%s|%s|%s\\n' "$row" "$prov" "$title"
    done`;
}

/**
 * One line into a Session, or null if tmux did not fill it in.
 *
 * Strict on purpose. Every field tmux owns must be present and sane, because
 * the alternative — coercing whatever arrived — is what produced a fleet of
 * sessions dated to 1970 and all reported as attached. A line we cannot read is
 * a line we drop, and the caller says so; it is never a session with made-up
 * values.
 *
 * The title is last and may itself contain `|`, so it takes the rest.
 */
export function parseSessionLine(line: string): Session | null {
  const [name, created, attached, windows, prov, ...rest] = line.split("|");
  if (!name) return null;

  // A tmux timestamp is seconds since the epoch and is never 0 for a live
  // session. `Number("")` is 0 and `Number(undefined)` is NaN — both must fail
  // here rather than downstream, where they become a date.
  const stamp = Number(created);
  if (!Number.isInteger(stamp) || stamp <= 0) return null;

  // "" is not "0", so a lenient check reads a missing field as ATTACHED.
  if (attached !== "0" && attached !== "1") return null;

  const windowCount = Number(windows);
  if (!Number.isInteger(windowCount) || windowCount <= 0) return null;

  return {
    name,
    created: new Date(stamp * 1000),
    attached: attached === "1",
    windows: windowCount,
    // The trailing two are ours, not tmux's: a session that has never run
    // Claude legitimately has neither, so absence is information, not damage.
    title: rest.join("|").trim(),
    provisional: prov === "1",
  };
}

/**
 * Every session, or an explanation of the lines we could not read.
 *
 * This FAILS CLOSED, and that is the whole point. Dropping an unreadable line
 * would leave callers reasoning about a list that is quietly missing a session:
 * `cmdNew` would decide a name is free when it is taken, and `resume` with no
 * name would attach to the wrong "most recent" session. A short list is
 * indistinguishable from a correct one, so it must not be produced.
 */
export function parseSessions(out: string): { sessions: Session[]; unreadable: string[] } {
  const lines = out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const sessions: Session[] = [];
  const unreadable: string[] = [];
  for (const line of lines) {
    const s = parseSessionLine(line);
    if (s) sessions.push(s);
    else unreadable.push(line);
  }
  return { sessions, unreadable };
}
```

---

## Your plan review, for reference

Verdict: **do not build this plan as written**. SSH multiplexing is reasonable, but the proposed socket path is likely too long, mosh disables the shared socket, and `-p -` conflicts with the default interactive attach.

## 1. `ControlMaster` / `ControlPersist`

**Verdict: use multiplexing, but prefer a command-scoped master over a shared 10-minute master.**

A master covering one `gjd-remote` invocation gets nearly all the benefit for `new` and `shell`, while avoiding sleep, network-change, rebuild, and cross-invocation races.

Specific findings:

- A fixed socket path is unsafe. It must include `%C` or `%h/%p/%r`; otherwise a changed `GJD_REMOTE_HOST` can reuse a master connected to the old machine. OpenSSH explicitly recommends this uniqueness and a directory not writable by other users. [OpenSSH configuration manual](https://man.openbsd.org/ssh_config)
- `$TMPDIR` is a bad location on this Mac. It is already 48 bytes. A plausible `gjd-remote-%C` path is about 100 bytes, but OpenSSH creates the master first at `ControlPath.<16-random-chars>`. That temporary path adds another 17 bytes and exceeds macOS’s 104-byte `sun_path`. The plan currently checks only the final path, which is insufficient. OpenSSH’s implementation confirms the temporary suffix. [OpenSSH mux implementation](https://raw.githubusercontent.com/openssh/openssh-portable/master/mux.c)
- Use something short such as `~/.ssh/gjd-%C`, or a private `mkdtemp` directory directly under `/tmp` for a command-scoped master.
- Concurrent `ControlMaster=auto` creation is handled reasonably: OpenSSH creates a temporary listener and atomically links it into place. The loser prints that multiplexing is disabled and continues with its own connection. It should cost an extra connection, not wedge. [OpenSSH mux implementation](https://raw.githubusercontent.com/openssh/openssh-portable/master/mux.c)
- A dead socket file with no listener is also handled: `auto` unlinks it on `ECONNREFUSED` and falls back.
- The dangerous case is a **live local master over a blackholed TCP connection** after sleep or a network change. The local mux handshake succeeds, then the client can wait indefinitely for the master to open the remote session. `ConnectTimeout` does not bound that later request. That looks like a hung remote command, hung tmux, or hung mosh—not “stale ControlMaster.”
- `ServerAliveInterval` defaults to zero. If you retain cross-invocation persistence, add bounded server-alive settings and test them on the bad link; otherwise one poisoned master can stall every command. [OpenSSH configuration manual](https://man.openbsd.org/ssh_config)
- `forget-key` must terminate the matching master before running `ssh-keygen -R`. Otherwise an existing master bypasses the next host-key check entirely.
- I found no reason to expect `ControlPersist` to keep macOS awake. It leaves one background process, TCP connection, and Unix listener; it does not normally assert a sleep prohibition. I also see no unbounded fd leak in the design. A hung client channel can legitimately keep the master beyond ten minutes, however.

`ControlMaster=auto` itself does not prompt on a non-interactive invocation; `autoask` does. But `auto` can still appear wedged in the live-master/dead-network case above.

## 2. Passing the socket to mosh

**Verdict: it will not work with the installed mosh configuration.**

`--ssh=` accepts an alternate SSH command, but mosh 1.4.0’s default `remote-ip=proxy` mode subsequently appends:

```text
-S none -o ProxyCommand=...
```

`-S none` disables connection sharing. It comes after the supplied `--ssh=` arguments, so it wins. This is visible both in the installed `/opt/homebrew/bin/mosh` and upstream source. [mosh bootstrap source](https://github.com/mobile-shell/mosh/blob/master/scripts/mosh.pl)

Changing to `--experimental-remote-ip=local` or `remote` may avoid that override, but that changes mosh’s address-discovery behaviour. It is not a harmless SSH optimisation and should not enter this plan without separate testing.

Even if multiplexing worked, it only removes the SSH part of the bootstrap. Mosh starts its server through SSH, closes SSH, then establishes UDP. [mosh design](https://github.com/mobile-shell/mosh#how-it-works) Given the measurements—2 seconds for SSH versus 6–7 seconds for mosh—the theoretical saving is roughly 2 seconds per bootstrap, not the full 6–7 seconds.

## 3. The double mosh bootstrap

**Verdict: leaving it alone is defensible for a scoped patch, but then the plan cannot claim to make `shell` fast.**

- A bare UDP “connect” or `nc -u` probe is not honest. UDP has no connection handshake, the mosh port is dynamically allocated, and there is no responder until `mosh-server` has been started with the corresponding key.
- Caching success per network creates a dangerous stale-success case: after a network change, the real mosh invocation can return to retrying forever. Reliably fingerprinting the current network is more machinery than this patch warrants.
- Running the real interactive mosh under a fixed timeout is not sufficient: success is a long-lived process, so the timeout would later kill a healthy session. An automatic fallback needs a way to detect the first successful UDP exchange while preserving terminal control.
- A failure-only cache is safe and could avoid repeated 15-second waits on a known-bad network, but it does nothing for normal-network startup.

My 80–20 recommendation is to keep the probe for now, explicitly record that attach still costs approximately two mosh bootstraps, and make elimination of the double bootstrap separate work. The alternative simplest product decision is “try mosh directly; Greg uses `--ssh` on known-bad networks,” rather than attempting unreliable automatic UDP detection.

I am unsure whether killing `script` on the existing 15-second timeout always reaps its mosh/ssh descendants. Add a process audit to the blocked-UDP smoke test.

## 4. Other wrong, missing, or over-built parts

**Verdict: multiplex before full batching, but fix several omissions first.**

The largest missing issue is `-p -`:

- A heredoc makes `stdin` non-TTY.
- `moshProbe()` therefore deliberately falls back to SSH.
- The subsequent interactive SSH attach inherits an exhausted pipe, not the terminal.
- A single `ssh -t` does not force allocation when there is no local TTY; multiple `-t` options are needed for that case, but stdin would still be the exhausted pipe. [OpenSSH `ssh` manual](https://man.openbsd.org/ssh)

The simple v1 is to require `--no-attach` with `-p -`, show that in the example, and tell the user to run `resume`. Reopening `/dev/tty` for probe and attach is possible, but it is a separate design choice.

Other issues:

- `attachCmd()`’s SSH branch does not use `SSH_OPTS` at all. The fallback attach therefore gets neither multiplexing nor `BatchMode`, `ConnectTimeout`, or `accept-new`.
- The parser must fail closed. Rejecting malformed `created` by silently dropping the session would let `cmdNew()` believe an existing session is absent. Validate `created`, `attached ∈ {0,1}`, `windows`, and provisional status, then surface an error.
- Test the missing colon itself, not only the malformed-output consequence.
- Read stdin before deriving the provisional name; otherwise `-p -` can derive its name from the literal `"-"`.
- Decide explicitly whether empty stdin is an error. Keeping downstream truthiness checks unchanged silently turns an empty prompt into “no prompt.”
- Resolve `host()` once per process rather than invoking `tofu output` for each connection.
- Make live smoke tests use a uniquely named disposable shell session, and kill only that session.

For batching: do not collapse all of `cmdNew` into one heredoc yet. A working command-scoped master already removes repeated authentication. After measuring, the low-risk follow-up is to combine `chmod` and `tmux new-session` into one remote command, and possibly transfer the prompt and job together. Full one-connection batching adds file-framing and error-reporting complexity for perhaps another 1–2 seconds.

## 5. The tmux target

**Verdict: `-t "=name:"` is correct for `display-message`/`display -p`, and correct on tmux 3.4.**

`display-message` takes a `target-pane`. The colon explicitly supplies the session portion and selects its current window/pane; the `=` makes the session match exact. Without `:` tmux is free to interpret the unqualified target according to the target type. [tmux target documentation](https://github.com/tmux/tmux/wiki/Advanced-Use#command-targets)

There is no portability concern for the stated box because it is already verified on 3.4. I would not broaden the claim to unknown older tmux versions without testing.

A cleaner listing implementation is:

```sh
tmux list-sessions -F '#{session_name}|#{session_created}|#{session_attached}|#{session_windows}'
```

That avoids a target altogether. If the loop still needs per-session operations, capture `#{session_id}` and use the immutable `$id:` for target-pane commands. The existing `=$s:` fix is nevertheless sufficient.

## Concrete plan changes, most important first

1. Remove the proposed mosh `--ssh=ControlPath…` step; it is disabled by mosh’s default `-S none`.
2. Replace the 10-minute shared master with a short-path, command-scoped master and explicit cleanup. If persistence remains, add server-alive bounds and a poisoned-master recovery test.
3. Require `%C` for any shared path and include OpenSSH’s extra 17-byte temporary suffix in the macOS length check.
4. Make `forget-key` terminate the matching master first.
5. Define `-p -` as `--no-attach` only for v1, or explicitly add `/dev/tty` reopening as separate work.
6. Apply the common SSH options to the SSH attach, `ssh`, and tunnel paths—not only helper calls.
7. Make malformed tmux output fatal; test both the exact `=name:` builder and strict parsing.
8. Keep full batching deferred, but combine `chmod` and session creation if measurements show multiplexed channel setup still matters.
9. Add smoke cases for concurrent cold starts, a dead socket file, a live-but-dead master, sleep/network change, `forget-key` with a live master, the actual macOS path length, and blocked-UDP descendant cleanup.
10. Rewrite the performance claim: this work should materially speed `new --no-attach` and the pre-attach SSH phase, but it will not remove the dominant double-mosh cost.