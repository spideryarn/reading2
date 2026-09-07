/**
 * **Type a word, press Enter, be in that mode** — or on that page. Spotlight
 * for the fourteen modes, and for the one page that is not a mode.
 *
 * Greg asked for it on 2026-09-05:
 *
 * > I'd also like to have a command bar where I can type (or even talk) and it
 * > would open the appropriate mode (a bit like Spotlight/Alfred on the Mac)
 *
 * and the four product calls that shape this file were his, made on 2026-09-06
 * before any of it was written (docs/plans/260906h-mode-catalog-and-a-command-bar.md
 * § The four product calls). **Two of them he changed on 2026-09-07**, which is
 * marked on each rather than tidied away — the reasoning that produced them is
 * still the reasoning that keeps the bar small:
 *
 *  1. **Modes only** — *until 2026-09-07*, when Greg asked for the changelog
 *     here too: *"add the Changelog to the footer (e.g. of the Homepage, and
 *     also as a command from the Command Bar."* Everything else that call
 *     refused is still refused, and for the reason it gave: a passage jump, a
 *     generation row, an "ask this article" each need **a verb this bar does
 *     not have**. A page needs none — "go there" is the verb every link in the
 *     app already has. `PAGES` below is the whole of the widening, and
 *     `Command` in command-match.ts is where the type says so.
 *
 *     The half of the call that did not change: a mode row's Enter opens it
 *     **exactly as pressing its Dock button does** — same activation, same
 *     generate-on-open, same cost.
 *  2. It is reachable by **⌘/Ctrl-K and by a button in the Dock**, because
 *     ⌘-K does not exist on a phone. The Dock keeps every mode button it has —
 *     this is an additional door, never a replacement.
 *  3. **No match says `No command matches.` and nothing else.** That overrode
 *     the recommendation put to him, which was to offer the article search as a
 *     fallback row. An honest empty state was preferred to a helpful guess.
 *  4. **The bar's mode rows are exactly what the Dock lists** — narrowed from
 *     *the bar lists exactly what the Dock lists* by the same 2026-09-07
 *     change, since the page rows are the bar's own. The surviving half is
 *     still true *by construction* rather than by agreement: the visible modes
 *     arrive as a prop, computed once by `visibleModes` in Dock.tsx, so there
 *     is no second copy of the experimental-switch rule to keep in step. The
 *     pages are appended **after** that prop, never mixed into it, which is
 *     what keeps the halves separable — and tests/command-bar.test.tsx asserts
 *     both halves rather than the old single one.
 *
 * ## It does not import from `Dock.tsx`, and that is a hard constraint
 *
 * `Dock.tsx` imports *this*, so an import back would close a dependency cycle —
 * GPT Sol's F3, and a real catch, because the obvious way to write this file is
 * `import { visibleModes } from "./Dock.js"`. Everything the bar needs about
 * the Dock arrives as a prop: the list, and the one callback that opens a mode.
 *
 * ## A native `<dialog>`, following FeedbackDialog.tsx
 *
 * `showModal()` gives the focus trap, the focus restore, the inert background
 * and Escape without any of them being written here. There is no shadcn
 * `Dialog` and no `cmdk` in this repo, and this is not the change that should
 * add one.
 *
 * **`showModal()` is not enough on a phone**, which is the other thing copied
 * from FeedbackDialog: iOS does not shrink the layout viewport for its
 * keyboard, it pans a smaller *visual* viewport over one that is still full
 * height, so a dialog placed by CSS sits under the keys. `useVisualViewport`
 * says the whole of it; the two numbers on the `style` below are the fix.
 *
 * ## Where the styling is
 *
 * In `tw:` utilities on the elements, not in a sheet under `src/web/styles/`,
 * and that is a deliberate exception worth flagging rather than a shortcut. By
 * docs/project/design-css-overview.md § Which mechanism owns what, a component
 * that reads as a *system* belongs in its own sheet — but a new sheet has to be
 * `@import`ed from `src/web/styles.css` at a chosen position, because the
 * import order **is** the cascade order (tests/styles-entry-is-imports-only.test.ts),
 * and that file is another agent's ground this week. The semantic class names
 * are all here (`cmdbar`, `cmdbar-row`, …) so the move is a cut and paste when
 * the ground is free; web-client.md § Never delete a semantic class name is why
 * they are on the elements even while they carry no rules.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { modeGenerates } from "./activation.js";
import {
  commandId,
  commandText,
  modeCommand,
  rankCommands,
  type Command,
} from "./command-match.js";
import type { Mode } from "./params.js";
import { CHANGELOG_HREF, CHANGELOG_LABEL, navigate } from "./router.js";
import { useVisualViewport } from "./useVisualViewport.js";

/**
 * **The pages the bar offers, which are not modes**, and this array is the
 * whole of Greg's 2026-09-07 widening — see call 1 in the header.
 *
 * The list lives here rather than in command-match.ts for one mechanical
 * reason: naming an href means importing router.ts, router.ts imports React,
 * and that module's first claim about itself is that it imports no React. It
 * ranks a page; it does not know which pages there are.
 *
 * **Why this is a list and not a single constant**, given it holds one entry:
 * the same argument SiteFooter.tsx § `LINKS` makes and has now been paid off
 * three times — a second page is one entry here, not an edit to the rendering
 * below. It is deliberately *not* the footer's list, though. Those two rows
 * answer different questions: the footer is the site's own navigation and
 * carries Home, Features, Pricing, Privacy and Contact, none of which a reader
 * mid-article is reaching for a keyboard to get to. Sharing one array would
 * make five rows appear in the bar to keep a promise nobody made.
 */
