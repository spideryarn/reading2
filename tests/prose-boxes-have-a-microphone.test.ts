/**
 * **Every box for the reader's prose has a microphone, or says why not** —
 * plan docs/plans/261020r-dictation-on-the-add-page-boxes-and-a-microphone-by-default.md
 * § Stage 5.
 *
 * Greg, 2026-10-19 (spya-wc4vku): *"we really want a dictate button next to
 * pretty much all of our input boxes that are going to have more than a few
 * words of text typed into them. Let's make a minimal tweak to our docs and/or
 * design system to make this more likely going forwards."*
 *
 * A ratchet, read from the source. Every `<textarea>` under `src/web/` is
 * found, with the top-level component it is drawn in (`File.tsx#Component`),
 * and that component must set up a microphone — `useDictationField`, or a
 * `DictationButton` or `ProfileBox` it draws — or be listed below with its
 * reason. Per component rather than per file, because one file can hold a box
 * with a microphone and one without (GPT Sol's plan review, P2-4). A new
 * textarea without one fails here, so its author decides rather than forgets.
 * How to add one: docs/project/dictation.md § Adding it to a box.
 *
 * Textareas only. Almost every textarea is prose; an `<input>` is as often a
 * search field or a title as a sentence, and no reading of the source can
 * tell which, so those are left to the reviewer. The fleet dashboard
 * (`tools/fleet/`) has its own microphone, `DictationControl`, and is not
 * scanned.
 *
 * What it does NOT prove: that the microphone works in that box. That is the
 * box's own test, and dictation.md's checklist (`busy`, the keeper, the
 * unmount).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");
const WEB = join(ROOT, "src/web");

/** Components whose textareas have no microphone, and why. Each reason is a decision, not an excuse. */
const WITHOUT: Record<string, string> = {
  "src/web/DesignPage.tsx#ControlsAcrossModes": "a specimen of the text box's look on /design, not a box anyone writes in",
  "src/web/ViewportProbe.tsx#ProbePanel": "read-only: a report to copy, not a box to type into",
  "src/web/AdminVouchersPage.tsx#CreateForm": "admin only: a short note sent with a voucher",
  "src/web/AdminVouchersPage.tsx#VoucherRow": "admin only: a short note sent with a voucher",
  "src/web/AdminAuthorGifts.tsx#Notes": "admin only: notes on an author gift",
  "src/web/AdminAuthorGifts.tsx#DraftEditor": "admin only: the draft of an author gift's email",
  /* Prose boxes a reader writes in, without a microphone yet. Queued as the
     sweep in plan 261020r § Stage 5; each has its own send and unmount to
     check, so each is a change of its own. Delete the line when it lands. */
  "src/web/SkimPurpose.tsx#PurposeLine": "not yet: queued (Skim's own purpose box)",
  "src/web/CriteriaPanel.tsx#NewCriterion": "not yet: queued (Referee's new-criterion box)",
  "src/web/CandidatesPanel.tsx#Composer": "not yet: queued (scoping the candidates search)",
  "src/web/ChatPanel.tsx#EditQuestion": "not yet: queued (rewriting a question already asked)",
  "src/web/CommentDialog.tsx#CommentBody": "not yet: queued (editing a comment's note)",
};

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

/** A JSX textarea opening a line: `<textarea` or shadcn's `<Textarea`, never one named in a comment. */
const TEXTAREA = /^\s*<(?:textarea|Textarea)\b/;
/** A top-level declaration, at the start of a line: where one component ends and the next begins. */
const DECLARATION = /^(?:export\s+)?(?:default\s+)?(?:function\s+(\w+)|const\s+(\w+)\s*[=:])/;
/* The strip counts: every box with a microphone draws one under itself, even
   where the button is drawn by a small wrapper (the add page's `AddMic`). */
const MICROPHONE = /useDictationField\(|<DictationButton\b|<DictationStrip\b|<ProfileBox\b/;

interface Box {
  /** `src/web/File.tsx#Component`. */
  where: string;
  mic: boolean;
}

const boxes: Box[] = tsxFiles(WEB).flatMap((path) => {
  const file = relative(ROOT, path);
  const lines = readFileSync(path, "utf8").split("\n");
  const declarations = lines.flatMap((line, at) => {
    const m = DECLARATION.exec(line);
    return m ? [{ name: m[1] ?? m[2] ?? "?", at }] : [];
  });
  return lines.flatMap((line, at) => {
    if (!TEXTAREA.test(line)) return [];
    const own = declarations.filter((d) => d.at <= at).at(-1);
    const next = declarations.find((d) => d.at > at);
    const body = lines.slice(own?.at ?? 0, next?.at ?? lines.length).join("\n");
    return [{ where: `${file}#${own?.name ?? "?"}`, mic: MICROPHONE.test(body) }];
  });
});

describe("prose boxes have a microphone", () => {
  it("finds the boxes it is about (a scan that matches nothing proves nothing)", () => {
    const withMic = boxes.filter((b) => b.mic).map((b) => b.where);
    expect(withMic).toEqual(
      expect.arrayContaining([
        "src/web/AddPage.tsx#PurposeBox",
        "src/web/AddPage.tsx#AboutYouBox",
        "src/web/ProfileBox.tsx#ProfileBox",
        "src/web/FeedbackSendBox.tsx#FeedbackSendBox",
      ]),
    );
  });

  it("every textarea is in a component with a microphone, or is listed with its reason", () => {
    const missing = boxes.filter((b) => !b.mic && !(b.where in WITHOUT)).map((b) => b.where);
    expect(missing, "add a microphone (docs/project/dictation.md § Adding it to a box), or list it in WITHOUT with why").toEqual([]);
  });

  it("every listed component still has a textarea and still has no microphone", () => {
    const stale = Object.keys(WITHOUT).filter((where) => {
      const found = boxes.filter((b) => b.where === where);
      return found.length === 0 || found.some((b) => b.mic);
    });
    expect(stale, "this exemption no longer describes the code: delete its line").toEqual([]);
  });
});
