/**
 * "What am I being written for?" — answered, and changed, where the question is
 * asked.
 *
 * A small popover, raised from the *written for you* badge (WrittenForYou.tsx)
 * — and, until 2026-09-13, from a button beside the *Use your profile*
 * checkbox, which went with the checkbox — that says what a profile does and
 * holds both boxes, **editable in place since 2026-10-02**, with a *Regenerate*
 * for the text the badge is on when the server says the profile has changed
 * since it was written. docs/plans/260830c-profile-panel.md,
 * docs/plans/261002b-written-for-your-profile-panel-edit-in-place-and-regenerate.md,
 * docs/project/reader-profile.md.
 *
 * ## It edits, and that reverses a decision made on purpose
 *
 * > And if possible, allow them to edit the text inline (rather than having to
 * > click out to separate pages.
 * >
 * > I suppose if they do edit or if the profile has changed since the mode
 * > generated, then it should show a handy "Regenerate" button in that mode's
 * > "This was written for your profile" panel.
 * >
 * > — Greg, 2026-10-01, `[SPIDERYARN-READING2-7S]`
 *
 * **Until then it was read-only, and that was chosen knowing the alternative.**
 * On 2026-08-30 GPT Sol found two ways a popover loses text, and Greg kept the
 * panel to reading rather than open them. Editing is back only because each
 * hole now has something closing it:
 *
 * 1. **Dismissed with words unsaved.** An outside press unmounts the box, so
 *    save-on-blur need never fire. Here an outside press, Escape or *Done*
 *    commits both boxes and the panel closes only once both saves have landed
 *    — `PurposePrompt`'s *Done* latch. A refused save lets go of the latch and
 *    keeps the panel open with the server's reason in the box's status line.
 * 2. **Dismissed mid-dictation.** Dictation's unmount *aborts*, on purpose. So
 *    each box tells the panel when its microphone is on or its words are on
 *    their way (`ProfileBox`'s `onBusyChange`), and while either is, nothing
 *    dismisses it.
 * 3. **Unmounted under the reader** — the dock switching mode, another article.
 *    The band goes whatever the popover thinks, and an SPA navigation fires
 *    neither `visibilitychange` nor `pagehide`. `useAutosavedText` now sends
 *    the `keepalive` save on unmount as well (Sol's plan review). A dictation
 *    still running then is aborted, as it is in every `ProfileBox`, with the
 *    device recording kept for recovery: named, not closed.
 *
 * The two `Edit →` links went with this. Each was a way out of the panel that
 * skipped the save, and what they led to is here now; `/profile` stays on the
 * Command bar.
 *
 * **An offline copy is shown, not edited** (Sol). `apiFetch` answers a failed
 * GET with the cached body as a 200 marked `x-spideryarn-offline: copy`; edited,
 * that copy would be PATCHed over whatever the reader has written since,
 * the moment the network came back.
 *
 * ## Regenerate: only when the server says so
 *
 * Offered only when the badge's `changed` is true — the mode's own read said
 * `profileChanged`. **Not when a save happened here**: an edit reverted, or
 * whitespace the server trims, would offer a paid call for text that is still
 * current — and for a step that appends, append. So once a save from the panel
 * has settled, the panel asks the mode to read again (`refresh`), and the
 * server's hash comparison decides. It is held while either box is unsaved or
 * a save is on the wire, so a run cannot start before the new profile has
 * landed and then be stamped as current. Pressing it calls the mode's own
 * forced run and closes the panel; the mode's progress row shows the job.
 *
 * ## Why this is not a `<Tooltip>`
 *
 * It was going to be. `Tooltip` cannot do it, and the reason is worth keeping
 * because the same mistake shipped once already.
 *
 * `.tooltip-anchor` is `pointer-events: none` (styles.css § tooltip) and
 * `Tooltip` passes `handleClose: null` — every card in this app is *read*, never
 * entered. So **a control inside one cannot be pressed**, and the pointer cannot
 * travel to it in the first place. The `written for you` badge carried an
 * `Edit your profile →` link from the day it was written, and that link never
 * worked: measured in headless Chrome with real pointer events,
 * `document.elementFromPoint` at the link's own centre returns the page behind
 * it, while the same test on an ordinary in-flow link on the same page returns
 * the link. jsdom has no layout and reports both as reachable, which is exactly
 * why it shipped — docs/reusable/silent-success.md.
 *
 * Passing `Tooltip` a controlled `open` would not have fixed it either: it
 * installs `useHover` and `useFocus` unconditionally, so a click-opened card
 * would still close when the pointer left the trigger, and
 * `useRole({role: "tooltip"})` is wrong for a container with controls in it.
 * GPT Sol's review of the plan, 2026-08-30.
 *
 * So this follows `ColourPicker` in SearchPanel.tsx instead, which is the one
 * click-popover this app already had and argues each of its choices in its own
 * docstring: `useClick` where the tooltip has `useHover`, `useDismiss` for
 * Escape and outside-press, `useRole({role: "dialog"})`, and
 * `FloatingFocusManager` at `modal={false}` so focus is not trapped and returns
 * to the trigger on close.
 *
 * ## Why it fetches for itself, and what that argument is NOT
 *
 * It fetches `/api/reader?slug=` when it is **opened**, rather than taking the
 * text as props from somewhere that fetched it at page load. That keeps this
 * component's data in one place.
 *
 * **The reason this file first gave was wrong, and the correction is worth
 * keeping.** It claimed the panel fetched separately so that the reader's
 * profile would not be sent repeatedly on a page. It was: six callers used
 * `useHasProfile`, which fetched `/api/reader` — `profile` and `purpose`
 * included — for a boolean, so this request was another fetch, not a substitute
 * for theirs. GPT Sol's review of the built code, 2026-08-30. Those callers went
 * with the *Use your profile* checkbox on 2026-09-13; this panel's read, made
 * only when it is opened, is now the only one made for the profile panel.
 *
 * What the fetch-on-open does buy is that the panel shows what the server holds
 * *now* rather than what it held when the page mounted — and, now that it
 * edits, that the boxes are seeded from that. That is only true because
 * `apiFetch` caches `/api/reader` offline and a `PATCH` to `/api/library/<slug>`
 * invalidates it — see `saving` in [lib/api.ts](./lib/api.ts). Without that
 * line this panel served last week's sentence as current, and said so
 * confidently.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
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
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MAX_PROFILE_CHARS, MAX_PURPOSE_CHARS } from "../types.js";
import { apiFetch, readJson } from "./lib/api.js";
import { ProfileBox } from "./ProfileBox.js";
import { leavePurpose, savePurpose } from "./purpose.js";
import { type SaveState, useAutosavedText } from "./useAutosavedText.js";
import { leaveProfile, saveProfile } from "./useProfile.js";

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
   * reader is offered an empty box over the sentence they wrote last week.
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
 * app will have lied to them in the calmest possible voice. Now that the panel
 * edits, it is worse than a lie: an empty box seeded from a failed read is one
 * a save would erase the paragraph with.
 *
 * `offline` is a fourth fact on `ready`: the body is `apiFetch`'s cached copy,
 * readable and not to be written back.
 */
