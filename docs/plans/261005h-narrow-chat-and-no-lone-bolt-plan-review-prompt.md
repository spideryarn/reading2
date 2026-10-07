# Plan review: narrow-window Chat list shows more, and no lone quick-search icon in the bottom bar

You are reviewing a plan before it is built. Read-only: do not edit anything. You may run one test
file (`npx vitest run tests/<one>.test.tsx`) or a `tsx` script if it helps; nothing that needs
Postgres or the network.

The plan:
`docs/plans/261005h-narrow-window-chat-thread-list-gets-more-lines-and-no-lone-quick-search-icon-in-the-bottom-bar.md`.
Two small, independent UI changes Greg asked for in two feedback reports, built in the simplest
version that gets most of the value.

Read the plan, then the code it names:

- `src/web/ChatPanel.tsx` § `ThreadList`, `lastSaid`, `describe`; `src/chat.ts` § `titleFrom` and its
  three call sites; `src/web/styles/mode-band.css` § the list of conversations;
  `src/web/styles/voices.css` (the title is in the reader's face, the preview in the model's or the
  reader's)
- `src/web/DockQuickSearch.tsx` (all of it: the `/` handler and the effect that notices a focused
  box being hidden both read `getComputedStyle(field).display`), `src/web/styles/dock-quick-search.css`,
  `src/web/dock-fit.ts`, `src/web/styles/dock-fit.css`, `src/web/Dock.tsx` § `hasQuickSearch` and
  where `DockQuickSearch` is mounted, `src/web/styles/dock.css` (the row), `src/web/styles/narrow-window.css`
- `tests/dock-quick-search.test.tsx`, `tests/dock-fit.test.ts`
- `docs/project/search.md` § Search as you type and the box in the bottom bar

Questions, in order of weight:

1. **The bar.** With `.dock-qs`, its field and its ⚡ all `display: none` at rung 4, under 732px and
   on a coarse pointer: does anything break? Trace `/`, the hidden-while-focused effect, the fit
   ladder's measurement (rung 4 now frees more width than before — can the ladder oscillate or
   settle wrongly?), the `.dock-qs--bolt` case when Search is open at those widths, selector
   specificity and source order against `.dock-qs--bolt .dock-qs-bolt { display: inline-flex }`,
   and anything else that looks for the ⚡ (tests, help text, a tour, keyboard docs). Name file and line.
2. **The bar.** The plan keeps the lone ⚡ when Search mode is open at a width that has the box. Is
   that the right reading of Greg's words, quoted in the plan? And the plan notes the ⚡ opens
   *quick* while the Search button opens *thorough* by default — is building as asked and reporting
   that the right call, or is there a cheap thing that should ride along?
3. **Chat.** Is the prefix rule in `rowTitle` sound against how `titleFrom` cuts (the `space > 20`
   branch, whitespace collapsing, an edited first question at `src/chat.ts` index 0, a Live/spoken
   first turn, a first message that carries command lines or attachments)? Is there a case where it
   shows something the reader would not recognise as the conversation's title, or leaks something
   the row should not show?
4. **Chat.** The clamp changes under 732px only. Any rule elsewhere that would defeat them (a
   later, more specific selector; `voices.css`; a coarse-pointer block), or a place the taller rows
   break (the list's scroll, the loading placeholder's height)?
5. Anything more complicated than it needs to be, or a simpler version that was missed. Check the
   plan's own claims, not only its steps: if a "what was measured" or "unchanged" claim is false,
   say so with the file and line.

Answer with a verdict first (approve / approve with changes / rework), then findings numbered and
ranked P0 to P2, each with the evidence. Be brief. Say plainly if you found nothing.
