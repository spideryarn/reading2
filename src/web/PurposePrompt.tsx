/**
 * **"Why are you reading this?", asked once when the article first opens.**
 *
 * > Also, if they don't fill this in (e.g. because they didn't notice it), pop
 * > up an input box asking why they're reading it when the article loads for
 * > the first time.
 * >
 * > — Greg, 2026-10-01, spya-hbqezu
 *
 * The add page leaves a mark in this tab (src/web/ask-purpose.ts) only when it
 * opened the article by itself with its own box empty and never touched. This
 * component reads that mark and, if the article still has no purpose, asks.
 * docs/plans/261001s-imports-detail-on-home-and-why-reading-saved-state-and-first-open-prompt.md
 * § Stage 3.
 *
 * ## The boundaries, and why each is a component rather than a condition
 *
 * - **Owner only, by where it is mounted** — inside `OwnedReader`
 *   (src/web/article/ArticlePage.tsx), so a visitor never mounts the hook or
 *   makes the request. GPT Sol's plan review, item 5.
 * - **No mark, no request.** `PurposePrompt` peeks once, at mount, and renders
 *   nothing without the mark; `Ask`, which calls `usePurpose`, exists only
 *   with it. Every owner's article view mounts this, so the ordinary case must
 *   cost nothing.
 * - **The mark is cleared on a definitive answer, never on mount.** A purpose
 *   exists → cleared, nothing shown. Definitively none → cleared, asked. A
 *   failed read, or `purposeFailed` (the shelf could not be read, which must
 *   never pass for "you have not said") → kept for the next load. Sol's item 3.
 *
 * ## The dialog
 *
 * A native modal `<dialog>`, after Lightbox.tsx and FeedbackDialog.tsx: it
 * interrupts on purpose, once, and `showModal()` brings the inert background,
 * the focus trap and Escape. The box is `ProfileBox` with `useAutosavedText`,
 * wired exactly as Metadata's "Why you're reading this one" is, so it saves
 * itself after a pause and says so. **Done** is a latch (Sol's item 4): it
 * commits, and closes only once the state is back to clean or saved; a refusal
 * keeps it open with the reason in the box's own status line. **Not now**,
 * Escape and the backdrop just close — anything typed has been or will be
 * saved by the box itself (a blur commits), because a box that saves as you
 * type and then drops the words on "Not now" would be two promises at odds.
 *
 * The dialog stays mounted once closed rather than unmounting, so the box's
 * idle save, its leave warning and `useAutosavedText`'s `pagehide` keep
 * working for words typed just before closing.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { MAX_PURPOSE_CHARS } from "../types.js";
import { clearAskPurpose, peekAskPurpose } from "./ask-purpose.js";
import { ProfileBox } from "./ProfileBox.js";
import { leavePurpose, savePurpose, usePurpose } from "./purpose.js";
import { useAutosavedText } from "./useAutosavedText.js";
import { useVisualViewport } from "./useVisualViewport.js";

/** Mount with `key={slug}`: the peek is taken once, for the article it was mounted on. */
export function PurposePrompt({ slug }: { slug: string }) {
  /* Once, at mount, and latched: once `Ask` clears the mark, a peek on the next
     render would answer "no" and unmount the dialog the reader is typing in. */
  const [asking] = useState(() => peekAskPurpose(slug));
  return asking ? <Ask slug={slug} /> : null;
}

function Ask({ slug }: { slug: string }) {
  const read = usePurpose(slug);
  const purpose = useAutosavedText({
    /* As Metadata.tsx's box: the server's answer, not what was typed, and an
       empty box clears. Here the box was seeded empty over a purpose that is
       definitively none, so there is nothing hidden to erase. */
    save: async (text) => (await savePurpose(slug, text === "" ? null : text)) ?? "",
    leave: (text) => leavePurpose(slug, text),
  });
  const seed = purpose.seed;
  const [open, setOpen] = useState(false);

  /* **Decided once.** A ref rather than state, so StrictMode's second run of
     this effect finds it taken and does not seed again over a first keystroke. */
  const decided = useRef(false);
  useEffect(() => {
    if (read.state !== "ready" || read.purposeFailed) return;
    clearAskPurpose(slug);
    if (read.purpose !== null || decided.current) return;
    decided.current = true;
    seed("");
    setOpen(true);
  }, [read, slug, seed]);

  /* **Done, latched.** Set by the press; this closes once the save it started
     has landed, and lets go on a refusal so the reader can see why.

     `inFlight` is a separate fact from the words under the box. If an older
     autosave is writing A and the reader changes the draft back to the value
     that was loaded, the state is correctly `clean` about the draft but the
     server may still become A. Done queues the correction; it must not close
     until that second write has landed too. */
  const [closing, setClosing] = useState(false);
  const state = purpose.state.kind;
  useEffect(() => {
    if (!closing) return;
    if (!purpose.inFlight && (state === "clean" || state === "saved")) {
      setClosing(false);
      setOpen(false);
    } else if (state === "error") {
      setClosing(false);
    }
  }, [closing, purpose.inFlight, state]);
  const done = () => {
    purpose.commit();
    setClosing(true);
  };

  const ref = useRef<HTMLDialogElement>(null);
  /* Lightbox.tsx § closingOurselves: `close()` fires the same `close` event
     Escape does, so our own close would otherwise come back as a second one. */
  const closingOurselves = useRef(false);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      closingOurselves.current = false;
      dialog.showModal();
    } else if (!open && dialog.open) {
      closingOurselves.current = true;
      dialog.close();
    }
  }, [open]);

  /* FeedbackDialog.tsx § the box the reader can see: on iOS the keyboard pans
     a smaller visual viewport over the layout one, and a dialog centred on the
     latter has its box under the keys. */
  const visible = useVisualViewport(open);

  return (
    // The click is the backdrop, whose keyboard equivalent is Escape — which
    // <dialog> implements itself. Lightbox.tsx carries the same exemption.
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape is the backdrop's keyboard twin, native to <dialog>
    <dialog
      ref={ref}
      className="purpose-prompt"
      aria-labelledby="prompt-purpose-title"
      style={
        visible === null
          ? undefined
          : { top: `${visible.offsetTop}px`, height: `${visible.height}px`, bottom: "auto" }
      }
      onClose={() => {
        if (closingOurselves.current) return;
        setClosing(false);
        setOpen(false);
      }}
      onClick={(e) => {
        if (e.target === ref.current) setOpen(false);
      }}
    >
      <div className="purpose-prompt-panel">
        <h2 id="prompt-purpose-title" className="purpose-prompt-title">
          Why are you reading this?
        </h2>
        <ProfileBox
          id="prompt-purpose"
          label="In a sentence, for this article"
          placeholder="e.g. I want to know how they handled missing data"
          hint="Shapes the quotes, ideas, glossary and the reading route — for this article only. Never what the article says. You can change it later on Metadata."
          value={purpose.draft}
          onChange={purpose.setDraft}
          onCommit={purpose.commit}
          max={MAX_PURPOSE_CHARS}
          disabled={purpose.saved === null}
          rows={2}
          save={purpose.state}
        />
        <div className="purpose-prompt-actions">
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Not now
          </Button>
          <Button type="button" size="sm" onClick={done} disabled={closing}>
            Done
          </Button>
        </div>
      </div>
    </dialog>
  );
}
