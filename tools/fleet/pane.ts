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
 *
 * THE SECOND DANGEROUS CASE, found by experiment on 2026-09-08 and the reason
 * `material` exists. Until then a question was a `prompt` plus its options, and
 * `prompt` was only the text between the LAST horizontal rule and the options.
 * Claude Code rules off the thing it is proposing — the diff, the command, the
 * destination path — from the sentence that asks about it, so `prompt` was
 * "Do you want to create notes.md?" and the file's contents were thrown away.
 * Two captures of the same dialog, one writing `hello` and one writing
 * `goodbye`, produced byte-identical questions and byte-identical options.
 *
 * That is two failures, not one. `sameQuestion` in steer.ts would accept an
 * answer aimed at one action and deliver it to a materially different one; and
 * the page would ask Greg on his phone to approve something without showing him
 * what it was. Both fixes are the same fix: carry the dialog's whole body, and
 * carry a hash of it so identity is compared on the body rather than on the
 * sentence. The regression fixtures are `dialog-file-write-hello.txt` and
 * `dialog-file-write-goodbye.txt`, which differ in exactly one word.
 *
 * THE THIRD QUESTION, ADDED 2026-09-08 AND THE REASON `gate` EXISTS. The two
 * above are about whether there is a dialog and what it is about. This one is
 * about what answering it would DO — approve a tool call, or take a turn in a
 * conversation with an agent that asked. They are not the same act and they do
 * not deserve the same answer, and the whole argument is in `PaneGate` below.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

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

/**
 * What saying yes to this option COSTS, which is not the same as what it does.
 *
 * "Yes" and "Yes, and don't ask again for: curl …" arrive as two adjacent lines
 * that look alike and read alike, and they are not alike at all: the first is a
 * decision about one action, the second changes the session's permission posture
 * for everything that comes after it, including things nobody has proposed yet.
 * On a phone they are two buttons a thumb-width apart. So the difference is a
 * field the client can render on, rather than a substring the client is trusted
 * to notice.
 *
 * `unknown` IS THE DEFAULT AND IS NOT A BUG. Every label we have not met before
 * lands here, and the client must treat it as "at least as serious as
 * persistent" rather than as "probably fine". Classifying an unrecognised label
 * as `once` would be the whole failure in one line, so nothing falls through to
 * `once`: it is reached only by a label that says nothing but yes.
 */
export type OptionConsequence =
  /** This action, and nothing after it. */
  | "once"
  /** Changes what the session will approve on its own from now on. */
  | "persistent"
  /** Refuses. */
  | "decline"
  /** Not a label we recognise. Treat as at least `persistent`. */
  | "unknown";

export type PaneOption = { label: string; key: OptionKey; consequence: OptionConsequence };

/**
 * WHAT IS ACTUALLY BEING APPROVED — the diff, the command, the path — as
 * opposed to the sentence that asks about it.
 *
 * THREE ARMS, NOT A NULLABLE STRING, and the reason is what the page does with
 * each. `read` is "here is the body, and here is its hash". `no-material` is a
 * positive claim that this dialog proposes nothing — a menu, where the options
 * are the whole of the question — and it is safe to render with no body.
 * `unreadable` is "there is a dialog here and we could not see what it is
 * about", which must make the page REFUSE rather than draw a confident empty
 * box. Collapse the last two into `null` or `""` and the two are the same
 * pixels, which is exactly how somebody approves a write they never saw.
 *
 * `text` AND `fingerprint` ARE BOTH NEEDED, and neither substitutes for the
 * other. `sameQuestion` compares fingerprints, because comparing prose across
 * two captures is fragile and because a hash is the whole body in one field.
 * The page shows `text`, because a hash tells a person nothing.
 */
export type PaneMaterial =
  | { kind: "read"; text: string; fingerprint: string }
  | { kind: "no-material" }
  | { kind: "unreadable"; why: string };

