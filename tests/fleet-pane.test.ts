/**
 * What a blocked session is asking — tools/fleet/pane.ts.
 *
 * EVERY FIXTURE UNDER tests/fixtures/fleet-panes/ IS A REAL CAPTURE, taken with
 * `tmux capture-pane -p` on the box, with one declared exception
 * (`dialog-loop-cloud-schedule.txt`, reproduced verbatim from the live capture
 * recorded in docs/plans/260907e-agent-fleet-dashboard.md on 2026-09-07 — the
 * modal did not reappear on this build, and inventing a plausible one would have
 * been worse than saying so). The `dialog-*` permission shapes were provoked in
 * throwaway sessions of my own, on 2026-09-08 — the four earlier ones and, later
 * the same day, `dialog-file-write-hello.txt`, `dialog-file-write-goodbye.txt`
 * and `dialog-edit-diff.txt`, and later again `dialog-ask-user-question-colour.txt`
 * (a throwaway session asked to call `AskUserQuestion` and nothing else). The
 * `none-*` panes, `dialog-ask-user-question.txt`,
 * `dialog-bash-permission-git-log.txt` and
 * `refused-ask-user-question-two-column.txt` are other agents' live sessions,
 * read only — `capture-pane` and nothing else. NOTHING HERE IS HAND-WRITTEN. Where a case
 * needs a shape we could not provoke, it is DERIVED from a named real capture by
 * one stated change, in the test itself, so the change is visible next to the
 * assertion rather than buried in a file that looks captured.
 *
 * THE ASYMMETRY IS THE POINT. A missed question costs a glance at the terminal.
 * A false question invites someone to tap "1" on their phone and land a digit in
 * a session that was mid-task, in somebody else's worktree. So most of this file
 * is about the panes that must say `none`, and three of them contain a
 * well-formed 1–4 numbered list.
 *
 * THE SECOND HALF OF THE FILE IS ABOUT A DIFFERENT ASYMMETRY, added on
 * 2026-09-08. A question we report without what it is ABOUT invites someone to
 * approve a file write they never saw. `dialog-file-write-hello.txt` and
 * `dialog-file-write-goodbye.txt` are the same dialog proposing the same path
 * with one word of contents changed, and before `material` existed they parsed
 * to byte-identical questions with byte-identical options. That pair is the
 * regression test and the reason the rest of it is here.
 *
 * THE THIRD ASYMMETRY, added later the same day with `gate`. Answering a dialog
 * is one gesture on the screen and two different acts underneath: approving a
 * tool call, or taking a turn in a conversation with an agent that asked. Only
 * the second is safe to tap from a phone, so `conversation` is the arm that has
 * to be EARNED and everything else falls to `unknown`, which every caller must
 * treat exactly as `permission`. Those tests are written the same way round as
 * the rest of the file: the interesting ones are the permission dialogs that
 * must not become conversations, including one derived from a real capture in
 * which the file being written contains a markdown checkbox.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  capturePane,
  classifyConsequence,
  classifyGate,
  cleanLines,
  fingerprintMaterial,
  grantsPermission,
  isPaneId,
  parsePane,
  stripAnsi,
  type PaneGate,
  type PaneMaterial,
  type PaneOption,
} from "../tools/fleet/pane.js";

const FIXTURES = path.resolve(import.meta.dirname, "fixtures/fleet-panes");

function fixture(name: string): string {
  return readFileSync(path.join(FIXTURES, name), "utf8");
}

function ask(name: string) {
  const q = parsePane(fixture(name));
  if (q.kind !== "question") throw new Error(`${name} parsed as ${q.kind}, expected a question`);
  return q;
}

/**
 * The `read` arm or a failure that names the fixture.
 *
 * A test that reached for `.text` on the wrong arm would fail on `undefined`
 * and say nothing about which arm it got, and "the material was unreadable" is
 * the interesting half of that answer.
 */
function read(name: string): Extract<PaneMaterial, { kind: "read" }> {
  const m = ask(name).material;
  if (m.kind !== "read") throw new Error(`${name}: material is ${m.kind}, expected read`);
  return m;
}

describe("the fixture corpus", () => {
  /**
   * The naming convention carries the expectation, so adding a fixture is the
   * whole of adding a case. A `dialog-` file that stops parsing, or a `none-`
   * file that starts, goes red here without anyone remembering to add an assert.
   */
  const files = readdirSync(FIXTURES).filter((f) => f.endsWith(".txt")).sort();

  it("has enough real panes of both kinds to be worth believing", () => {
    expect(files.filter((f) => f.startsWith("dialog-")).length).toBeGreaterThanOrEqual(10);
    expect(files.filter((f) => f.startsWith("none-")).length).toBeGreaterThanOrEqual(8);
    expect(files.every((f) => /^(dialog|none|refused)-/.test(f))).toBe(true);
  });

  /**
   * `refused-` IS A THIRD PREFIX AND IT IS NOT A SYNONYM FOR `none-`.
   *
   * `none-` says "this pane is not asking anything, and saying so is right".
   * `refused-` says "this pane IS asking something, we return `none` anyway,
   * and that is a known limitation rather than the answer we want". Both must
   * parse to `none` today, so the loop below treats them the same; the
   * difference is what a red test means. A `refused-` file that starts parsing
   * is good news and the fix is to rename it, which is why it goes red rather
   * than passing quietly — see the note on the one such fixture further down.
   */
  for (const f of files) {
    const expected = f.startsWith("dialog-") ? "question" : "none";
    it(`${f} → ${expected}`, () => {
      expect(parsePane(fixture(f)).kind).toBe(expected);
    });
  }

  /**
   * Corpus-wide invariants, so a new fixture cannot quietly introduce the shape
   * this module exists to refuse. `read` with nothing in it is the confident
   * empty box; `once` on a label that does not simply say yes is the button
   * somebody taps by muscle memory.
   */
  for (const f of files.filter((f) => f.startsWith("dialog-"))) {
    it(`${f} never reports empty material or an unearned "once"`, () => {
      const q = ask(f);
      if (q.material.kind === "read") expect(q.material.text.trim()).not.toBe("");
      if (q.material.kind === "unreadable") expect(q.material.why.length).toBeGreaterThan(20);
      for (const opt of q.options) {
        if (opt.consequence === "once") expect(opt.label.toLowerCase()).toMatch(/^yes[.!]?$/);
      }
      expect(q.options.length).toBeGreaterThan(1);
    });
  }
});

