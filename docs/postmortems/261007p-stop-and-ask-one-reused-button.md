# Stop and Ask were one reused button, so a click on Stop submitted the form

Up: [postmortems.md](../project/postmortems.md)

Found in a browser on 2026-10-07, before it shipped, in *Ask about Spideryarn* on the Help pages
([plan 261007k](../plans/261007k-help-chatbot.md)). Clicking **Stop** while an answer arrived did not
stop: a second `POST /api/help-chat` went out about 140 ms later, the server refused it with a 429
(one question at a time), and the box said *"Your last question is still being answered"* instead of
*"Stopped."* Escape, which calls the same `stop()` from the keyboard, worked.

## Root cause

```tsx
{arriving ? <Button type="button" onClick={stop}>Stop</Button>
          : <Button type="submit">Ask</Button>}
```

Same component, same position, no key: React keeps **one DOM `<button>`** across the swap and
updates its attributes. A click on it runs in this order in a browser:

1. the click's listeners: React's handler calls `stop()`, and because a click is a *discrete*
   event, React renders the result **before the handler returns** — `arriving` is false, so the
   one button is now `type="submit"`;
2. the click's default action: the button is a submit button **now**, so the form submits, and
   `onSubmit` asks the question still sitting in the box.

The deeper cause: a swap that looks like two elements in JSX is one element in the DOM unless
something says otherwise, and the attribute that changes is one the browser reads *after* the
handler that changed it.

## The class

**A control swapped in place whose meaning the browser reads after the click** — Stop ↔ Send,
Cancel ↔ Submit, any toggle where one side is `type="submit"` (or a link, or anything with a
default action) and the other is not. React's reconciliation makes it one element; the default
action reads the new attribute.

## Which commit introduced it

`5413fb4fb` (261007k stage 2), which wrote `HelpAsk.tsx`. It was not a regression; the box was new.

## The fix

**Shipped, and right for the long term:** `key="stop"` and `key="ask"`, so React unmounts one and
mounts the other; the clicked element is detached and is never a submit button. The same keys went
onto Chat's composer (`src/web/ChatPanel.tsx`), whose Stop/Send swap was safe only because Send
happens to be wrapped in a `Tooltip` and so is a different element type — an accident one refactor
from becoming this bug.

## What would have caught it, ranked by ease against value

1. **A test that the two sides are different elements** (`tests/help-ask.test.tsx`, *stops on a
   click of Stop*) — red before the keys, green after. Done. Note what did *not* work: a test that
   clicks Stop and counts requests passes with the bug in jsdom, inside `act` or outside it, because
   jsdom does not reproduce the browser's render-then-default-action order. The behavioural test was
   never red, so it is evidence of nothing on its own ([silent-success.md](../reusable/silent-success.md)).
2. **A browser pass that presses every button with a mouse**, not only the keyboard — which is how
   this was found. Already the house rule for a new control ([browser-testing.md](../project/browser-testing.md)).
3. **A lint rule** flagging a conditional that swaps elements of the same type whose `type` differs.
   Rejected for now: no off-the-shelf rule, and two occurrences in the whole client do not pay for a
   custom one.