/**
 * WHAT ANSWERING THIS DIALOG DOES — which is not the same as what it asks.
 *
 * Answering a dialog from the phone was switched off at the route on
 * 2026-09-08, because two independent cross-family reviews found the same hole:
 * a forged or mis-bound approval could grant a permission the person never saw.
 * Blanket-off is too broad, and Greg said so:
 *
 * > Yes auto mode is the default. But mightn't there be other reasons why it
 * > needs to answer with multiple choice to a session?
 * >
 * > — Greg, 2026-09-08
 *
 * Not every numbered dialog is a permission grant. Fable drew the line, and the
 * line is the whole of this design:
 *
 * > Pane text as executable UI is acceptable when execution means "a user
 * > turn", and not acceptable when it means "grant a permission". A forged menu
 * > can then make Greg send the digit "2" to an agent that was going to
 * > misbehave anyway; it cannot mint an approval.
 * >
 * > — Fable, 2026-09-08
 *
 * SO THIS CLASSIFIES THE CONSEQUENCE, NOT THE SENDER. Provenance is exactly
 * what a pane capture cannot give us — that is Sol's finding and it has not
 * gone away. What it can give us is what the screen would DO if a digit landed
 * on it, and that is enough to separate the two cases Fable separates.
 *
 * TWO OF THE THREE ARMS ARE THE SAME DECISION. `permission` and `unknown` both
 * mean "not a thumb on a phone"; only `conversation` unlocks anything. So
 * `conversation` is the arm that must be EARNED by positive evidence and
 * everything else falls to `unknown` — which is why the care here goes into the
 * evidence for `conversation` rather than into naming every other kind of
 * dialog precisely. Callers should ask `grantsPermission` rather than switch on
 * `kind` themselves, so the conservative default is structural rather than a
 * rule each caller has to remember.
 *
 * WHERE THE HARNESS'S OWN SETTINGS MENUS LAND, AND WHY THEY ARE NOT A FOURTH
 * ARM. The `/loop` cloud-schedule prompt and the model selector are neither a
 * tool permission nor an agent's question: answering one changes the harness's
 * configuration — the default model for every session after this one, or a
 * cloud schedule that goes on running after this session is closed. They are a
 * genuinely different third thing, and they still land in `unknown`, for two
 * reasons. The first is evidence: `/loop` is drawn by the same select-menu
 * widget as an agent's own question and proposes no body at all, so a
 * `configuration` arm would be reached by a guess, and an arm nothing can
 * reliably reach is an untested guard wearing the clothes of a fact. The second
 * is that it would change no behaviour: a cloud schedule that outlives the
 * session is at least as consequential as one tool approval, so a caller has to
 * refuse it exactly as it refuses `permission`. `unknown` says the true thing —
 * we could not tell — and produces the right behaviour for the right reason.
 */
export type PaneGate =
  /**
   * Answering can hand the harness a capability it does not have: a tool-use
   * approval, or trust in a folder. `why` names the signal that fired.
   */
  | { kind: "permission"; why: string }
  /**
   * Answering is a turn in a conversation. The AGENT asked, with options it
   * wrote itself (`AskUserQuestion`), and the digit reaches a model that is
   * already in the loop. This is the only arm that is safe to tap, and the only
   * one reached by positive evidence rather than by falling through.
   */
  | { kind: "conversation" }
  /**
   * We could not tell. **Treat exactly as `permission`** — this arm is
   * conservative, not neutral, and it is where every dialog we have not
   * positively identified ends up, the harness's own settings menus included.
   */
  | { kind: "unknown"; why: string };

/**
 * The one question a caller should be asking, so the conservative default lives
 * here instead of in each of them.
 *
 * Written as "is it NOT a conversation" rather than as a list of the arms that
 * are dangerous, because that is the direction that stays correct when a fourth
 * arm arrives: a new kind of dialog is refused by default and somebody has to
 * argue it into `conversation`, rather than being waved through because nobody
 * remembered to add it to a list.
 *
 * A TYPE PREDICATE, so the caller that refuses has `why` in its hand inside the
 * branch and does not have to re-narrow to build its own sentence. Refusing
 * without saying which signal fired is how a person on a phone learns nothing
 * from being told no.
 */
export function grantsPermission(gate: PaneGate): gate is Exclude<PaneGate, { kind: "conversation" }> {
  return gate.kind !== "conversation";
}

/**
 * The `AskUserQuestion` widget's header row: a ballot box, then the short name
 * the agent gave its own question — `☐ Colour`, `☐ Repair`, `☐ How to finish`.
 *
 * THIS IS THE EVIDENCE THE WHOLE SAFE ARM RESTS ON, from three real captures on
 * 2026-09-08: two live sessions of other agents' and one provoked in a throwaway
 * of my own. No permission dialog on this box draws it — they open with the tool
 * they are asking about (`Bash command`, `Create file`, `Edit file`) or with
 * `Accessing workspace:`.
 *
 * MATCHED ON THE FIRST LINE OF THE BODY ONLY, NEVER ANYWHERE IN IT, and that is
 * not fussiness. `☐ ` is ordinary markdown for an unticked to-do, so a `Create
 * file` dialog proposing a checklist has one in its diff. Searching the body
 * would turn that permission dialog into a conversation — the one direction that
 * costs an approval rather than a refusal.
 *
 * U+2610 SURVIVES `DECORATION` BY A HAIR: that class stops at U+25FF and
 * resumes at U+2B1B, so the ballot box is not blanked into a space. Widen
 * `DECORATION` and this rule stops firing silently, and a real agent question
 * becomes `unknown` — safe, but the feature is gone. `cleanLines` has a test
 * that keeps the character.
 */