describe("the dangerous case: a working pane that must not look like a question", () => {
  /**
   * The one that names the class. A live idle session whose transcript ends in
   * "What's left, and what it costs: 1. … 2. … 3. … 4. …" — a perfectly formed
   * four-option run at a consistent indent, with continuation lines. Agents on
   * this box write these constantly.
   */
  it("does not mistake an agent's prose list for a menu", () => {
    const text = fixture("none-idle-with-prose-numbered-list.txt");
    expect(text).toMatch(/^ {2}1\. The two fix passes/m);
    expect(text).toMatch(/^ {2}4\. Not the routes\.ts/m);
    expect(parsePane(text)).toEqual({ kind: "none" });
  });

  /**
   * THE ONE THE FOOTER RULE EXISTS FOR, and the reason it is required rather
   * than a bonus. Greg types numbered instructions, and a multi-line message
   * sitting unsent in the input box renders as `❯ 1. …` / `  2. …` / `  3. …`:
   * a numbered run, at a consistent digit column, with exactly one cursor. Every
   * structural signal a real menu has. The only thing it lacks is the dialog's
   * key-hint line, so that is the signal we insist on.
   */
  it("does not mistake a half-typed numbered message for a menu", () => {
    const text = fixture("none-typed-numbered-message-in-input-box.txt");
    // The gap after `❯` in the input box is a non-breaking space, not a plain
    // one — a difference from the dialogs, and not one worth leaning on.
    expect(text).toMatch(/^❯\s1\. read the plan\s*$/m);
    expect(text).toMatch(/^\s{2}3\. stop and report\s*$/m);
    expect(parsePane(text)).toEqual({ kind: "none" });
  });

  /**
   * Recorded because it is the false positive we went looking for and did not
   * find: Claude Code erases a dialog when it is answered rather than letting it
   * scroll into history. Verified with `capture-pane -S -60` immediately after
   * answering — no trace of the options or the footer. So a stale dialog in
   * scrollback is not a shape we have to defend against, and if that ever
   * changes this fixture is where it will show up.
   */
  it("says none for a pane that answered a dialog seconds ago", () => {
    expect(parsePane(fixture("none-dialog-just-answered.txt"))).toEqual({ kind: "none" });
  });

  /**
   * THE TWO TESTS BELOW EXIST BECAUSE OF A MEASUREMENT, not a hunch. Disabling
   * each of the three guards in turn and re-running showed only the footer rule
   * changing a verdict on the real corpus — the cursor and input-box rules were
   * carrying nothing, and an untested guard is the thing silent-success.md warns
   * about. Rather than delete defence that costs two lines, these two cases
   * isolate them, each derived from a real capture by ONE stated change.
   *
   * This one keeps the live idle pane and gives it what it lacks: a cursor on
   * item 1 and a key-hint line under item 4 — which is the shape an agent
   * produces the day it writes "press Enter to confirm" at the end of a numbered
   * report. Only the input box below it says this is a transcript, not a menu.
   */
  it("says none when a prose list acquires a cursor and a hint line, because the input box is still there", () => {
    const real = fixture("none-idle-with-prose-numbered-list.txt");
    const derived = real
      .replace("  1. The two fix passes", "❯ 1. The two fix passes")
      .replace("     you.", "     you.\n Enter to select · Esc to cancel");
    expect(derived).not.toBe(real);
    expect(parsePane(derived)).toEqual({ kind: "none" });
  });

  /**
   * And this one takes the real permission dialog and removes only the cursor,
   * as a clipped or half-redrawn frame would. Without it there is no origin for
   * an arrow key and no way to say which option is live, so the honest answer is
   * that we did not read this screen.
   */
  it("says none for a dialog whose cursor is missing", () => {
    const real = fixture("dialog-bash-permission.txt");
    const derived = real.replace(" ❯ 1. Yes", "   1. Yes");
    expect(derived).not.toBe(real);
    expect(parsePane(real).kind).toBe("question");
    expect(parsePane(derived)).toEqual({ kind: "none" });
  });

  it("says none for a blank pane and for a bare shell that printed a numbered list", () => {
    expect(parsePane(fixture("none-blank-pane.txt"))).toEqual({ kind: "none" });
    expect(fixture("none-bare-shell.txt")).toMatch(/^1\. install deps$/m);
    expect(parsePane(fixture("none-bare-shell.txt"))).toEqual({ kind: "none" });
  });
});

