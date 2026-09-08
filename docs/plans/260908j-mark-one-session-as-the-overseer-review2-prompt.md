# Review the code built from the plan you already reviewed

You are GPT Sol. You reviewed the PLAN for this work an hour ago and raised P0-1, P0-2, P0-3, P1-1,
P1-2, P1-3, P1-4 and three P2s. This is the code. Weight this review higher than the first: a
plan-stage review cannot find a `PATCH` that writes one field and then rejects the request.

Be adversarial. Rank findings P0 / P1 / P2, and say plainly if it is fine. **Check my claims about
your own earlier findings** — I say below which I took and which I argued with, and I would rather be
told I have described a fix I did not make.

## What this is

The box runs 20–35 Claude Code coding agents in tmux sessions. Exactly one of them is meant to be
"the Overseer", the permanent supervising session. Nothing marked which one. The mechanism: a role
string (`GJD_ROLE=overseer`) in that session's tmux environment, read by the readers that already
read that environment, surfaced in `gjd-remote ls`, in the fleet dashboard's header and rows, and in
`npx tsx scripts/overseer.ts status`.

## What I did with your plan findings

- **P0-1 (a failed role read becomes "no role") — taken, and you were right.** The six per-session
  reads use `tmux show-environment -t "$sid" VAR 2>/dev/null | cut -d= -f2-`, and that exits 1 both
  for an absent variable and for a session that has gone. The role is now read by DUMPING the
  session's own environment (`show-environment -t "$sid"` with no variable), which exits 0 iff the
  session is still there; the field carries `?` when even that failed, and `?` parses to
  `cannot-tell`. Tested with a stubbed `tmux` whose `ls` succeeds and whose dump fails.
  **Note the five OTHER per-session reads still have the shape you objected to** — I left them alone
  as out of scope. Tell me if you think that is wrong.
- **P0-2 (whole-fleet cannot-tell) — taken.** One truth table, in `tools/fleet/overseer-claim.ts`,
  with a `ReadingCompleteness` argument. `contested` beats incompleteness; any uncertainty with 0 or
  1 known holder is `cannot-tell` and NAMES the known holder in its `why`. The dashboard header
  passes `collectedAt === null` and `unreadableRows > 0` as incompleteness.
- **P0-3 (no safe data path for `overseer status`) — taken.** `claimFromSnapshot(body, {nowMs,
  maxAgeMs})` in the same leaf module checks `schema`, `error`, `collectedAt`, age, and drops+counts
  unreadable rows. `scripts/overseer.ts` does the fetch and nothing else. That function is also the
  named API for the scheduler; I told its author so.
- **P1-1 (the race is understated) — taken.** Comment and plan now say *eventual detection, not
  mutual exclusion*, with your A/B/A/B sequence written out, and a test asserts two decisions from
  one snapshot are both allowed.
- **P1-2 (release postcondition) — taken.** Release is allowed while contested (it is the repair) and
  is verified against the TARGET; claim is still verified against the whole box.
- **P1-3 (keep the role outside META) — taken.** Standalone `SESSION_ROLE_ENV`.
- **P1-4 (rename the session instead) — considered and declined, with reasons now in the plan.** I
  verified that `rename-session` onto a taken name fails atomically, so your point about it being
  stronger stands. The reasons for declining: the runbook itself says names are reassigned when a
  session dies and that a session must be addressed by handle rather than name; names are already
  overloaded as the job claim register; and empirically the session WAS already named `Overseer` and
  no reader looked at it. Argue with this if you think it is rationalisation.
- **P2 (base64 vs token) — taken**, the plan now separates undecodable base64 (fails the line) from a
  decoded value that is not a role token (`cannot-tell`).
- **P2 (drop the `other` arm) — declined**, because under the new P0-2 rule an unrecognised role must
  be *known not to be the Overseer*; without `other` one such session would poison the whole box's
  reading for every older `gjd-remote`. Check that reasoning.

## What to look for now

1. **Anything that reports a wrong answer rather than an honest one**, especially any path where a
   failure becomes `none`.
2. The shell. `sed -n 's/^GJD_ROLE=//p' | head -1` on a dumped tmux environment: what values break it,
   and does breaking it fail safe? What about a tmux that prints `-GJD_ROLE` (an unset marker)?
