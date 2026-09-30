# Cross-reference links in the prose, with a preview on hover

SPIDERYARN-READING2-5Z. The report came from Greg (admin, verified by account id, with
`feedback-reporter.ts` exit 0), in production, on
`https://www.spideryarn.com/read/nihms-536461-spya-nr87dn`. The time in the file name is when this
session received the report. The session runs on a pool account, so it could not read Sentry.

> A couple of actions. So it would be really nice if it annotated things by adding, you know, anchor
> links or whatever to relevant other parts of the article. So, for example, if it describes a
> result, then it would create an anchor link to the block that actually, you know, the results in
> detail that underlie that statement or conclusion. So you can always jump around the paper to get
> to the thing being described. And maybe this would be a preprocessing step that always happens.
> And you'd have a cool tooltip, a rich tooltip that you could hover over that would preview that
> linked-to block.

**Ending: Shipped.** It is on `dev`, not deployed. Resolve 5Z; the next feedback sweep does the
Sentry status write. Two follow-ups are listed in
[awaiting-approval.md](awaiting-approval.md), because each is an edit to a listed defence.

What we did:

- A new step, `crossrefs`, has the model link a short phrase in one paragraph to the paragraph,
  figure or section that shows it in detail. Every link is checked against the article before it is
  stored.
- In the prose the phrase is underlined. Hovering shows the target's section and opening words, and
  clicking jumps there with the usual flash and back chip.
- It runs after an import when the *generate the main modes* box is ticked. For older articles, it
  runs from Metadata's *Re-run AI processing*.
- It costs $0.05–0.17 an article.

For Greg:

- **Only the article's owner sees the links for now.** Showing them to visitors needs a change to
  the public allowlist, which is a listed defence.
- **The sanitiser should reserve the new mark.** A forged one already cannot work, because it
  cannot know the per-page nonce. The same edit should also close an older gap: an article can
  forge a block-preview card today.

Both are in the plan's § Left for Greg.

Plan: [260930f](../plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md).
Doc: [cross-references.md](../project/cross-references.md).
