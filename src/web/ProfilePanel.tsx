/**
 * "What am I being written for?" — answered where the question is asked.
 *
 * A small popover, raised from the *written for you* badge (WrittenForYou.tsx)
 * — and, until 2026-09-13, from a button beside the *Use your profile*
 * checkbox, which went with the checkbox — that says what a profile does, shows
 * both boxes
 * as the reader currently has them, and carries a working link to each editor.
 * docs/plans/260830c-profile-panel.md, docs/project/reader-profile.md.
 *
 * ## Why this is not a `<Tooltip>`
 *
 * It was going to be. `Tooltip` cannot do it, and the reason is worth keeping
 * because the same mistake is already shipping one line away.
 *
 * `.tooltip-anchor` is `pointer-events: none` (styles.css § tooltip) and
 * `Tooltip` passes `handleClose: null` — every card in this app is *read*, never
 * entered. So **a link inside one cannot be clicked**, and the pointer cannot
 * travel to it in the first place. The `written for you` badge has carried an
 * `Edit your profile →` link since it was written, and that link has never
 * worked: measured in headless Chrome with real pointer events,
 * `document.elementFromPoint` at the link's own centre returns the page behind
 * it, while the same test on an ordinary in-flow link on the same page returns
 * the link. jsdom has no layout and reports both as reachable, which is exactly
 * why it shipped — docs/reusable/silent-success.md.
 *
 * Passing `Tooltip` a controlled `open` would not have fixed it either: it
 * installs `useHover` and `useFocus` unconditionally, so a click-opened card
 * would still close when the pointer left the trigger, and
 * `useRole({role: "tooltip"})` is wrong for a container with links in it.
 * GPT Sol's review of the plan, 2026-08-30.
 *
 * So this follows `ColourPicker` in SearchPanel.tsx instead, which is the one
 * click-popover this app already has and argues each of its choices in its own
 * docstring: `useClick` where the tooltip has `useHover`, `useDismiss` for
 * Escape and outside-press, `useRole({role: "dialog"})`, and
 * `FloatingFocusManager` at `modal={false}` so focus is not trapped, Tab
 * reaches the links, and focus returns to the trigger on close.
 *
 * ## Why it fetches for itself, and what that argument is NOT
 *
 * It fetches `/api/reader?slug=` when it is **opened**, rather than taking the
 * text as props from somewhere that fetched it at page load. That keeps this
 * component's data in one place.
 *
 * **The reason this file first gave was wrong, and the correction is worth
 * keeping.** It claimed the panel fetched separately so that the reader's
 * profile would not be sent five times a page. It was: five hooks called
 * `useHasProfile`, which fetched `/api/reader` — `profile` and `purpose`
 * included — for a boolean, so this request was a *sixth*, not a substitute
 * for five. GPT Sol's review of the built code, 2026-08-30. Those five went
 * with the *Use your profile* checkbox on 2026-09-13; this panel's read, made
 * only when it is opened, is no longer one of six.
 *
 * What the fetch-on-open does buy is that the panel shows what the server holds
 * *now* rather than what it held when the page mounted. That is only true
 * because `apiFetch` caches `/api/reader` offline and a `PATCH` to
 * `/api/library/<slug>` now invalidates it — see `saving` in
 * [lib/api.ts](./lib/api.ts). Without that line this panel served last week's
 * sentence as current, and said so confidently.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  FloatingFocusManager,
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import { apiFetch, readJson } from "./lib/api.js";
import { Link } from "./Link.js";
import { PROFILE_HREF, carriedSearch, readHref } from "./router.js";

/**
 * What `GET /api/reader?slug=` says about the reader.
 *
 * `hasProfile` is on the response and deliberately unused here: this panel is
 * about the two boxes, and whether they add up to something the prompts count
 * is not a question it needs answered.
 */
interface ReaderProfile {
  /** "About you", the same on every article. `null` for never written. */
  profile: string | null;
  /** "Why you're reading this one". `null` for never written. */
  purpose: string | null;
  /**
   * `purpose` is `null` because the **shelf could not be read**, not because
   * nothing was written there.
   *
   * The server swallows a shelf failure when it is building a prompt — a job
   * must not die over a purpose nobody may have written — and that policy is
   * exactly wrong for a panel whose whole job is to say what the reader's
   * profile is. Without this flag the two arrive as the same `null` and a
   * reader is told they never wrote the sentence they wrote last week.
   * src/routes.ts § resolveProfileParts.
   */
  purposeFailed: boolean;
}

/**
 * Three states, not two — and the third is the one that gets forgotten.
 *
 * A profile that could not be *read* must never render as a profile that was
 * never *written*: a reader told "you haven't said anything about yourself yet"
 * about the paragraph they wrote last week will go and write it again, and the
 * app will have lied to them in the calmest possible voice.
 */
type Load =
  | { state: "loading" }
  | { state: "ready"; value: ReaderProfile }
  | { state: "failed" };

/**
 * The panel, and whatever button raises it.
 *
 * **The trigger's looks are the caller's, its behaviour is this component's.**
 * Two very different things open this: a bare `👤` beside the checkbox, and the
 * `written for you` pill, which has its own shape and its own two states. Both
 * are the same *act* — ask what this was written for — so they share the
 * popover and nothing else. `className` and `children` are the whole of the
 * difference, which keeps one implementation of focus, dismissal and the fetch
 * rather than two that drift.
 *
 * **It does not hide itself when the reader has no profile.** That is the state
 * where the explanation matters most, and where the two links are the only way
 * a first profile ever gets written — the caller hides the *checkbox*, never
 * this.
 */