3. `claimFromSnapshot` — anything in that payload I am still trusting that I should not be.
4. The 13→14 field change to `parseSessionLine`. Anything that produces a 13-field line and now
   silently disappears? (`parseSessions` refuses a short listing, so I believe the answer is "nothing
   silently".)
5. The new `scripts/` → `tools/fleet/` import direction. Worth it, or worse than the twin it removes?
6. The tests: which of them could pass while the thing they name is broken?
7. Simplicity. This grew from "a role string in the tmux environment" to a leaf module with an
   aggregate rule and a snapshot reader. Is any of that now more than the job needs?

## Evidence

- `npx tsx scripts/typecheck.ts` exits 0.
- `npx vitest run tests/gjd-remote-overseer-claim.test.ts` — 48 passed.
- `npx vitest run tests/fleet-overseer-badge.test.tsx` — 8 passed.
- Live on the box: `gjd-remote claim-overseer Overseer` succeeded, `ls` grew a `ROLE` column and the
  line `— overseer: 'Overseer'`, and a second `claim-overseer` was refused naming the holder.
- Also live and unplanned: another agent created a session with an invalid `GJD_REPO`, which fails
  the whole listing by pre-existing design, and `overseer status` correctly printed
  `Overseer unknown — the dashboard's last collection failed (…), so its rows are not current`
  instead of naming a stale holder. That is P0-3's behaviour demonstrated by accident.

## The diff, then the three new files in full

diff --git a/docs/project/hetzner-remote-server-box.md b/docs/project/hetzner-remote-server-box.md
index f3dcd7de..17de70f4 100644
--- a/docs/project/hetzner-remote-server-box.md
+++ b/docs/project/hetzner-remote-server-box.md
@@ -29,8 +29,9 @@ and tmux refused the second one; on a box meant to hold many parallel sessions t
 **The CLI**
 
 - [`scripts/gjd-remote.ts`](../../scripts/gjd-remote.ts) — all of it: `ls`, `new-claude`,
-  `new-shell`, `resume`, `resume-all`, `kill`, `log`, `doctor`, `provision`, `clone`, `setup`,
-  `push-env`, `upload`, `resolve`, `ssh`, `tunnel`, `forget-key`. `--help` is long on purpose.
+  `new-shell`, `resume`, `resume-all`, `kill`, `claim-overseer`, `release-overseer`, `log`,
+  `doctor`, `provision`, `clone`, `setup`, `push-env`, `upload`, `resolve`, `ssh`, `tunnel`,
+  `forget-key`. `--help` is long on purpose.
 - [`scripts/gjd-remote-repo.ts`](../../scripts/gjd-remote-repo.ts) — which repo you are standing in,
   and which directory on the box is that same repo. The box-side inventory script and its
   fail-closed parse live here too. See [Which repo, and where on the box](#which-repo-and-where-on-the-box)
@@ -495,6 +496,38 @@ are doing something, and `kill` the ones that are not. Before 2026-09-05 both re
 eight sessions accumulated on the box that nobody could tell apart
 ([§ Sessions nobody made on purpose](#sessions-nobody-made-on-purpose)).
 
+### The `ROLE` column, and the line about the Overseer
+
+The box is meant to have **exactly one Overseer** — the permanent session that supervises all the
+others, [overseer.md](overseer.md). Until 2026-09-08 nothing marked which session that was, so two
+could both believe they were it and neither could find out. Now one session holds a claim:
+
+```
+gjd-remote claim-overseer <name>     # refuses, naming the holder, if somebody else has it
+gjd-remote release-overseer <name>   # or just kill the session
+```
+
+**There is no `--force`.** Releasing is the verb, or the holder dying.
+
+`ls` grows a `ROLE` column only when some session has one — almost none ever will — and **always**
+prints a line under the table saying who the Overseer is, including `no session holds the overseer
+claim`. That absent line is the point of it: the claim is a variable in the session's own tmux
+environment, so it dies with the session **and with the tmux server**, and after a reboot nobody
+holds it. Failing to nobody is the safe direction; a stale claim pointing at a session that is gone
+would be the dangerous one.
+
+**The refusal is a courtesy, not a mutex.** Two claims racing can both pass it. What actually holds
+the line is that every reader — `ls`, the dashboard's header, `overseer status` — reports two
+holders as a fault rather than picking one, so a double claim is *visible* rather than silently
+deciding which session gets prodded. One holder plus one session whose role could not be read is
+also not an answer: it reports as unknown, and names the holder it did see.
+
+A program should ask the dashboard rather than tmux — `claimFromSnapshot` in
+[`tools/fleet/overseer-claim.ts`](../../tools/fleet/overseer-claim.ts), which refuses a stale
+snapshot, one whose collection failed, and one with rows it could not read. The dashboard serves its
+*last good* rows after a failure, so a hand-rolled read of `/api/state` will confidently name an
+Overseer that died an hour ago.
+
 **Two sources, and neither is trusted alone.**
 
 `claude agents --json` prints one record per live session — `sessionId`, `pid`, `cwd`, `status` —
diff --git a/scripts/gjd-remote-tmux.ts b/scripts/gjd-remote-tmux.ts
index 35d2fb2d..e2eae179 100644
--- a/scripts/gjd-remote-tmux.ts
+++ b/scripts/gjd-remote-tmux.ts
@@ -7,6 +7,15 @@
  */
 
 import { REPO_UNKNOWN, isRepoValue } from "./gjd-remote-repo.js";
+/* THE ONE IMPORT OUT OF `scripts/`, and it is a leaf module with no imports of
+   its own — see the re-export below, and `tools/fleet/overseer-claim.ts` for
+   why the Overseer's vocabulary has to be reachable from three places at once. */
+import {
+  OVERSEER_ROLE,
+  type OverseerClaim,
+  type SessionRole,
+  overseerClaim as wireOverseerClaim,
+} from "../tools/fleet/overseer-claim.js";
 
 export type Session = {
   /**
@@ -48,6 +57,13 @@ export type Session = {
   /** Which repo this session is for, and how much of that we are allowed to
    *  believe. See `SessionMeta`. */
   meta: SessionMeta;
+  /**
+   * Whether this session is the Overseer — see `SessionRole`.
+   *
+   * Separate from `meta` because it is set and unset while the session runs,
+   * whereas everything in `meta` is pinned at launch and is all-or-nothing.
+   */
+  role: SessionRole;
 };
 
 /**
@@ -68,6 +84,67 @@ export const META = {
 /** The only metadata version this reader was written against. */
 export const METADATA_VERSION = "1";
 
+/**
+ * **WHICH ROLE A SESSION HOLDS** — deliberately NOT a fifth member of `META`.
+ *
+ * `META` means *the versioned quartet*: four variables pinned at launch, never
+ * changed afterwards, and all-or-nothing (`legacy` is all four absent). Callers
+ * and tests already read `META` as that set. This one is set and unset while the
+ * session runs, on sessions of any vintage, so putting it in there would blur
+ * the one thing that type is for — and it does not bump `METADATA_VERSION`,
+ * which would fail the whole listing for every session alive on the box. GPT
+ * Sol, reviewing the plan for
+ * docs/plans/260908j-mark-one-session-as-the-overseer.md.
+ *
+ * It is read on its own, the way `CLAUDE_SESSION_ID` and `GJD_PROVISIONAL` are.
+ */
+export const SESSION_ROLE_ENV = "GJD_ROLE";
+
+/**
+ * What the role field says when the session's environment could not be read at
+ * all — a session that died between `tmux ls` and the lookup, or a server that
+ * went away underneath us.
+ *
+ * `?` and not an empty field, because an empty field is a session that holds no
+ * role, and those two must never be the same bytes. It is safe as a sentinel
+ * because every other value in that field is base64, which has no `?` in its
+ * alphabet. Same shape as `SessionProc`'s own `?`.
+ */
+export const ROLE_UNREADABLE = "?";
+
+/**
+ * **THE OVERSEER'S CLAIM.** The vocabulary is not declared here.
+ *
+ * The Overseer is one permanent session supervising all the others
+ * (docs/project/overseer.md). Until 2026-09-08 the only thing that made a
+ * session the Overseer was its own belief that it was, which is a fact no other
+ * program could read and two sessions could hold at once. A string in a
+ * session's tmux environment is now the claim, and THIS file is what reads it
+ * off the box — but the words, and the rule for what a listing of them adds up
+ * to, live in [`tools/fleet/overseer-claim.ts`](../tools/fleet/overseer-claim.ts).
+ *
+ * **Imported rather than restated, and that is deliberate after GPT Sol's P0-2
+ * on the plan:** three consumers on two sides of a compilation boundary have to
+ * agree about what *one known holder plus one unreadable row* means, and the
+ * first draft of that rule was already written two different ways in one
+ * afternoon. That module has no imports at all, so it is equally reachable from
+ * here, from the dashboard's node side, and from the browser bundle.
+ */
+export {
+  OVERSEER_ROLE,
+  type OverseerClaim,
+  type SessionRole,
+} from "../tools/fleet/overseer-claim.js";
+
+/**
+ * What a role value is allowed to look like: a short lower-case token.
+ *
+ * Narrow on purpose. The value is interpolated into a shell command by
+ * `setRoleCommand` and printed into a table, and it arrives from a tmux
+ * environment variable, which anybody on the box can set to anything by hand.
+ */
+const ROLE_TOKEN = /^[a-z][a-z0-9-]{0,31}$/;
+
 /**
  * What was started in the session, as the launcher knew it — not as the process
  * table guesses it.
@@ -337,15 +414,24 @@ export const ROW_COUNT = "GJDROWS";
  * pinned into its tmux environment at launch, its name, and the latest title
  * Claude has given the conversation.
  *
- * SIX `show-environment` CALLS PER SESSION, and the four newest are the repo
- * metadata (`META`). They are four more round trips to the local tmux server
- * per row — a few milliseconds each, against the ~1.85s the whole script takes
- * on a box with a dozen sessions — and they are separate calls rather than one
- * dump of the session environment because a variable read by name cannot be
- * mis-attributed to the wrong row by a parse. `pane_current_path` would have
- * cost nothing at all and is not an option: a shell that has `cd`'d elsewhere,
- * or a session started with `--dir ~`, would be attributed to whatever repo is
- * under the cursor.
+ * SEVEN `show-environment` CALLS PER SESSION: the two oldest, the repo metadata
+ * (`META`'s four), and one DUMP of the session environment for the Overseer
+ * claim. They are round trips to the local tmux server per row — a few
+ * milliseconds each, against the ~1.85s the whole script takes on a box with a
+ * dozen sessions.
+ *
+ * The six are separate BY-NAME calls rather than one dump because a variable
+ * read by name cannot be mis-attributed to the wrong row by a parse. **The
+ * seventh is a dump precisely because it needs what by-name cannot give**:
+ * `show-environment -t X VAR` exits 1 both for a variable that is not set and
+ * for a session that is not there, so a by-name read of the claim cannot tell
+ * *this session holds no role* from *this session could not be asked*. The dump
+ * exits 0 iff the session is still there, which separates them. It is still one
+ * session's own environment, so nothing can be mis-attributed across rows.
+ *
+ * `pane_current_path` would have cost nothing at all and is not an option: a
+ * shell that has `cd`'d elsewhere, or a session started with `--dir ~`, would be
+ * attributed to whatever repo is under the cursor.
  *
  * A variable tmux has never been given prints nothing here, and that is what
  * every session started before this existed looks like — see `SessionMeta`,
@@ -509,6 +595,20 @@ export function buildSessionScript(opts: { agents: boolean } = { agents: false }
       mkind=$(tmux show-environment -t "$sid" ${META.kind} 2>/dev/null | cut -d= -f2-)
       mrepo=$(tmux show-environment -t "$sid" ${META.repo} 2>/dev/null | cut -d= -f2-)
       mdir=$(tmux show-environment -t "$sid" ${META.dir} 2>/dev/null | cut -d= -f2-)
+      # THE ROLE IS READ FROM THE WHOLE SESSION ENVIRONMENT, not by name, and
+      # that is the one difference that matters. \`show-environment -t X VAR\`
+      # exits 1 both when the variable is absent AND when the session is gone,
+      # so a by-name read cannot tell "this session holds no claim" from "this
+      # session could not be asked" — and the first is a fact while the second
+      # is an absence. GPT Sol's P0-1 on the plan. Dumping the session's own
+      # environment exits 0 iff the session is still there, so the two come
+      # apart: '?' means we could not look, and anything else is an answer.
+      if renv=$(tmux show-environment -t "$sid" 2>/dev/null); then
+        rval=$(printf '%s\\n' "$renv" | sed -n 's/^${SESSION_ROLE_ENV}=//p' | head -1)
+        mrole=$(printf '%s' "$rval" | base64 -w0)
+      else
+        mrole='${ROLE_UNREADABLE}'
+      fi
       mine=$(printf '%s\\n' "$panes" | awk -v s="$sid" '$1==s { print $2 }')
       if [ -z "$snap" ] || [ -z "$mine" ]; then
         proc='?'
@@ -679,9 +779,9 @@ export function buildSessionScript(opts: { agents: boolean } = { agents: false }
         f=$(ls -1 "$HOME"/.claude/projects/*/"$id".jsonl 2>/dev/null | head -1)
         [ -n "$f" ] && title=$(grep -o '"aiTitle":"[^"]*"' "$f" 2>/dev/null | tail -1 | cut -d'"' -f4)
       fi
-      printf '%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s\\n' "$sid" "$created" "$attached" "$windows" "$prov" \\
+      printf '%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s\\n' "$sid" "$created" "$attached" "$windows" "$prov" \\
         "$id" "$proc" "$(printf '%s' "$name" | base64 -w0)" "$(printf '%s' "$title" | base64 -w0)" \\
-        "$mver" "$mkind" "$mrepo" "$(printf '%s' "$mdir" | base64 -w0)"
+        "$mver" "$mkind" "$mrepo" "$(printf '%s' "$mdir" | base64 -w0)" "$mrole"
     done
     echo ${SESSION_SENTINEL}`;
 }
@@ -809,14 +909,14 @@ const NOT_A_RECORD: ParsedSessionLine = { ok: false, why: null };
  */
 export function parseSessionLine(line: string): ParsedSessionLine {
   const parts = line.split("|");
-  // Exactly thirteen: id, created, attached, windows, provisional, claude id,
-  // wait remaining, name, title, and the four metadata fields. Not "at least
-  // thirteen" — a fourteenth field means the record is not the one this function
-  // was written against, and guessing which is which is how the last two bugs
-  // happened. No free-text field can contribute a separator: the name, the title
-  // and the directory all arrive base64-encoded.
-  if (parts.length !== 13) return NOT_A_RECORD;
-  const [sid, created, attached, windows, prov, claudeId, procField, nameB64, titleB64, mv, mk, mr, mdB64] =
+  // Exactly fourteen: id, created, attached, windows, provisional, claude id,
+  // wait remaining, name, title, the four metadata fields, and the role. Not "at
+  // least fourteen" — a fifteenth field means the record is not the one this
+  // function was written against, and guessing which is which is how the last
+  // two bugs happened. No free-text field can contribute a separator: the name,
+  // the title, the directory and the role all arrive base64-encoded.
+  if (parts.length !== 14) return NOT_A_RECORD;
+  const [sid, created, attached, windows, prov, claudeId, procField, nameB64, titleB64, mv, mk, mr, mdB64, roleB64] =
     parts as [
       string,
       string,
@@ -831,6 +931,7 @@ export function parseSessionLine(line: string): ParsedSessionLine {
       string,
       string,
       string,
+      string,
     ];
 
   // tmux's own session handle: a dollar and digits. Nobody is shown it, but it
@@ -884,6 +985,25 @@ export function parseSessionLine(line: string): ParsedSessionLine {
   const meta = parseMeta({ version: mv, kind: mk, repo: mr, dirB64: mdB64 }, name);
   if (!meta.ok) return meta;
 
+  // THREE OUTCOMES FOR THE ROLE FIELD, and the middle one is the whole reason
+  // the script dumps the environment rather than asking by name:
+  //
+  //  - the sentinel — the session's environment could not be read at all, so we
+  //    do not know whether it holds a claim;
+  //  - undecodable bytes — a broken line, the way an undecodable name is: the
+  //    script always base64s this field, so anything else did not come from the
+  //    script;
+  //  - anything else — a value, which `parseRole` judges without ever failing
+  //    the listing over a word it does not know.
+  let role: SessionRole;
+  if (roleB64 === ROLE_UNREADABLE) {
+    role = { kind: "cannot-tell", why: "this session's environment could not be read, so its role is unknown" };
+  } else {
+    const roleValue = decode(roleB64);
+    if (roleValue === null) return NOT_A_RECORD;
+    role = parseRole(roleValue);
+  }
+
   return {
     ok: true,
     session: {
@@ -899,10 +1019,38 @@ export function parseSessionLine(line: string): ParsedSessionLine {
       claudeId: claudeId === "" ? null : claudeId,
       proc,
       meta: meta.meta,
+      role,
     },
   };
 }
 
+/**
+ * One role value into a `SessionRole`. **Never fails the listing.**
+ *
+ * That is the difference between this and `parseMeta` next door, and it is
+ * deliberate. A metadata version this reader does not know means the launcher
+ * and the reader disagree about the record's shape, so nothing in it can be
+ * trusted. A role it does not know means somebody claimed a role — the record is
+ * fine, one word in it is new. Refusing the listing over that would take down
+ * `ls`, `resume` and `kill` for the whole box, and would do it to whoever is
+ * running the older copy of `gjd-remote`, who is exactly the person least able
+ * to work out why.
+ *
+ * The three non-`none` arms all mean *this session is not the Overseer* unless
+ * the value is `OVERSEER_ROLE` exactly, so nothing here can mint a claim.
+ */
+export function parseRole(value: string): SessionRole {
+  if (value === "") return { kind: "none" };
+  if (value === OVERSEER_ROLE) return { kind: "overseer" };
+  if (ROLE_TOKEN.test(value)) return { kind: "other", name: value };
+  return {
+    kind: "cannot-tell",
+    // The value is not quoted back: it is somebody's environment variable and
+    // this string is printed into a terminal. Its length is the actionable part.
+    why: `${SESSION_ROLE_ENV} is set to something this reader cannot make sense of (${value.length} characters)`,
+  };
+}
+
 /**
  * The four metadata fields into a `SessionMeta`, or a sentence saying which
  * session and which variable made it impossible.
@@ -964,6 +1112,133 @@ export function sessionRepo(s: Session): { text: string; known: boolean } {
   return { text: s.meta.repo, known: true };
 }
 
+/* ------------------------------------------------------------------ *
+ * The Overseer's claim.
+ * ------------------------------------------------------------------ */
+
+/**
+ * Who holds the Overseer claim, across a whole listing.
+ *
+ * **Defined once, in [`tools/fleet/overseer-claim.ts`](../tools/fleet/overseer-claim.ts)**,
+ * so the terminal and the dashboard cannot disagree about what one holder plus
+ * one unreadable row means. This is the thin adaptor from `Session` to the rows
+ * that module works on.
+ */
+export function overseerClaim(list: readonly Session[]): OverseerClaim {
+  return wireOverseerClaim(list.map((s) => ({ id: s.id, name: s.name, role: s.role })));
+}
+
+/**
+ * What `claim-overseer` and `release-overseer` should do, decided before
+ * anything is written.
+ *
+ * A separate function from the command that carries it out so the decision can
+ * be tested against a listing, and so that the refusal — the whole point of the
+ * verb — is not buried in a CLI.
+ */
+export type RoleChange =
+  | { kind: "claim"; id: string; name: string }
+  | { kind: "release"; id: string; name: string }
+  | { kind: "already-yours" }
+  | { kind: "refused"; why: string };
+
+/**
+ * **THE CONTRACT IS EVENTUAL DETECTION, NOT MUTUAL EXCLUSION**, and the
+ * difference is worth being exact about (GPT Sol's P1-1).
+ *
+ * The decision is made against a listing read a moment ago and carried out by a
+ * second tmux call, so this sequence is reachable and this function does not
+ * prevent it: A and B both read no holder; A sets its role; A re-reads and is
+ * satisfied; B sets its role; the box is now contested. The re-read after a
+ * write is not a lock — it narrows the window and catches the ordinary case, and
+ * what actually holds the line is that **every reader reports two holders as a
+ * fault rather than picking one**, so a double claim is visible on the next quiet
+ * read rather than silently deciding which session the scheduler prods.
+ *
+ * That is accepted rather than fixed. A real mutex means a lock file with an
+ * owner pid and a liveness check — the machinery this whole design exists to
+ * avoid — for a verb a person runs about once a week.
+ */
+export function decideClaim(list: readonly Session[], target: string): RoleChange {
+  const found = resolveSession(list, target);
+  if (!found.ok) return { kind: "refused", why: found.why };
+
+  const claim = overseerClaim(list);
+  switch (claim.kind) {
+    case "one":
+      return claim.id === found.session.id
+        ? { kind: "already-yours" }
+        : {
+            kind: "refused",
+            why:
+              `${printableName(claim.name)} already holds the Overseer claim.` +
+              `\n  There is no --force. Release it there first: gjd-remote release-overseer ${printableName(claim.name)}` +
+              `\n  (or kill that session — the claim dies with it).`,
+          };
+    case "contested":
+      return {
+        kind: "refused",
+        why:
+          `${claim.names.length} sessions already claim to be the Overseer: ${claim.names.join(", ")}` +
+          `\n  Release all but one before claiming.`,
+      };
+    case "cannot-tell":
+      // Deliberately not "claim anyway". The unreadable role might be on the
+      // target itself, and overwriting a value nobody has looked at is how a
+      // claim silently replaces something it did not understand.
+      return { kind: "refused", why: `${claim.why}\n  Look at those sessions before claiming.` };
+    case "none":
+      return { kind: "claim", id: found.session.id, name: found.session.name };
+    default: {
+      const never: never = claim;
+      return never;
+    }
+  }
+}
+
+/**
+ * Releasing a session that does not hold the claim is a refusal, never a silent
+ * success — it is otherwise indistinguishable from having released it.
+ *
+ * **It does NOT refuse a contested box, and the postcondition is about the
+ * TARGET.** If two sessions both claim the role, releasing one is the repair,
+ * and demanding that the box end up with zero holders would refuse the very
+ * operation that fixes it — or, worse, call a good release a failure because
+ * the other claimant is still there. GPT Sol's P1-2. So `decideClaim` asks about
+ * the whole box, because a claim is about being the only one, and this one asks
+ * only about the session in front of it.
+ */
+export function decideRelease(list: readonly Session[], target: string): RoleChange {
+  const found = resolveSession(list, target);
+  if (!found.ok) return { kind: "refused", why: found.why };
+  if (found.session.role.kind !== "overseer") {
+    return {
+      kind: "refused",
+      why: `${printableName(found.session.name)} does not hold the Overseer claim, so there was nothing to release.`,
+    };
+  }
+  return { kind: "release", id: found.session.id, name: found.session.name };
+}
+
+/**
+ * The one tmux command that writes or removes a claim.
+ *
+ * THE ID IS QUOTED because tmux's own handles look like shell positional
+ * parameters: an unquoted `$2514` expands to the empty string, and the command
+ * then addresses whatever session tmux considers current — the same trap
+ * `gjd-remote`'s kill path has a comment about.
+ *
+ * Throws rather than returning a refusal on a bad id: every caller gets its id
+ * from a parsed listing, so a value that is not tmux's shape is a programming
+ * error and not a thing a person did.
+ */
+export function setRoleCommand(sessionId: string, role: string | null): string {
+  if (!TMUX_ID.test(sessionId)) throw new Error(`not a tmux session id: ${sessionId}`);
+  if (role === null) return `tmux set-environment -u -t '${sessionId}' ${SESSION_ROLE_ENV}`;
+  if (!ROLE_TOKEN.test(role)) throw new Error(`not a role token: ${role}`);
+  return `tmux set-environment -t '${sessionId}' ${SESSION_ROLE_ENV} '${role}'`;
+}
+
 /**
  * The five shapes the process probe is allowed to have, and nothing else.
  *
diff --git a/scripts/gjd-remote.ts b/scripts/gjd-remote.ts
index 860a96df..68757301 100755
--- a/scripts/gjd-remote.ts
+++ b/scripts/gjd-remote.ts
@@ -55,19 +55,25 @@ import {
 import {
   META,
   METADATA_VERSION,
+  OVERSEER_ROLE,
+  type OverseerClaim,
   type Session,
   type SessionKind,
   type SessionState,
   bindingsVerdict,
   buildBindingsScript,
   buildSessionScript,
+  decideClaim,
+  decideRelease,
   formatWait,
   escapeName,
+  overseerClaim,
   parseSessions,
   printableName,
   resolveSession,
   sessionRepo,
   sessionState,
+  setRoleCommand,
 } from "./gjd-remote-tmux.js";
 import { bootstrapProbeScript, buildProvisionRunner, cloudInitGate, provisionVerdict } from "./gjd-remote-provision.js";
 import { declaredServers, mcpVerdict } from "./gjd-remote-mcp.js";
@@ -2131,6 +2137,113 @@ const visibleWidth = (s: string) => s.replace(SGR, "").length;
 
 const padVisible = (s: string, width: number) => s + " ".repeat(Math.max(0, width - visibleWidth(s)));
 
+/**
+ * What the ROLE column says about one session, and `""` for the great majority
+ * that hold no role at all.
+ *
+ * `?` for a role we could not read: it is not nothing, and a blank cell would
+ * claim it was.
+ */
+function roleCell(s: Session): string {
+  switch (s.role.kind) {
+    case "none":
+      return "";
+    case "overseer":
+      return OVERSEER_ROLE;
+    case "other":
+      return s.role.name;
+    case "cannot-tell":
+      return "?";
+    default: {
+      const never: never = s.role;
+      return never;
+    }
+  }
+}
+
+/**
+ * One line saying who is the Overseer — **including when nobody is**.
+ *
+ * Shared by `ls` and by the claim verbs so that the sentence a person reads
+ * after claiming is the same sentence `ls` will show them a minute later. There
+ * must be exactly one Overseer on the box (docs/project/overseer.md); two is a
+ * fault to shout about and never to pick from.
+ */
+function claimLine(claim: OverseerClaim): string {
+  switch (claim.kind) {
+    case "one":
+      return `${dim("overseer:")} ${cyan(printableName(claim.name))}`;
+    case "none":
+      return dim("no session holds the overseer claim");
+    case "contested":
+      return red(`${claim.names.length} sessions claim to be the overseer: ${claim.names.join(", ")}`);
+    case "cannot-tell":
+      return red(`overseer: ${claim.why}`);
+    default: {
+      const never: never = claim;
+      return never;
+    }
+  }
+}
+
+/**
+ * Mark one live session as the Overseer, or let go of the claim.
+ *
+ * **THE READ AFTERWARDS IS NOT DECORATION.** The refusal is decided against a
+ * listing taken a moment ago and then carried out by a second tmux call, so two
+ * claims racing can both pass it — see `decideClaim`. Re-reading turns that from
+ * a silent double-claim into a sentence on screen, which is the whole of what
+ * this design promises: not that a race cannot happen, but that it cannot happen
+ * quietly.
+ */
+function cmdRole(action: "claim" | "release", name: string | undefined): void {
+  if (!name) die(`usage: gjd-remote ${action}-overseer <name>`);
+  const before = sessions();
+  const verdict = action === "claim" ? decideClaim(before, name) : decideRelease(before, name);
+
+  // Before the switch rather than in it: `die` never returns, so a `case` for it
+  // is either unreachable code or a value returned from a void function, and
+  // there is no spelling of it that tsc and biome both accept.
+  if (verdict.kind === "refused") die(verdict.why);
+
+  switch (verdict.kind) {
+    case "already-yours":
+      console.log(green(`✓ ${printableName(name)} already holds the overseer claim`));
+      return;
+    case "claim":
+    case "release": {
+      ssh(setRoleCommand(verdict.id, verdict.kind === "claim" ? OVERSEER_ROLE : null));
+      appendLog({ cmd: `${action}-overseer`, name: verdict.name });
+      const list = sessions();
+      const after = overseerClaim(list);
+      // TWO DIFFERENT POSTCONDITIONS, because the two verbs promise different
+      // things. A claim promises *this session and no other*, so it is checked
+      // against the whole box. A release promises only *this session no longer
+      // holds it* — checked against the target, because releasing one of two
+      // claimants is the repair for a contested box and would otherwise be
+      // reported as a failure. GPT Sol's P1-2.
+      const wanted =
+        verdict.kind === "claim"
+          ? after.kind === "one" && after.id === verdict.id
+          : list.find((s) => s.id === verdict.id)?.role.kind !== "overseer";
+      // Reported as a warning rather than a success, and non-zero, because the
+      // interesting case is somebody else claiming it in the same second.
+      if (!wanted) {
+        console.error(red(`✗ the ${action} was sent, and the box does not now say what it should`));
+        console.error(`  ${claimLine(after)}`);
+        process.exit(1);
+      }
+      console.log(green(`✓ ${verdict.kind === "claim" ? "claimed" : "released"} by ${printableName(verdict.name)}`));
+      console.log(dim("— ") + claimLine(after));
+      return;
+    }
+    default: {
+      const never: never = verdict;
+      throw new Error(`unhandled role change: ${JSON.stringify(never)}`);
+    }
+  }
+}
+
 function cmdLs(): void {
   const { list: raw, agents, agentsWhy } = fleet({ agents: true });
   const list = adoptTitles(raw);
@@ -2167,20 +2280,35 @@ function cmdLs(): void {
   // column ragged.
   const rw = Math.max(4, ...list.map((s) => sessionRepo(s).text.length));
   const sw = Math.max(5, ...rows.map((r) => visibleWidth(r.label.text)));
-  console.log(bold(`${"NAME".padEnd(w)}  ${"REPO".padEnd(rw)}  AGE   ATT  ${"STATE".padEnd(sw)}  TITLE`));
+  // A COLUMN ONLY WHEN THERE IS SOMETHING IN IT. Almost every session on the box
+  // holds no role, so an unconditional column would be a stripe of dashes down
+  // the page for the one day in a hundred when it says something. The absent
+  // state is not lost by hiding it: the claim line under the table always says
+  // whether anybody holds it.
+  const oww = Math.max(0, ...list.map((s) => roleCell(s).length));
+  const ow = oww === 0 ? 0 : Math.max(4, oww);
+  const roleHead = ow === 0 ? "" : `${"ROLE".padEnd(ow)}  `;
+  console.log(bold(`${"NAME".padEnd(w)}  ${"REPO".padEnd(rw)}  ${roleHead}AGE   ATT  ${"STATE".padEnd(sw)}  TITLE`));
   for (const { s, label } of rows) {
     // Dimmed when it is not a real answer, the same treatment the empty TITLE
     // cell gets: a session started before the metadata existed, or against an
     // arbitrary --dir, cannot be attributed to a repo and should not look like
     // it has been.
     const repo = sessionRepo(s);
+    const role = roleCell(s);
     console.log(
       `${nameOf(s).padEnd(w)}  ${padVisible(repo.known ? repo.text : dim(repo.text), rw)}  ` +
+        (ow === 0 ? "" : `${padVisible(role === OVERSEER_ROLE ? cyan(role) : dim(role), ow)}  `) +
         `${age(s.created).padEnd(4)}  ${s.attached ? green("yes") : dim(" no")}  ` +
         `${padVisible(label.text, sw)}  ${s.title ? s.title : dim("(no title yet)")}`,
     );
   }
   if (rows.length > 1) console.log(dim("— ") + stateSummary(rows.map((r) => r.state)));
+  // ALWAYS printed, including when nobody holds it. "No session is the
+  // Overseer" is the state that most needs saying out loud: it is what a box
+  // looks like after a reboot, and a blank line where the answer should be
+  // reads exactly like a box that is fine.
+  console.log(dim("— ") + claimLine(overseerClaim(list)));
 
   // Every `unknown` carries a reason, and the first version threw them away —
   // so a row said `! unknown` and there was nowhere to find out why. Printed
@@ -5175,6 +5303,15 @@ ${bold("SESSIONS")}
   resume-all              one new iTerm tab per session, each attached to its own
       --include-attached    take over sessions something else is already in
   kill <name>             end a session ${dim("— any name ls shows, made by this tool or not")}
+  claim-overseer <name>   mark that session as ${bold("the Overseer")}, of which the box has
+                          exactly one ${dim("(docs/project/overseer.md)")}
+                          Refuses, naming the holder, if another live session
+                          already holds it. ${bold("There is no --force")} — release it
+                          there, or kill that session. The claim is a variable in
+                          the session's tmux environment, so it dies with the
+                          session and with the tmux server: after a reboot NO
+                          session is the Overseer, which ${dim("ls")} says out loud.
+  release-overseer <name> let go of the claim, leaving the session running
   log                     every session launched from here, and whether it ran
       --lost                only the ones that never started ${dim("— the reboot case")}
       --limit N             how many rows ${dim("(default 40)")}
@@ -5631,6 +5768,10 @@ async function main(): Promise<void> {
       return;
     }
 
+    case "claim-overseer":
+    case "release-overseer":
+      return cmdRole(cmd === "claim-overseer" ? "claim" : "release", positionalName(rest));
+
     case "new-shell": {
       const { values, positionals } = parseArgs({
         args: rest,
diff --git a/scripts/overseer.ts b/scripts/overseer.ts
index eef1214e..d10bcdd5 100644
--- a/scripts/overseer.ts
+++ b/scripts/overseer.ts
@@ -38,6 +38,7 @@ import { describeRuleOutcome } from "../tools/overseer/rules.js";
 import type { ProposingRuleWork } from "../tools/overseer/scheduler.js";
 import { describeStandingJobs, standingJobs } from "../tools/overseer/standing-jobs.js";
 import type { AttentionList } from "../tools/fleet/wire.js";
+import { type OverseerClaim, claimFromSnapshot, describeClaim } from "../tools/fleet/overseer-claim.js";
 import type { OverseerEvent } from "../tools/overseer/diff.js";
 import type { AuthorisedJob } from "../tools/overseer/jobs.js";
 import { describeNote, openConditions, readNotes, type DaemonNote } from "../tools/overseer/notes.js";
@@ -304,7 +305,56 @@ export function describeEvent(event: OverseerEvent): string {
  * anything wrong, and only then the fleet — because the register is the part
  * that looks fine when everything above it is broken.
  */
-export function statusLines(root: string, nowMs: number = Date.now()): string[] {
+/**
+ * **WHO HOLDS THE OVERSEER CLAIM**, asked of the dashboard rather than of tmux.
+ *
+ * The dashboard is the one collector on this box
+ * (docs/project/overseer-direction.md § Two tenses), so this reads its snapshot
+ * instead of growing a second inventory — which is also why it can fail, and why
+ * failing has to produce `cannot-tell` rather than *no Overseer*. A supervisor
+ * that reports "nobody is in charge" because it could not reach a web server is
+ * the exact substitution this whole area keeps writing comments about.
+ *
+ * Not in `statusLines`, which is synchronous and file-only by design: the claim
+ * is passed in, so the printing stays testable without a server.
+ */
+export async function readOverseerClaim(
+  baseUrl: string,
+  opts: { nowMs?: number; maxAgeMs?: number; fetchImpl?: typeof fetch } = {},
+): Promise<OverseerClaim> {
+  const fetchImpl = opts.fetchImpl ?? fetch;
+  try {
+    const response = await fetchImpl(`${baseUrl}/api/state`);
+    if (!response.ok) {
+      return { kind: "cannot-tell", why: `the dashboard answered ${response.status} for /api/state` };
+    }
+    // EVERY judgement about the payload — schema, a failed collection, an
+    // uncollected one, staleness, unreadable rows — is `claimFromSnapshot`'s,
+    // so this function's whole job is the network and its failures.
+    return claimFromSnapshot(await response.json(), {
+      nowMs: opts.nowMs ?? Date.now(),
+      maxAgeMs: opts.maxAgeMs ?? CLAIM_MAX_SNAPSHOT_AGE_MS,
+    });
+  } catch (cause) {
+    return {
+      kind: "cannot-tell",
+      why: `the dashboard could not be reached at ${baseUrl} (${cause instanceof Error ? cause.message : String(cause)})`,
+    };
+  }
+}
+
+/**
+ * How stale a snapshot may be before this reading stops trusting who it names.
+ *
+ * The dashboard collects on a chain roughly every 60 seconds and backs off 5×
+ * after a failure, so a healthy box is never more than a couple of cadences
+ * behind. Five minutes is several missed collections — long enough that a
+ * momentarily-busy box does not produce an alarm, short enough that a session
+ * killed since is unlikely to still be named.
+ */
+export const CLAIM_MAX_SNAPSHOT_AGE_MS = 5 * 60_000;
+
+export function statusLines(root: string, nowMs: number = Date.now(), claim?: OverseerClaim): string[] {
   requireAbsoluteRoot(root);
   const read = readCheckpoint(root);
   const checkpoint = read.kind === "checkpoint" ? read.checkpoint : null;
@@ -357,6 +407,18 @@ export function statusLines(root: string, nowMs: number = Date.now()): string[]
     }
   }
 
+  // WHO THE OVERSEER IS, ON ITS OWN LINE AND ALWAYS PRESENT. The box is meant
+  // to have exactly one, the claim dies with the tmux server, and nothing else
+  // on this page would notice — a daemon can be perfectly alive with no session
+  // holding the role. `not asked` is a fourth state and is not `none`: it is
+  // what a caller that did not look produces, and reading it as "nobody" would
+  // be the same substitution the source line above refuses to make.
+  lines.push(
+    claim === undefined
+      ? "overseer    not asked — this reading did not query the dashboard"
+      : `overseer    ${describeClaim(claim)}`,
+  );
+
   const open = openConditions(notes.notes);
   if (open.length === 0) lines.push("conditions  all clear");
   for (const condition of open) {
@@ -744,7 +806,7 @@ async function main(argv: readonly string[]): Promise<number> {
 
   switch (command) {
     case "status":
-      console.log(statusLines(root).join("\n"));
+      console.log(statusLines(root, Date.now(), await readOverseerClaim(fleetUrl(process.env))).join("\n"));
       return 0;
     case "events": {
       const tail = readEventTail(root, Number(flag(argv, "--limit") ?? 40));
diff --git a/tests/fleet-collect.test.ts b/tests/fleet-collect.test.ts
index 466f126d..b039d7ef 100644
--- a/tests/fleet-collect.test.ts
+++ b/tests/fleet-collect.test.ts
@@ -57,6 +57,7 @@ function session(over: Partial<Session> = {}): Session {
     claudeId: "f1ee7000-0000-4000-8000-000000000001",
     proc: { kind: "claude" },
     meta: { version: 1, kind: "claude", repo: "spideryarn/reading2", dir: "/home/greg/code/spideryarn2" },
+    role: { kind: "none" },
     ...over,
   };
 }
diff --git a/tests/fleet-drain.test.ts b/tests/fleet-drain.test.ts
index 24f165fb..02b77609 100644
--- a/tests/fleet-drain.test.ts
+++ b/tests/fleet-drain.test.ts
@@ -69,6 +69,7 @@ function row(over: Partial<FleetRow> = {}): FleetRow {
     repo: null,
     worktree: null,
     meta: { version: "legacy" },
+    role: { kind: "none" },
     startedAt: "2026-09-08T00:00:00.000Z",
     /* The arm the collector produces before `readPauses` has run. Not `none`:
        a fixture is in no position to claim we looked everywhere. */
diff --git a/tests/fleet-refresh.test.ts b/tests/fleet-refresh.test.ts
index efd0b831..de3c8b42 100644
--- a/tests/fleet-refresh.test.ts
+++ b/tests/fleet-refresh.test.ts
@@ -56,6 +56,7 @@ function row(over: Partial<FleetRow> = {}): FleetRow {
     repo: null,
     worktree: null,
     meta: { version: "legacy" },
+    role: { kind: "none" },
     startedAt: "2026-09-08T00:00:00.000Z",
     /* The arm the collector produces before `readPauses` has run. Not `none`:
        a fixture is in no position to claim we looked everywhere. */
diff --git a/tests/fleet-status.test.ts b/tests/fleet-status.test.ts
index 98188633..d8f57e1e 100644
--- a/tests/fleet-status.test.ts
+++ b/tests/fleet-status.test.ts
@@ -30,6 +30,7 @@ function session(over: Partial<Session> = {}): Session {
     claudeId: CLAUDE_ID,
     proc: { kind: "claude" },
     meta: { version: 1, kind: "claude", repo: "spideryarn/reading2", dir: "/home/greg/code/spideryarn2" },
+    role: { kind: "none" },
     ...over,
   };
 }
diff --git a/tests/fleet-web.test.tsx b/tests/fleet-web.test.tsx
index 6d33d09b..7eafd472 100644
--- a/tests/fleet-web.test.tsx
+++ b/tests/fleet-web.test.tsx
@@ -171,6 +171,7 @@ function row(over: Partial<FleetState["rows"][number]> & { id: string }): FleetS
       cause: "rate-limits-not-collected",
     },
     meta: { version: "legacy" },
+    role: { kind: "none" },
     panePid: null,
     claudeSessionId: null,
     rawStatus: over.status ?? { kind: "idle" },
diff --git a/tests/gjd-remote-tmux.test.ts b/tests/gjd-remote-tmux.test.ts
index 802bb001..7518c94f 100644
--- a/tests/gjd-remote-tmux.test.ts
+++ b/tests/gjd-remote-tmux.test.ts
@@ -67,6 +67,10 @@ const row = (
     kind: string;
     repo: string;
     dir: string;
+    /** The Overseer claim, empty for the overwhelming majority of sessions.
+     *  Encoded here the way the remote script encodes it — see
+     *  tests/gjd-remote-overseer-claim.test.ts, which is where it is exercised. */
+    role: string;
   }> = {},
 ) =>
   [
@@ -83,6 +87,7 @@ const row = (
     o.kind ?? "claude",
     o.repo ?? "gregdetre/reading2",
     b64(o.dir ?? "/home/greg/code/spideryarn2"),
+    b64(o.role ?? ""),
   ].join("|");
 
 /**
@@ -102,6 +107,13 @@ const parsed = (line: string): Session | null => {
  * What the box really printed on 2026-09-01, tmux 3.4, claude 2.1.251, verbatim
  * but for the agents blob, which is trimmed to the three sessions below.
  *
+ * **One edit since, named rather than quietly absorbed**, because the value of
+ * this fixture is that it is a real capture: each row gained a fourteenth field
+ * on 2026-09-08 when the Overseer claim was added, and it is empty on all four
+ * because none of these sessions was the Overseer — the role did not exist. A
+ * record from before that field is refused outright by `parseSessionLine`, which
+ * is the point of the exact field count.
+ *
  * Three states in one reply, and they are the three worth having: a session
  * Claude Code calls `waiting` — parked on a permission prompt nobody has
  * answered — one it calls `busy`, and one that is not in the agents list at all
@@ -115,10 +127,10 @@ const AGENTS_JSON = JSON.stringify([
 
 const REAL = reply(
   [
-    "$36|1788194293|1|1|0|3c67234f-2da6-4208-8473-9b5ee58be82a|claude|ZGF0YWJhc2UtbW92ZS1jb21wbGV0aW9u|RGF0YWJhc2UgbW92ZSBjb21wbGV0aW9u||||",
-    "$81|1788259262|1|1|0|49348111-df07-44ac-a204-f2e168f46de5|claude|Z2pkLXJlbW90ZS1scy1zdGF0dXMtaW5kaWNhdG9ycw==|Z2pkLXJlbW90ZSBscyBzdGF0dXMgaW5kaWNhdG9ycw==||||",
-    "$78|1788259066|0|1|1|7d9a25bf-ef51-425f-9ec5-65ada264eb4c|wait:13335|cnVuLWdpdC1jb21taXQtY2hhbmdlcy1tZC10aGVuLXB1bGw=|||||",
-    "$77|1788246895|1|1|0|70852e00-cc1b-4218-9106-4f7b17eb6e34|claude|d29ya3RyZWVzLW1pZ3JhdGlvbi1oaXN0b3J5|V29ya3RyZWVzIG1pZ3JhdGlvbiBoaXN0b3J5||||",
+    "$36|1788194293|1|1|0|3c67234f-2da6-4208-8473-9b5ee58be82a|claude|ZGF0YWJhc2UtbW92ZS1jb21wbGV0aW9u|RGF0YWJhc2UgbW92ZSBjb21wbGV0aW9u|||||",
+    "$81|1788259262|1|1|0|49348111-df07-44ac-a204-f2e168f46de5|claude|Z2pkLXJlbW90ZS1scy1zdGF0dXMtaW5kaWNhdG9ycw==|Z2pkLXJlbW90ZSBscyBzdGF0dXMgaW5kaWNhdG9ycw==|||||",
+    "$78|1788259066|0|1|1|7d9a25bf-ef51-425f-9ec5-65ada264eb4c|wait:13335|cnVuLWdpdC1jb21taXQtY2hhbmdlcy1tZC10aGVuLXB1bGw=||||||",
+    "$77|1788246895|1|1|0|70852e00-cc1b-4218-9106-4f7b17eb6e34|claude|d29ya3RyZWVzLW1pZ3JhdGlvbi1oaXN0b3J5|V29ya3RyZWVzIG1pZ3JhdGlvbiBoaXN0b3J5|||||",
   ],
   [`${AGENTS_OK} ${Buffer.from(AGENTS_JSON, "utf8").toString("base64")}`],
 );
@@ -378,6 +390,7 @@ describe("sessionState", () => {
     claudeId: UUID,
     proc: { kind: "claude" },
     meta: { version: 1, kind: "claude", repo: "gregdetre/reading2", dir: "/home/greg/code/spideryarn2" },
+    role: { kind: "none" },
     ...o,
   });
   const agents = (status: string) => new Map([[UUID, status]]);
@@ -1317,6 +1330,7 @@ describe("resolveSession", () => {
     claudeId: null,
     proc: { kind: "none" },
     meta: { version: "legacy" },
+    role: { kind: "none" },
   });
   const live = [s("gateA", "$1"), s("stageDbase", "$2"), s("spideryarn-ui-top-bar-cleanup", "$3")];
 
diff --git a/tools/fleet/collect.ts b/tools/fleet/collect.ts
index badbc015..404d7ea4 100644
--- a/tools/fleet/collect.ts
+++ b/tools/fleet/collect.ts
@@ -26,6 +26,7 @@ import {
   parseSessions,
   type Session,
   type SessionMeta,
+  type SessionRole,
 } from "../../scripts/gjd-remote-tmux.js";
 import { capturePane, parsePane, readPaneMode, type PaneAutoMode, type PaneQuestion } from "./pane.js";
 import { statusesOf, type FleetStatus } from "./status.js";
@@ -67,6 +68,18 @@ export type FleetRow = {
    * writing comments about.
    */
   meta: SessionMeta;
+  /**
+   * **WHETHER THIS SESSION IS THE OVERSEER**, and the box must have exactly one
+   * (docs/project/overseer.md). See `SessionRole` in scripts/gjd-remote-tmux.ts:
+   * it is a union rather than a nullable string because *nobody holds it* and
+   * *we could not look* are different facts, and this payload is read by things
+   * that decide whether to prod the Overseer.
+   *
+   * The claim lives in the session's own tmux environment, so it dies with the
+   * session and with the tmux server: after a reboot, no row carries it, which
+   * is the honest answer rather than a stale one.
+   */
+  role: SessionRole;
   startedAt: string;
   /**
    * What the session is doing. A union, never a bare string, and `unknown`
@@ -339,6 +352,7 @@ export function toRows(
       repo: s.meta.version === 1 ? s.meta.repo : null,
       worktree: s.meta.version === 1 ? worktreeOf(s.meta.dir) : null,
       meta: s.meta,
+      role: s.role,
       startedAt: s.created.toISOString(),
       paneId: panes.get(s.id)?.paneId ?? null,
       panePid: panes.get(s.id)?.panePid ?? null,
diff --git a/tools/fleet/web/src/Header.tsx b/tools/fleet/web/src/Header.tsx
index eae805c4..afffc52f 100644
--- a/tools/fleet/web/src/Header.tsx
+++ b/tools/fleet/web/src/Header.tsx
@@ -31,7 +31,8 @@ import type { ReactNode } from "react";
 
 import { Explain, type Tip } from "./Tooltip";
 import { Button, cx } from "./ui";
-import type { FleetState } from "./types";
+import { type FleetState, overseerClaim } from "./types";
+import { COMPLETE } from "../../overseer-claim.js";
 import { clockNote, collectedAge, formatDuration, tally } from "./view";
 
 /**
@@ -233,6 +234,60 @@ function Count({ n, label, className }: { n: number; label: string; className?:
  */
 export const SHELL = "tw:mx-auto tw:w-full tw:max-w-[96rem] tw:px-[calc(0.75rem+var(--safe-left))]";
 
+/**
+ * The Overseer line: which session holds the claim, or that none does.
+ *
+ * **FOUR STATES AND NONE OF THEM IS BLANK.** *No Overseer session* is not the
+ * absence of news — it is what the box looks like after a reboot, since the
+ * claim dies with the tmux server, and it is the state the scheduler that prods
+ * the Overseer has to be able to see. Two claimants is a fault and is drawn in
+ * the alarm colour: picking one of them is how two sessions both go on believing
+ * they are it.
+ */
+function OverseerLine({ state }: { state: FleetState }): ReactNode {
+  /* **THE ROWS ARE NOT THE WHOLE STORY, and a short list must not pass as a
+     complete one.** Two things can hide the holder from this page: a payload
+     from before the first collection has no rows at all, which is not a box with
+     no Overseer; and `parseFleetState` DROPS rows it cannot read and counts
+     them, and the malformed row is as likely as any to be the holder's. Both go
+     in as incompleteness so the answer degrades to *unknown* rather than to a
+     confident *no Overseer session*. GPT Sol's P0-2. */
+  const claim = overseerClaim(
+    state.rows,
+    state.collectedAt === null
+      ? { ok: false, why: "no collection has finished yet" }
+      : state.unreadableRows > 0
+        ? { ok: false, why: `${state.unreadableRows} session row(s) in this payload could not be read` }
+        : COMPLETE,
+  );
+  switch (claim.kind) {
+    case "one":
+      return (
+        <p className="tw:mt-0.5 tw:text-[12px] tw:text-ink-soft">
+          Overseer: <span className="tw:font-semibold tw:text-ink">{claim.name}</span>
+        </p>
+      );
+    case "none":
+      return <p className="tw:mt-0.5 tw:text-[12px] tw:text-ink-faint">no Overseer session</p>;
+    case "contested":
+      return (
+        <p className="tw:mt-0.5 tw:text-[12px] tw:font-semibold tw:text-alarm">
+          {claim.names.length} sessions claim to be the Overseer: {claim.names.join(", ")}
+        </p>
+      );
+    case "cannot-tell":
+      return (
+        <p className="tw:mt-0.5 tw:text-[12px] tw:font-semibold tw:text-alarm">
+          Overseer unknown — {claim.why}
+        </p>
+      );
+    default: {
+      const never: never = claim;
+      return never;
+    }
+  }
+}
+
 export function Header({
   state,
   fresh,
@@ -295,6 +350,16 @@ export function Header({
           </Explain>
         </div>
 
+        {/* **WHO IS THE OVERSEER, INCLUDING WHEN NOBODY IS.** The box is meant
+            to have exactly one supervising session (docs/project/overseer.md),
+            and the claim lives in that session's tmux environment — so a reboot
+            leaves nobody holding it and nothing else on this page would say so.
+            *No Overseer session* is therefore the state this line exists for,
+            and it is drawn as loudly as the other three rather than as an empty
+            space. Suppressed only before the first payload arrives, where every
+            answer would be a guess. */}
+        {state === null ? null : <OverseerLine state={state} />}
+
         {/* Its own row rather than another item in the wrap above, so that on a
             phone it never lands between the tally and the age and pushes the
             one number this page is read for onto a second line. */}
diff --git a/tools/fleet/web/src/SessionsPanel.tsx b/tools/fleet/web/src/SessionsPanel.tsx
index 9a3f6d64..cec832a9 100644
--- a/tools/fleet/web/src/SessionsPanel.tsx
+++ b/tools/fleet/web/src/SessionsPanel.tsx
@@ -128,6 +128,19 @@ function SessionCard({
             "finished" or "blocked and nobody has noticed". It renders nothing
             when there is nothing to say. PauseLine.tsx has the reasoning. */}
         <PauseLine pause={row.pause} status={row.status} now={now} />
+        {/* THE OVERSEER'S BADGE. Drawn only for the one session that holds the
+            claim — the header carries the absent state, which is the one a
+            per-row badge structurally cannot show. Nothing is drawn for a role
+            this page does not know: it is not the Overseer, and a badge for it
+            would read as one. */}
+        {row.role.kind === "overseer" ? (
+          <span
+            className="tw:rounded tw:bg-ink/10 tw:px-1.5 tw:py-0.5 tw:text-[11px] tw:font-semibold tw:tracking-wide tw:uppercase tw:text-ink-soft"
+            title="This session holds the Overseer claim — the box has exactly one."
+          >
+            Overseer
+          </span>
+        ) : null}
         <Uptime row={row} now={now} className="tw:ml-auto" />
       </div>
 
diff --git a/tools/fleet/web/src/types.ts b/tools/fleet/web/src/types.ts
index ac849a2c..7bfc86c2 100644
--- a/tools/fleet/web/src/types.ts
+++ b/tools/fleet/web/src/types.ts
@@ -33,6 +33,7 @@
  * module exists to prevent.
  */
 import { readAttemptClock, type AttemptClock } from "../../attempt-clock.js";
+import { overseerClaim, parseRole, type SessionRole } from "../../overseer-claim.js";
 import type {
   AttentionAnswerability,
   AttentionEvidence,
@@ -194,6 +195,19 @@ export type FleetPermissionMode =
  */
 export type SessionMeta = { version: "legacy" } | { version: 1; kind: string | null; repo: string | null; dir: string | null };
 
+/**
+ * Whether a session is the Overseer — the box's one supervising session
+ * (docs/project/overseer.md).
+ *
+ * **NOT RESTATED HERE.** `tools/fleet/overseer-claim.ts` is a leaf module with
+ * no imports, so this project can compile it — the same escape `attempt-clock.ts`
+ * takes, and it means the parse and the *who holds it* rule are one
+ * implementation rather than a twin the compiler could not relate. Re-exported
+ * so that a component reads its types from one place.
+ */
+export type { OverseerClaim, SessionRole } from "../../overseer-claim.js";
+export { overseerClaim, parseRole };
+
 /** One session. Flat, because it is rendered and it is JSON. */
 export type FleetRow = {
   /** tmux's SESSION handle, `$1643` — the address, and stable across renames. */
@@ -219,6 +233,8 @@ export type FleetRow = {
   pause: Pause;
   /** What the session recorded about itself. See `SessionMeta`. */
   meta: SessionMeta;
+  /** Whether this session is the Overseer. See `SessionRole`. */
+  role: SessionRole;
   /**
    * The pane's own pid, when tmux told us — `#{pane_pid}`.
    *
@@ -987,6 +1003,7 @@ export function parseRow(v: unknown, skew: ClockSkew): FleetRow | null {
     permissionMode: parsePermissionMode(v["permissionMode"]),
     pause: parsePause(v["pause"], skew),
     meta: parseMeta(v["meta"]),
+    role: parseRole(v["role"]),
     panePid:
       typeof v["panePid"] === "number" && Number.isSafeInteger(v["panePid"]) && v["panePid"] > 0
         ? v["panePid"]
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
 * Three consumers, on two sides of a compilation boundary. `wire.ts` cannot hold
 * it, because a `const` there would be bundled into the browser and that file's
 * whole job is to be free of anything but types. `collect.ts` cannot hold it,
 * because it reaches `node:child_process` and the client project has no node
 * types. A leaf module with no imports has neither problem — the argument
 * `attempt-clock.ts` makes at length, and the same discipline applies:
 *
 * **No imports, and this file must never acquire one.**
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
 * The role string itself.
 *
 * **THIS IS THE WIRE-SIDE TWIN of `OVERSEER_ROLE` in
 * scripts/gjd-remote-tmux.ts**, and not an import of it, for the reason above:
 * that module reaches `node:child_process` and the browser cannot compile it.
 * The twin is the same trade this client already makes for `SessionMeta`,
 * `FleetStatus` and `PauseUnknownCause` — and unlike those, a divergence here
 * would be silent and total, so `tests/gjd-remote-overseer-claim.test.ts`
 * asserts the two are equal. A copy nothing compares is a copy that stops
 * matching.
 */
export const OVERSEER_ROLE = "overseer";

/**
 * Whether a session holds a role, or an admission that we could not tell.
 *
 * The same four arms as `SessionRole` in scripts/gjd-remote-tmux.ts, which is
 * where a role is read off the box. This is the one the payload carries.
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

/** What a whole snapshot says about the claim. See the header for why `none` and `contested` matter. */
export type OverseerClaim =
  | { kind: "none" }
  | { kind: "one"; name: string; id: string }
  | { kind: "contested"; names: string[] }
  | { kind: "cannot-tell"; why: string };

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
 * Whether the reading this claim is computed from was complete.
 *
 * **A ROW LIST IS NOT A SNAPSHOT.** The dashboard drops rows it cannot parse and
 * counts them; it serves the last good rows after a collection fails; and before
 * the first collection it has no rows at all, which is not a box with no
 * sessions. Any of those can hide the holder, so the caller has to say what it
 * is handing over rather than let a short list pass as a complete one.
 *
 * `ok: false` does not mean the answer is thrown away — a `contested` reading is
 * still `contested`, because two known holders are two known holders however
 * much else went missing. It means a *quiet* answer cannot be trusted.
 */
export type ReadingCompleteness = { ok: true } | { ok: false; why: string };

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
  if (holders.length > 1) return { kind: "contested", names: holders.map((r) => r.name).sort() };

  const held = holders[0];
  /* The known holder's name is carried into every `cannot-tell` below, so a
     caller that only wants somebody to prod keeps the address. What it has lost
     is the guarantee that there is nobody else, which is the thing in doubt. */
  const but = held === undefined ? "nobody visibly holds the claim, but" : `${held.name} holds the claim, but`;

  if (!completeness.ok) return { kind: "cannot-tell", why: `${but} ${completeness.why}` };

  const murky = rows.filter((r) => r.role.kind === "cannot-tell");
  const first = murky[0];
  if (first !== undefined && first.role.kind === "cannot-tell") {
    return {
      kind: "cannot-tell",
      why: `${but} ${murky.length} session(s) could not be read (${first.role.why})`,
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
  if (typeof snapshot["error"] === "string" && snapshot["error"] !== "") {
    // The rows in a payload carrying an error are the LAST GOOD ones, not
    // current ones — which is the whole trap.
    return no(`the dashboard's last collection failed (${snapshot["error"]}), so its rows are not current`);
  }
  const collectedAt = snapshot["collectedAt"];
  if (typeof collectedAt !== "string") return no("the dashboard has never completed a collection");
  const age = opts.nowMs - Date.parse(collectedAt);
  if (!Number.isFinite(age)) return no(`the snapshot's collectedAt is not a time (${String(collectedAt)})`);
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
    if (typeof id !== "string" || id === "" || typeof name !== "string") {
      dropped++;
      continue;
    }
    bearing.push({ id, name, role: parseRole(record["role"]) });
  }

  return overseerClaim(
    bearing,
    dropped === 0 ? COMPLETE : { ok: false, why: `${dropped} of ${rows.length} rows in the snapshot could not be read` },
  );
}

/**
 * One line of prose, so the terminal and the page say the same sentence.
 *
 * No colour and no markup: each caller decides how loud to draw it, and the two
 * that shout — `contested` and `cannot-tell` — are told apart by `kind`, not by
 * reading the string.
 */
export function describeClaim(claim: OverseerClaim): string {
  switch (claim.kind) {
    case "one":
      return `Overseer: ${claim.name}`;
    case "none":
      return "no Overseer session";
    case "contested":
      return `${claim.names.length} sessions claim to be the Overseer: ${claim.names.join(", ")}`;
    case "cannot-tell":
      return `Overseer unknown — ${claim.why}`;
    default: {
      const never: never = claim;
      return never;
    }
  }
}
/**
 * **Marking exactly one live session as the Overseer.**
 *
 * The Overseer is one permanent Claude session supervising 20–35 others
 * (docs/project/overseer.md). Until 2026-09-08 nothing on the box could tell it
 * from any other session, so two sessions could both believe they were it and
 * neither could find out. The claim is a role string in the session's own tmux
 * environment — docs/plans/260908j-mark-one-session-as-the-overseer.md.
 *
 * TWO HALVES, AND THE SECOND ONE IS THE POINT. The first half hands
 * `parseSessionLine` and the deciders strings, which is cheap and covers the
 * arms. The second half runs REAL TMUX on a disposable socket, because the two
 * facts this design leans on are facts about tmux and not about our parse:
 *
 *  - `show-environment -t <session> VAR` does not fall back to the global
 *    environment, so `set-environment -g` cannot mint a claim;
 *  - **killing the holder releases the claim** — which is the whole reason
 *    there is no lock file to break and no liveness check to get wrong. Asserted
 *    here rather than assumed, because "the claim dies with the session" was a
 *    sentence in a plan before it was a thing anybody watched happen.
 *
 * The tmux half is skipped where tmux and GNU coreutils are not both present —
 * the same probe `gjd-remote-tmux-script.test.ts` uses, and for the same reason:
 * the script only ever runs on the box.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  META,
  METADATA_VERSION,
  OVERSEER_ROLE,
  ROLE_UNREADABLE,
  ROW_COUNT,
  SESSION_SENTINEL,
  type Session,
  buildSessionScript,
  decideClaim,
  decideRelease,
  overseerClaim,
  parseSessionLine,
  parseSessions,
  setRoleCommand,
} from "../scripts/gjd-remote-tmux.js";
import {
  OVERSEER_ROLE as WIRE_OVERSEER_ROLE,
  type SessionRole as WireRole,
  claimFromSnapshot,
  describeClaim,
  overseerClaim as wireClaim,
  parseRole as parseWireRole,
} from "../tools/fleet/overseer-claim.js";

const b64 = (t: string) => Buffer.from(t, "utf8").toString("base64");

/** One well-formed record, with the role field last. */
const row = (o: { sid?: string; name?: string; role?: string } = {}): string =>
  [
    o.sid ?? "$1",
    "1757000000",
    "0",
    "1",
    "0",
    "3c67234f-2da6-4208-8473-9b5ee58be82a",
    "claude",
    b64(o.name ?? "one"),
    b64(""),
    METADATA_VERSION,
    "claude",
    "spideryarn/reading2",
    b64("/home/greg/code/spideryarn2"),
    b64(o.role ?? ""),
  ].join("|");

const reply = (rows: string[]) => [`${ROW_COUNT} ${rows.length}`, ...rows, SESSION_SENTINEL].join("\n");

/** The sessions a reply parses to, or a thrown assertion naming what went wrong. */
function sessionsOf(rows: string[]): Session[] {
  const parsed = parseSessions(reply(rows));
  expect(parsed.failure).toBeNull();
  return parsed.sessions;
}

describe("reading a role off the wire", () => {
  it("an empty role field is NONE — the session holds no claim", () => {
    const r = parseSessionLine(row({ role: "" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.session.role).toEqual({ kind: "none" });
  });

  it("the overseer role is recognised", () => {
    const r = parseSessionLine(row({ role: OVERSEER_ROLE }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.session.role).toEqual({ kind: "overseer" });
  });

  it("a role this reader has never heard of is OTHER, and keeps its name", () => {
    const r = parseSessionLine(row({ role: "auditor" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.session.role).toEqual({ kind: "other", name: "auditor" });
  });

  it("a malformed role is CANNOT-TELL, never none — something is there and we could not read it", () => {
    const r = parseSessionLine(row({ role: "Over Seer!" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.session.role.kind).toBe("cannot-tell");
  });

  it("a role that is not decodable base64 fails the LINE, like every other field", () => {
    const line = row().replace(/[^|]*$/, "!!!not-base64!!!");
    expect(parseSessionLine(line).ok).toBe(false);
  });

  it("a thirteen-field line — the shape before the role existed — is refused, not defaulted", () => {
    const old = row().split("|").slice(0, 13).join("|");
    expect(parseSessionLine(old).ok).toBe(false);
  });
});

describe("who holds the claim", () => {
  it("nobody, and that is a real answer", () => {
    expect(overseerClaim(sessionsOf([row({ sid: "$1", name: "a" })]))).toEqual({ kind: "none" });
  });

  it("one holder, named", () => {
    const list = sessionsOf([row({ sid: "$1", name: "a" }), row({ sid: "$2", name: "b", role: OVERSEER_ROLE })]);
    expect(overseerClaim(list)).toEqual({ kind: "one", name: "b", id: "$2" });
  });

  it("two holders is a FAULT, not a pick — both names are reported", () => {
    const list = sessionsOf([
      row({ sid: "$1", name: "a", role: OVERSEER_ROLE }),
      row({ sid: "$2", name: "b", role: OVERSEER_ROLE }),
    ]);
    const claim = overseerClaim(list);
    expect(claim.kind).toBe("contested");
    if (claim.kind !== "contested") return;
    expect(claim.names).toEqual(["a", "b"]);
  });

  it("a role we could not read is CANNOT-TELL — it is not evidence that nobody holds it", () => {
    const list = sessionsOf([row({ sid: "$1", name: "a", role: "Over Seer!" })]);
    expect(overseerClaim(list).kind).toBe("cannot-tell");
  });

  it("ONE HOLDER PLUS ONE UNREADABLE ROW IS NOT SINGLETON OWNERSHIP", () => {
    // The claim this whole mechanism makes is *exactly one*, and a row nobody
    // could read might be a second claimant. So the answer is cannot-tell —
    // GPT Sol's P0-2, against a first draft that returned `one` here.
    const list = sessionsOf([
      row({ sid: "$1", name: "a", role: "Over Seer!" }),
      row({ sid: "$2", name: "b", role: OVERSEER_ROLE }),
    ]);
    const claim = overseerClaim(list);
    expect(claim.kind).toBe("cannot-tell");
    // ...and it still says WHO, so a caller that only wants somebody to prod
    // keeps the address. What it has lost is the guarantee, not the name.
    if (claim.kind !== "cannot-tell") return;
    expect(claim.why).toContain("b");
  });

  it("TWO KNOWN HOLDERS BEAT AN INCOMPLETE READING — more rows could only make it worse", () => {
    const list = sessionsOf([
      row({ sid: "$1", name: "a", role: OVERSEER_ROLE }),
      row({ sid: "$2", name: "b", role: OVERSEER_ROLE }),
      row({ sid: "$3", name: "c", role: "Over Seer!" }),
    ]);
    expect(overseerClaim(list).kind).toBe("contested");
  });
});

describe("deciding whether a claim may go ahead", () => {
  it("claims a free role", () => {
    const list = sessionsOf([row({ sid: "$1", name: "a" })]);
    expect(decideClaim(list, "a")).toEqual({ kind: "claim", id: "$1", name: "a" });
  });

  it("refuses when somebody else holds it, and NAMES them", () => {
    const list = sessionsOf([row({ sid: "$1", name: "a" }), row({ sid: "$2", name: "held", role: OVERSEER_ROLE })]);
    const v = decideClaim(list, "a");
    expect(v.kind).toBe("refused");
    if (v.kind !== "refused") return;
    expect(v.why).toContain("held");
  });

  it("is a no-op when the target already holds it", () => {
    const list = sessionsOf([row({ sid: "$1", name: "a", role: OVERSEER_ROLE })]);
    expect(decideClaim(list, "a").kind).toBe("already-yours");
  });

  it("refuses a session that is not there", () => {
    expect(decideClaim(sessionsOf([row({ name: "a" })]), "ghost").kind).toBe("refused");
  });

  it("refuses to claim over a role we could not read, rather than overwriting it", () => {
    const list = sessionsOf([row({ sid: "$1", name: "a", role: "Over Seer!" })]);
    expect(decideClaim(list, "a").kind).toBe("refused");
  });

  it("releasing a session that does not hold it says so rather than pretending to work", () => {
    const list = sessionsOf([row({ sid: "$1", name: "a" })]);
    expect(decideRelease(list, "a").kind).toBe("refused");
  });

  it("releases the holder", () => {
    const list = sessionsOf([row({ sid: "$1", name: "a", role: OVERSEER_ROLE })]);
    expect(decideRelease(list, "a")).toEqual({ kind: "release", id: "$1", name: "a" });
  });
});

describe("a role the box could not be asked about", () => {
  it("the sentinel is CANNOT-TELL, and is not the same bytes as an empty field", () => {
    // `show-environment -t X VAR` exits 1 both for a variable that is not set
    // and for a session that has gone, so the script dumps the environment and
    // sends '?' when even that failed. If those two collapsed, a session that
    // vanished mid-listing would report as one that holds no claim.
    const r = parseSessionLine(row().replace(/[^|]*$/, ROLE_UNREADABLE));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.session.role.kind).toBe("cannot-tell");
    expect(r.session.role).not.toEqual({ kind: "none" });
  });

  it("poisons the whole reading rather than being ignored", () => {
    const list = sessionsOf([
      row({ sid: "$1", name: "a" }),
      row({ sid: "$2", name: "b" }).replace(/[^|]*$/, ROLE_UNREADABLE),
    ]);
    expect(overseerClaim(list).kind).toBe("cannot-tell");
  });

  it("and a claim is REFUSED while any role is unreadable", () => {
    const list = sessionsOf([row({ sid: "$1", name: "a" }).replace(/[^|]*$/, ROLE_UNREADABLE)]);
    expect(decideClaim(list, "a").kind).toBe("refused");
  });
});

describe("what the refusal does and does not promise", () => {
  it("TWO CLAIMS FROM THE SAME SNAPSHOT ARE BOTH ALLOWED — this is not a mutex", () => {
    // The contract is eventual detection, not mutual exclusion. Written down as
    // a test so nobody later reads `decideClaim` as a lock. GPT Sol's P1-1.
    const before = sessionsOf([row({ sid: "$1", name: "a" }), row({ sid: "$2", name: "b" })]);
    expect(decideClaim(before, "a").kind).toBe("claim");
    expect(decideClaim(before, "b").kind).toBe("claim");
  });

  it("and the box that results is reported as contested, not resolved in someone's favour", () => {
    const after = sessionsOf([
      row({ sid: "$1", name: "a", role: OVERSEER_ROLE }),
      row({ sid: "$2", name: "b", role: OVERSEER_ROLE }),
    ]);
    expect(overseerClaim(after).kind).toBe("contested");
  });

  it("releasing is allowed WHILE contested, because that is the repair", () => {
    const contested = sessionsOf([
      row({ sid: "$1", name: "a", role: OVERSEER_ROLE }),
      row({ sid: "$2", name: "b", role: OVERSEER_ROLE }),
    ]);
    expect(decideRelease(contested, "a")).toEqual({ kind: "release", id: "$1", name: "a" });
  });
});

describe("reading a claim off a dashboard snapshot", () => {
  const NOW = Date.parse("2026-09-08T20:05:00.000Z");
  const snapshot = (over: Record<string, unknown> = {}) => ({
    schema: 1,
    collectedAt: "2026-09-08T20:04:30.000Z",
    error: null,
    rows: [{ id: "$1", name: "alpha", role: { kind: "overseer" } }],
    ...over,
  });
  const read = (body: unknown) => claimFromSnapshot(body, { nowMs: NOW, maxAgeMs: 5 * 60_000 });

  it("names the holder in a fresh, complete snapshot", () => {
    expect(read(snapshot())).toEqual({ kind: "one", name: "alpha", id: "$1" });
  });

  it("REFUSES A PAYLOAD WHOSE COLLECTION FAILED — those rows are the last good ones, not current", () => {
    expect(read(snapshot({ error: "tmux went away" })).kind).toBe("cannot-tell");
  });

  it("refuses a snapshot from before the first collection, which is not an empty box", () => {
    expect(read(snapshot({ collectedAt: null, rows: [] })).kind).toBe("cannot-tell");
  });

  it("refuses a stale snapshot rather than naming a session that may be gone", () => {
    expect(read(snapshot({ collectedAt: "2026-09-08T19:00:00.000Z" })).kind).toBe("cannot-tell");
  });

  it("refuses a schema it does not read", () => {
    expect(read(snapshot({ schema: 2 })).kind).toBe("cannot-tell");
  });

  it("a row it cannot read makes the whole answer uncertain, holder or no holder", () => {
    expect(read(snapshot({ rows: [{ id: "$1", name: "alpha", role: { kind: "overseer" } }, {}] })).kind).toBe(
      "cannot-tell",
    );
    expect(read(snapshot({ rows: [{ id: "$1", name: "alpha", role: { kind: "none" } }, {}] })).kind).toBe(
      "cannot-tell",
    );
  });

  it("says none for a fresh, complete snapshot in which nobody holds it", () => {
    expect(read(snapshot({ rows: [{ id: "$1", name: "alpha", role: { kind: "none" } }] }))).toEqual({ kind: "none" });
  });
});

describe("the wire-side twin", () => {
  it("spells the role the same as the reader that writes it", () => {
    // The whole exclusivity rule is string equality against this word, on two
    // sides of a compilation boundary the compiler cannot bridge. A divergence
    // would be silent and total: every claim written by gjd-remote would read as
    // `other` on the dashboard, and the header would say no Overseer while a row
    // sat there holding it.
    expect(WIRE_OVERSEER_ROLE).toBe(OVERSEER_ROLE);
  });

  it("reads an ABSENT role as cannot-tell — a server from before the field is not a denial", () => {
    expect(parseWireRole(undefined).kind).toBe("cannot-tell");
    expect(parseWireRole(null).kind).toBe("cannot-tell");
  });

  it("reads each arm the collector sends", () => {
    expect(parseWireRole({ kind: "none" })).toEqual({ kind: "none" });
    expect(parseWireRole({ kind: "overseer" })).toEqual({ kind: "overseer" });
    expect(parseWireRole({ kind: "other", name: "auditor" })).toEqual({ kind: "other", name: "auditor" });
    expect(parseWireRole({ kind: "cannot-tell", why: "junk" })).toEqual({ kind: "cannot-tell", why: "junk" });
  });

  it("an arm this build has never heard of is cannot-tell, not none", () => {
    expect(parseWireRole({ kind: "deputy" }).kind).toBe("cannot-tell");
  });

  it("says who holds it, that nobody does, and when two do", () => {
    const r = (id: string, name: string, role: WireRole) => ({ id, name, role });
    expect(wireClaim([r("$1", "a", { kind: "none" })])).toEqual({ kind: "none" });
    expect(wireClaim([r("$1", "a", { kind: "overseer" })])).toEqual({ kind: "one", name: "a", id: "$1" });
    expect(wireClaim([r("$1", "a", { kind: "overseer" }), r("$2", "b", { kind: "overseer" })]).kind).toBe(
      "contested",
    );
    expect(wireClaim([r("$1", "a", { kind: "cannot-tell", why: "x" })]).kind).toBe("cannot-tell");
  });

  it("describes the ABSENT state as a sentence, not a blank", () => {
    expect(describeClaim({ kind: "none" })).toBe("no Overseer session");
  });
});

describe("the tmux command a claim turns into", () => {
  it("quotes the session id, because a bare $2514 is a positional parameter", () => {
    expect(setRoleCommand("$2514", OVERSEER_ROLE)).toContain("'$2514'");
  });

  it("releasing UNSETS rather than writing an empty string", () => {
    expect(setRoleCommand("$1", null)).toContain(" -u ");
  });

  it("refuses an id that is not tmux's own shape", () => {
    expect(() => setRoleCommand("2514; rm -rf /", OVERSEER_ROLE)).toThrow();
  });
});

/* ------------------------------------------------------------------ *
 * The shell branch nothing else can reach: a live listing whose per-session
 * environment read fails. This is the race GPT Sol's P0-1 is about — a session
 * that dies between `tmux ls` and the lookup — and it cannot be arranged against
 * a real server on demand, so `tmux` is stubbed for exactly this one shape.
 * ------------------------------------------------------------------ */

describe.runIf(usable())("when tmux lists a session it can no longer be asked about", () => {
  let dir = "";

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "overseer-claim-stub-"));
    // `ls` answers; `show-environment -t X VAR` answers; the DUMP —
    // `show-environment -t X` with no variable — fails, which is what a session
    // that has gone looks like.
    writeFileSync(
      path.join(dir, "tmux"),
      [
        "#!/bin/sh",
        'if [ "$1" = "ls" ]; then printf \'$7|1757000000|0|1|gone-session\\n\'; exit 0; fi',
        'if [ "$1" = "list-panes" ]; then exit 0; fi',
        'if [ "$1" = "show-environment" ]; then',
        '  if [ $# -ge 4 ]; then printf \'%s=\\n\' "$4"; exit 0; fi',
        "  exit 1",
        "fi",
        "exit 0",
      ].join("\n"),
    );
    chmodSync(path.join(dir, "tmux"), 0o755);
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("REPORTS THE ROLE AS UNKNOWN, not as absent", () => {
    const out = execFileSync("bash", ["-c", buildSessionScript({ agents: false })], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${dir}:${process.env["PATH"] ?? ""}` },
    });
    const parsed = parseSessions(out);
    expect(parsed.failure).toBeNull();
    expect(parsed.sessions).toHaveLength(1);
    // The bug this guards: with a by-name read, the empty answer here was
    // indistinguishable from "this session holds no claim", and a vanished
    // session would have been counted as evidence that nobody is the Overseer.
    expect(parsed.sessions[0]?.role.kind).toBe("cannot-tell");
    expect(parsed.sessions[0]?.role).not.toEqual({ kind: "none" });
  });
});

/* ------------------------------------------------------------------ *
 * Against a real tmux server, on a socket nothing else can reach.
 * ------------------------------------------------------------------ */

/** GNU coreutils and tmux, or the whole block is skipped. See the header. */
function usable(): boolean {
  try {
    execFileSync("wc", ["--version"], { stdio: "ignore" });
    execFileSync("tmux", ["-V"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe.runIf(usable())("against a real tmux server", () => {
  let dir = "";
  let sock = "";

  const tmux = (...args: string[]): string =>
    execFileSync("tmux", ["-S", sock, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

  /** Run the listing script against this socket and parse it. */
  const list = (): Session[] => {
    const script = buildSessionScript({ agents: false }).replaceAll("tmux ", `tmux -S ${sock} `);
    const out = execFileSync("bash", ["-c", script], { encoding: "utf8", env: { ...process.env, HOME: dir } });
    const parsed = parseSessions(out);
    expect(parsed.failure).toBeNull();
    return parsed.sessions;
  };

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "overseer-claim-"));
    sock = path.join(dir, "s.sock");
    tmux("new-session", "-d", "-s", "alpha", "sleep 300");
    tmux("new-session", "-d", "-s", "beta", "sleep 300");
    for (const s of ["alpha", "beta"]) {
      tmux("set-environment", "-t", s, META.version, METADATA_VERSION);
      tmux("set-environment", "-t", s, META.kind, "claude");
      tmux("set-environment", "-t", s, META.repo, "spideryarn/reading2");
      tmux("set-environment", "-t", s, META.dir, "/home/greg/code/spideryarn2");
    }
  });

  afterAll(() => {
    try {
      tmux("kill-server");
    } catch {
      /* already gone */
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("starts with nobody holding the claim", () => {
    expect(overseerClaim(list())).toEqual({ kind: "none" });
  });

  it("a claim is visible to the listing, and only on the session that got it", () => {
    const v = decideClaim(list(), "alpha");
    expect(v.kind).toBe("claim");
    if (v.kind !== "claim") return;
    execFileSync("bash", ["-c", setRoleCommand(v.id, OVERSEER_ROLE).replace("tmux ", `tmux -S ${sock} `)]);

    const claim = overseerClaim(list());
    expect(claim.kind).toBe("one");
    if (claim.kind !== "one") return;
    expect(claim.name).toBe("alpha");
    expect(list().find((s) => s.name === "beta")?.role).toEqual({ kind: "none" });
  });

  it("refuses a second claim, naming the holder", () => {
    const v = decideClaim(list(), "beta");
    expect(v.kind).toBe("refused");
    if (v.kind !== "refused") return;
    expect(v.why).toContain("alpha");
  });

  it("a GLOBAL role marks nothing — show-environment does not fall back to it", () => {
    tmux("set-environment", "-g", "GJD_ROLE", OVERSEER_ROLE);
    try {
      expect(list().find((s) => s.name === "beta")?.role).toEqual({ kind: "none" });
    } finally {
      tmux("set-environment", "-gu", "GJD_ROLE");
    }
  });

  it("KILLING THE HOLDER RELEASES THE CLAIM — there is nothing left to break", () => {
    tmux("kill-session", "-t", "alpha");
    expect(overseerClaim(list())).toEqual({ kind: "none" });
    // And the role is free again, which is the half that matters after a reboot.
    expect(decideClaim(list(), "beta").kind).toBe("claim");
  });

  it("releasing removes it, and the session stays alive", () => {
    const v = decideClaim(list(), "beta");
    expect(v.kind).toBe("claim");
    if (v.kind !== "claim") return;
    execFileSync("bash", ["-c", setRoleCommand(v.id, OVERSEER_ROLE).replace("tmux ", `tmux -S ${sock} `)]);
    expect(overseerClaim(list()).kind).toBe("one");

    const r = decideRelease(list(), "beta");
    expect(r.kind).toBe("release");
    if (r.kind !== "release") return;
    execFileSync("bash", ["-c", setRoleCommand(r.id, null).replace("tmux ", `tmux -S ${sock} `)]);
    expect(overseerClaim(list())).toEqual({ kind: "none" });
    expect(list().map((s) => s.name)).toContain("beta");
  });
});
// @vitest-environment jsdom
/**
 * **The dashboard saying who the Overseer is — and, more importantly, when
 * nobody is.**
 *
 * The box is meant to have exactly one supervising session
 * (docs/project/overseer.md), and the claim is a variable in that session's tmux
 * environment, so it dies with the tmux server. **After a reboot nobody holds
 * it**, and nothing else on this page would notice: the daemon can be perfectly
 * alive, the rows all present, the counts all green. So the absent state is what
 * these tests are mostly about — a per-row badge structurally cannot show it,
 * which is why the header carries a line of its own.
 *
 * The plan is docs/plans/260908j-mark-one-session-as-the-overseer.md.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Header, freshness } from "../tools/fleet/web/src/Header";
import { SessionsPanel } from "../tools/fleet/web/src/SessionsPanel";
import { parseFleetState, type FleetState, type SessionRole } from "../tools/fleet/web/src/types";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const draw = (node: React.ReactNode): void => {
  act(() => root.render(node));
};

/** A payload the way the server sends it, so the real parser runs. */
function wireRow(over: { id: string; name: string; role?: unknown }): Record<string, unknown> {
  return {
    id: over.id,
    name: over.name,
    title: null,
    repo: "spideryarn/reading2",
    worktree: null,
    meta: { version: 1, kind: "claude", repo: "spideryarn/reading2", dir: "/home/greg/code/spideryarn2" },
    startedAt: "2026-09-08T20:00:00.000Z",
    paneId: "%1",
    panePid: 100,
    claudeSessionId: "117e181a-155b-435a-b95b-e74220678d1a",
    question: null,
    status: { kind: "idle" },
    ...("role" in over ? { role: over.role } : {}),
  };
}

/** Through the REAL parser, so an absent `role` key is absent the way a server makes it. */
function stateOf(rows: Record<string, unknown>[], over: Record<string, unknown> = {}): FleetState {
  const read = parseFleetState(
    {
      schema: 1,
      rows,
      ...over,
      collectedAt: "collectedAt" in over ? over["collectedAt"] : "2026-09-08T20:05:00.000Z",
      attemptedAt: "2026-09-08T20:05:00.000Z",
      servedAt: "2026-09-08T20:05:00.000Z",
      tmuxServerPid: 1,
      tookMs: 10,
      error: null,
      health: null,
      refreshMs: 60_000,
      answeringEnabled: true,
      attention: { kind: "not-asked" },
    },
    Date.parse("2026-09-08T20:05:00.000Z"),
  );
  if (!read.ok) throw new Error(`the fixture did not parse: ${read.why}`);
  return read.state;
}

const NOW = Date.parse("2026-09-08T20:05:00.000Z");

const header = (state: FleetState): string => {
  // The real `freshness`, not a stub: the masthead's age tooltip is built from
  // it, and a hand-made object with the wrong shape crashes the render in a way
  // that has nothing to do with what these tests are about.
  const fresh = freshness({ state, receivedAt: NOW, error: null, failures: 0, now: NOW });
  draw(<Header state={state} fresh={fresh} onRefresh={() => {}} />);
  return host.textContent ?? "";
};

describe("the header says who the Overseer is", () => {
  it("names the one session that holds the claim", () => {
    const text = header(stateOf([wireRow({ id: "$1", name: "alpha", role: { kind: "overseer" } })]));
    expect(text).toContain("Overseer: alpha");
  });

  it("SAYS SO OUT LOUD when nobody holds it — the state a reboot leaves behind", () => {
    const text = header(stateOf([wireRow({ id: "$1", name: "alpha", role: { kind: "none" } })]));
    expect(text).toContain("no Overseer session");
  });

  it("shouts when two sessions both claim it, rather than picking one", () => {
    const text = header(
      stateOf([
        wireRow({ id: "$1", name: "alpha", role: { kind: "overseer" } }),
        wireRow({ id: "$2", name: "beta", role: { kind: "overseer" } }),
      ]),
    );
    expect(text).toContain("2 sessions claim to be the Overseer");
    expect(text).toContain("alpha");
    expect(text).toContain("beta");
  });

  it("A PAYLOAD FROM BEFORE THE FIRST COLLECTION IS NOT A BOX WITH NO OVERSEER", () => {
    const text = header(stateOf([], { collectedAt: null }));
    expect(text).toContain("Overseer unknown");
    expect(text).not.toContain("no Overseer session");
  });

  it("a row the page had to drop makes the answer uncertain — it could have been the holder's", () => {
    // `parseFleetState` drops a row with no id and counts it. A shorter list
    // must not pass as a complete one. GPT Sol's P0-2.
    const text = header(stateOf([wireRow({ id: "$1", name: "alpha", role: { kind: "none" } }), { name: "?" }]));
    expect(text).toContain("Overseer unknown");
    expect(text).not.toContain("no Overseer session");
  });

  it("A SERVER THAT DOES NOT REPORT ROLES IS NOT A BOX WITH NO OVERSEER", () => {
    // The field was added without a schema bump, so an older dashboard sends no
    // `role` key at all. Reading that as "nobody" would print a confident,
    // plausible, wrong sentence — the exact substitution this page keeps being
    // written to avoid.
    const text = header(stateOf([wireRow({ id: "$1", name: "alpha" })]));
    expect(text).toContain("Overseer unknown");
    expect(text).not.toContain("no Overseer session");
  });
});

describe("the row badge", () => {
  /**
   * The panel with everything it does not use stubbed.
   *
   * The card path reads `rows` and `now` and nothing else — the steer, rename,
   * actions, messages and new-session APIs are handed to the DETAIL pane, which
   * is not open here. They are cast rather than built because building five API
   * objects to assert one badge would be testing the harness.
   */
  const panel = (state: FleetState): string => {
    draw(
      <SessionsPanel
        rows={state.rows}
        now={Date.parse("2026-09-08T20:05:00.000Z")}
        collected={true}
        unreadableRows={0}
        answeringEnabled={{ kind: "enabled" }}
        tmuxServerPid={1}
        order="status"
        onOrder={() => {}}
        selectedId={null}
        onSelect={() => {}}
        steer={{} as never}
        rename={{} as never}
        actions={{} as never}
        messages={{} as never}
        newSession={{} as never}
        onRefresh={() => {}}
      />,
    );
    return host.textContent ?? "";
  };

  it("marks the holder", () => {
    expect(panel(stateOf([wireRow({ id: "$1", name: "alpha", role: { kind: "overseer" } })]))).toContain("Overseer");
  });

  it("marks nobody else — including a role this build has never heard of", () => {
    const other: SessionRole = { kind: "other", name: "auditor" };
    const text = panel(stateOf([wireRow({ id: "$1", name: "alpha", role: other })]));
    expect(text).not.toContain("Overseer");
  });
});
