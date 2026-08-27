# Letting a chat answer link to the web, and showing what the link is

Greg, 2026-08-27:

> Allow chat responses to include hyperlinks to the web (e.g. in response to searching the web if it
> found something useful). These should reuse our tooltips machinery for previewing hyperlinks that
> we use in the main text.

Two halves. The first is that a model answer can now carry an address and have it drawn as something
you can press. The second is the one that makes the first safe: the same hover card the article's own
hyperlinks get ([links.md](../project/links.md)) opens over it, so the reader sees the real host and
the whole URL before they decide.

## Where this starts from

Chat has been able to search the web since 2026-08-26, and the addresses it finds have had exactly
one place to go: a **list at the foot of the answer**, built from OpenRouter's `url_citation`
annotations ([`src/converse.ts`](../../src/converse.ts) § `citations`). That list is a bibliography.
It says which pages the model consulted, and it does not say *which sentence* any of them was behind.

Inside the prose there was nothing. `Answer` renders model output as text and only text —
`splitCitations` turns `[spya-k3m9qt]` into a chip and everything else is a string React escapes. So
a model that wrote "the study is at https://…" got an unclickable string, and a model that wrote a
Markdown link got the brackets and parentheses printed at the reader.

## The awkward thing first

**A link in a model answer is model output reaching an `href`**, which is the shape
[security.md](../project/security.md) is about, and it is worse than it looks: chat reads untrusted
web pages, so a page that wants to be linked can ask to be, and the label is the model's to choose.
`[the Anthropic paper](https://not-anthropic.example/)` renders as a plausible sentence with a
hostile destination, and nothing in the text gives it away.

That is not an argument against the feature, and Greg's second sentence is most of the answer to it:
the card prints the host on its own line, the full URL underneath, and whether the destination leaves
the site the article came from — the three facts a deceptive label cannot touch.

**But the card is not sufficient, and the first version of this plan said it was.** A GPT Sol review
pointed out the hole: a card takes 320ms of rest to open and a click does not wait for it, and on a
touch screen a link navigates on the first tap by design. A reader can therefore follow a link
having never seen where it goes. So the host is now printed **in the answer itself**, quietly, beside
the label — the check is on the page rather than behind a gesture, and the card is the richer version
of it rather than the only version.

Four guards, all of them reuses bar the last:

- **`http` and `https` only**, via `isWebUrl` ([`src/urls.ts`](../../src/urls.ts)) — the same
  function the citation list and `article_links` already use, not a second one. A match that fails it
  is left where it was, as text, exactly as the model wrote it.
- **`rel="noopener noreferrer"`**, the rule every outbound link in this app already follows: the
  article's URL is a reading history and a model-supplied destination is not owed it.
- **Text is still text.** No `dangerouslySetInnerHTML` anywhere near this. `splitLinks` returns runs
  of *string* and the label goes through React, which escapes it.
- **An address carrying credentials is refused outright.** `https://trusted.example@evil.example/`
  passes every scheme check and lands somewhere other than it reads. The form has no honest use in a
  chat answer, so it is not drawn as a link at all — the characters stay where the model put them.
  Also the review's.

And the sink is **opt-in**. `CitedText` is shared with the summary panel, and the first version
turned links on for both, on the argument that a mark meaning two things in two bands is worse than
either. That argument is about appearance; this is about what an attacker can reach. The summary
model reads the same untrusted article under a prompt that says nothing about links, so it does not
get the sink — only chat, which has the provenance rule, passes `links`.

## What the model is allowed to write

Two shapes, and the parser takes both because models produce both whatever the prompt says:

- `[what the page is](https://example.com/the-piece)` — the Markdown link.
- A bare `https://…`, which becomes a link labelled with itself.

The prompt asks for the first ([`src/converse.ts`](../../src/converse.ts) § FORMAT) with the same
sentence the block-id rule uses: **never invent one.** A hallucinated URL is the exact analogue of a
hallucinated block id — it looks like a working link and goes nowhere — except that we cannot check
it against a list the way `splitCitations` checks ids against the article's blocks. So the prompt
rule is that a URL must have come back from a tool on this turn, and the card is what lets a reader
notice when it did not.

## Links come out before citations, and that ordering is load-bearing

`splitCitations` matches a **bare run of ids** as well as a bracketed one, on the shape
`spya-[a-z0-9]{6}`. A URL is a string somebody else wrote, and
`https://example.com/notes/spya-k3m9qt` contains that shape. Parsed citations-first, the id inside
the address becomes a chip and the URL is torn in half — a link to `https://example.com/notes/` and
a chip pointing at a block that probably does not exist.

So the pipeline gains a stage on the front: **links, then citations inside what is left, then
emphasis.** The label of a link gets emphasis only — a bolded word inside one renders bold rather
than printing its asterisks — and no citation parsing, because an id inside a link label is not a
citation.