const AGENT_QUESTION_HEADER = /^\s*☐\s+\S/;

/**
 * Yes at the top, no at the bottom: the shape of an approval.
 *
 * Read off `consequence` rather than off the words, so it shares its reading of
 * English with the field the client renders instead of drifting from it. It is
 * a SECOND, INDEPENDENT permission signal, and it exists because the first one
 * — an option that widens the session's own permissions — is a strong tell that
 * Claude Code is under no obligation to keep offering. A permission dialog that
 * some day carries only `Yes` and `No` is still caught here.
 *
 * An agent's own question that happened to offer `Yes` then `No` would be read
 * as a permission and refused. That is the cheap direction, and it is the one
 * this whole module is biased towards.
 */
function isApprovalShape(options: readonly PaneOption[]): boolean {
  if (options.length < 2) return false;
  return options[0]?.consequence === "once" && options[options.length - 1]?.consequence === "decline";
}

/**
 * What answering this dialog would do, from the body and the labels and nothing
 * else.
 *
 * PURE, AND DELIBERATELY BLIND TO THE FOOTER, which is the best single
 * discriminator on the screen — a permission dialog says `Esc to cancel · Tab
 * to amend`, an agent's question says `Enter to select · ↑/↓ to navigate`. It
 * is not used because the footer is not one of the fields a client sends back,
 * so routes-steer.ts could not recompute this the way it recomputes
 * `consequence`, and a field only one of the two computations can see is a
 * field that can disagree with itself. If the footer is ever worth having, the
 * fix is to carry it in `PaneQuestion` so BOTH sides read the same thing — not
 * to classify here and trust the answer over the wire.
 *
 * PERMISSION IS TESTED FIRST so that any overlap lands on the safe side. A
 * dialog that looked like both would be a dialog we do not understand.
 */
export function classifyGate(material: PaneMaterial, options: readonly PaneOption[]): PaneGate {
  const widening = options.find((o) => o.consequence === "persistent");
  if (widening) {
    return {
      kind: "permission",
      why: `an option widens what the session will approve on its own: "${widening.label}"`,
    };
  }
  if (isApprovalShape(options)) {
    return {
      kind: "permission",
      why: "the options are an approval followed by a refusal, which is the shape of a permission prompt",
    };
  }
  if (material.kind !== "read") {
    return {
      kind: "unknown",
      why: `the dialog's body is ${material.kind}, so the header that identifies an agent's own question is not there to check`,
    };
  }
  const header = material.text.split("\n").find((l) => l.trim() !== "") ?? "";
  if (AGENT_QUESTION_HEADER.test(header)) return { kind: "conversation" };
  return {
    kind: "unknown",
    why: "the dialog's body does not open with the header an agent's own question carries",
  };
}

/**
 * The answer. `none` is not an error and not an absence of data — it is the
 * assertion that this pane is not asking anything, which is what almost every
 * pane on the box is doing at any moment.
 *
 * `prompt` IS THE HEADLINE, `material` IS THE EVIDENCE. `prompt` is the last
 * section of the dialog — usually one sentence, "Do you want to create
 * notes.md?" — and it is kept because it is the right thing to put in a list of
 * blocked sessions. It is NOT enough to decide on, and it is not what identity
 * is compared on. See the header comment for the day that distinction was worth.
 *
 * `options` IS WHAT IS ON THE SCREEN, WHICH IS NOT ALWAYS ALL OF THEM. A long
 * menu scrolls: the model selector shows four rows and a `… +1 model` line, and
 * a pane capture cannot see the fifth. The digits we report are still correct —
 * `5` would still choose it — we simply do not know its label. Anything that
 * renders this should read as "here are the options" rather than "there are
 * four", and if that ever matters enough, the fix is a `truncated` flag here
 * rather than a guess in the caller.
 *
 * `gate` IS WHAT ANSWERING WOULD DO, and it is the field that decides whether a
 * person may tap this from a phone at all. It is derived from `material` and
 * `options`, both of which are already on the wire and already re-checked by
 * routes-steer.ts, so it can be recomputed rather than believed. See `PaneGate`.
 */
