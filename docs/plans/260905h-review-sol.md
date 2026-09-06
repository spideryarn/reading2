I found four behavioral/copy defects, plus two test/API hazards.

## Findings

1. **High — a non-web URL enables Re-fetch even though stage 1 will reject it.**

   [ShelfEntry.tsx:477](/home/greg/code/spideryarn2/.claude/worktrees/shelf-action-tooltips/src/web/ShelfEntry.tsx:477) chooses the live rerun tip whenever `entry.url` is truthy, and [ShelfEntry.tsx:490](/home/greg/code/spideryarn2/.claude/worktrees/shelf-action-tooltips/src/web/ShelfEntry.tsx:490) disables only when it is absent. Thus `javascript:`, `data:`, `file:`, or `mailto:` gets an enabled “Re-fetch” button.

   Stage 1 explicitly refuses anything except HTTP(S) at [fetch.ts:819](/home/greg/code/spideryarn2/.claude/worktrees/shelf-action-tooltips/src/fetch.ts:819). The action can therefore queue successfully and fail later. The `NOT_WEB` fixture tests only Open-original; it should also assert Re-fetch is unavailable. In the current design, `canFetch` should use the same scheme gate as `canOpen`.

2. **Medium — Copy-link’s tooltip lies for public articles.**

   [ShelfEntry.tsx:359](/home/greg/code/spideryarn2/.claude/worktrees/shelf-action-tooltips/src/web/ShelfEntry.tsx:359) always says the link opens “for you and nobody else, until you publish”. But `LibraryEntry.visibility === "public"` is carried onto shelf entries, and those cards use the same static tip. For an already-public article, the copied link is usable by other people now.

   This needs a public/private variant or neutral wording such as “Copying does not change who can read it.”

3. **Medium — Re-fetch’s description materially overstates what happens.**

   [ShelfEntry.tsx:317](/home/greg/code/spideryarn2/.claude/worktrees/shelf-action-tooltips/src/web/ShelfEntry.tsx:317) says it re-runs “the whole pipeline”. It actually submits the default ingest steps, which are only `fetch`, `extract`, `blocks`, `hierarchy`, and `assets` at [pipeline.ts:220](/home/greg/code/spideryarn2/.claude/worktrees/shelf-action-tooltips/src/pipeline.ts:220). It does not forcibly rebuild arc, glossary, ideas, quotes, timeline, quiz, sketches, illustrated diagrams, debate, or tweets.

   “Your comments and notes come through” is also too absolute. IDs survive for unchanged/matchable blocks; the contract explicitly admits partial loss at [block-ids.md:120](/home/greg/code/spideryarn2/.claude/worktrees/shelf-action-tooltips/docs/project/block-ids.md:120). A removed or substantially edited passage can leave its annotation without a current target.

4. **Medium — the unavailable Open button gives assistive technology the wrong reason.**

   For every refused URL, including `javascript:…`, the accessible name is “Open the original page (no address)” at [ShelfEntry.tsx:518](/home/greg/code/spideryarn2/.claude/worktrees/shelf-action-tooltips/src/web/ShelfEntry.tsx:518). But there is an address; it is unsupported. The tooltip then contradicts the name.

   The test at [shelf-action-tooltips.test.tsx:223](/home/greg/code/spideryarn2/.claude/worktrees/shelf-action-tooltips/tests/shelf-action-tooltips.test.tsx:223) claims a nonempty `aria-label` gives a screen reader what the tooltip gives the pointer. It proves only that the control has a name. It neither checks the name’s accuracy nor proves that focus opens the tooltip and wires `aria-describedby`.

5. **Low/currently latent — disabled clicks are not “swallowed.”**

   [IconButton.tsx:82](/home/greg/code/spideryarn2/.claude/worktrees/shelf-action-tooltips/src/web/IconButton.tsx:82) removes the component’s handler. The click still dispatches and bubbles. Today neither the card nor table row has an ancestor click handler, so I found no current accidental navigation, but the reusable component and docs promise stronger behavior than they implement.

   If “disabled” is meant to emulate native activation suppression, the guarded handler should call `preventDefault()` and probably `stopPropagation()`. The existing test spies only on `fetch`, so it cannot catch bubbling.