## The half-written address

An answer streams. A bare URL at the very end of the text received *so far* is very likely half of
one, and linkifying it produces a link to a truncated address that a reader can click during the
second before the rest arrives.

The rule is one line: **while the answer is still arriving, a bare URL that touches the end of the
last paragraph is left as text.** It becomes a link the moment anything follows it. A Markdown link
needs no such rule — its closing `)` is proof the address finished.

`partial` is therefore a different prop from `live`, and only the last paragraph gets it. `live`
already means "do not mount a Floating UI instance per citation chip" (Cited.tsx); this one means
"the last few characters may be half-written", and conflating them would either suppress links in
every paragraph of a streaming answer or trust the tail of the one that is still being written.

## The card, and the bug that scoping it uncovered

The hover machinery needs no new instance. `useHoverCard` is already **one delegated listener for the
whole document**, so a chat link costs nothing but a selector.

Which is where the existing selector turned out to be a problem. It was `"mark.term, a[href]"` — on
`document` — so it already fired on **every anchor on the page**: the masthead's "Library", the
`read it here` button inside the card itself, the source list at the foot of an answer. A relative
href does not parse, so `describeLink` returns `{kind: "other"}` and the reader got a panel saying
`link` over `/library`. Nobody had reported it, which is what an ignorable wart looks like.

**A citation chip is an anchor too**, which is the sharper case and the one that would have been
noticed eventually: `BlockRef` renders `/?at=spya-k3m9qt` so the id is an address a reader can copy,
and under the old selector every chip in every answer had *two* panels racing over it — its own
`Tooltip`, showing the paragraph it points at, and a hover card saying `link` over a query string.
The render test in tests/chat-web-links-render.test.tsx trips over the same conflation from the other
side, which is why it selects `a.cited-link` rather than `a`.

Narrowing it is what this feature needs anyway, so it is done here:

```
mark.term, .prose a[href], a.cited-link, .chat-sources a[href]
```

The article's own links, the model's inline links, and the answer's source list — which is also a
list of web addresses a reader is deciding whether to follow, and gets the same card for one more
selector.

A second, smaller change: the observer that closes a card when its anchor is replaced under it looked
for `.prose` and fell back to `parentElement`, which outside the prose is the anchor's own `<p>`. The
host is now an option on the hook and ProseHoverCard passes `.prose, .chat-turn`.

**This is robustness, not a bug fix, and the first version of this plan claimed otherwise.** It said
React replaces the whole `<p>` on every streamed update, so an observer on the detached old `<p>`
would never fire for the `<p>`'s own removal and the card would stay pinned to a node out of the
document. The general statement about a detached observer is true; the premise is not. The paragraphs
are keyed by index and the element type does not change, so React keeps both the `<p>` and the `<a>`
across ordinary updates — the review checked their DOM identities and they are equal. Watching the
turn rather than the paragraph is still the better ancestor, because it survives cases the paragraph
does not; it just is not fixing anything today.

## What the card says about a chat link

Whatever it says about any other external link: host, whether it leaves the site the article came
from, a scholarly id if the path carries one, the shelf entry if we already have that page, the
Wikipedia summary if it is a Wikipedia article, and the full URL.

`sameSite` is still measured against the **article's** source host, which is worth being explicit
about because the reader is in a chat panel rather than in the prose. It still answers a real
question — *does this go back to the publication I am reading, or away from it* — and "leaves this
site" is the honest reading of that. Nothing needed changing.

## Not built

- **A rule that a link must be one the model actually fetched.** The right fix for invented URLs, and
  it is the same allowlist [chat-tools.md § Still open](../project/chat-tools.md) already wants for
  `read_web_page` — *"fetch only URLs that are already in play"*. Building half of it here, as a
  render-time filter over `message.citations` and the article's own hrefs, would be a filter that
  drops good links (a URL the model quoted out of a search *snippet* never appears as a citation) and
  would still be defeated by a page that gets itself cited. It wants its own plan and the same
  membership test both sides use.
- **Turning the source list into inline superscripts.** A different feature, and it would need the
  model to number its own claims.
- **Links in summary mode.** This bullet used to say they were not built while the code built them —
  `CitedText` is shared, so turning linkification on there turned it on everywhere, and the review
  caught the doc and the code disagreeing. They are now genuinely not built: `links` defaults off and
  only chat passes it. If summaries ever want them, that producer needs the same provenance rule in
  its own prompt first.

## What the review changed in the parsing

Five defects, all of them silent, and all of them now in
[`tests/chat-web-links.test.ts`](../../tests/chat-web-links.test.ts):

- **A Markdown label could contain `[`**, so an input of *n* opening brackets made every one of them
  scan the rest of the string for a `]`. Measured: 48ms at 8k brackets, 714ms at 32k — quadratic, on
  a parser that re-runs over every accumulated paragraph on every streamed token. The label class now
  excludes `[`, and the test is a **scaling** test rather than a timeout at one size, because one
  generous timeout passes at 8k and freezes the reader at 32k.