export type PaneQuestion =
  | { kind: "none" }
  | { kind: "question"; prompt: string; material: PaneMaterial; options: PaneOption[]; gate: PaneGate };

/**
 * The one place a question is built, so the two parsers below cannot come to
 * different conclusions about the same screen.
 *
 * `gate` is not a parameter: a caller that could pass its own would be a caller
 * that could pass `conversation`.
 */
function question(prompt: string, material: PaneMaterial, options: PaneOption[]): PaneQuestion {
  return { kind: "question", prompt, material, options, gate: classifyGate(material, options) };
}

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

/**
 * A rule drawn out of dashed box-drawing characters, U+254C–U+254F and
 * U+2504–U+250B.
 *
 * THIS IS THE DIFFERENCE BETWEEN A DIALOG AND HALF OF ONE. Claude Code draws
 * the outside of a permission dialog with the solid `─`, and the separators
 * INSIDE it — above and below a diff, around a command — with the dashed `╌`.
 * So the topmost rule above the options tells us which we are looking at: solid
 * means we can see the whole box and the material above the diff is real;
 * dashed means the capture begins in the middle of the dialog, its top border
 * having scrolled off, and whatever we can see of the material is a fragment.
 * A fragment shown as if it were the whole thing is the failure this module
 * exists to prevent, so that case becomes `unreadable`.
 */
const DASHED_RULE = /^[\s╌-╏┄-┋]+$/;

/** Solid means the dialog's own border; dashed means a separator inside it. */
type RuleStyle = "none" | "solid" | "dashed";