type Load =
  | { state: "loading" }
  | { state: "ready"; value: ReaderProfile; offline: boolean }
  | { state: "failed" };

/**
 * What a mode hands its badge so the panel can offer to write the text again.
 * Owner-only, like the badge.
 */
export interface Regenerate {
  /** The mode's existing forced run — the same press its own stale banner makes. */
  run(): void;
  /** A job is running or starting for this mode, so a press would be a second one. */
  busy: boolean;
  /**
   * Read the mode's artefact again, so `profileChanged` is the server's
   * verdict on the profile as it now is. Never spends.
   */
  refresh(): void;
}

/** Text the server may not have — `ProfileBox`'s own `pending`. */
function pending(s: SaveState): boolean {
  return s.kind === "dirty" || s.kind === "saving" || s.kind === "error";
}

/**
 * The panel, and the provenance badge that raises it.
 *
 * **The trigger's looks are the caller's, its behaviour is this component's.**
 * `WrittenForYou` supplies the `written for you` pill and its changed-profile
 * state; this component owns the shared act underneath — ask, and change, what
 * this was written for. `className` and `children` keep the trigger's
 * appearance out of the implementation of focus, dismissal and the fetch.
 *
 * It is mounted only for an artefact that was written with a profile. A reader
 * making their first profile now enters through `/profile` or the Command bar;
 * the pre-generation trigger went with the checkbox on 2026-09-13.
 */
