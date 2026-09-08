/**
 * DID THIS TURN END, AND WHAT DID IT END BY SAYING?
 *
 * ## The finding this exists for
 *
 * `docs/project/overseer-direction.md` § "`idle` is the bug: the vocabulary
 * describes the pane, not the work". Measured on the live fleet 2026-09-08:
 * **ten of fifteen sessions genuinely waiting on Greg had ended their turn
 * handing him a decision in sentences, and not one of them showed as needing
 * him.** A mechanical check found 1 of 23 by grepping for question marks,
 * because the decisions end in full stops. `needs-you` means *Claude Code says a
 * dialog is open*, so a list built from it is a list of the cheapest thing on
 * the box.
 *
 * The direction doc splits that finding in two. The mechanical half — a
 * subprocess under a pane — is `work.ts`. **This is the material for the other
 * half**, which the doc is explicit is not a parse: *"has this agent asked Greg
 * something?" is a judgement*. Nothing in this file makes that judgement. It
 * cuts the thing a model has to read out of a pane, and refuses when there is
 * nothing to cut.
 *
 * ## Why the pane and not the transcript
 *
 * The transcript is more authoritative about what an agent said, and it was the
 * obvious choice. Three things decided against it, and they are worth having
 * written down because it is the kind of decision that gets re-litigated:
 *
 *  - **Mapping a session to a transcript is a claim that decays.** The only
 *    handle we have is `ObservedRow.claimedConversationId`, and its own comment
 *    says it is pinned into the tmux environment before Claude runs and is never
 *    updated, so a pane on its second conversation still names its first. A
 *    prose question read off the wrong conversation is worse than none.
 *  - **The ground truth was read off panes.** Fable's 38-pane read is the
 *    measurement this stage is scored against, so classifying from a different
 *    source would make every disagreement ambiguous between *the classifier was
 *    wrong* and *the two were looking at different things*.
 *  - **One `tmux capture-pane` costs about a millisecond.** Resolving a
 *    transcript means walking `~/.claude/projects`, which on this box is the
 *    ~12-second grep the direction doc is emphatic about not doing twice.
 *
 * **The cost of that choice, named rather than discovered later:** Claude Code
 * draws on the terminal's ALTERNATE SCREEN, which has no scrollback, so
 * `capture-pane -S -80` returns the same ~25 to ~31 lines as `capture-pane`
 * alone. We see the last screenful of a turn and no more. A turn that ended with
 * a question and then printed forty lines of a diff has pushed its own question
 * off the top, and we will not see it. That is a floor on recall this design
 * cannot lift; it is not a bug to be fixed in the parser.
 *
 * ## What "ended" means here, and the one asymmetry
 *
 * `ended` means *the input box is back and the spinner is not turning*: the
 * agent has stopped generating and the next thing to happen is a person typing.
 * It deliberately includes a turn that ended while a background agent runs on —
 * `✻ Waiting for 1 background agent to finish` — because the agent's last words
 * are its last words either way.
 *
 * The care in this file goes into `mid-turn`, and that is the opposite emphasis
 * from `pane.ts`. There, a false question invites somebody to tap a digit into a
 * live session, so most of the file is about saying `none`. Here nothing is
 * answerable at all — a prose item renders an excerpt, a reason and a link, with
 * no control — so a false positive costs one model call and one card Greg
 * dismisses. A pane misread as `ended` while its spinner turns, though, is a
 * model call about a half-written sentence, **repeated on every tick**, which is
 * the cost constraint (Astra's A30: thirty-six sessions must not trigger
 * thirty-six model reviews a minute).
 *
 * ## Pure, and testable against captures
 *
 * Nothing here runs `tmux`; `attention-probe.ts` does that. The same split as
 * `work.ts` / `work-probe.ts`, for the same reason: a classifier that reaches
 * for the machine cannot be tested against the machine's stranger days.
 */
import { createHash } from "node:crypto";

import { cleanLines, isInputPrompt } from "../fleet/pane.js";

/**
 * What a pane can tell us about whether its turn has ended.
 *
 * FOUR ARMS RATHER THAN A NULLABLE STRING, and each of the three refusals means
 * something different to the caller. `mid-turn` says *ask again later, this one
 * is alive*. `no-input-box` says *this is not a Claude Code turn at all* — a
 * shell, a Codex TUI, or a dialog, and a dialog goes down the observed path in
 * `pane.ts` instead. `unreadable` says *there is a Claude Code pane here and we
 * could not make sense of it*, which is the arm that must stay visible: if the
 * harness redraws its status line in a future version, every session lands here,
 * and an empty inbox drawn from thirty unreadable panes must not look like a
 * calm fleet (docs/reusable/silent-success.md).
 */
