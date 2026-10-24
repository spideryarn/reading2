/**
 * **How the lookup writes the message** — Greg's guidance for the author
 * lookup's suggested message, edited on `/admin/vouchers`' *Drafts* tab.
 * Greg, 2026-10-23 (#688, spya-n8ruxv): *"have some kind of prompt or template
 * that I can easily screw with, you know, in the web that would improve these
 * author gift emails going forwards"*. Plan
 * docs/plans/261024f-author-gift-drafts-permanent-delete-exact-email-preview-editable-lookup-guidance.md
 * § D4, R4, R5.
 *
 * Folded until opened: it is changed rarely, and the drafts are what the tab is
 * for. Only the voice of the message is editable; the rest of the prompt is
 * shown read-only under it, so Greg can see the whole of what the model is
 * told. A save is a new row on the server, so nothing he wrote before is lost.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { AUTHOR_GIFT_GUIDANCE_MAX, type AuthorGiftGuidance as Guidance } from "../admin-author-gifts.js";
import { BUTTON, TEXTAREA } from "./admin-vouchers-parts.js";
import { apiFetch, readJson } from "./lib/api.js";
import { describeFetchFailure } from "./lib/describe-failure.js";
import { MalformedReply } from "./lib/reader-facing.js";
import { exactly } from "./relative-time.js";

const PATH = "/api/admin/author-gift-guidance";

function checked(body: Partial<Guidance>): Guidance {
  if (typeof body.builtIn !== "string" || typeof body.fixedPrompt !== "string") {
    throw new MalformedReply("the guidance reply is incomplete");
  }
  return body as Guidance;
}

export function AuthorGiftGuidance() {
  const [open, setOpen] = useState(false);
  const [guidance, setGuidance] = useState<Guidance | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);

  const took = useCallback((g: Guidance) => {
    setGuidance(g);
    setText(g.guidance ?? g.builtIn);
  }, []);

  /* Read once it is first opened, not with the page: most visits never open it. */
  useEffect(() => {
    if (!open || guidance !== null) return;
    let live = true;
    apiFetch(PATH)
      .then((r) => readJson<Partial<Guidance>>(r))
      .then((body) => {
        if (live) took(checked(body));
      })
      .catch((e: Error) => {
        if (live) setRefusal(describeFetchFailure(e));
      });
    return () => {
      live = false;
    };
  }, [open, guidance, took]);

  async function save(next: string | null, done: string) {
    setBusy(true);
    setRefusal(null);
    setSaid(null);
    try {
      const reply = await apiFetch(PATH, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guidance: next }),
      });
      took(checked(await readJson<Partial<Guidance>>(reply)));
      setSaid(done);
    } catch (e) {
      setRefusal(describeFetchFailure(e as Error));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || guidance === null) return;
    /* The built-in text saved as typed is still "the built-in": stored as
       null, so a later change to it in code is not shadowed (R5). */
    const next = text.trim() === "" || text.trim() === guidance.builtIn.trim() ? null : text;
    void save(next, "Saved. Lookups that run from now on use it.");
  }

  const length = [...text].length;
  const over = length > AUTHOR_GIFT_GUIDANCE_MAX;
  const saved = guidance?.updatedAt ? exactly(guidance.updatedAt) : undefined;

  return (
    <section aria-label="How the lookup writes the message" className="tw:mb-4 tw:rounded-lg tw:border tw:border-border tw:p-3 tw:text-xs">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={BUTTON}
      >
        {open ? "Hide" : "Show"} how the lookup writes the message
      </button>
      {open && (
        <div className="tw:mt-2 tw:flex tw:flex-col tw:gap-2 tw:text-muted-foreground">
          <p className="tw:m-0">
            Each lookup suggests a message for the author, shown on its draft with <em>Use as your message</em>. This is
            what it is told about how to write it: the voice, what to offer, how to sign off. It applies to lookups that
            run after you save; to change a draft already made, press <em>Look up again</em> on it.
          </p>
          {refusal && (
            <p role="alert" className="tw:m-0 tw:text-danger">
              {refusal}
            </p>
          )}
          {said && (
            <p role="status" className="tw:m-0 tw:text-foreground">
              {said}
            </p>
          )}
          {guidance === null ? (
            !refusal && <p className="tw:m-0 tw:text-ink-faint">Loading…</p>
          ) : (
            <form onSubmit={submit} className="tw:flex tw:flex-col tw:gap-2">
              <p className="tw:m-0">
                {guidance.guidance === null ? "The built-in text is in use" : "Your own text is in use"}
                {saved ? `; last changed ${saved}` : ""}.
              </p>
              <textarea
                aria-label="Guidance for the message"
                rows={8}
                value={text}
                disabled={busy}
                onChange={(e) => setText(e.target.value)}
                className={`${TEXTAREA} tw:w-full`}
              />
              <span className={over ? "tw:text-danger" : "tw:text-ink-faint"}>
                {length.toLocaleString("en-GB")} of {AUTHOR_GIFT_GUIDANCE_MAX.toLocaleString("en-GB")} characters
              </span>
              <div className="tw:flex tw:flex-wrap tw:gap-2">
                <button type="submit" disabled={busy || over} className={`${BUTTON} tone-positive`}>
                  {busy ? "Saving…" : "Save"}
                </button>
                {guidance.guidance !== null && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void save(null, "Back to the built-in text.")}
                    className={BUTTON}
                  >
                    Back to the built-in text
                  </button>
                )}
              </div>
              <details>
                <summary className="tw:cursor-pointer">The rest of the prompt (fixed, in the code)</summary>
                <p className="tw:m-0 tw:mt-1">
                  These rules stay whatever the guidance says: what to find, where an address may come from, that the
                  article is data and not instructions, and that the message claims nothing you were not told and stays
                  short. Your guidance goes where it says.
                </p>
                <pre className="tw:mt-1 tw:whitespace-pre-wrap tw:break-words tw:rounded-md tw:bg-background tw:p-2 tw:font-mono tw:text-xs tw:text-foreground">
                  {guidance.fixedPrompt}
                </pre>
              </details>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