/** One line of the pane, cleaned, with the columns preserved. */
type Line = {
  /** Decorations replaced by spaces, so indent is unchanged and comparable. */
  text: string;
  /** Non-`none` when the raw line held nothing but decoration and whitespace. */
  rule: RuleStyle;
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
      const isRule = text.trim() === "" && raw.trim() !== "";
      const rule: RuleStyle = !isRule ? "none" : DASHED_RULE.test(raw) ? "dashed" : "solid";
      return { text, rule };
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
 *
 * EXPORTED SINCE 2026-09-08 because steer.ts needs the same line for the
 * opposite question. This file asks "is the input box in the way of calling
 * this a dialog?"; `inputSurface` in steer.ts asks "is the input box THERE,
 * before we type free text at this pane?" — Sol's F2. Two callers, one
 * definition, because a second regex that drifted from this one would fail in
 * the direction that types a message into a permission dialog.
 */
export function isInputPrompt(text: string): boolean {
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
  let start = Math.max(0, firstOption - PROMPT_WINDOW);
  for (let i = firstOption - 1; i >= start; i--) {
    if (lines[i]?.rule !== "none") {
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

/** How far above the options `promptAbove` will look when no rule bounds it. */
const PROMPT_WINDOW = 10;

/**
 * How far above the options to look for the dialog's top border.
 *
 * Wide enough for the shapes measured on this box — the folder-trust dialog is
 * twelve lines of body, and a permission dialog with a diff can be more — and
 * bounded so that a menu with no border at all does not swallow the transcript
 * above it. Over-reaching is the cheap direction: it shows the person a few
 * lines of transcript they did not need, and it makes the fingerprint change
 * when the transcript does, which costs a refusal rather than a wrong approval.
 */
const MATERIAL_WINDOW = 40;

/**
 * A stable name for a body of text.
 *
 * NOT TRUNCATED. A short hash would be plenty against accidental collision, and
 * truncating invites the question of how short is short enough for a value that
 * gates a keystroke into somebody's session. Sixty-four hex characters costs a
 * line of JSON and closes the question.
 */
export function fingerprintMaterial(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * What the dialog is proposing: its whole body, above the options.
 *
 * BOUNDED BY THE DIALOG'S TOP BORDER, not by the last rule. `promptAbove` takes
 * the last rule on purpose — it wants the final section, the question sentence.
 * That is the wrong boundary for the material, and taking it was the bug: for a
 * file write the last rule sits under the diff, so everything the write would
 * actually do lands above it and was dropped.
 *
 * The body deliberately INCLUDES the prompt sentence. Two fields that each hold
 * half a screen invite a caller to render one of them; `text` is meant to be
 * the whole of what the person needs to read, and `prompt` a headline for a
 * list.
 *
 * Rules inside the body are dropped rather than kept as blank lines, so the
 * fingerprint does not move when Claude Code changes its box drawing. Blank
 * lines that were really blank ARE kept — a diff whose blank lines vanished
 * would be a different file that hashed the same.
 */
function materialAbove(lines: readonly Line[], firstOption: number): PaneMaterial {
  const start = Math.max(0, firstOption - MATERIAL_WINDOW);
  let top = -1;
  for (let i = start; i < firstOption; i++) {
    if (lines[i]?.rule !== "none") {
      top = i;
      break;
    }
  }

  if (top === -1) {
    // No rule at all. Either the dialog genuinely has no box — the `/loop`
    // scheduling menu is a question and four options and nothing else — or the
    // box is off screen. They are told apart by what is above the prompt: a
    // borderless menu that has a transcript above it gives us no way to say
    // where the transcript stops, so we say we could not read it rather than
    // guess a boundary and present the guess as the thing being approved.
    const promptStart = Math.max(0, firstOption - PROMPT_WINDOW);
    const transcriptAbove = lines.slice(start, promptStart).some((l) => l.text.trim() !== "");
    if (transcriptAbove) {
      return {
        kind: "unreadable",
        why: "no rule above the options, so the dialog's body cannot be told from the transcript above it",
      };
    }
    return { kind: "no-material" };
  }

  if (lines[top]?.rule === "dashed") {
    return {
      kind: "unreadable",
      why: "the capture begins inside the dialog — its top border has scrolled off, so what is being"
        + " proposed is only partly on screen",
    };
  }

  const body: string[] = [];
  for (let i = top + 1; i < firstOption; i++) {
    const line = lines[i];
    if (!line || line.rule !== "none") continue;
    body.push(line.text);
  }
  while (body[0]?.trim() === "") body.shift();
  while (body[body.length - 1]?.trim() === "") body.pop();
  const text = body.join("\n");
  if (text.trim() === "") {
    return {
      kind: "unreadable",
      why: "the dialog's border is on screen but there is nothing between it and the options",
    };
  }
  return { kind: "read", text, fingerprint: fingerprintMaterial(text) };
}

/**
 * Phrases that mean "and change what you approve from now on".
 *
 * Matched as substrings of a lower-cased label with curly apostrophes folded
 * flat, because Claude Code writes `don’t` (U+2019) and everybody's memory of
 * the string writes `don't`. Checked BEFORE the refusal test on purpose: a
 * hypothetical "No, and don't ask again" is both, and of the two facts the
 * posture change is the one a person must not miss.
 *
 * "for this session" is here and "this session only" deliberately is not. The
 * first is a permission granted for the rest of the session; the second is the
 * `/loop` menu declining to make anything permanent.
 */
const PERSISTENT_MARKERS = [
  "don't ask again",
  "auto mode",
  "accept edits",
  "for this session",
  "for the rest of this session",
  "during this session",
  "always allow",
  "allow all",
  "yes to all",
  "i trust this folder",
  "trust the files",
];

/** A refusal. `no, and tell Claude what to do differently` is one of these. */
const DECLINE = /^(no\b|don't\b|do not\b|cancel\b|reject\b|exit\b|abort\b)/;

/** The only labels that get to be `once`: the ones that say nothing but yes. */
const BARE_YES = /^yes(,? (proceed|once|allow (this )?once|just this once))?[.!]?$/;

/**
 * What one option costs, from its label and nothing else.
 *
 * Label text is all we have — the pane does not tell us what a digit is wired
 * to — so this is a reading of English, and it is written to be wrong in one
 * direction only. Anything unrecognised is `unknown`, which the client must
 * treat as at least as serious as `persistent`. Nothing reaches `once` by
 * falling through.
 */
export function classifyConsequence(label: string): OptionConsequence {
  const flat = label.toLowerCase().replace(/[’‘]/g, "'");
  if (PERSISTENT_MARKERS.some((m) => flat.includes(m))) return "persistent";
  if (DECLINE.test(flat)) return "decline";
  if (BARE_YES.test(flat)) return "once";
  return "unknown";
}

/** One parsed option line, with both of the things a caller has to know about it. */
function toOption(label: string, key: OptionKey): PaneOption {
  return { label, key, consequence: classifyConsequence(label) };
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

  return question(
    promptAbove(lines, first.index),
    materialAbove(lines, first.index),
    run.map((o) => toOption(o.label, numberedKey(o, cursorAt))),
  );
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

  return question(
    promptAbove(lines, at),
    materialAbove(lines, at),
    run.map((o) => toOption(o.label, arrowKey(o.index, at))),
  );
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