export type TurnTail =
  | {
      kind: "ended";
      /** What the agent last said, chrome removed. Never includes `draft`. */
      tail: string;
      /** The cache key. A function of `tail` alone — see `tailFingerprint`. */
      fingerprint: string;
      /** Text sitting UNSENT in the input box. Not something the agent said. */
      draft: string | null;
    }
  | { kind: "mid-turn"; why: string }
  | { kind: "no-input-box"; why: string }
  | { kind: "unreadable"; why: string };

/**
 * How much of the tail we keep, in lines and then in characters.
 *
 * The line cap is generous against a ~25-line alternate screen and exists only
 * so a pane with an unusually tall window cannot post a whole essay to a model.
 * The character cap is the one that binds, and it is the budget: at ~4000
 * characters a tail is roughly a thousand tokens, so a full fleet pass is
 * bounded whatever the panes happen to contain. Both trim from the TOP, because
 * the end of a turn is the part that asks.
 */
export const MAX_TAIL_LINES = 40;
export const MAX_TAIL_CHARS = 4000;

/**
 * The cache key: a hash of the tail and nothing else.
 *
 * **A function of the tail alone, deliberately.** The status line carries an
 * elapsed time and a wall clock, and the input box carries whatever Greg has
 * half-typed; a key that noticed either would re-classify every session on every
 * tick, which is exactly the cost A30 forbids. It also means two sessions that
 * ended their turns saying the same thing share a key, which is the beginning of
 * duplicate collapse rather than a collision to defend against.
 *
 * Truncated to 16 hex characters. It is a cache key and a card id, not a
 * signature over anything an attacker would gain by colliding.
 */
export function tailFingerprint(tail: string): string {
  return createHash("sha256").update(tail, "utf8").digest("hex").slice(0, 16);
}

/**
 * Claude Code's footer, which is the positive evidence that an input box is
 * Claude Code's and not somebody else's.
 *
 * Required rather than treated as a bonus. A Codex TUI draws its own input box
 * (`› Ask Codex to do anything`) and a shell prompt can be anything at all, so an
 * anchor that trusted a `❯` alone would read a Codex pane's prompt as a Claude
 * Code turn and hand a model the wrong harness's chrome. `⏵⏵` is the permission
 * mode indicator and `[Opus 5 (1M context)]` is the model line; every live
 * Claude Code pane on this box on 2026-09-08 carried at least one.
 */
function isClaudeFooter(text: string): boolean {
  return /⏵⏵/.test(text) || /^\s*\[[^\]]+\]\s+\S/.test(text);
}

/** How far below the input box the footer is allowed to be. Two rules, a model line, a mode line. */
const FOOTER_WINDOW = 8;

/**
 * A dialog's key-hint line — "Esc to cancel · Tab to amend".
 *
 * A SECOND COPY of `pane.ts`'s private `isFooter`, and the duplication is
 * declared rather than hidden: that file is another session's tree and does not
 * export it. Present in all six `dialog-*` captures under
 * tests/fixtures/fleet-panes/ and in neither shell capture — measured, and
 * tests/overseer-turn-tail.test.ts pins it against the real fixtures so a drift
 * shows up as a red test rather than as a quietly calmer fleet.
 */
const DIALOG_KEY_HINT = /(?:^|·|\s)(?:enter|esc|tab|space|↑\/↓|←\/→)\s+to\s+\w+/i;

/** Codex's own input prompt, which says what it is. */
const CODEX_PROMPT = /›\s*Ask Codex to do anything/i;

/**
 * The spinner: a gerund, an ellipsis, and a parenthesised elapsed time —
 * `✽ Cascading… (34m 8s · ↓ 43.9k tokens)`.
 *
 * Matched on the SHAPE rather than on the verb, because the verb is drawn from a
 * list of a few hundred whimsical participles that changes between releases, and
 * a recogniser keyed to the list would silently start calling every working
 * session `ended` after an upgrade — a change that reports success while doing
 * nothing, which is this project's commonest bug.
 */
