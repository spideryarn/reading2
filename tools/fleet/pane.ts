/**
 * v0.4 of the fleet dashboard: what a blocked session is asking.
 *
 * READ-ONLY BY CONSTRUCTION, like the rest of tools/fleet. Nothing here sends a
 * keystroke; it works out what *would* be sent, and hands that to a caller that
 * has its own decision to make. See docs/project/orchestrator-direction.md for
 * the direction and the measured constraints, and
 * docs/plans/260907e-agent-fleet-dashboard.md § v0.4 for the slice.
 *
 * WHY THIS IS THE HIGH-VALUE SLICE. "Needs you" on this box is usually a
 * numbered modal dialog, not a text prompt (measured 2026-09-07, and every
 * dialog captured on 2026-09-08 agreed). A free-text steering message cannot
 * answer one of those. A digit can.
 *
 * THE FALSE POSITIVE IS THE DANGEROUS CASE, and it drives every rule below. If
 * we tell the page that a working session is asking a question, someone taps an
 * option on their phone and a digit lands in the middle of a session that was
 * mid-task. Reporting nothing costs a glance at the terminal; reporting a
 * question that is not there corrupts somebody else's work. So this parser is
 * deliberately biased towards `none`: it requires the cursor, the footer and the
 * absence of an input box, all three, and if a real dialog shape turns up that
 * lacks one of them the fix is to teach it that shape — not to relax a rule.
 *
 * The specific accident it is written against: agents on this box write
 * numbered lists in prose constantly ("Three decisions, all yours: 1. … 2. …"),
 * and one of the fixtures here is a live pane doing exactly that while idle.
 * A naive "line starts with a digit and a dot" parser calls that a four-option
 * menu.
 */
import { execFileSync } from "node:child_process";

/**
 * What to send to choose an option.
 *
 * Three arms rather than a digit and a nullable count, because the three cases
 * genuinely need different keystrokes and a caller that forgets one should not
 * compile. A numbered menu takes a digit; a cursor menu (the folder-trust
 * prompt has no numbers at all) takes arrows and then Enter; and the option the
 * cursor is already on takes Enter alone, which is not "zero Down presses" in
 * any useful sense — it is the case where pressing anything at all would be
 * wrong.
 */
export type OptionKey =
  | { via: "digit"; digit: string }
  /** `presses` is always >= 1. `key` is the tmux key name, so it can be passed straight through. */
  | { via: "arrows"; key: "Down" | "Up"; presses: number }
  | { via: "selected" };

export type PaneOption = { label: string; key: OptionKey };

/**
 * The answer. `none` is not an error and not an absence of data — it is the
 * assertion that this pane is not asking anything, which is what almost every
 * pane on the box is doing at any moment.
 *
 * `options` IS WHAT IS ON THE SCREEN, WHICH IS NOT ALWAYS ALL OF THEM. A long
 * menu scrolls: the model selector shows four rows and a `… +1 model` line, and
 * a pane capture cannot see the fifth. The digits we report are still correct —
 * `5` would still choose it — we simply do not know its label. Anything that
 * renders this should read as "here are the options" rather than "there are
 * four", and if that ever matters enough, the fix is a `truncated` flag here
 * rather than a guess in the caller.
 */
export type PaneQuestion =
  | { kind: "none" }
  | { kind: "question"; prompt: string; options: PaneOption[] };

/**
 * Strip ANSI escapes.
 *
 * `tmux capture-pane -p` already strips these, but `-p -e` keeps them and a
 * caller that wants colour will use it, so a parser that only works on one of
 * the two flags is a trap. CSI first (the common `\x1b[1;32m`), then OSC (which
 * ends with BEL or ST and can carry arbitrary text, so it must be removed before
 * anything else looks at that text), then the two-character escapes.
 */