const PAGES: readonly Extract<Command, { kind: "page" }>[] = [
  {
    kind: "page",
    href: CHANGELOG_HREF,
    /* "What's new" rather than "Changelog", the same call SiteFooter.tsx makes
       and for the same reason: the latter is the internal name for the process
       that writes the page (docs/project/changelog.md), and a reader has never
       heard of it. So the word a reader *would* type is an alias below rather
       than the name here. */
    label: CHANGELOG_LABEL,
    description: "Every release since launch, newest first.",
    /* `changelog` because it is what the address says and what a developer
       reaches for. `releases` and `updates` are the two other words for the
       same thing.

       **Then the label itself, twice more, because there are three ways to type
       it and only one of them is the label.** `canonical` deliberately does not
       fold punctuation (command-match.ts § `canonical` says why), and the label
       carries the typographic `’`, so a reader who types the words in front of
       them matches only if their keyboard happened to produce that character.
       A phone's does — iOS substitutes `’` automatically — and a desktop's
       usually does not, which makes `what's new` with a straight apostrophe the
       single likeliest spelling of all and the one this list shipped without
       until GPT Sol caught it. `whats new` covers dropping it entirely. */
    aliases: ["changelog", "releases", "updates", "what's new", "whats new"],
  },
];

/**
 * **What a reader is told about a row that would start work**, and it is one
 * plain verb rather than a glyph or a figure.
 *
 * Fable's reasoning, 2026-09-07, arbitrating GPT Sol's F1: a glyph needs a
 * tooltip to mean anything and *"a tooltip is not read by anybody in a hurry"*
 * (this repo's own words, 260906b); a coin would make it about money, which
 * readers do not pay per call since they hold slots; a spark would read as "AI
 * magic", which is the flattening voice vision.md rejects. `generates` names
 * what happens.
 *
 * Which rows carry it is `modeGenerates` in activation.ts, derived from a table
 * that is already total — so mode fifteen gets its marker decided by the row it
 * must already write. That docblock has what the marker deliberately does not
 * say, and where it over-warns.
 */
export const GENERATES_MARKER = "generates";

/**
 * **The empty state, exactly as Greg specified it and nothing beside it.**
 *
 * A `const` rather than a literal in the markup so that the test asserting the
 * bar says this *and only this* is comparing against the same string the reader
 * sees. docs/project/copy.md is the home for reader-facing failure messages;
 * this is not one — nothing failed, and the sentence is about the query rather
 * than about the app.
 */
export const NO_MATCH = "No command matches.";