export function ProfilePanel({
  slug,
  className,
  label,
  children,
}: {
  slug: string;
  /** The trigger's class. It is a `<button>` whatever it looks like. */
  className: string;
  /** What a screen reader is told the button does. */
  label: string;
  /** The trigger's contents — an icon, or an icon and a word. */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: "top-start",
    whileElementsMounted: autoUpdate,
    /* Padded `flip` and `shift`, like the colour picker's: the trigger lives in
       a band that is 400px at best and 288px at worst, hard against the reading
       column, so the panel has to be free to swing to the other side rather
       than be squeezed against an edge. */
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useClick(context),
    useDismiss(context),
    useRole(context, { role: "dialog" }),
  ]);

  return (
    <>
      <button
        type="button"
        ref={refs.setReference}
        className={`${className}${open ? " open" : ""}`}
        /* Not `title`: a native tooltip on a button that opens a panel about
           the same subject is two explanations racing each other. The panel is
           the explanation. */
        aria-label={label}
        {...getReferenceProps()}
      >
        {children}
      </button>
      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false}>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              className="prof-panel"
              /* Written out as well as spread, for the same reason the colour
                 picker writes it out: a static check cannot see through
                 `getFloatingProps()`, and `aria-label` on a bare `<div>` is a
                 lint error without it. */
              role="dialog"
              aria-label="What you're being written for"
              {...getFloatingProps()}
            >
              <PanelBody slug={slug} onLeave={() => setOpen(false)} />
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}

/**
 * The contents, mounted only while the panel is open — which is what makes the
 * fetch happen on opening rather than on page load, and makes it happen again
 * the next time rather than being cached into staleness.
 */
function PanelBody({ slug, onLeave }: { slug: string; onLeave(): void }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  /**
   * Which request is the current one.
   *
   * **A `live` boolean is not enough, and the reason is StrictMode.** In
   * development React mounts, unmounts and mounts again, so a shared boolean is
   * set true, cleared by the first cleanup, and then set true again by the
   * second effect — after which the *first* request lands, sees `true`, and
   * writes its answer over the second one's. That is a real out-of-order write
   * behind a guard that looks like it covers it, and it is the same trap
   * `useProfile`'s `generation` counter exists for. A number distinguishes the
   * generations a boolean cannot. GPT Sol's review of the built code,
   * 2026-08-30.
   */
  const generation = useRef(0);

  useEffect(() => {
    const mine = ++generation.current;
    apiFetch(`/api/reader?slug=${encodeURIComponent(slug)}`)
      .then((r) => readJson<ReaderProfile>(r))
      .then((value) => mine === generation.current && setLoad({ state: "ready", value }))
      /* No message shown, on purpose: `/profile` reports a read failure
         properly, and this panel's job is to be clear that it does not know
         rather than to explain why. */
      .catch(() => mine === generation.current && setLoad({ state: "failed" }));
    /* Bumping the counter is the cleanup: whatever was in flight for the
       previous generation can no longer win. There is nothing to unsubscribe
       from, and `AbortController` would only save a request that has already
       been paid for. */
    return () => {
      generation.current++;
    };
  }, [slug]);

  return (
    <>
      {/* The promise, said where the claim is made — and it is enforced in the
          prompt rather than here (src/profile.ts § PROFILE_RULES). It is what
          makes a personalised glossary safe to read. */}
      <p className="prof-panel-lede">
        What the glossary, the ideas, chat and explanations are written for. It changes what
        gets explained and how much — never what the article says.
      </p>
      <Box
        label="About you"
        text={load.state === "ready" ? load.value.profile : null}
        failed={load.state === "failed"}
        loading={load.state === "loading"}
        empty="You haven't said anything about yourself yet."
        href={PROFILE_HREF}
        onLeave={onLeave}
      />
      <Box
        label="Why you're reading this one"
        text={load.state === "ready" ? load.value.purpose : null}
        /* **Two ways this half can fail and only one of them is the request.**
           The whole fetch can fall over, or it can come back 200 with the
           global profile intact and the shelf read behind `purpose` having
           thrown. The second is invisible without `purposeFailed`, and it is
           the one that renders as "you never wrote this". */
        failed={load.state === "failed" || (load.state === "ready" && load.value.purposeFailed)}
        loading={load.state === "loading"}
        empty="You haven't said why you're reading this one."
        /* `carriedSearch` so leaving the article for its metadata page and
           coming back does not lose the reader their place — the same thing
           every other link out of the reading view does. */
        href={readHref(slug, carriedSearch(location.search), "metadata")}
        onLeave={onLeave}
      />
    </>
  );
}

/** One of the two boxes, shown rather than edited, with its own way in. */
function Box({
  label,
  text,
  failed,
  loading,
  empty,
  href,
  onLeave,
}: {
  label: string;
  text: string | null;
  failed: boolean;
  loading: boolean;
  /** What to say when this box has never been written. */
  empty: string;
  href: string;
  onLeave(): void;
}) {
  return (
    <div className="prof-panel-box">
      <div className="prof-panel-head">
        <span className="prof-panel-label">{label}</span>
        {/* A real `<a>`, reachable by Tab and by the pointer — which is the
            whole reason this is a popover and not a tooltip. `onLeave` closes
            the panel on the way out so it is not left hanging over a page the
            reader has navigated to. */}
        <Link href={href} className="prof-panel-edit" onClick={onLeave}>
          Edit →
        </Link>
      </div>
      <p className={`prof-panel-text${text ? "" : " quiet"}`}>
        {loading ? "…" : failed ? "We couldn't read this just now." : (text ?? empty)}
      </p>
    </div>
  );
}