- **A bare URL could swallow `**`.** `**https://x.example/y**` linked to a path ending in two
  asterisks: a wrong destination, and the markers still printed.
- **Parentheses nested twice truncated the address.** `…/Foo_(bar_(baz))` linked to `…/Foo_` — a
  *different, shorter* page, which is worse than no link because nothing on screen says it happened.
  Two levels are now handled, and a bare address we would have had to cut at an opening parenthesis
  is refused instead. (The old comment claimed one level was "all CommonMark promises". It is not;
  CommonMark allows arbitrary balanced parentheses.)
- **Trailing punctuation ate query data.** `…/search?q=why?` lost its second `?`. The trim is now
  conservative once the address has a query — and the test for that had to look at the string *after*
  a bold trim, because the `?` in `…/x?` is the one being asked about.
- **A shouted scheme was missed.** `HTTPS://example.com/x` is a valid address; the pattern is now
  case-insensitive.

## Two counts that were wrong on the server

The ordering rule has a second half nobody had noticed. `citedBlockIds` and `unknownCitedIds` in
[`src/converse.ts`](../../src/converse.ts) scan the raw answer for id *shapes* — so
`https://example.com/notes/spya-k3m9qt` was logged as a citation the reader never saw, or, if the id
were not ours, as a hallucination that never happened. Those two numbers are the ones watched to tell
whether the citation prompt is still working.

The client/server agreement test could not catch it, because both sides shared the same raw regex.
So the matcher moved to [`src/urls.ts`](../../src/urls.ts) — the module that imports nothing, which
is where this repo puts a thing both halves need — and `withoutWebLinks` blanks the links before
either side counts. One definition, and the seam has its own test.

## What landed first, and what is still in the working tree

**This went in as two commits, and the split is not a design decision.** Naming a file in a commit
takes whatever else is in it ([version-control.md](../project/version-control.md)), and on the
evening of 2026-08-27 four of the files this feature touches held other agents' unfinished work.
Committing any of them would have shipped somebody else's half-written change under this message,
and in two cases would have broken `main` outright.

Landed first — self-contained, and dormant, because `links` defaults off and nothing passes it yet:

- `src/urls.ts` — the matcher, `webLinks` and `withoutWebLinks`
- `src/web/citations.ts` — `splitLinks`, `emphasise`
- `src/web/Cited.tsx` — the rendering, behind the `links` prop
- the two tests that need none of the rest, and this plan, `links.md` and `security.md`

Held back, with the reason:

| File | Why |
|---|---|
| `src/converse.ts` | held a peer's refactor pulling `openRouterStream` into `src/ai-call.ts`, **and that file was not yet in git** — committing this would have broken every build |
| `src/web/ChatPanel.tsx` | a peer's new `loaded` / `onSendNew` props, whose only call site is in `App.tsx`, which is also mid-edit — committing one without the other fails the type-check |
| `src/web/styles.css` | a peer's in-flight visual work; `.cited-link` is inert without ChatPanel anyway |
| `src/web/ProseHoverCard.tsx`, `src/web/useHoverCard.ts` | a peer's touch/tap feature, mid-review |
| `docs/project/tooltips.md` | a peer's paragraph in it links to `touch-glossary-card.md`, which is untracked — `doc-links.test.ts` would go red on `main` |
| `tests/chat-web-links-prompt.test.ts` | it pins the prompt block, which lives in `converse.ts` |

The one worth checking by hand is the **prompt**. Until `converse.ts` next goes in, a model writing
links has not been told the provenance rule — *"link only an address that came back from a tool on
this turn"* — which is the single line standing between a linked answer and an invented URL. The
block is written, as `WEB_LINKS`, and interpolated into both prompts; whoever commits that file next
should check it went along.

## Tests

[`tests/chat-web-links.test.ts`](../../tests/chat-web-links.test.ts) — the splitter, which is where
the failures are silent:

- a Markdown link, and a bare URL, and both in one paragraph
- **a URL containing an id shape** stays whole and produces no chip — the ordering bug above
- Wikipedia's parenthesised titles survive both forms (`…/Mercury_(planet)`)
- a trailing full stop, comma or closing quote is not part of the address
- `javascript:` and `mailto:` labels never become an `href` — left as text
- while `partial`, a bare URL at the end of the string stays text, and the same string with one more
  character after it becomes a link
- emphasis inside a label renders; a citation id inside a label does not become a chip
- text either side of a link is preserved exactly, including the paragraph that is nothing but a link

and a jsdom render pass, because the thing worth pinning is the attribute: the `href` is the URL the
model wrote, `rel` carries both tokens, and the class the hover selector depends on is on the element.