export function stripAnsi(s: string): string {
  return s
    .replace(new RegExp("\\u001b\\][^\\u0007\\u001b]*(?:\\u0007|\\u001b\\\\)", "g"), "")
    .replace(new RegExp("\\u001b\\[[0-9;?]*[ -/]*[@-~]", "g"), "")
    .replace(new RegExp("\\u001b[@-Z\\\\-_]", "g"), "")
    // ESC ( B and friends: the nF charset-designation sequences, which a
    // terminal emits around box drawing and which are not Fe escapes.
    .replace(new RegExp("\\u001b[ -/]+[0-~]", "g"), "");
}

/**
 * Box drawing, block elements and the geometric shapes used as bullets.
 *
 * Claude Code draws its dialogs out of these, so they are noise in every field
 * we want. `❯` (U+276F) is deliberately NOT in here — it is the cursor, and it
 * is the single most load-bearing character on the screen for this module.
 * Neither are the arrows `↑ ↓ ←`, which appear in the cursor column as a
 * "there is more above/below" hint and would otherwise silently become spaces
 * and change a line's indent.
 */
const DECORATION = /[─-╿▀-▟■-◿⬛-⬜]/g;

/** One line of the pane, cleaned, with the columns preserved. */
type Line = {
  /** Decorations replaced by spaces, so indent is unchanged and comparable. */
  text: string;
  /** True when the raw line held nothing but decoration and whitespace — a horizontal rule. */
  isRule: boolean;
};

/**
 * Clean a capture into lines.
 *
 * Decoration becomes a space rather than being deleted, because indent is
 * evidence here: an option's label column is how a continuation line is told
 * from the next thing on the screen, and deleting a `│` at column 0 would shift
 * every label one to the left.
 */
export function cleanLines(capture: string): Line[] {
  return stripAnsi(capture)
    .split("\n")
    .map((raw) => {
      const text = raw.replace(DECORATION, " ").replace(/\s+$/, "");
      return { text, isRule: text.trim() === "" && raw.trim() !== "" };
    });
}

/**
 * The Claude Code input box's prompt line, which is the proof that no modal is up.
 *
 * When Claude Code shows a dialog it takes the input box away; when it is
 * working, idle, or merely printing, the box is there. So an input prompt
 * *below* a candidate menu means the candidate is scrollback — an echo of
 * something Greg typed earlier, which is rendered with the same `❯` and can
 * absolutely be a numbered list. This is the guard that saves us from
 * `none-idle-with-prose-numbered-list.txt`, where the pane really does contain
 * a well-formed 1–4 list.
 */
function isInputPrompt(text: string): boolean {
  return /^\s*❯(\s|$)/.test(text);
}

/**
 * The dialog's key hint line — "Esc to cancel · Tab to amend".
 *
 * Every dialog captured on this box on 2026-09-08 has one, in all four shapes
 * (permission-to-run, permission-to-write, the model selector, folder trust),
 * as does the `/loop` scheduling menu captured on 2026-09-07. It is the one
 * marker that prose never produces by accident, and it is required rather than
 * treated as a bonus for exactly that reason.
 */
function isFooter(text: string): boolean {
  return /(?:^|·|\s)(?:enter|esc|tab|space|↑\/↓|←\/→)\s+to\s+\w+/i.test(text);
}

/** A line that looks like `❯ 3. Some label`, wherever the cursor and the digit sit. */
type NumberedLine = {
  index: number;
  n: number;
  /** Column of the digit, so a menu is not merged with a prose list at another indent. */
  digitCol: number;
  /** Column the label starts at, which is also the indent a continuation line must reach. */
  labelCol: number;
  cursor: boolean;
  label: string;
};

const NUMBERED = /^(\s*)(❯|↑|↓)?\s*(\d+)\.\s+(\S.*)$/;

function numberedLine(text: string, index: number): NumberedLine | null {
  const m = NUMBERED.exec(text);
  if (!m) return null;
  const digitCol = text.indexOf(`${m[3]}.`);
  return {
    index,
    n: Number(m[3]),
    digitCol,
    labelCol: text.length - (m[4] ?? "").length,
    cursor: m[2] === "❯",
    label: (m[4] ?? "").trim(),
  };
}

/** A line that looks like `❯ Yes, I trust this folder` — a menu with no numbers. */
type CursorLine = { index: number; labelCol: number; cursor: boolean; label: string };