6. **Low — the finished plan still contains the factual claim you said was removed.**

   [260905h-rich-tooltips-on-the-shelf-action-buttons.md:55](/home/greg/code/spideryarn2/.claude/worktrees/shelf-action-tooltips/docs/plans/260905h-rich-tooltips-on-the-shelf-action-buttons.md:55) still says later stages can be re-run from the metadata page. That directly contradicts the stated state of the product.

## The eight cards

| Card | Verdict |
|---|---|
| Edit | Passes the two-paragraph rule. |
| Re-fetch | Paragraphs are distinct, but “whole pipeline” and unconditional annotation survival are false. “The progress list follows it” is direct action feedback, not really an unguessable second-paragraph fact. |
| Re-fetch unavailable | Breaks the rule: “no address to fetch” and “only the trip back to the source is impossible” are the same fact twice. It also cannot know that the article was uploaded or old merely from an absent URL. |
| Open original | Borderline: the first paragraph mostly restates the heading, with “new tab” as its only addition. The no-referrer paragraph is distinct. |
| Open, no URL | Structurally distinct, but “uploaded or predates…” is unsupported. The metadata implementation explicitly records that an ordinary web article may simply lack a stored address at [Metadata.tsx:1236](/home/greg/code/spideryarn2/.claude/worktrees/shelf-action-tooltips/src/web/Metadata.tsx:1236). |
| Open, unsupported URL | Breaks the rule: both paragraphs say it cannot be opened/no link is drawn. “Anything else” runs code rather than goes somewhere is also false—`mailto:` opens a handler and `file:` names a location. |
| Copy | Structurally useful because it distinguishes the Spideryarn URL from the source URL, but its privacy claim is false for public articles. |
| Archive | Paragraphs are distinct. “Show archived” is already visible on the same shelf, and “the card goes straight away” is not strictly true: `useShelf.archive` waits for the server before removing it. |

The clearest already-on-screen repetition is Archive’s “Show archived at the foot of the shelf.” Copy’s reference to “the page its title opens” is borderline: the linked title is visible, but the equality of the two destinations is not.

## `aria-disabled` and prop spreading

`aria-disabled` is defensible here. It preserves focus so keyboard users can discover the explanation, and assistive technology can announce the unavailable state. It is not inherently a worse accessibility answer. The cost is two inert tab stops per URL-less article—potentially substantial in dense-table view—so that trade-off needs a real keyboard pass.

The rationale “native disabled buttons dispatch no mouse events” is too categorical. Native disabled buttons are removed from sequential focus and suppress user activation clicks; hover/pointer-event behavior varies. The safer claim is that a disabled button is not a reliable tooltip trigger across input methods.

The spread order protects `ref`, `type`, `onClick`, `aria-disabled`, `title`, `aria-label`, and `className`. A caller cannot override those. Remaining hazards are:

- `tabIndex`, `role`, or `aria-hidden` can deliberately defeat the focus/accessibility contract.
- A caller-supplied `aria-describedby` can replace Floating UI’s tooltip description rather than combine with it; I would pin this with a render/focus test.
- Calling this prop `disabled` hides its deliberately non-native semantics from future callers.

## Real-browser risks

Most likely to be wrong:

- **Touch:** the icons become visible, but an enabled control’s first tap also performs its action. Open-original leaves the page, Archive removes the card, and Edit opens the editor before the rich explanation can be read. These are not useful pre-action tooltips on touch.
- **Narrow cards:** five fixed 28px controls consume roughly 148px before card padding and title spacing. At 320–390px, long titles may be severely squeezed. The table will horizontally scroll; the card view cannot.
- **Screen readers:** verify VoiceOver/Safari and NVDA/Firefox announce the dynamically-added tooltip description after focus. The current tests do not exercise focus or `aria-describedby`.
- **Keyboard:** Tab through URL-less rows, confirm each card appears, Escape dismisses it without moving focus, and decide whether the added dead stops are tolerable.

I found no current route by which a refused `entry.url` is written into the shelf action DOM. The invalid value is used only for branching; the `<a href>` branch is gated. The security regression test is narrower than its prose, though: it inspects `host.innerHTML` without opening the portalled tooltip, so it would not detect a future copy change that printed the value there.