export function ProfilePanel({
  slug,
  className,
  label,
  note,
  changed = false,
  regenerate,
  children,
}: {
  slug: string;
  /** The trigger's class. It is a `<button>` whatever it looks like. */
  className: string;
  /** What a screen reader is told the button does. */
  label: string;
  /** The trigger's contents — an icon, or an icon and a word. */
  children: ReactNode;
  /**
   * What the trigger was saying, in a sentence at the top of the panel — for a
   * trigger that is only an icon, this is the one place its words are read
   * (WrittenForYou.tsx § `compact`).
   */
  note?: string | undefined;
  /** The server says the text was written for a profile the reader has since changed. */
  changed?: boolean;
  /** The mode's forced run, if it has one the panel may offer. */
  regenerate?: Regenerate | undefined;
}) {
  const [open, setOpen] = useState(false);
  /**
   * **Whether the panel may close now** — asked by every way of closing it
   * except a Regenerate press, which is only enabled when the answer is yes.
   * `PanelBody` installs the real question while it is mounted; it answers
   * no, and arranges to close itself, when a box still has words the server
   * does not.
   */
  const mayClose = useRef<() => boolean>(() => true);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: (next) => {
      if (next) setOpen(true);
      else if (mayClose.current()) setOpen(false);
    },
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
          {/* **Focus goes to the panel, not into the first box.** The default
              is the first tabbable thing, which is now a textarea — and on a
              phone or an iPad focusing a textarea raises the keyboard over
              the panel the reader only opened to read. */}
          <FloatingFocusManager context={context} modal={false} initialFocus={refs.floating}>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              className="prof-panel"
              tabIndex={-1}
              /* Written out as well as spread, for the same reason the colour
                 picker writes it out: a static check cannot see through
                 `getFloatingProps()`, and `aria-label` on a bare `<div>` is a
                 lint error without it. */
              role="dialog"
              aria-label="What you're being written for"
              {...getFloatingProps()}
            >
              {note && <p className="prof-panel-note">{note}</p>}
              <PanelBody
                slug={slug}
                mayClose={mayClose}
                onClose={() => setOpen(false)}
                changed={changed}
                regenerate={regenerate}
              />
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
 * the next time rather than being cached into staleness. The two saves live
 * here for the same reason: a box seeded from this opening's read, and nothing
 * left over from the last.
 */
function PanelBody({
  slug,
  mayClose,
  onClose,
  changed,
  regenerate,
}: {
  slug: string;
  mayClose: RefObject<() => boolean>;
  onClose(): void;
  changed: boolean;
  regenerate: Regenerate | undefined;
}) {
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

  /* The same two saves the two pages make — `/profile`'s and Metadata's — so
     the panel is a third place to edit each string, not a third way of
     storing it. */
  const about = useAutosavedText({ save: saveProfile, leave: leaveProfile });
  const purpose = useAutosavedText({
    /* The server's answer, not what was typed, and an empty box clears — as
       Metadata.tsx's box. Seeded from this opening's read, so an empty box is
       one the reader can see is empty. */
    save: async (text) => (await savePurpose(slug, text === "" ? null : text)) ?? "",
    leave: (text) => leavePurpose(slug, text),
  });
  const seedAbout = about.seed;
  const seedPurpose = purpose.seed;

  useEffect(() => {
    const mine = ++generation.current;
    apiFetch(`/api/reader?slug=${encodeURIComponent(slug)}`)
      .then(async (r) => {
        const offline = r.headers.get("x-spideryarn-offline") === "copy";
        const value = await readJson<ReaderProfile>(r);
        if (mine !== generation.current) return;
        setLoad({ state: "ready", value, offline });
        /* **Seeded only from a real read.** A copy is shown and not offered,
           and a half the server could not read gets no box at all. */
        if (offline) return;
        seedAbout(value.profile ?? "");
        if (!value.purposeFailed) seedPurpose(value.purpose ?? "");
      })
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
  }, [slug, seedAbout, seedPurpose]);

  /* The microphone in either box is on, or its words are on their way. */
  const [aboutBusy, setAboutBusy] = useState(false);
  const [purposeBusy, setPurposeBusy] = useState(false);
  const dictating = aboutBusy || purposeBusy;

  /* Every word in both boxes is on the server, and no write is still on the
     wire to change that. `inFlight` as well as the state, for the reason
     PurposePrompt.tsx's latch gives: a draft moved back to the loaded value
     reads `clean` while an older write is still on its way to replace it. */
  const settled =
    !pending(about.state) && !pending(purpose.state) && !about.inFlight && !purpose.inFlight;
  const refused = about.state.kind === "error" || purpose.state.kind === "error";

  /* **Closing, latched.** Set by a dismissal that found words unsaved; this
     closes once both saves have landed, and lets go on a refusal so the reader
     can read the reason in the box. */
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (!closing || dictating) return;
    if (settled) {
      setClosing(false);
      onClose();
    } else if (refused) {
      setClosing(false);
    }
  }, [closing, dictating, settled, refused, onClose]);

  /* What the dismissal asks. Read through a ref, because Floating UI calls it
     from listeners set up on an earlier render. */
  const now = useRef({ settled, dictating, commitAbout: about.commit, commitPurpose: purpose.commit });
  now.current = { settled, dictating, commitAbout: about.commit, commitPurpose: purpose.commit };
  const ask = useCallback((): boolean => {
    const { settled: clean, dictating: busy, commitAbout, commitPurpose } = now.current;
    /* Not while a dictation is running — its unmount aborts. The reader stops
       the microphone, and the next dismissal goes through. */
    if (busy) return false;
    if (clean) return true;
    commitAbout();
    commitPurpose();
    setClosing(true);
    return false;
  }, []);
  useEffect(() => {
    mayClose.current = ask;
    return () => {
      mayClose.current = () => true;
    };
  }, [mayClose, ask]);

  /* **Ask the mode to read again, once per save that settles here.** Its
     `profileChanged` is the server comparing the artefact's profile hash with
     the profile as it now is — the only judge of whether a Regenerate is due,
     so a reverted edit offers nothing. `saved` is the state after a write
     this opening; once refreshed, nothing more until a box has something
     pending again. */
  const savedHere = about.state.kind === "saved" || purpose.state.kind === "saved";
  const refreshed = useRef(false);
  const latestRegenerate = useRef(regenerate);
  latestRegenerate.current = regenerate;
  useEffect(() => {
    if (!settled) {
      refreshed.current = false;
      return;
    }
    if (savedHere && !refreshed.current) {
      refreshed.current = true;
      latestRegenerate.current?.refresh();
    }
  }, [settled, savedHere]);

  const ready = load.state === "ready" ? load : null;
  const editable = ready !== null && !ready.offline;

  return (
    <>
      {/* The promise, said where the claim is made — and it is enforced in the
          prompt rather than here (src/profile.ts § PROFILE_RULES). It is what
          makes a personalised glossary safe to read. */}
      <p className="prof-panel-lede">
        What the glossary, the ideas, chat and explanations are written for. It changes what
        gets explained and how much — never what the article says.
      </p>
      {ready?.offline && (
        <p className="prof-panel-offline">
          You're offline, so this is the copy saved on this device. You can change it once you're
          back online.
        </p>
      )}
      {editable ? (
        <ProfileBox
          id="panel-profile"
          label="About you"
          hint="Every article."
          placeholder="e.g. Cognitive scientist. Rusty on transformer internals."
          value={about.draft}
          onChange={about.setDraft}
          onCommit={about.commit}
          max={MAX_PROFILE_CHARS}
          disabled={about.saved === null}
          rows={3}
          save={about.state}
          onBusyChange={setAboutBusy}
        />
      ) : (
        <Shown
          label="About you"
          text={ready ? ready.value.profile : null}
          failed={load.state === "failed"}
          loading={load.state === "loading"}
          empty="You haven't said anything about yourself yet."
        />
      )}
      {/* **Two ways this half can fail and only one of them is the request.**
          The whole fetch can fall over, or it can come back 200 with the global
          profile intact and the shelf read behind `purpose` having thrown. The
          second is invisible without `purposeFailed`, and it is the one that
          would offer an empty box over a sentence the reader wrote. */}
      {editable && !ready.value.purposeFailed ? (
        <ProfileBox
          id="panel-purpose"
          label="Why you're reading this one"
          hint="This article only."
          placeholder="e.g. I want the evidence, not the history"
          value={purpose.draft}
          onChange={purpose.setDraft}
          onCommit={purpose.commit}
          max={MAX_PURPOSE_CHARS}
          disabled={purpose.saved === null}
          rows={2}
          save={purpose.state}
          onBusyChange={setPurposeBusy}
        />
      ) : (
        <Shown
          label="Why you're reading this one"
          text={ready ? ready.value.purpose : null}
          failed={load.state === "failed" || ready?.value.purposeFailed === true}
          loading={load.state === "loading"}
          empty="You haven't said why you're reading this one."
        />
      )}
      <div className="prof-panel-actions">
        {changed && regenerate && (
          <Button
            type="button"
            size="xs"
            variant="outline"
            /* Held until both boxes are on the server — a run started first
               would be written for the old words and stamped as current — and
               while the mode already has a job, so a press is never a second
               paid call. */
            disabled={!settled || dictating || regenerate.busy}
            onClick={() => {
              regenerate.run();
              onClose();
            }}
          >
            <RefreshCw aria-hidden="true" />
            {/* One word whatever the state: a job already running may not be
                this button's, and the mode's own progress row says what it is. */}
            Regenerate
          </Button>
        )}
        <Button
          type="button"
          size="xs"
          className="prof-panel-done"
          disabled={closing}
          onClick={() => {
            if (ask()) onClose();
          }}
        >
          Done
        </Button>
      </div>
    </>
  );
}

/**
 * One of the two boxes, shown rather than edited — while the read is on its
 * way, when it failed, or when all there is is an offline copy.
 */
function Shown({
  label,
  text,
  failed,
  loading,
  empty,
}: {
  label: string;
  text: string | null;
  failed: boolean;
  loading: boolean;
  /** What to say when this box has never been written. */
  empty: string;
}) {
  return (
    <div className="prof-panel-box">
      <span className="prof-panel-label">{label}</span>
      <p className={`prof-panel-text${text && !failed ? "" : " quiet"}`}>
        {loading ? "…" : failed ? "We couldn't read this just now." : (text ?? empty)}
      </p>
    </div>
  );
}
