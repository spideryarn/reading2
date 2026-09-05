# Review: rich tooltips on the shelf's action buttons

You are reviewing a small, finished UI change in a TypeScript + React 19 app (Spideryarn, a
reading tool). Be adversarial and concrete. I want defects, not praise. Where you are unsure, say so
and say what you would check.

## The ask

> On the Homepage shelf, there are a few icons that show up on hover, e.g. what looks like edit
> title, open original, archive... Add rich tooltips for each (sometimes I see them, sometimes I
> don't). And if some actions are not available, perhaps show them but disabled with a tooltip
> explaining why.
>
> — the product owner, 2026-09-05

"Sometimes I see them, sometimes I don't" is not a flake: two of the five buttons were rendered only
when the article had a usable source URL, so the row was five icons wide on one card and three on the
next.

## What was done

1. Every button in the row now carries a `ControlTip` card (Floating UI) instead of a native `title`.
   The row is wrapped in one `TooltipGroup` so neighbours open instantly.
2. All five buttons are always drawn. Where the action cannot be performed the control is
   **`aria-disabled`** (not natively `disabled`) and its card says why.
3. `IconButton` changed: it now spreads rest props (so `Tooltip` can attach `onFocus`/`onBlur`,
   `aria-describedby`, dismiss handlers), `disabled` means `aria-disabled` + a swallowed click, and
   `titled={false}` suppresses the native `title`.

## The reasoning I want you to attack

- **`aria-disabled` rather than `disabled`.** A natively disabled `<button>` dispatches no mouse
  events and is out of the tab order, so the card explaining why it is unavailable would be the one
  card that can never be opened — by pointer or keyboard. Is that right? Is `aria-disabled` on a
  button that remains in the tab order and remains clickable (with the handler swallowing the click)
  actually the better accessibility answer here, or have I traded one problem for a worse one?
- **The non-web-URL case still renders no `<a>` at all** — a `<button aria-disabled>` instead —
  because the security rule is that no anchor may hold an `href` we would not follow (imported
  metadata is written into the row as given, so `javascript:` is reachable). Is there any remaining
  path by which that value reaches the DOM?
- **`IconButton` now spreads arbitrary `ButtonHTMLAttributes`.** Is anything load-bearing now
  overridable by a caller in a way that could break silently? Note the order: `{...rest}` is first,
  then `ref`, `type`, `onClick`, `aria-disabled`, `title`, `aria-label`, `className`.
- **`ControlTip`'s house rule** is that the first paragraph is what pressing the control would have
  told you and the second is what it would not (cost, provenance, or what the control does *not*
  promise). A second paragraph restating the first is the failure mode. Read the eight cards in
  `TIPS` and tell me which ones break that rule, and which say something a reader can already see on
  the screen.
- **Factual claims in the copy.** Flag anything the code does not support. In particular I removed an
  older comment claiming later pipeline stages can be re-run from the metadata page — that control is
  still in that page's "SOON" list, so it does not exist.

## What I checked

- `npm run typecheck` clean; `npm run check` clean; the full `npm test` suite.
- New `tests/shelf-action-tooltips.test.tsx`, 10 cases. I proved two of them go red by putting the
  native `disabled` and the `title` back: both failed as expected.
- **Measured**: with the native `disabled` restored, every *card* assertion in that file still
  passed. jsdom does not implement the event-suppression a real browser applies to a disabled
  control, so a test that opened the card and called that proof would be green over exactly this
  bug. Hence the direct attribute assertions.

## What I have NOT checked

Real-browser behaviour. Tell me what you would expect to be different there and what is most likely
to be wrong.

## Files

The scoped diff for `src/web/IconButton.tsx` and `src/web/ShelfEntry.tsx` is below. Read the whole of
`tests/shelf-action-tooltips.test.tsx`, `src/web/Tooltip.tsx` and
`src/web/library-columns.tsx` (§ `RowActions`, the dense-table caller that gets this for free) in the
repo as needed.
diff --git a/src/web/IconButton.tsx b/src/web/IconButton.tsx
index 7afcc03a..d9ca1175 100644
--- a/src/web/IconButton.tsx
+++ b/src/web/IconButton.tsx
@@ -7,19 +7,60 @@
  * `ShelfEntry` uses `TitleEditor`, so importing it from there would have made a
  * cycle — which `npm run check` gates on (docs/project/static-analysis.md).
  */
-import type { ReactNode, Ref } from "react";
+import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
+
+/**
+ * Everything a `<button>` takes that this component does not name itself.
+ *
+ * **It exists so a `<Tooltip>` can wrap one of these.** `Tooltip` clones its
+ * trigger and hands it the props Floating UI's interaction hooks return —
+ * `onFocus`/`onBlur` from `useFocus`, `aria-describedby` from `useRole`, a key
+ * handler from `useDismiss`. A component that names its props and drops the
+ * rest swallows all of that, and the failure is close to invisible: `useHover`
+ * binds a *native* `mouseenter` to the ref, so the card still opens under a
+ * mouse and only the keyboard and the screen reader lose it.
+ * docs/project/tooltips.md § Five things that are load-bearing, point 5, is the
+ * same trap one step along.
+ */
+type PassThrough = Omit<
+  ButtonHTMLAttributes<HTMLButtonElement>,
+  "type" | "onClick" | "disabled" | "title" | "aria-label" | "className" | "children"
+>;
 
 export function IconButton({
   label,
   onClick,
   children,
   disabled,
+  titled = true,
   ref,
+  ...rest
 }: {
   label: string;
-  onClick: () => void;
+  /** Optional, because a permanently unavailable button has nothing to run. */
+  onClick?: () => void;
   children: ReactNode;
+  /**
+   * **Unavailable — and still hoverable, focusable and named.**
+   *
+   * This sets `aria-disabled` and swallows the click; it does *not* set the
+   * native `disabled` attribute, and that is the whole point. A disabled
+   * `<button>` dispatches no mouse events and is out of the tab order, so a
+   * card explaining *why* it is unavailable is the one card that could never be
+   * opened — by either route. Since 2026-09-05 the shelf draws its
+   * source-URL-only buttons this way rather than deleting them
+   * (ShelfEntry.tsx § `Actions`), so the explanation has to be reachable.
+   */
   disabled?: boolean;
+  /**
+   * Whether to set the native `title`. Pass `false` when a `<Tooltip>` already
+   * describes this button: two tooltips on one control is the OS's slow grey
+   * box racing ours, and `title` is the one that wins the wait.
+   * docs/project/tooltips.md says at length why it is a regression rather than
+   * a shortcut — but it stays the default, because a button with neither is a
+   * button called "".
+   */
+  titled?: boolean;
   /**
    * For callers that have to put focus back on this button.
    *
@@ -29,17 +70,21 @@ export function IconButton({
    * when it closes, or the reader is dropped on `<body>`.
    */
   ref?: Ref<HTMLButtonElement>;
-}) {
+} & PassThrough) {
   return (
     <button
+      {...rest}
       ref={ref}
       type="button"
-      onClick={onClick}
-      disabled={disabled}
+      // Guarded here rather than by the native attribute, per the prop's own
+      // note: an `aria-disabled` button is still clickable, so the refusal has
+      // to be in the handler.
+      onClick={disabled ? undefined : onClick}
+      aria-disabled={disabled || undefined}
       // Both, and they are not the same thing: `title` is the hover tooltip a
       // sighted reader gets, `aria-label` is the name a screen reader reads.
       // An icon-only button with neither is a button called "".
-      title={label}
+      title={titled ? label : undefined}
       aria-label={label}
       /* A fixed 28px square rather than `p-1.5` round a 14px glyph. Same
          reason as the shelf's view toggle (ShelfControls.tsx): a stated size
@@ -52,7 +97,10 @@ export function IconButton({
          is this app's colour for *this cannot be undone* and every button that
          reaches this component is reversible. Dead options are how a convention
          stops meaning anything, so it was removed rather than left. */
-      className="tw:inline-flex tw:size-7 tw:items-center tw:justify-center tw:rounded-md tw:text-muted-foreground tw:transition-colors tw:hover:bg-highlight/10 tw:hover:text-foreground tw:disabled:opacity-50"
+      /* `aria-disabled:` rather than `disabled:`, matching the attribute above,
+         and the hover lift is taken away with it — a control that lights up
+         under the pointer is claiming it will do something. */
+      className="tw:inline-flex tw:size-7 tw:items-center tw:justify-center tw:rounded-md tw:text-muted-foreground tw:transition-colors tw:hover:bg-highlight/10 tw:hover:text-foreground tw:aria-disabled:cursor-default tw:aria-disabled:opacity-40 tw:aria-disabled:hover:bg-transparent tw:aria-disabled:hover:text-muted-foreground"
     >
       {children}
     </button>
diff --git a/src/web/ShelfEntry.tsx b/src/web/ShelfEntry.tsx
index 2c38fff6..7dd3ffb6 100644
--- a/src/web/ShelfEntry.tsx
+++ b/src/web/ShelfEntry.tsx
@@ -10,7 +10,7 @@
  *
  * See docs/project/library.md § What you can do to a card.
  */
-import { useCallback, useState } from "react";
+import { useCallback, useState, type ReactElement } from "react";
 import {
   Archive,
   Check,
@@ -30,7 +30,7 @@ import { Link } from "./Link.js";
 import { exactly } from "./relative-time.js";
 import { readHref } from "./router.js";
 import { TitleEditor } from "./TitleEditor.js";
-import { Tooltip } from "./Tooltip.js";
+import { ControlTip, Tooltip, TooltipGroup } from "./Tooltip.js";
 import type { useShelf } from "./useShelf.js";
 import { fetchOk } from "./lib/api.js";
 
@@ -293,6 +293,78 @@ export function Details({ entry }: { entry: LibraryEntry }) {
 
 /* ------------------------------------------------------------ actions ----- */
 
+/**
+ * **What each button's card says.**
+ *
+ * Here rather than inline in the row below, because three of the five have a
+ * second version — the sentence for when the action cannot be performed — and a
+ * row with eight `ControlTip`s written into it stops being readable as a row.
+ *
+ * `ControlTip`'s rule holds throughout (Tooltip.tsx): `what` is what pressing
+ * the button would have told you, and `how` is what it would not — what it
+ * costs, where the answer comes from, or what the control does *not* promise.
+ * A `how` that restates its `what` is the failure mode, and
+ * tests/shelf-action-tooltips.test.tsx checks the two against each other.
+ */
+const TIPS = {
+  edit: {
+    head: "Edit title",
+    what: "Rename the article. The shelf, the reading view and the browser tab all follow.",
+    how: "Yours alone, and reversible: the title the extractor found is kept underneath, and saving an empty box restores it.",
+  },
+  rerun: {
+    head: "Re-fetch and rebuild",
+    what: "Fetches the page again and re-runs the whole pipeline over what comes back — extraction, hierarchy, gists and the rest.",
+    how: "It spends model calls and takes a few minutes, and the progress list at the top of the shelf follows it. Your comments and notes come through, because they are keyed to block ids that are minted once and kept.",
+  },
+  /**
+   * **The button that used not to be drawn at all.**
+   *
+   * It queued a job whose first step failed with "No source URL", every time,
+   * having looked exactly like a button that ought to work — so on 2026-08-27
+   * it was deleted where there was nothing to fetch. That fixed the dead
+   * button and left a row that is five wide on one card and four on the next,
+   * which is what Greg noticed on 2026-09-05: *"sometimes I see them,
+   * sometimes I don't"*. Drawn and unavailable is the answer to both.
+   */
+  rerunNoUrl: {
+    head: "Re-fetch and rebuild",
+    what: "There is no address to fetch. This one was uploaded, or it was added before we started recording where an article came from.",
+    how: "Nothing else is affected — everything the pipeline already made from it is here and stays. It is only the trip back to the source that is impossible.",
+  },
+  open: {
+    head: "Open the original",
+    what: "Opens the page this article was made from, in a new tab.",
+    how: "The link carries no referrer, so the site is never told which of your articles pointed at it.",
+  },
+  openNoUrl: {
+    head: "Open the original",
+    what: "We have no address for this one — it was uploaded, or it predates our recording where an article came from.",
+    how: "The reading view's metadata page lists everything we do know about where it came from.",
+  },
+  /**
+   * The other absence, and a rarer one: `final_url` is validated on the way in
+   * by the fetcher, but *imported* metadata is written into the row as given,
+   * so a `javascript:` or `data:` value is reachable. src/urls.ts § `isWebUrl`,
+   * docs/project/security.md.
+   */
+  openNotWeb: {
+    head: "Open the original",
+    what: "The address recorded for this article is not a web link, so there is nowhere to send you.",
+    how: "Only http and https addresses are opened. Anything else is a way to make a click run something rather than go somewhere, so we draw no link at all.",
+  },
+  copy: {
+    head: "Copy link",
+    what: "Copies this article's address on Spideryarn — the page its title opens.",
+    how: "It is not a share: the link opens for you and nobody else, until you publish the article from its metadata page.",
+  },
+  archive: {
+    head: "Archive",
+    what: "Takes the article off the shelf. The card goes straight away, with an Undo for nine seconds.",
+    how: "Nothing is destroyed. The link still opens, and Show archived at the foot of the shelf brings it back — though an article you have shared does drop out of the public listing while it is away.",
+  },
+} as const;
+
 /**
  * The row of buttons.
  *
@@ -300,6 +372,21 @@ export function Details({ entry }: { entry: LibraryEntry }) {
  * hiding the row until hover would delete it outright for anyone navigating by
  * keyboard — and every check anybody ran with a mouse would look fine.
  * `focus-within` brings it back for exactly that reason.
+ *
+ * **Five buttons, always five.** Two of them used to be drawn only for an
+ * article with a usable source URL, which is right about the action and wrong
+ * about the row: the icons moved between cards, and a reader had no way to find
+ * out that a button existed, let alone why theirs was missing. So the
+ * precondition still decides whether the button *works*, and the card says
+ * which of the two absences this is. docs/project/library.md § When a button
+ * cannot do its job.
+ *
+ * **One `TooltipGroup` around the lot**, the DiagramPanel.tsx idiom: once one
+ * card is open the neighbours open instantly, so reading along five icons is a
+ * scrub rather than five 240ms waits. `keepSide` with it, for the reason
+ * Tooltip.tsx § `keepSide` gives about rows specifically — without it a card
+ * too wide to centre is thrown onto the cross axis and lands on top of the very
+ * buttons the reader is about to hover.
  */
 export function Actions({
   entry,
@@ -354,6 +441,23 @@ export function Actions({
     }
   }, [entry.slug, shelf]);
 
+  /* **Only where there is something to re-fetch.** An uploaded PDF has no
+     address, and neither has an article old enough to predate our recording
+     one — so this button queued a job whose first step failed with "No source
+     URL", every time. Keyed on the URL rather than on "is it an upload",
+     because that is the actual precondition and it covers both cases. GPT Sol,
+     2026-08-27.
+
+     **And `isWebUrl` on top of it for the anchor, since 2026-08-31.** A shelf
+     row's `url` is the same `final_url` the reading view's controls bar and the
+     metadata page check, and for the same reason: the fetcher validates one on
+     the way in, but *imported* metadata is written straight into the row, so a
+     `javascript:` or `data:` value is reachable and this anchor would be an
+     active URL sink. src/urls.ts, docs/project/security.md. Note the two are
+     not the same test — a non-web address is still an address, so the re-fetch
+     is offered where the link is not. */
+  const canOpen = Boolean(entry.url) && isWebUrl(entry.url ?? "");
+
   return (
     /* `opacity`, never `display: none` — a hidden element is not focusable, so
        hiding the row until hover would delete it outright for anyone navigating
@@ -363,67 +467,112 @@ export function Actions({
        controls you cannot see but can press by accident. Caught by a
        cross-family review, 2026-08-26. */
     <div className="tw:relative tw:flex tw:shrink-0 tw:items-center tw:gap-0.5 tw:opacity-0 tw:transition-opacity tw:group-hover:opacity-100 tw:group-focus-within:opacity-100 tw:hover-none:opacity-100">
-      <IconButton label="Edit title" onClick={onEdit}>
-        <Pencil size={14} />
-      </IconButton>
-      {/* **Only where there is something to re-fetch.** An uploaded PDF has no
-          address, and neither has an article old enough to predate our
-          recording one — so this button queued a job whose first step failed
-          with "No source URL", every time, having looked exactly like a button
-          that ought to work. Keyed on the URL rather than on "is it an upload",
-          because that is the actual precondition and it covers both cases.
-          Re-running the *later* stages is still meaningful and is still
-          reachable from the metadata page; only the re-fetch is impossible.
-          GPT Sol, 2026-08-27. */}
-      {entry.url && (
-        <IconButton
-          label={rerunning ? "Queueing…" : "Re-fetch and rebuild"}
-          onClick={() => void rerun()}
-          disabled={rerunning}
-        >
-          <RefreshCw size={14} className={rerunning ? "cmt-spinner" : undefined} />
-        </IconButton>
-      )}
-      {/* **`isWebUrl`, since 2026-08-31.** A shelf row's `url` is the same
-          `final_url` the reading view's controls bar and the metadata page now
-          check, and for the same reason: the fetcher validates one on the way
-          in, but *imported* metadata is written straight into the row, so a
-          `javascript:` or `data:` value is reachable and this anchor would be an
-          active URL sink. No button rather than a dead one — the card has
-          nowhere to print the address, so there is nothing to keep. GPT Sol,
-          second pass, 2026-08-31. src/urls.ts, docs/project/security.md. */}
-      {entry.url && isWebUrl(entry.url) && (
-        <a
-          href={entry.url}
-          target="_blank"
-          // noreferrer as well as noopener: the target should not be told which
-          // of the reader's articles linked to it.
-          rel="noopener noreferrer"
-          title="Open the original page"
-          aria-label="Open the original page"
-          /* An `<a>` wearing the button's clothes, so the row does not have a
-             gap in it where the one link sits. Kept in step with `IconButton`
-             below by hand — a shared helper would have to take an element
-             type, which is more machinery than five utilities are worth. */
-          className="tw:inline-flex tw:size-7 tw:items-center tw:justify-center tw:rounded-md tw:text-muted-foreground tw:no-underline tw:transition-colors tw:hover:bg-highlight/10 tw:hover:text-foreground"
-        >
-          <ExternalLink size={14} />
-        </a>
-      )}
-      <IconButton label={copied ? "Copied" : "Copy link"} onClick={copy}>
-        {copied ? <Check size={14} className="tw:text-highlight" /> : <Copy size={14} />}
-      </IconButton>
-      {/* **"Archive", and a box rather than a bin.** It said "Delete" with a
-          `Trash2` in it until 2026-09-04, over a handler that has always been
-          `shelf.archive` — and a reader filed a report asking for the archive
-          feature this already was, because nothing on screen said it was
-          reversible. The label, the icon and the red are all the same claim, so
-          all three moved: `destructive` is gone too, because red is this app's
-          word for *this cannot be undone* and undoing it is the whole design
-          (docs/project/library.md § Archive, and Undo is the confirmation). */}
-      <IconButton label="Archive" onClick={() => void shelf.archive(entry.slug)}>
-        <Archive size={14} />
-      </IconButton>
+      <TooltipGroup delay={{ open: 240, close: 90 }} timeoutMs={400}>
+        <ActionTip tip={TIPS.edit}>
+          <IconButton label="Edit title" titled={false} onClick={onEdit}>
+            <Pencil size={14} />
+          </IconButton>
+        </ActionTip>
+
+        <ActionTip tip={entry.url ? TIPS.rerun : TIPS.rerunNoUrl}>
+          {/* The label still tracks the state — it is the accessible name, and
+              a screen reader gets no card. */}
+          <IconButton
+            label={
+              !entry.url
+                ? "Re-fetch and rebuild (no source address)"
+                : rerunning
+                  ? "Queueing…"
+                  : "Re-fetch and rebuild"
+            }
+            titled={false}
+            onClick={() => void rerun()}
+            disabled={!entry.url || rerunning}
+          >
+            <RefreshCw size={14} className={rerunning ? "cmt-spinner" : undefined} />
+          </IconButton>
+        </ActionTip>
+
+        <ActionTip tip={canOpen ? TIPS.open : entry.url ? TIPS.openNotWeb : TIPS.openNoUrl}>
+          {canOpen ? (
+            <a
+              href={entry.url}
+              target="_blank"
+              // noreferrer as well as noopener: the target should not be told which
+              // of the reader's articles linked to it.
+              rel="noopener noreferrer"
+              aria-label="Open the original page"
+              /* An `<a>` wearing the button's clothes, so the row does not have a
+                 gap in it where the one link sits. Kept in step with `IconButton`
+                 by hand — a shared helper would have to take an element
+                 type, which is more machinery than five utilities are worth. */
+              className="tw:inline-flex tw:size-7 tw:items-center tw:justify-center tw:rounded-md tw:text-muted-foreground tw:no-underline tw:transition-colors tw:hover:bg-highlight/10 tw:hover:text-foreground"
+            >
+              <ExternalLink size={14} />
+            </a>
+          ) : (
+            /* **A `<button>` and not a dead `<a>`**, which is the whole point of
+               the `isWebUrl` gate: there must be no anchor whose `href` is a
+               value we would not follow, disabled or otherwise. This one has no
+               `href` to disable. */
+            <IconButton label="Open the original page (no address)" titled={false} disabled>
+              <ExternalLink size={14} />
+            </IconButton>
+          )}
+        </ActionTip>
+
+        <ActionTip tip={TIPS.copy}>
+          <IconButton label={copied ? "Copied" : "Copy link"} titled={false} onClick={copy}>
+            {copied ? <Check size={14} className="tw:text-highlight" /> : <Copy size={14} />}
+          </IconButton>
+        </ActionTip>
+
+        {/* **"Archive", and a box rather than a bin.** It said "Delete" with a
+            `Trash2` in it until 2026-09-04, over a handler that has always been
+            `shelf.archive` — and a reader filed a report asking for the archive
+            feature this already was, because nothing on screen said it was
+            reversible. The label, the icon and the red are all the same claim, so
+            all three moved: `destructive` is gone too, because red is this app's
+            word for *this cannot be undone* and undoing it is the whole design
+            (docs/project/library.md § Archive, and Undo is the confirmation).
+            The card now says the same thing in a sentence. */}
+        <ActionTip tip={TIPS.archive}>
+          <IconButton
+            label="Archive"
+            titled={false}
+            onClick={() => void shelf.archive(entry.slug)}
+          >
+            <Archive size={14} />
+          </IconButton>
+        </ActionTip>
+      </TooltipGroup>
     </div>
   );
 }
+
+/**
+ * One card, in the placement the whole row shares.
+ *
+ * `bottom`, because the row sits at the top right of a card and in a table cell
+ * on a dense row — above it is the window edge or the row before, and below it
+ * is this article's own body, which is the thing the reader is least surprised
+ * to have covered for a moment.
+ */
+function ActionTip({
+  tip,
+  children,
+}: {
+  tip: { head: string; what: string; how: string };
+  children: ReactElement<Record<string, unknown>>;
+}) {
+  return (
+    <Tooltip
+      placement="bottom"
+      keepSide
+      className="tip-soon"
+      content={<ControlTip head={tip.head} what={tip.what} how={tip.how} />}
+    >
+      {children}
+    </Tooltip>
+  );
+}