describe("numbered dialogs", () => {
  it("reads the bash permission prompt, digits and all", () => {
    const q = ask("dialog-bash-permission.txt");
    expect(q.prompt).toContain("Do you want to proceed?");
    expect(q.options.map((o) => o.label)).toEqual([
      "Yes",
      "Yes, and don’t ask again for: curl -s https://example.com",
      "Yes, and switch to auto mode · auto mode handles these prompts for you",
      "No",
    ]);
    expect(q.options.map((o) => o.key)).toEqual([
      { via: "digit", digit: "1" },
      { via: "digit", digit: "2" },
      { via: "digit", digit: "3" },
      { via: "digit", digit: "4" },
    ]);
  });

  /**
   * `prompt` is bounded by the LAST horizontal rule, which is why it is the
   * single question line and not the diff above it: Claude Code rules off the
   * diff, and the rule is the boundary we use. That was the whole of the answer
   * once, and it is why `material` had to exist — the assertion below it is the
   * one that says the contents did not go missing.
   */
  it("reads the file-write prompt and stops at the rule under the diff", () => {
    const q = ask("dialog-file-write.txt");
    expect(q.prompt).toBe("Do you want to create notes.md?");
    expect(q.options.map((o) => o.label)).toEqual([
      "Yes",
      "Yes, and switch to accept edits (auto-approve file edits and common file commands) for this session (shift+tab)",
      "No",
    ]);
    expect(read("dialog-file-write.txt").text).toContain("hello");
  });

  /**
   * A continuation line under option 1, indented to the label column, and no
   * horizontal rule above the question at all — so this is the fixture that
   * exercises both the gap rule and the fallback the prompt scan uses when there
   * is nothing to bound it.
   */
  it("reads the /loop menu across its continuation line", () => {
    const q = ask("dialog-loop-cloud-schedule.txt");
    expect(q.prompt).toBe(
      "This loop stops when you close this session. Set it up as a cloud schedule instead so it keeps running?",
    );
    expect(q.options.map((o) => o.label)).toEqual([
      "Cloud schedule (recommended)",
      "This session only",
      "Type something.",
      "Chat about this",
    ]);
    expect(q.options[0]?.key).toEqual({ via: "digit", digit: "1" });
  });

  /**
   * The model selector puts a `↓` in the cursor column on the last visible row,
   * meaning there is more below. It is not a cursor, and treating it as one
   * would give the menu two cursors and lose the dialog entirely.
   */
  it("does not mistake the scroll arrow for the cursor", () => {
    const q = ask("dialog-model-selector.txt");
    expect(q.prompt).toContain("Select model");
    expect(q.options).toHaveLength(4);
    expect(q.options[3]?.label).toContain("Sonnet");
    expect(q.options[3]?.key).toEqual({ via: "digit", digit: "4" });
  });
});

describe("cursor dialogs, which have no numbers at all", () => {
  /**
   * Folder trust: two lines under a `❯`, and the keys are arrow presses rather
   * than digits. The option already under the cursor is `selected` — Enter
   * alone — rather than "zero Down presses", because a caller that treated it as
   * a count would send nothing and think it had.
   */
  it("reads the folder-trust prompt as arrow keys", () => {
    const q = ask("dialog-folder-trust.txt");
    expect(q.prompt).toContain("Is this a project you created or one you trust?");
    expect(q.options).toEqual([
      { label: "No, exit", key: { via: "selected" }, consequence: "decline" },
      {
        label: "Yes, I trust this folder",
        key: { via: "arrows", key: "Down", presses: 1 },
        consequence: "persistent",
      },
    ]);
  });
});

