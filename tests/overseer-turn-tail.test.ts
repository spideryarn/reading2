/**
 * Did this turn END, and what did it end by saying — tools/overseer/turn-tail.ts.
 *
 * EVERY FIXTURE THIS FILE READS IS A REAL CAPTURE, taken with
 * `tmux capture-pane -p -S -80` off this box on 2026-09-08, read only. Nothing
 * here is hand-written; where a case needs a shape the box did not offer, it is
 * DERIVED from a named capture by one stated change made in the test, so the
 * change sits next to the assertion. (The same directory also holds plan
 * 260910f's hand-written labelled set — everything not named `ended-*`,
 * `mid-turn-*` or `no-input-box-*` — which tests/overseer-attention-labels.test.ts
 * reads, and this file does not.)
 *
 * WHY THIS FILE EXISTS AT ALL, and it is a measurement rather than a taste.
 * `needs-you` means *Claude Code says a dialog is open*, and ten of fifteen
 * sessions genuinely waiting on Greg on 2026-09-08 had ended their turn handing
 * him a decision in sentences, ending in a full stop — none of them showed as
 * needing him, and a grep for question marks found 1 of 23
 * (docs/project/overseer-direction.md § `idle` is the bug). So the tail of
 * an ended turn is the material a model has to read, and everything in this file
 * is about cutting that material out of a pane correctly and cheaply.
 *
 * THE ASYMMETRY, and it points the other way from fleet-pane.test.ts. There, a
 * false question invites somebody to tap a digit into a live session. Here
 * nothing is answerable — a prose item renders an excerpt and a link and no
 * control at all — so the cost of a false positive is one wasted model call and
 * one card Greg dismisses, while the cost of a false negative is the thing this
 * stage exists to fix. The care therefore goes into `mid-turn`: classifying a
 * working session as ended would ask a model about a sentence that is still
 * being written, and would do it on every tick.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readTurnTail, tailFingerprint } from "../tools/overseer/turn-tail.js";

function pane(name: string): string {
  return readFileSync(new URL(`./fixtures/overseer-turn-tails/${name}`, import.meta.url), "utf8");
}

function fleetPane(name: string): string {
  return readFileSync(new URL(`./fixtures/fleet-panes/${name}`, import.meta.url), "utf8");
}

describe("readTurnTail — a turn that has ended", () => {
  it("finds the tail of a turn that ended by asking Greg something, in a full stop", () => {
    const tail = readTurnTail(pane("ended-prose-question-shut-it-down.txt"));
    expect(tail.kind).toBe("ended");
    if (tail.kind !== "ended") return;
    // The sentence a question-mark grep cannot see. This is the whole finding.
    expect(tail.tail).toContain("Say the word and I'll shut it down.");
    expect(tail.tail).not.toContain("?");
  });

  it("keeps the draft sitting unsent in the input box, and keeps it OUT of the tail", () => {
    const tail = readTurnTail(pane("ended-prose-question-shut-it-down.txt"));
    expect(tail.kind).toBe("ended");
    if (tail.kind !== "ended") return;
    // WHAT IS MEASURED AND WHAT IS INFERRED, kept apart, because the fleet
    // dashboard agent corrected an earlier telling of this on 2026-09-08 and the
    // correction is worth carrying. Measured: this pane's input box was
    // non-empty and held these words, in a session running in auto mode; and
    // separately, that a message sent at a pane CONCATENATES with what the box
    // already holds — a real send produced one turn neither half of which
    // anybody wrote, and the send reported success. Inferred: that these
    // particular words were never sent. The conclusion is the same either way,
    // and it is why a `prose` item gets no answer control at all in v1.
    //
    // For this parser the consequence is narrow and absolute: whatever is in the
    // box is not something the agent said, so it must never reach a classifier
    // as if it were.
    expect(tail.draft).toBe("yes, shut it all down");
    expect(tail.tail).not.toContain("yes, shut it all down");
  });

  it("counts a turn that ended while a background agent runs on as ended, and this is contested", () => {
    // FABLE DISAGREED WITH THIS ONE, reading the same capture cold on
    // 2026-09-08: it called `fb2g-gutter-icons-on-touch` mid-turn, on the
    // grounds that the session is not blocked on a person — a subagent will
    // wake it. That is a fair reading of what the SESSION is doing, and this
    // parser is answering a narrower question: has anything been SAID that a
    // person might now be needed for.
    //
    // The behaviour stays, and the cost is named. Treating this as mid-turn
    // would silently drop every turn that ended with a real question while a
    // background agent happened to be running — the case
    // `ended-prose-question-recogniser-fixes.txt` is exactly that, and it does
    // hold a decision. Keeping it costs one model call on a pane that is
    // usually quiet; dropping it loses a population without saying so.
    const tail = readTurnTail(pane("ended-while-a-background-agent-runs-on.txt"));
    expect(tail.kind).toBe("ended");
    if (tail.kind !== "ended") return;
    expect(tail.tail).toContain("the box refused a couple of new vitest starts");
  });

  it("counts a turn that ended while a background agent runs on as ended", () => {
    // `✻ Waiting for 1 background agent to finish` is not a spinner: the turn is
    // over, the input box is back, and the agent's last words are its last words.
    const tail = readTurnTail(pane("ended-prose-question-recogniser-fixes.txt"));
    expect(tail.kind).toBe("ended");
    if (tail.kind !== "ended") return;
    expect(tail.tail).toContain("prose-retention fallback");
    expect(tail.draft).toBe("keep going");
  });

  it("reads a turn that ended with a report and no question at all", () => {
    const tail = readTurnTail(pane("ended-prose-no-question-status-report.txt"));
    expect(tail.kind).toBe("ended");
    if (tail.kind !== "ended") return;
    expect(tail.tail).toContain("Still to do");
  });

  it("stops at the PREVIOUS input prompt, so Greg's own words never become the agent's", () => {
    // GPT Sol's finding 4, and it is the worst bug this file had. The backward
    // walk skipped rule lines and blank lines and ran straight past an earlier
    // `❯` in the scrollback — which is Greg's own last message, echoed. So a
    // turn that merely said "Done." would be handed to the classifier with
    // "Should I deploy this now?" attached to the front of it, and would become
    // a confident attention card quoting a question nobody's agent asked. The
    // fingerprint then caches the contamination.
    //
    // Derived from a real capture by one stated change: an earlier user turn is
    // put back above the agent's reply, which is what a real pane looks like
    // before the scrollback rolls it off.
    const real = pane("ended-prose-no-question-status-report.txt");
    const lines = real.split("\n");
    const contaminated = [
      "❯ Should I deploy this now?",
      "",
      ...lines,
    ].join("\n");
    const tail = readTurnTail(contaminated);
    expect(tail.kind).toBe("ended");
    if (tail.kind !== "ended") return;
    expect(tail.tail).not.toContain("Should I deploy this now?");
  });

  it("drops the harness's own chrome from the tail", () => {
    const tail = readTurnTail(pane("ended-prose-no-question-two-messages.txt"));
    expect(tail.kind).toBe("ended");
    if (tail.kind !== "ended") return;
    // The status line carries a clock and an elapsed time, and the notice line is
    // the harness talking about itself. Both would churn the fingerprint and
    // neither is anything the agent said.
    expect(tail.tail).not.toContain("done 12:44 PM");
    expect(tail.tail).not.toContain("Update installed");
  });
});

describe("readTurnTail — a turn that has NOT ended", () => {
  it("refuses a pane whose spinner is still turning", () => {
    const tail = readTurnTail(pane("mid-turn-spinner.txt"));
    expect(tail.kind).toBe("mid-turn");
  });

  it("refuses a mid-turn pane even when it is deep in a long shell command", () => {
    const tail = readTurnTail(fleetPane("none-working-empty-prompt.txt"));
    expect(tail.kind).toBe("mid-turn");
  });

  it("finds the status line under a queued message from another session", () => {
    // FOUND ON THE LIVE FLEET, 2026-09-08, by the `unreadable` arm doing its job:
    // one of thirty panes came back "the line above the input box is neither a
    // spinner nor a finished turn". Claude Code draws an incoming cross-session
    // message BETWEEN the status line and the input box, over two lines with no
    // marker on the second, so a walk that expected the first non-chrome line to
    // be the status line stopped on somebody else's message.
    //
    // The fix is not another entry in a taxonomy of chrome. It is to SEARCH
    // upward for a status line rather than to demand the first line be one — a
    // recogniser keyed to the shapes the harness happens to draw today would go
    // on being wrong every time it drew a new one, and would report every
    // session as unreadable rather than saying which shape it had not met.
    const tail = readTurnTail(pane("mid-turn-with-queued-message.txt"));
    expect(tail.kind).toBe("mid-turn");
  });

  it("still refuses a pane with no status line anywhere above the box", () => {
    // The search is bounded, so the arm that found the bug above can still fire.
    // A pane whose chrome we have never met must say so rather than reach far
    // enough up to mistake a line of prose for a status line.
    const capture = pane("mid-turn-with-queued-message.txt").replace(/^.*Frosting.*$/m, "  some prose instead");
    const tail = readTurnTail(capture);
    expect(tail.kind).toBe("unreadable");
  });
});

describe("readTurnTail — panes that are not a Claude Code turn", () => {
  it("refuses a Codex TUI, which has an input box of its own", () => {
    const tail = readTurnTail(pane("no-input-box-codex-tui.txt"));
    expect(tail.kind).toBe("no-input-box");
  });

  it("refuses a job shell", () => {
    const tail = readTurnTail(pane("no-input-box-job-shell.txt"));
    expect(tail.kind).toBe("no-input-box");
  });

  it("never turns a pane with a dialog up into a prose tail", () => {
    // A dialog is OBSERVED evidence and goes down the other path entirely
    // (`parsePane`), so the pass never asks this function about one. Asked
    // directly it answers `unreadable` — *there is something on this screen I
    // cannot read* — which is the honest answer and, since the pass counts
    // `unreadable` as NOT read, the safe one. What matters, and what this pins,
    // is that it is never `ended`: a dialog must not become a prose item.
    const tail = readTurnTail(fleetPane("dialog-bash-permission.txt"));
    expect(tail.kind).not.toBe("ended");
    expect(tail.kind).toBe("unreadable");
  });

  it("refuses an empty pane", () => {
    const tail = readTurnTail(fleetPane("none-blank-pane.txt"));
    expect(tail.kind).toBe("no-input-box");
  });

  it("calls a dialog it cannot parse UNREADABLE, not a pane that is none of our business", () => {
    // GPT Sol's finding 1, third variant, and the failure is severe: if the
    // harness changes how it draws a dialog, `parsePane` stops recognising them,
    // every such pane lands in `no-input-box`, `no-input-box` counts as READ, and
    // the whole box draws as a calm fleet with every question on it invisible.
    //
    // Derived from a real capture by one stated change: the numbered option lines
    // are removed, so `parsePane` no longer recognises the dialog. What is left is
    // what a future harness's unrecognised dialog would look like.
    const gutted = fleetPane("dialog-bash-permission.txt")
      .split("\n")
      .filter((l) => !/^\s*[❯>]?\s*\d\.\s/.test(l))
      .join("\n");
    expect(readTurnTail(gutted).kind).toBe("unreadable");
  });
});

describe("the dialog key-hint line, which is a SECOND COPY of pane.ts's private `isFooter`", () => {
  // Pinned against the real captures, because a duplicated recogniser that drifts
  // fails in the direction that draws a calmer fleet than the box deserves. If
  // `pane.ts` changes its line and this does not, one of these goes red.
  const DIALOGS = [
    "dialog-bash-permission.txt",
    "dialog-ask-user-question.txt",
    "dialog-file-write.txt",
    "dialog-folder-trust.txt",
    "dialog-model-selector.txt",
    "dialog-loop-cloud-schedule.txt",
  ];

  it.each(DIALOGS)("%s carries it", (name) => {
    const stripped = fleetPane(name)
      .split("\n")
      .filter((l) => !/^\s*[❯>]?\s*\d\.\s/.test(l))
      .join("\n");
    // With the options gone `parsePane` cannot see a dialog, so the ONLY thing
    // standing between this pane and a calm fleet is the key-hint line.
    expect(readTurnTail(stripped).kind).toBe("unreadable");
  });

  it.each(["none-bare-shell.txt", "none-blank-pane.txt"])("%s does not", (name) => {
    expect(readTurnTail(fleetPane(name)).kind).toBe("no-input-box");
  });
});

describe("tailFingerprint — the cache key, and what it must and must not notice", () => {
  it("is unchanged when only the elapsed clock and the draft move", () => {
    // THE COST CONSTRAINT THIS SERVES (Astra's A30): thirty-six sessions must
    // not trigger thirty-six model reviews a minute. A key that churned on the
    // status line's clock would classify every session on every tick.
    const capture = pane("ended-prose-question-shut-it-down.txt");
    const later = capture
      .replace("done 2:11 AM", "done 2:11 AM · 3 shells still running")
      .replace("yes, shut it all down", "yes, shut it all down and tell me when");
    const a = readTurnTail(capture);
    const b = readTurnTail(later);
    expect(a.kind).toBe("ended");
    expect(b.kind).toBe("ended");
    if (a.kind !== "ended" || b.kind !== "ended") return;
    expect(b.fingerprint).toBe(a.fingerprint);
  });

  it("changes when the agent says something new", () => {
    const capture = pane("ended-prose-question-shut-it-down.txt");
    const later = capture.replace("Say the word and I'll shut it down.", "Shutting it down now.");
    const a = readTurnTail(capture);
    const b = readTurnTail(later);
    if (a.kind !== "ended" || b.kind !== "ended") return;
    expect(b.fingerprint).not.toBe(a.fingerprint);
  });

  it("is a function of the tail alone, so two panes that said the same thing share a key", () => {
    const one = readTurnTail(pane("ended-prose-question-shut-it-down.txt"));
    if (one.kind !== "ended") return;
    expect(tailFingerprint(one.tail)).toBe(one.fingerprint);
  });
});
