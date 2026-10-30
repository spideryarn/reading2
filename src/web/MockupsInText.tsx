/**
 * **A question's body, where a mockup's id opens the mockup in place.** In the
 * Feedback dialog a mockup's id (`m-k3m9qt`) in the text is a button; a tap
 * draws the mockup after the plain-text run containing it, inside the dialog,
 * and another tap shuts it. Plan 261029g.
 *
 * It was a link to `/admin/mockups/m-…` in a new tab (plan 261028b), and in
 * Greg's home-screen web app on the iPad that left the dialog with no way back:
 * *"So right now this is extremely cumbersome […] I think we want to be able to
 * embed them within this feedback dialog so I can see them."* (`spya-rrvwca`,
 * 2026-10-28.)
 *
 * The id has a fixed shape (`isMockupId`) and the URL is built from it, so the
 * text can make this fetch nothing but one mockup, through the admin route.
 * Ids inside a ``` block are left as text, as is anything in the mockup's own
 * body (MockupView.tsx draws it with plain PlainTextBlocks).
 */
import { type ReactNode, useEffect, useRef, useState } from "react";
import { isMockupId } from "../mockups.js";
import { MockupBody, mockupUrl, pickMockup, useAdminRead, Waiting } from "./MockupView.js";
import { PlainTextBlocks } from "./PlainTextBlocks.js";

/** Candidates only; each is checked with `isMockupId` before it becomes a button. */
const MOCKUP_ID_IN_TEXT = /\bm-[0-9a-z]{6}\b/g;

export function TextWithMockups({
  text,
  className,
  stateKey,
}: {
  text: string;
  className: string;
  /** The question and section this text belongs to; changing it forgets open mockups. */
  stateKey: string;
}) {
  return (
    <PlainTextBlocks
      key={stateKey}
      text={text}
      className={className}
      paragraph={(run) => <ParagraphWithMockups text={run} className={className} />}
    />
  );
}

function ParagraphWithMockups({ text, className }: { text: string; className: string }) {
  /* Open ids, in the order they were opened; one entry per id however often it is named. */
  const [open, setOpen] = useState<string[]>([]);
  const toggle = (id: string) => setOpen((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const parts: ReactNode[] = [];
  let from = 0;
  for (const match of text.matchAll(MOCKUP_ID_IN_TEXT)) {
    const id = match[0];
    if (!isMockupId(id)) continue;
    parts.push(text.slice(from, match.index));
    parts.push(
      <button
        key={`${id}@${match.index}`}
        type="button"
        className="fb-mockup-toggle"
        data-mockup-toggle={id}
        aria-expanded={open.includes(id)}
        onClick={() => toggle(id)}
      >
        <span className="fb-mockup-id">{id}</span>
      </button>,
    );
    from = match.index + id.length;
  }
  parts.push(text.slice(from));

  return (
    <>
      <p className={className}>{parts}</p>
      {open.map((id) => (
        <InlineMockup key={id} id={id} />
      ))}
    </>
  );
}

function InlineMockup({ id }: { id: string }) {
  const load = useAdminRead(mockupUrl(id), pickMockup);
  /* It opens after the whole run of text, which can be below the fold of the
     thread's scroll area (the browser check for plan 261029g), so bring its
     top into view once. `nearest` leaves the page still if it is already seen. */
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    box.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, []);
  return (
    <section ref={box} className="fb-mockup" data-mockup={id} aria-label={`Mockup ${id}`}>
      <Waiting load={load}>
        {(mockup) => (
          <>
            <p className="fb-mockup-title">{mockup.title}</p>
            <MockupBody mockup={mockup} textClassName="fb-question-text" />
          </>
        )}
      </Waiting>
    </section>
  );
}