const SPINNER = /…\s*\(\s*(?:\d+h\s*)?(?:\d+m\s*)?\d+s\b/;

/** Codex's spinner, which says so in as many words. Only reachable if a pane fools the footer check. */
const CODEX_SPINNER = /\besc to interrupt\b/i;

/**
 * The finished line — `✻ Cooked for 9m 15s · done 1:12 PM`, and the one case
 * that is not a spinner and not a clock:
 * `✻ Waiting for 1 background agent to finish`.
 *
 * The turn is over in both. The second is the interesting one: the agent stopped
 * generating and handed control back while an agent it spawned carries on, so
 * its last words are exactly as final as the first case's.
 */
const FINISHED = /·\s*done\s+\d/i;
const FINISHED_WAITING = /^\s*\S?\s*Waiting for \d+ background agents? to finish\b/i;

/**
 * How far above the input box a status line may be.
 *
 * Six, which is the queued cross-session message (two lines) plus a `⎿ Tip:`
 * (two, wrapped) plus slack. Bounded on purpose: the point of searching rather
 * than matching the first line is to survive a chrome shape we have not met, and
 * the point of the bound is that a pane with NO status line still says so
 * instead of walking back into the transcript and finding a sentence that
 * happens to end in a parenthesised duration.
 */
const STATUS_SEARCH_LINES = 6;

function isStatusLine(text: string): boolean {
  return SPINNER.test(text) || CODEX_SPINNER.test(text) || FINISHED.test(text) || FINISHED_WAITING.test(text);
}

/**
 * Lines that are the harness talking about itself, not the agent talking.
 *
 * Both are right-aligned notices drawn beside the status line — `✔ Update
 * installed · Restart to update`, `new task? /clear to save 168.7k tokens` — and
 * the `⎿ Tip:` line beneath it. They churn, they are not the agent's words, and
 * a fingerprint that included them would expire on the harness's schedule rather
 * than on the agent's.
 */
function isHarnessNotice(text: string): boolean {
  const t = text.trim();
  if (t === "") return false;
  return (
    /^⎿\s*Tip:/.test(t) ||
    /^✔\s/.test(t) ||
    /^new task\?/.test(t) ||
    /^\(?ctrl\+/i.test(t) ||
    /^esc to /i.test(t)
  );
}

/**
 * Cut the tail of an ended turn out of a pane capture.
 *
 * The anchor is the LAST input-prompt line, because Claude Code's input box is
 * the bottom-most `❯` on the screen and an earlier one is scrollback — an echo
 * of something Greg typed, which `pane.ts` documents at `isInputPrompt` as the
 * guard that saves it from a prose numbered list.
 */
export function readTurnTail(capture: string): TurnTail {
  const lines = cleanLines(capture);

  let box = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line === undefined || !isInputPrompt(line.text)) continue;
    const footer = lines
      .slice(i + 1, i + 1 + FOOTER_WINDOW)
      .some((l) => isClaudeFooter(l.text));
    if (footer) {
      box = i;
      break;
    }
  }
  if (box < 0) {
    // TWO VERY DIFFERENT THINGS, AND THEY USED TO BE ONE ARM. GPT Sol's finding
    // 1, third variant: a pane that is positively NOT Claude Code and a Claude
    // Code pane whose input box has been taken away by a dialog we could not
    // parse are not the same fact. Counting the second as understood means a
    // harness dialog-format change turns every question on the box into a calm
    // fleet — the exact silent success this stage exists to refuse.
    //
    // The permission-mode footer cannot separate them — MEASURED: none of the six
    // dialog captures under tests/fixtures/fleet-panes/ carries `⏵⏵` at all,
    // because Claude Code takes the footer away along with the input box. So the
    // signal is the DIALOG'S KEY-HINT LINE, which every one of those six does
    // carry and neither shell capture does.
    //
    // That is `pane.ts`'s own finding, reused rather than re-derived — its
    // `isFooter` says of the same line: *"the one marker that prose never
    // produces by accident, and it is required rather than treated as a bonus for
    // exactly that reason"*. It is not exported, and `tools/fleet/` is another
    // session's tree, so this is a second copy of that shape and the drift is a
    // real risk. It is worth taking here because the failure it guards is the
    // whole point of the stage and the failure it can cause is one extra
    // `unreadable`.
    if (CODEX_PROMPT.test(capture)) {
      return { kind: "no-input-box", why: "a Codex TUI, which draws its own input box and is not ours to read" };
    }
    if (lines.some((l) => DIALOG_KEY_HINT.test(l.text))) {
      return {
        kind: "unreadable",
        why:
          "no input box, but a dialog's key-hint line is on screen and `parsePane` did not recognise a " +
          "dialog. Something is up there we cannot read — most likely a shape the harness has changed. " +
          "This must NOT be counted as a pane we understood, or a dialog-format change turns every " +
          "question on the box into a calm fleet.",
      };
    }
    return {
      kind: "no-input-box",
      why: "no input box and no dialog on screen, so this is a shell pane or an empty one",
    };
  }

  const draftRaw = (lines[box]?.text ?? "").replace(/^\s*❯\s?/, "").trim();
  const draft = draftRaw === "" ? null : draftRaw;

  // SEARCH upward for the status line rather than demanding the first non-blank
  // line above the box be one.
  //
  // This walk used to stop at the first line it did not recognise as chrome, and
  // the live fleet broke it within the hour: Claude Code draws an incoming
  // cross-session message BETWEEN the status line and the input box, over two
  // lines with no marker on the second, so one of thirty panes came back
  // `unreadable` naming another session's message. The fix is deliberately not a
  // third entry in a taxonomy of chrome — the harness will keep inventing
  // shapes, and a recogniser that has to know all of them fails on the next one
  // — but the status line's own shape is stable and distinctive, so we look for
  // it.
  //
  // BOUNDED, so the `unreadable` arm that found that bug can still fire. A pane
  // with no status line within reach says so rather than reaching far enough up
  // to mistake a line of prose for one.
  let cursor = -1;
  let scanned = 0;
  for (let i = box - 1; i >= 0 && scanned < STATUS_SEARCH_LINES; i--) {
    const line = lines[i];
    if (line === undefined) break;
    // A rule line carrying the session name — `──── fleet-dictation ─` — survives
    // `cleanLines` as its name, so it is not `rule` and has to be recognised here.
    if (line.rule !== "none" || line.text.trim() === "" || isBorderedName(line.raw)) continue;
    scanned += 1;
    if (isStatusLine(line.text)) {
      cursor = i;
      break;
    }
  }
  if (cursor < 0) {
    const above = lines
      .slice(Math.max(0, box - STATUS_SEARCH_LINES), box)
      .map((l) => l.text.trim())
      .filter((t) => t !== "");
    return {
      kind: "unreadable",
      why:
        `no status line within ${STATUS_SEARCH_LINES} lines above the input box, so we cannot tell whether ` +
        `this turn has ended. The harness may have changed how it draws this. Last saw: ` +
        `${JSON.stringify(above.slice(-2).join(" / ").slice(0, 160))}`,
    };
  }

  const status = lines[cursor]?.text ?? "";
  if (SPINNER.test(status) || CODEX_SPINNER.test(status)) {
    return { kind: "mid-turn", why: `still generating: ${JSON.stringify(status.trim().slice(0, 80))}` };
  }

  const body: string[] = [];
  for (let i = cursor - 1; i >= 0 && body.length < MAX_TAIL_LINES; i--) {
    const line = lines[i];
    if (line === undefined) break;
    // STOP AT THE PREVIOUS INPUT PROMPT. GPT Sol's finding 4, and the worst bug
    // this file had: the walk skipped rules and blanks and ran straight past an
    // earlier `❯` in the scrollback — which is GREG'S OWN LAST MESSAGE, echoed.
    // A turn that merely said "Done." was then handed to the classifier with
    // "Should I deploy this now?" attached to the front of it, and became a
    // confident attention card quoting a question nobody's agent asked. The
    // fingerprint cached the contamination, so it would have persisted.
    //
    // A `break` rather than a `continue`, and that is the whole fix: everything
    // above that line belongs to an earlier exchange, and the tail's contract is
    // WHAT THIS TURN SAID.
    if (isInputPrompt(line.text)) break;
    if (line.rule !== "none" || isHarnessNotice(line.text) || isBorderedName(line.raw)) continue;
    body.push(line.text);
  }
  body.reverse();

  const tail = clampFromTheTop(body.join("\n").replace(/^\s*\n+/, "").replace(/\s+$/, ""));
  if (tail.trim() === "") {
    return { kind: "unreadable", why: "the turn ended but the pane holds none of what it said" };
  }
  return { kind: "ended", tail, fingerprint: tailFingerprint(tail), draft };
}

/** A rule line with the session's name written into it — decoration, then a name, then decoration. */
function isBorderedName(raw: string): boolean {
  return /^[\s─╌┄]*─[\s─╌┄]*\S.*[\s─╌┄]─[\s─╌┄]*$/.test(raw) && /─{8}/.test(raw);
}

/** Trim to the LAST `MAX_TAIL_CHARS`: the end of a turn is the part that asks. */
function clampFromTheTop(text: string): string {
  if (text.length <= MAX_TAIL_CHARS) return text;
  return text.slice(text.length - MAX_TAIL_CHARS);
}