interface Props {
  /**
   * The modes to offer, in Dock order, **already filtered** by
   * `visibleModes` — which is the whole of requirement 4. The bar never asks
   * whether the experimental switch is on; it draws what it was handed.
   */
  modes: readonly Mode[];
  /**
   * **Opening a mode, and the same function the Dock button calls** — `Dock` §
   * `activateMode`. It arms and it moves the band, in that order. This
   * component adds only its own presentation afterwards: close, and clear.
   */
  activateMode(next: Mode): void;
  open: boolean;
  onClose(): void;
}

export function CommandBar({ modes, activateMode, open, onClose }: Props) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listId = useId();

  const [draft, setDraft] = useState("");
  /**
   * **Which row Enter would take**, as an index into `results` below.
   *
   * The first row is selected whenever the filter changes — reset in the input
   * handler rather than in an effect, so that "the selection follows what you
   * typed" is one statement in the one place the filter can change. It is also
   * **clamped at render**, because `modes` can shrink underneath it: the
   * experimental switch is three inches away and turning it off takes five rows
   * out of the list while the bar is open.
   */
  const [selected, setSelected] = useState(0);

  /**
   * **The Dock's modes, then the pages** — and the concatenation is what makes
   * call 4 in the header true. `modes` arrives already filtered and is spread
   * rather than merged into, so the mode rows remain exactly the prop, in
   * exactly its order; a tie between a mode and a page therefore falls to the
   * mode, because `rankCommands` breaks ties on input order.
   */
  const commands = useMemo(() => [...modes.map(modeCommand), ...PAGES], [modes]);
  const results = useMemo(() => rankCommands(draft, commands), [draft, commands]);
  const index = Math.min(selected, Math.max(0, results.length - 1));
  const active = results[index];

  /* Lightbox.tsx § closingOurselves, and the same trap: `close()` fires the
     same `close` event a reader's Escape does, so without this the shutting we
     asked for comes back as a second `onClose`. */
  const closingOurselves = useRef(false);

  /**
   * **`useLayoutEffect` for the same reason FeedbackDialog gives**: a passive
   * effect runs after paint, so a state change that also shuts the dialog gets
   * one painted frame of the new state inside a dialog that is still open.
   * jsdom cannot tell the two apart, which is why that file says so out loud
   * rather than claiming its test proves the timing.
   */
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      /* **Cleared here, before `showModal()`, and not in the passive effect
         below.** It was there until GPT Sol's F1 on stage 2: Escape and a
         backdrop click close the dialog without clearing, so the *next* open
         painted one frame of the last query's results — or of
         `No command matches.` — before a passive effect could reset it. A
         layout effect runs before that paint, so there is no frame to see. */
      setDraft("");
      setSelected(0);
      closingOurselves.current = false;
      dialog.showModal();
    } else if (!open && dialog.open) {
      closingOurselves.current = true;
      dialog.close();
    }
  }, [open]);

  /**
   * **A fresh bar every time, and the draft does not survive a close.**
   *
   * The design brief proposed keeping an unfinished command across a close and
   * reopen; v1 clears, deliberately (260906h § Deliberately deferred). One
   * `useState`, no identity question, and no half-typed command surviving a
   * change of reader.
   *
   * The focus is here rather than on an `autoFocus` attribute because the
   * element is inside a `<dialog>` that was not in the top layer when React
   * mounted it: `showModal()` moves focus itself, to the first focusable child,
   * and asking explicitly is what makes that a fact rather than a coincidence
   * of child order.
   */
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  /* The reader can see less than CSS thinks on iOS — see the header, and
     useVisualViewport.ts, which owns the whole argument. */
  const visible = useVisualViewport(open);

  /**
   * **Enter, and the one thing it must not do**: activate when there is nothing
   * selected. `results` is empty for a query that matches nothing, and a bar
   * that opened *something* on Enter after saying `No command matches.` would
   * be worse than one that did nothing.
   */
  const activate = useCallback(
    (command: Command) => {
      /* **Two verbs, and the switch is the whole of the difference between the
         two kinds of row.** A mode is armed exactly as its Dock button arms it
         (call 1); a page is navigated to exactly as a `<Link>` navigates —
         `navigate` is what Link.tsx calls once it has decided the reader wants
         to stay in this tab, which a reader pressing Enter in a modal dialog
         has.

         **No ⌘-click into a new tab**, which a real `<a>` would give and this
         does not. Deferred rather than missed: an `<a>` inside `role="option"`
         puts an interactive element inside an interactive role, and the rows
         are `div`s precisely because Biome is right to refuse that. The bar is
         a keyboard instrument; the footer link is the one to ⌘-click. */
      if (command.kind === "page") navigate(command.href);
      else activateMode(command.mode);
      setDraft("");
      setSelected(0);
      onClose();
    },
    [activateMode, onClose],
  );

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the click handled here is the backdrop, whose keyboard equivalent is Escape — which <dialog> implements itself. Lightbox.tsx carries the same ignore for the same handler; FeedbackDialog.tsx does not only because its ⌘/Ctrl+Enter listener happens to satisfy the rule
    <dialog
      ref={ref}
      className="cmdbar tw:fixed tw:inset-0 tw:m-0 tw:h-full tw:max-h-full tw:w-full tw:max-w-full tw:border-0 tw:bg-black/50 tw:p-0"
      aria-label="Commands"
      /**
       * **The box the reader can see, rather than the one CSS believes in** —
       * the same three numbers FeedbackDialog places itself with, and the same
       * reasoning: `inset: 0` above is the *layout* viewport, and on iOS the
       * keyboard does not touch that, it pans a smaller *visual* viewport over
       * it. `bottom: auto` because `inset-0` set it, and with `top`, `bottom`
       * and `height` all given the browser drops one of them — which one is not
       * a thing to leave to a rule of precedence.
       *
       * `undefined` when there is no `visualViewport` (jsdom, an old browser),
       * which leaves the utilities above standing exactly as written.
       */
      style={
        visible === null
          ? undefined
          : { top: `${visible.offsetTop}px`, height: `${visible.height}px`, bottom: "auto" }
      }
      onClose={() => {
        if (closingOurselves.current) return;
        onClose();
      }}
      onClick={(e) => {
        /* The backdrop. Its keyboard equivalent is Escape, which <dialog>
           implements itself — so no handler here needs to. */
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="cmdbar-panel tw:mx-auto tw:mt-[12vh] tw:flex tw:max-h-[70%] tw:w-[min(34rem,92vw)] tw:flex-col tw:overflow-hidden tw:rounded-lg tw:border tw:border-rule tw:bg-surface-raised tw:shadow-lg">
        <input
          ref={inputRef}
          type="text"
          className="cmdbar-input tw:w-full tw:border-0 tw:border-b tw:border-rule tw:bg-transparent tw:px-4 tw:py-3 tw:text-base tw:text-ink tw:outline-none"
          /* The visible label would be one more thing on screen in a bar whose
             whole argument is speed; the placeholder is the hint and this is the
             name. */
          aria-label="Type a command"
          /* "a command" rather than "a mode" since 2026-09-07: the bar stopped
             being modes-only (call 1), and a placeholder that names one of the
             two kinds tells the reader the other one is not here. */
          placeholder="Type a command…"
          /* **The soft keyboard's Enter key says Go**, because that is what it
             does: it takes you to the selected command — into a mode, or to a
             page. Not `search` — the search
             is the typing, and Enter does not run one — and not `send`, which
             in this app means posting something into a conversation.
             docs/project/touch.md § What the Enter key promises, and
             tests/what-the-enter-key-promises.test.tsx, which is a sweep of the
             source and so finds a box that never asked the question. */
          enterKeyHint="go"
          value={draft}
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          /* Which row Enter would take, announced without moving focus off the
             box the reader is typing in — the listbox pattern's own answer. */
          aria-activedescendant={active === undefined ? undefined : `${listId}-${commandId(active)}`}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setDraft(e.target.value);
            /* **Back to the first row on every filter change.** Otherwise a
               reader who arrowed down to row four and then typed one more
               letter has Enter pointing at whatever is fourth in a list they
               have not looked at. */
            setSelected(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              /* Clamped rather than wrapped, at both ends. Wrapping is fine in a
                 long list you scroll; in fourteen rows it means holding an arrow
                 quietly cycles, and every row here can spend money. */
              setSelected(Math.min(index + 1, results.length - 1));
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelected(Math.max(index - 1, 0));
              return;
            }
            if (e.key === "Enter") {
              e.preventDefault();
              if (active !== undefined) activate(active);
            }
          }}
        />

        {results.length === 0 ? (
          /* Exactly this, and nothing beside it — Greg's answer 3. No search
             fallback, no "did you mean", no list of everything. */
          <p className="cmdbar-empty tw:m-0 tw:px-4 tw:py-4 tw:text-sm tw:text-muted-foreground">
            {NO_MATCH}
          </p>
        ) : (
          /* **`div`s rather than a `ul`/`li`**, on Biome's own advice: an
             interactive ARIA role on a non-interactive element is an error
             (`noNoninteractiveElementToInteractiveRole`), and a listbox of
             options is exactly that. The semantics a screen reader reads come
             from the roles either way. */
          <div
            id={listId}
            className="cmdbar-list tw:m-0 tw:overflow-y-auto tw:p-1"
            role="listbox"
            /* "Commands", not "Modes", since a page row is neither a mode nor
               a lie the reader should have to reconcile. */
            aria-label="Commands"
          >
            {results.map((command, at) => (
              // biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard equivalent is on the input above — Up/Down move the selection and Enter takes it, which is the listbox pattern; a key handler here would need focus on the row, and focus stays in the box the reader is typing in
              <div
                key={commandId(command)}
                id={`${listId}-${commandId(command)}`}
                className={`cmdbar-row tw:flex tw:cursor-pointer tw:items-baseline tw:gap-2 tw:rounded tw:px-3 tw:py-2 tw:text-sm ${
                  at === index ? "on tw:bg-accent tw:text-ink" : "tw:text-ink-soft"
                }`}
                role="option"
                aria-selected={at === index}
                /* **Which kind of row this is, readable from the outside.** Not
                   styling — the two kinds are drawn identically on purpose, so
                   that going somewhere and changing the band feel like one
                   instrument. It is here so that tests/command-bar.test.tsx can
                   state the surviving half of call 4 ("the *mode* rows are
                   exactly what the Dock lists") without inferring the kind from
                   a row's label or from an href's leading slash. */
                data-kind={command.kind}
                /* **`-1`, and not a tab stop.** Focus stays in the box the
                   reader is typing in — which is the whole reason the input
                   carries `aria-activedescendant` — so a row is reached by the
                   arrows rather than by Tab. The attribute is here because an
                   element with an interactive role and no `tabIndex` at all is
                   reachable by nothing, which Biome is right to refuse. */
                tabIndex={-1}
                /* A mouse or a finger selects **and** activates, in one press.
                   Selecting first is what makes the highlight follow the press
                   rather than lag a frame behind it. */
                onClick={() => {
                  setSelected(at);
                  activate(command);
                }}
              >
                <span className="cmdbar-name tw:font-medium tw:text-ink">
                  {commandText(command).label}
                </span>
                <span className="cmdbar-what tw:min-w-0 tw:flex-1 tw:truncate tw:text-muted-foreground">
                  {commandText(command).description}
                </span>
                {/* One bit, after the sentence rather than before it: the row is
                    still about what the mode gives you, and this is a note on
                    the end. `GENERATES_MARKER` says why it is a word.

                    **No page row can carry it, and that is a limitation rather
                    than a fact about pages.** It is true of today's only page —
                    `/changelog` reads a file the build already shipped — and it
                    is enforced by this `kind` check, which is exactly why a
                    page that *did* spend would ship silently under-warning: the
                    check would go on excluding it and no test could see the
                    difference (GPT Sol, 2026-09-07). The fix, on the day a
                    spending page is proposed, is to move "does this start
                    work?" into `Command` itself and render off the property —
                    not to add a second name to this condition. */}
                {command.kind === "mode" && modeGenerates(command.mode) && (
                  <span className="cmdbar-generates tw:shrink-0 tw:text-xs tw:text-ink-faint">
                    {GENERATES_MARKER}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </dialog>
  );
}