describe("what is actually being approved", () => {
  /**
   * THE REGRESSION TEST, AND THE REASON FOR ALL OF THIS. Two real captures of
   * the same dialog, proposing the same path, one writing `hello` and one
   * writing `goodbye`. Everything the parser used to report about them is
   * identical — same prompt, same three labels, same three digits — so the first
   * half of this test asserts that identity rather than assuming it. If those
   * ever diverge, the second half stops proving anything and this test would be
   * passing on the wrong evidence.
   *
   * `sameQuestion` in steer.ts compares what it is given, so before `material`
   * it would have accepted an answer aimed at the `hello` dialog and delivered
   * it to the `goodbye` one.
   */
  it("gives two writes of the same path different fingerprints when the contents differ", () => {
    const hello = ask("dialog-file-write-hello.txt");
    const goodbye = ask("dialog-file-write-goodbye.txt");

    expect(hello.prompt).toBe("Do you want to create notes.md?");
    expect(goodbye.prompt).toBe(hello.prompt);
    expect(goodbye.options.map((o) => o.label)).toEqual(hello.options.map((o) => o.label));
    expect(goodbye.options.map((o) => o.key)).toEqual(hello.options.map((o) => o.key));

    const a = read("dialog-file-write-hello.txt");
    const b = read("dialog-file-write-goodbye.txt");
    expect(a.text).toContain("1 hello");
    expect(b.text).toContain("1 goodbye");
    // Paired with the two above, so "the material is empty" cannot satisfy them.
    expect(a.text).not.toContain("goodbye");
    expect(b.text).not.toContain("1 hello");

    expect(a.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(b.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(b.fingerprint).not.toBe(a.fingerprint);
  });

  /**
   * The other half of the same claim: the fingerprint is of the MATERIAL, not
   * of the pane. These two captures are of different sessions with different
   * transcripts scrolled above the dialog, and they propose the identical write.
   * If the transcript leaked into the hash, `sameQuestion` would refuse a
   * perfectly good answer every time the session printed a line — which is a
   * safe failure, but a useless dashboard.
   */
  it("fingerprints the dialog, not the transcript above it", () => {
    const older = fixture("dialog-file-write.txt");
    const newer = fixture("dialog-file-write-hello.txt");
    expect(older).toContain("Ran 1 shell command");
    expect(newer).toContain("Claude Code v2.1.263");
    expect(newer).not.toContain("Ran 1 shell command");
    expect(older).not.toContain("Claude Code v2.1.263");

    const a = read("dialog-file-write.txt");
    const b = read("dialog-file-write-hello.txt");
    expect(a.text).toContain("1 hello");
    expect(b.text).toBe(a.text);
    expect(b.fingerprint).toBe(a.fingerprint);
  });

  it("carries the command a Bash approval is asking about", () => {
    const m = read("dialog-bash-permission.txt");
    expect(m.text).toContain("curl -s https://example.com | head -1");
    expect(m.text).toContain("This command requires approval");
    expect(ask("dialog-bash-permission.txt").prompt).toContain("Do you want to proceed?");
  });

  /**
   * A diff has two sides and the removed one matters: "change beta to
   * BETA-CHANGED" and "delete beta" are the same `+` line and a different edit.
   */
  it("carries both sides of an edit's diff, and the path", () => {
    const m = read("dialog-edit-diff.txt");
    expect(m.text).toContain("notes.md");
    expect(m.text).toContain("2 -beta");
    expect(m.text).toContain("2 +BETA-CHANGED");
    expect(m.text).toContain("1  alpha");
  });

  it("carries the folder a trust prompt is about", () => {
    const m = read("dialog-folder-trust.txt");
    expect(m.text).toContain("/home/greg/wf-pane-trust-probe");
    expect(m.text).toContain("Is this a project you created or one you trust?");
  });

  /**
   * A menu is not a proposal. The `/loop` scheduling dialog is a question and
   * four options and nothing else — no box, no diff, no path — and forcing an
   * empty `read` onto it would teach the page to render empty boxes, which is
   * the thing `unreadable` exists to stop it doing.
   */
  it("says no-material for a menu that proposes nothing, rather than inventing an empty one", () => {
    const text = fixture("dialog-loop-cloud-schedule.txt");
    expect(text).toMatch(/^❯ 1\. Cloud schedule/m);
    expect(text).not.toMatch(/^[─╌]+$/m);
    expect(ask("dialog-loop-cloud-schedule.txt").material).toEqual({ kind: "no-material" });
  });

  /**
   * DERIVED FROM A REAL CAPTURE BY ONE STATED CHANGE: everything above the
   * dashed rule that opens the diff is dropped, which is what a pane too short
   * to hold the whole dialog looks like. The question, the options and the
   * footer all survive — this still parses as an answerable dialog — but the
   * `Edit file` / `notes.md` header and the top of the diff are gone.
   *
   * The distinction that catches it is the box drawing itself: Claude Code
   * draws a dialog's outside with the solid `─` and its inner separators with
   * the dashed `╌`. A topmost rule that is dashed means we are looking at the
   * middle of a dialog. Showing that fragment as though it were the whole
   * proposal is precisely the failure this module is for, so it refuses.
   */
  it("refuses to read a dialog whose top border has scrolled off the pane", () => {
    const real = fixture("dialog-edit-diff.txt");
    const lines = real.split("\n");
    const firstDashedRule = lines.findIndex((l) => l.startsWith("╌"));
    expect(firstDashedRule).toBeGreaterThan(0);
    const clipped = lines.slice(firstDashedRule + 1).join("\n");

    // Positive: what survives is still a well-formed, answerable dialog...
    const q = parsePane(clipped);
    if (q.kind !== "question") throw new Error(`clipped capture parsed as ${q.kind}`);
    expect(q.prompt).toBe("Do you want to make this edit to notes.md?");
    expect(q.options.map((o) => o.label)).toEqual(ask("dialog-edit-diff.txt").options.map((o) => o.label));
    // ...and the header it lost is exactly what a person would need.
    expect(read("dialog-edit-diff.txt").text).toContain("Edit file");
    expect(clipped).not.toContain("Edit file");

    expect(q.material.kind).toBe("unreadable");
    if (q.material.kind !== "unreadable") throw new Error("unreachable");
    expect(q.material.why).toContain("top border");
  });

  /**
   * The same refusal from the other direction: the fingerprint is only ever
   * reachable through the `read` arm, so there is no way to hold a hash of
   * material nobody read. This is a type-level claim as much as a runtime one,
   * and `npm run typecheck` is where the type half is checked.
   */
  it("never carries a fingerprint without the text it is a fingerprint of", () => {
    const seen = new Set<string>();
    for (const f of readdirSync(FIXTURES).filter((f) => f.startsWith("dialog-"))) {
      const m = ask(f).material;
      if (m.kind !== "read") continue;
      expect(m.fingerprint).toBe(fingerprintMaterial(m.text));
      seen.add(m.fingerprint);
    }
    // The ANSI pairs collide with their plain twins, and file-write with
    // file-write-hello, so this is a floor rather than a count.
    expect(seen.size).toBeGreaterThanOrEqual(5);
  });

  it("hashes deterministically and notices one character", () => {
    expect(fingerprintMaterial("1 hello")).toBe(fingerprintMaterial("1 hello"));
    expect(fingerprintMaterial("1 hello")).not.toBe(fingerprintMaterial("1 hellO"));
    expect(fingerprintMaterial("")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("yes once, versus yes and never ask me again", () => {
  /**
   * Astra's point, and the reason this is a field rather than something the
   * client greps for. On a phone these are two buttons a thumb-width apart, and
   * one of them is a decision about a single write while the other stops the
   * session asking about writes at all.
   */
  it("separates the two yeses on a real file-write dialog", () => {
    const q = ask("dialog-file-write-hello.txt");
    expect(q.options.map((o) => [o.label.slice(0, 30), o.consequence])).toEqual([
      ["Yes", "once"],
      ["Yes, and switch to accept edit", "persistent"],
      ["No", "decline"],
    ]);
  });

  it("separates them on a real Bash dialog, where there are two persistent yeses", () => {
    const q = ask("dialog-bash-permission.txt");
    expect(q.options.map((o) => o.consequence)).toEqual(["once", "persistent", "persistent", "decline"]);
    expect(q.options[1]?.label).toContain("ask again");
    expect(q.options[2]?.label).toContain("auto mode");
  });

  /**
   * Trusting a folder is permanent and the label never says so — no "again", no
   * "session", nothing the other rules would catch. It is listed by name for
   * that reason, and this test is what stops somebody tidying the list.
   */
  it("calls trusting a folder persistent, because it is", () => {
    const q = ask("dialog-folder-trust.txt");
    expect(q.options.map((o) => [o.label, o.consequence])).toEqual([
      ["No, exit", "decline"],
      ["Yes, I trust this folder", "persistent"],
    ]);
  });

  /**
   * THE CONSERVATIVE DEFAULT, tested on the two menus whose options are not
   * approvals at all. Nothing here is `once`. A parser that guessed `once` for
   * anything it did not recognise would render the model selector's rows and
   * the `/loop` menu's rows as harmless single-shot approvals, which is the
   * failure in miniature.
   */
  it("calls an unrecognised option unknown, never once", () => {
    for (const f of ["dialog-model-selector.txt", "dialog-loop-cloud-schedule.txt"]) {
      const q = ask(f);
      expect(q.options.length).toBeGreaterThan(3);
      expect(q.options.every((o) => o.consequence === "unknown")).toBe(true);
    }
  });

  it("classifies the phrases directly, including the ones that only look alike", () => {
    expect(classifyConsequence("Yes")).toBe("once");
    expect(classifyConsequence("yes.")).toBe("once");
    expect(classifyConsequence("Yes, proceed")).toBe("once");
    // U+2019 in the real label, U+0027 in everybody's memory of it.
    expect(classifyConsequence("Yes, and don’t ask again for: rm -rf /")).toBe("persistent");
    expect(classifyConsequence("Yes, and don't ask again for: rm -rf /")).toBe("persistent");
    expect(classifyConsequence("Yes, allow all edits during this session")).toBe("persistent");
    expect(classifyConsequence("No, and tell Claude what to do differently (esc)")).toBe("decline");
    // "for this session" grants; "this session only" declines to grant.
    expect(classifyConsequence("This session only")).toBe("unknown");
    expect(classifyConsequence("Yes, for this session")).toBe("persistent");
    expect(classifyConsequence("Run it at low concurrency (Recommended)")).toBe("unknown");
    expect(classifyConsequence("")).toBe("unknown");
  });
});

describe("what answering would DO: a permission, or a turn in a conversation", () => {
  /**
   * THE ONE THAT MATTERS. `dialog-ask-user-question-colour.txt` was provoked in
   * a throwaway session of my own; the other two are other agents' live
   * sessions, read with `capture-pane` and nothing else. Three captures, three
   * different renderings of the same widget — a plain one, one whose body is
   * quoted with `│` bars, and one laid out in two columns with a preview box on
   * the right — and all three carry `☐ <header>` as the first line of the body.
   */
  for (const f of ["dialog-ask-user-question.txt", "dialog-ask-user-question-colour.txt"]) {
    it(`${f} is a conversation, and its body opens with the agent's own header`, () => {
      const q = ask(f);
      expect(q.gate).toEqual({ kind: "conversation" });
      expect(grantsPermission(q.gate)).toBe(false);
      // Paired with the above, so "the material was empty" cannot satisfy it.
      expect(read(f).text.split("\n")[0]).toMatch(/^\s*☐\s+\S/);
      expect(q.options.length).toBeGreaterThan(2);
    });
  }

  /**
   * And the four permission shapes, which must never reach `conversation`.
   * `dialog-bash-permission-git-log.txt` is a live capture of another agent
   * being asked about a `git log`, taken on 2026-09-08 — a second, independent
   * Bash approval, so the pair is not one screen twice.
   */
  for (const f of [
    "dialog-bash-permission.txt",
    "dialog-bash-permission-git-log.txt",
    "dialog-file-write-hello.txt",
    "dialog-edit-diff.txt",
    "dialog-folder-trust.txt",
  ]) {
    it(`${f} is a permission, named by the option that widens the session`, () => {
      const q = ask(f);
      expect(q.gate.kind).toBe("permission");
      expect(grantsPermission(q.gate)).toBe(true);
      if (q.gate.kind !== "permission") throw new Error("unreachable");
      expect(q.gate.why).toContain("widens");
      // The reason has to name a real option, not a generic sentence.
      expect(q.options.some((o) => q.gate.kind === "permission" && q.gate.why.includes(o.label))).toBe(true);
    });
  }

  /**
   * WHERE THE HARNESS'S OWN SETTINGS MENUS LAND, and the argument is in
   * `PaneGate`: answering one changes the harness's configuration rather than
   * approving a tool call or taking a turn, which is a genuinely third thing —
   * and we cannot tell it apart from an agent's question with evidence we
   * trust, so it says so. `/loop` is the sharp case: it is drawn by the SAME
   * select-menu widget as an agent's question, right down to the `Type
   * something.` and `Chat about this` rows, and answering it can create a cloud
   * schedule that outlives the session. It reaches `unknown` because it carries
   * no body to find a header in, and `unknown` is refused exactly as
   * `permission` is.
   */
  it("refuses the /loop scheduling menu and the model selector, and says which reason", () => {
    const loop = ask("dialog-loop-cloud-schedule.txt");
    expect(loop.material.kind).toBe("no-material");
    expect(loop.gate).toEqual({
      kind: "unknown",
      why: "the dialog's body is no-material, so the header that identifies an agent's own question is not there to check",
    });
    expect(grantsPermission(loop.gate)).toBe(true);

    const model = ask("dialog-model-selector.txt");
    expect(read("dialog-model-selector.txt").text).toContain("Select model");
    expect(model.gate).toEqual({
      kind: "unknown",
      why: "the dialog's body does not open with the header an agent's own question carries",
    });
    expect(grantsPermission(model.gate)).toBe(true);
  });

  /**
   * THE ATTACK THE FIRST-LINE RULE IS FOR, derived from a real capture by ONE
   * stated change: the file being written now contains a markdown to-do,
   * `☐ ship it`, which is ordinary prose and puts the ballot box inside the
   * proposal. A rule that searched the body would read that as an agent's own
   * question and hand a thumb a file write.
   *
   * TWO PASSES, AND NEITHER OF THEM IS THE FIRST-LINE RULE — which is the
   * point, and it was measured rather than assumed. Mutating the header test to
   * search the whole body left this test green: the first pass is caught by the
   * persistent option and the second, with that option removed, by the yes/no
   * shape. So what this test proves is that a permission dialog carrying a
   * checkbox has TWO defences in front of the one that would be tricked, which
   * is worth knowing and is not what its name suggests on its own. The
   * first-line rule is isolated by the test below, on a real agent question.
   */
  it("does not become a conversation because the file being written contains a checkbox", () => {
    const real = fixture("dialog-file-write-hello.txt");
    const planted = real.replace("  1 hello", "  1 ☐ ship it");
    expect(planted).not.toBe(real);
    expect(read("dialog-file-write-hello.txt").text).toContain("1 hello");

    const q = parsePane(planted);
    if (q.kind !== "question") throw new Error(`planted capture parsed as ${q.kind}`);
    // Positive: the checkbox really is in the body we would show the person...
    if (q.material.kind !== "read") throw new Error("planted capture lost its material");
    expect(q.material.text).toContain("☐ ship it");
    // ...and it is still an approval.
    expect(q.gate.kind).toBe("permission");

    const stripped = planted
      .replace(/^ {3}2\. Yes, and switch to accept edits.*\n/m, "")
      .replace("   3. No", "   2. No");
    expect(stripped).not.toContain("accept edits");
    const bare = parsePane(stripped);
    if (bare.kind !== "question") throw new Error(`stripped capture parsed as ${bare.kind}`);
    expect(bare.options.map((o) => o.label)).toEqual(["Yes", "No"]);
    expect(bare.gate.kind).toBe("permission");
    if (bare.gate.kind !== "permission") throw new Error("unreachable");
    expect(bare.gate.why).toContain("approval followed by a refusal");
  });

  /**
   * THE FIRST-LINE RULE, ISOLATED, on a dialog where nothing else can catch it.
   * Derived from the real `Colour` capture by ONE stated change: a line is put
   * above the `☐ Colour` header, so the ballot box is still in the body but is
   * no longer the first thing in it. Every option is the agent's own prose, so
   * neither permission signal fires and the header rule is the only thing left
   * standing — and it must refuse.
   *
   * This is the shape a permission dialog takes when the file it proposes
   * contains a checkbox: the tool's name on the first line, `☐ something`
   * further down. Here it is on a capture with no approval options at all, so
   * nothing can pass the test for the wrong reason.
   */
  it("wants the header on the first line of the body, not merely somewhere in it", () => {
    const real = fixture("dialog-ask-user-question-colour.txt");
    const derived = real.replace(" ☐ Colour", " Create file\n ☐ Colour");
    expect(derived).not.toBe(real);
    expect(ask("dialog-ask-user-question-colour.txt").gate).toEqual({ kind: "conversation" });

    const q = parsePane(derived);
    if (q.kind !== "question") throw new Error(`derived capture parsed as ${q.kind}`);
    // Positive: the ballot box really is still in the body, one line down...
    if (q.material.kind !== "read") throw new Error("derived capture lost its material");
    expect(q.material.text).toContain("☐ Colour");
    expect(q.material.text.split("\n")[0]?.trim()).toBe("Create file");
    // ...and no permission signal is available to catch this for us.
    expect(q.options.every((o) => o.consequence === "unknown")).toBe(true);

    expect(q.gate).toEqual({
      kind: "unknown",
      why: "the dialog's body does not open with the header an agent's own question carries",
    });
  });

  /**
   * The corpus-wide invariant, so a fixture added tomorrow cannot quietly
   * become tappable. Only files named `ask-user-question` may be a
   * conversation, and every one of them must be — a rule that fails in both
   * directions rather than one, since "nothing is a conversation" would satisfy
   * half of it.
   */
  it("lets nothing but a real agent question through, and lets all of them through", () => {
    const dialogs = readdirSync(FIXTURES).filter((f) => f.startsWith("dialog-")).sort();
    const conversations = dialogs.filter((f) => !grantsPermission(ask(f).gate));
    expect(conversations).toEqual(dialogs.filter((f) => f.includes("ask-user-question")));
    expect(conversations.length).toBeGreaterThanOrEqual(2);
  });

  /**
   * A REAL AGENT QUESTION IN TWO COLUMNS, WHICH THE PARSER WAS BLIND TO.
   *
   * Captured live from another agent's session on 2026-09-08, read-only. In a
   * wide pane, `AskUserQuestion` lays its options out in two columns with a
   * preview box on the right, and it indents the wrapped continuation of an
   * option's label to `digitCol + 2` — one column SHALLOWER than the label
   * itself. `gapsAreContinuations` required at least `labelCol`, so the run was
   * cut and the whole dialog reported `none`: **a blocked session showing as
   * not blocked**, which is the dashboard being blind to the thing it is for.
   * The corpus could not have caught it, because every dialog captured until
   * that day was drawn in one column.
   *
   * Two halves, and fixing either alone would have been worse than fixing
   * neither: the run, and the LABELS, which in this layout carry the right-hand
   * preview box glued on. Option 2's label came out as
   * `Write a PendingLabelsFile    │ - "structureHash": "847fa44562a719b9",`,
   * and that is what a person would have read on their phone.
   */
  it("reads a two-column agent question, options and all", () => {
    const text = fixture("dialog-ask-user-question-two-column.txt");
    // Positive: it is a real, well-formed dialog — header, cursor, three
    // numbered options at one digit column, and the select-menu footer.
    expect(text).toMatch(/^ ☐ Repair$/m);
    expect(text).toMatch(/^❯ 1\. Re-stamp structureHash/m);
    expect(text).toMatch(/^ {2}3\. Leave it red, write it up/m);
    expect(text).toMatch(/^Enter to select · ↑\/↓ to navigate/m);

    // The geometry that used to lose it, asserted so a future reader can see
    // the off-by-one rather than take it on trust.
    const lines = cleanLines(text);
    const option1 = lines.findIndex((l) => l.text.startsWith("❯ 1. Re-stamp"));
    expect(option1).toBeGreaterThan(0);
    const labelCol = lines[option1]?.text.indexOf("Re-stamp");
    const wrapped = lines[option1 + 1]?.text ?? "";
    expect(wrapped.trimStart()).toMatch(/^\(Recommended\)/);
    expect(wrapped.length - wrapped.trimStart().length).toBe((labelCol ?? 0) - 1);

    const q = parsePane(text);
    expect(q.kind).toBe("question");
    if (q.kind !== "question") return;
    // THE LABELS ARE THE LABELS, with no second column glued to them.
    expect(q.options.map((o) => o.label)).toEqual([
      "Re-stamp structureHash",
      "Write a PendingLabelsFile",
      "Leave it red, write it up",
    ]);
    expect(q.options.map((o) => o.key)).toEqual([
      { via: "digit", digit: "1" },
      { via: "digit", digit: "2" },
      { via: "digit", digit: "3" },
    ]);
    // And it is an agent's own question, so it is answerable.
    expect(q.gate).toEqual({ kind: "conversation" });
  });

  /**
   * The other direction, and the reason the loosening is bounded.
   *
   * A continuation must still be indented deeper than the option MARKER. A line
   * starting at or left of the digit column is a new top-level thing, and a run
   * that spans one is a run we made up — which is what the old rule was really
   * protecting, `labelCol` having been a proxy for it that the widget itself
   * does not respect.
   */
  it("still refuses a run that spans a line at the menu's own left edge", () => {
    const menu = [
      "Do you want to proceed?",
      "",
      "❯ 1. Yes",
      "  Something else entirely, at the digit column",
      "  2. No",
      "",
      "Enter to select · ↑/↓ to navigate · Esc to cancel",
      "",
    ].join("\n");

    /* Asserted on the KEYS rather than on `kind`, and that is the whole point of
       this test rather than a detail of it. `parseNumbered` refusing does not
       make the pane a `none`: `parseCursor` gets a look next, and here it takes
       all three lines as a cursor menu whose first label is the literal text
       "1. Yes". So "the numbered run was refused" and "nothing was found" are
       different claims, and only the first one is what the digit-column rule is
       responsible for. A test asserting `none` would have gone green the day
       somebody broke `parseCursor` instead. */
    const spanned = parsePane(menu);
    if (spanned.kind === "question") {
      expect(spanned.options.every((o) => o.key.via !== "digit")).toBe(true);
    }

    // The paired positive: the same line indented one column further —
    // `digitCol + 1`, which is the loosest thing the new rule admits — and the
    // numbered parser takes it, digits and all.
    const ok = parsePane(
      menu.replace("  Something else entirely, at the digit column", "   Something else entirely, at the digit column"),
    );
    expect(ok.kind).toBe("question");
    if (ok.kind !== "question") return;
    expect(ok.options.map((o) => o.key)).toEqual([
      { via: "digit", digit: "1" },
      { via: "digit", digit: "2" },
    ]);
    expect(ok.options.map((o) => o.label)).toEqual(["Yes", "No"]);
  });

  /**
   * The classifier on its own, where the inputs can be stated rather than
   * captured. `unknown` is reached by falling through and `conversation` never
   * is, which is the whole of the bias in four lines.
   */
  it("earns conversation and falls through to unknown", () => {
    const opt = (label: string): PaneOption => ({
      label,
      key: { via: "digit", digit: "1" },
      consequence: classifyConsequence(label),
    });
    const body = (text: string): PaneMaterial => ({ kind: "read", text, fingerprint: fingerprintMaterial(text) });

    expect(classifyGate(body("☐ Colour\n\nWhich colour?"), [opt("Red"), opt("Green")])).toEqual({
      kind: "conversation",
    });
    // The header, and one option that widens the session: permission wins.
    expect(
      classifyGate(body("☐ Colour"), [opt("Red"), opt("Yes, and don’t ask again for: rm -rf /")]).kind,
    ).toBe("permission");
    // The header, one line down instead of first.
    expect(classifyGate(body("Create file\n☐ Colour"), [opt("Red"), opt("Green")]).kind).toBe("unknown");
    // Read, headed, but we could not read the body at all.
    expect(classifyGate({ kind: "unreadable", why: "top border scrolled off" }, [opt("Red"), opt("Green")]).kind).toBe(
      "unknown",
    );
    expect(grantsPermission({ kind: "unknown", why: "x" })).toBe(true);
    expect(grantsPermission({ kind: "permission", why: "x" })).toBe(true);
    expect(grantsPermission({ kind: "conversation" })).toBe(false);

    // The predicate narrows, so a caller that refuses has the reason to hand
    // without re-narrowing. This line does not compile if that stops being true.
    const gate: PaneGate = classifyGate({ kind: "no-material" }, [opt("Yes"), opt("No")]);
    expect(grantsPermission(gate) ? gate.why : "").toContain("approval followed by a refusal");
  });

  /**
   * `☐` IS U+2610, WHICH SITS IN THE GAP BETWEEN TWO OF `DECORATION`'S RANGES.
   * Widening that class by a few code points would blank it into a space, every
   * agent question would quietly become `unknown`, and every test above would
   * still be green except this one — the feature would be gone and nothing
   * would say so.
   */
  it("keeps the ballot box that the whole safe arm rests on", () => {
    expect(cleanLines(" ☐ Colour")[0]?.text).toBe(" ☐ Colour");
    expect(cleanLines(" │ Colour")[0]?.text).toBe("   Colour");
  });
});

describe("ANSI", () => {
  /**
   * `capture-pane -p` strips escapes and `-p -e` keeps them, so a parser that
   * only works on one of the two is a trap for whoever adds colour later. The
   * paired fixtures are the same screen captured both ways.
   */
  for (const name of ["dialog-bash-permission", "dialog-folder-trust", "dialog-model-selector"]) {
    it(`${name} parses identically with and without escapes`, () => {
      const raw = fixture(`${name}-ansi.txt`);
      expect(raw.includes("\u001b[")).toBe(true);
      expect(parsePane(raw)).toEqual(parsePane(fixture(`${name}.txt`)));
    });
  }

  it("removes CSI, OSC and two-character escapes", () => {
    expect(stripAnsi("\u001b[1;32mgreen\u001b[0m")).toBe("green");
    expect(stripAnsi("\u001b]0;a title\u0007after")).toBe("after");
    expect(stripAnsi("\u001b(Bplain")).toBe("plain");
  });

  /**
   * Decoration becomes a space rather than vanishing, because indent is evidence
   * here — the label column is how a continuation line is told from the next
   * thing on screen. A `│` deleted at column 0 would shift every label left.
   */
  it("blanks box drawing without moving the text", () => {
    const [line] = cleanLines("│ 1. Yes");
    expect(line?.text).toBe("  1. Yes");
    expect(line?.rule).toBe("none");
  });

  /**
   * Solid is the dialog's own border, dashed is a separator inside it, and the
   * difference is what tells a whole dialog from the middle of one. A blank
   * line is neither — it has no characters to be made of.
   */
  it("tells the dialog's border from the separators inside it", () => {
    expect(cleanLines("──────")[0]?.rule).toBe("solid");
    expect(cleanLines("▔▔▔▔▔▔")[0]?.rule).toBe("solid");
    expect(cleanLines("╌╌╌╌╌╌")[0]?.rule).toBe("dashed");
    expect(cleanLines("┄┄┄┄┄┄")[0]?.rule).toBe("dashed");
    expect(cleanLines("      ")[0]?.rule).toBe("none");
  });
});

describe("addressing a pane", () => {
  /**
   * tmux's `-t` resolves a session name as happily as a pane id, and the
   * direction doc's hardest-won rule is to address by pane handle rather than by
   * name, because names get reassigned when a session dies. Refusing anything
   * that is not `%<digits>` makes that structural rather than a convention the
   * next caller has to remember.
   */
  it("takes a pane id and nothing else", () => {
    expect(isPaneId("%2108")).toBe(true);
    expect(isPaneId("%0")).toBe(true);
    expect(isPaneId("fleet-v01")).toBe(false);
    expect(isPaneId("$1643")).toBe(false);
    expect(isPaneId("%12 ")).toBe(false);
    expect(isPaneId("")).toBe(false);
  });

  it("refuses to shell out for anything that is not a pane id", () => {
    expect(() => capturePane("fleet-v01")).toThrow(/not a tmux pane id/);
  });
});