function cursorLine(text: string, index: number): CursorLine | null {
  const m = /^(\s*)(❯)?\s*(\S.*)$/.exec(text);
  if (!m) return null;
  const label = (m[3] ?? "").trim();
  if (label === "") return null;
  return { index, labelCol: text.length - (m[3] ?? "").length, cursor: m[2] === "❯", label };
}

/**
 * Everything after the options, up to a few lines, must contain a footer and
 * must not contain an input prompt.
 *
 * The window is small because a dialog's hint line is immediately under it; a
 * "footer" found forty lines away is a coincidence, not a dialog. The model
 * selector puts two lines between (`… +1 model`, the effort row), so four is
 * comfortable rather than tight.
 */
function tailIsDialogLike(lines: readonly Line[], lastOption: number): boolean {
  const after = lines.slice(lastOption + 1);
  if (after.some((l) => isInputPrompt(l.text))) return false;
  const meaningful = after.filter((l) => l.text.trim() !== "").slice(0, 4);
  return meaningful.some((l) => isFooter(l.text));
}

/**
 * The dialog's own text, above its options.
 *
 * Bounded by the last horizontal rule, because that is what Claude Code draws
 * between a dialog's sections: the rule under a diff means the question is the
 * one line below it, and the rule at the top of a permission dialog means the
 * whole body belongs to the question. Falling back to ten lines when there is no
 * rule keeps a bare menu (the `/loop` one arrives with none) from swallowing the
 * transcript above it.
 */
function promptAbove(lines: readonly Line[], firstOption: number): string {
  let start = Math.max(0, firstOption - 10);
  for (let i = firstOption - 1; i >= start; i--) {
    if (lines[i]?.isRule) {
      start = i + 1;
      break;
    }
  }
  return lines
    .slice(start, firstOption)
    .map((l) => l.text.trim())
    .filter((t) => t !== "")
    .join(" ")
    .trim();
}

/**
 * Are the lines between two options continuation text rather than a new thing?
 *
 * The `/loop` menu puts a description under its first option, indented to the
 * label column. Anything shallower than that is not part of the menu, and a run
 * that spans it is a run we made up.
 */
function gapsAreContinuations(lines: readonly Line[], opts: readonly { index: number; labelCol: number }[]): boolean {
  for (let i = 1; i < opts.length; i++) {
    const prev = opts[i - 1];
    const cur = opts[i];
    if (!prev || !cur) return false;
    for (let j = prev.index + 1; j < cur.index; j++) {
      const text = lines[j]?.text ?? "";
      if (text.trim() === "") continue;
      if (text.length - text.replace(/^\s*/, "").length < prev.labelCol) return false;
    }
  }
  return true;
}

/** Digits stop working past 9, so options beyond that fall back to arrows. */
function numberedKey(opt: NumberedLine, cursorAt: number): OptionKey {
  if (opt.n <= 9) return { via: "digit", digit: String(opt.n) };
  return arrowKey(opt.index, cursorAt);
}

function arrowKey(index: number, cursorAt: number): OptionKey {
  if (index === cursorAt) return { via: "selected" };
  return index > cursorAt
    ? { via: "arrows", key: "Down", presses: index - cursorAt }
    : { via: "arrows", key: "Up", presses: cursorAt - index };
}

/**
 * A numbered menu: `❯ 1. Yes` and friends.
 *
 * Takes the LAST run in the pane and does not fall back to an earlier one. A
 * dialog is the bottom-most thing on the screen by construction, so an earlier
 * run is scrollback, and trying the next-best candidate is how a parser talks
 * itself into an answer.
 */
function parseNumbered(lines: readonly Line[]): PaneQuestion {
  const all = lines.map((l, i) => numberedLine(l.text, i)).filter((x): x is NumberedLine => x !== null);
  if (all.length < 2) return { kind: "none" };

  // Walk back from the end while the numbers count down 1 at a time to 1.
  const run: NumberedLine[] = [];
  for (let i = all.length - 1; i >= 0; i--) {
    const cur = all[i];
    if (!cur) break;
    const next = run[0];
    if (next && cur.n !== next.n - 1) break;
    if (next && cur.digitCol !== next.digitCol) break;
    run.unshift(cur);
    if (cur.n === 1) break;
  }
  const first = run[0];
  const last = run[run.length - 1];
  if (!first || !last || run.length < 2 || first.n !== 1) return { kind: "none" };

  const cursors = run.filter((o) => o.cursor);
  const cursorAt = cursors[0]?.index;
  if (cursors.length !== 1 || cursorAt === undefined) return { kind: "none" };
  if (!gapsAreContinuations(lines, run)) return { kind: "none" };
  if (!tailIsDialogLike(lines, last.index)) return { kind: "none" };

  return {
    kind: "question",
    prompt: promptAbove(lines, first.index),
    options: run.map((o) => ({ label: o.label, key: numberedKey(o, cursorAt) })),
  };
}

/**
 * A cursor menu with no numbers, of which folder-trust is the one we have seen.
 *
 * Much weaker evidence than a numbered menu — every option is just an indented
 * line — so the rules are correspondingly tighter: the labels must all start at
 * the same column, they must be contiguous with no blank line between them, and
 * the label must be short enough to be a label. A multi-line message Greg typed,
 * echoed back into the transcript under a `❯`, is exactly this shape minus the
 * footer.
 */
function parseCursorMenu(lines: readonly Line[]): PaneQuestion {
  const cursorIndexes = lines.flatMap((l, i) => (isInputPrompt(l.text) && l.text.trim() !== "❯" ? [i] : []));
  const at = cursorIndexes[cursorIndexes.length - 1];
  if (at === undefined) return { kind: "none" };

  const head = cursorLine(lines[at]?.text ?? "", at);
  if (!head) return { kind: "none" };

  const run: CursorLine[] = [head];
  for (let i = at + 1; i < lines.length; i++) {
    const cand = cursorLine(lines[i]?.text ?? "", i);
    if (!cand || cand.cursor || cand.labelCol !== head.labelCol) break;
    run.push(cand);
  }
  const last = run[run.length - 1];
  if (run.length < 2 || !last) return { kind: "none" };
  if (run.some((o) => o.label.length > 200)) return { kind: "none" };
  if (!tailIsDialogLike(lines, last.index)) return { kind: "none" };

  return {
    kind: "question",
    prompt: promptAbove(lines, at),
    options: run.map((o) => ({ label: o.label, key: arrowKey(o.index, at) })),
  };
}

/**
 * What this pane is asking, if anything.
 *
 * Pure: give it the same text and it gives the same answer, which is what lets
 * the fixtures under tests/fixtures/fleet-panes/ be the whole test.
 */
export function parsePane(capture: string): PaneQuestion {
  const lines = cleanLines(capture);
  const numbered = parseNumbered(lines);
  if (numbered.kind === "question") return numbered;
  return parseCursorMenu(lines);
}

/**
 * A pane id, and nothing else.
 *
 * tmux's `-t` will happily resolve a session name, and the direction doc's
 * hardest-won rule is to address a session by pane handle rather than by name,
 * because names get reassigned when a session dies and another takes its place.
 * Refusing anything that is not `%<digits>` makes that rule structural instead
 * of a convention the next caller has to remember. It is not injection defence —
 * execFile takes no shell — it is aim defence.
 */
export function isPaneId(id: string): id is `%${string}` {
  return /^%\d+$/.test(id);
}

/**
 * Read a pane. The one impure thing in this file, kept thin so the server does
 * not shell out inline and so tests never need tmux.
 *
 * Throws on an unknown pane rather than returning "": a pane that has gone away
 * is a session that has gone away, and the caller must not render an empty
 * question for it.
 */
export function capturePane(paneId: string): string {
  if (!isPaneId(paneId)) throw new Error(`not a tmux pane id: ${paneId}`);
  return execFileSync("tmux", ["capture-pane", "-p", "-t", paneId], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    timeout: 10_000,
  });
}
