# Question 2, Opus's answer (2026-10-31)

Brief: [261031d-q2-consult-prompt.md](261031d-q2-consult-prompt.md). Recorded as returned.

**Verdict: A for now. If the measurement makes the case, build one narrow version of B where code writes
the follow-up query and the reader only chooses which work to follow up. Do not build B as described,
where the reader writes the query itself.**

## 1. What is best for the reader

The reader gets most from a digest they can trust, and an extra round of searching does not make it more
trustworthy. The quote check proves only that the words are on the page. It does not prove the page
deserves weight. So every search steered by a page adds evidence that someone else got to choose. A
hostile page also pushes more cost and more wait onto the reader: about +30% on a ~$1 run, and a second
search-and-read round, one after the other, inside an 11-minute budget. And the digest has never run live.
We do not know yet whether readers miss depth. Today's "dig further, as words, then chat on your own
press" already gives the depth to the readers who want it, under their own control.

What the hostile-page risk actually is:

- **Who can exploit it.** Anyone whose page shows up in Exa's results for a planned query: content farms,
  the author of a work the piece criticises, a disputed party. The article's own author can already steer
  the planner, because the planner reads the article. B adds a new set of attackers: strangers on the web.
  This is the boundary situate.ts drew (S3, S11).
- **What they gain.** Mainly they steer what gets found. A page says "the real rebuttal is X", the
  follow-up searches for X, X's quotes check out, and Opus cites them. That turns their page into our
  evidence. This is the real harm, and quote checking does not touch it.
- **Spending our money.** Weak. Caps bound it (at most one search per reader, at most 16 a run), and so
  does the rate bucket (3 an hour, 8 a day, 50 a day globally).
- **Getting article text out.** A page can tell the reader to put passages into its query. That query
  goes to Exa (and OpenRouter), not to the attacker. The one way it could reach them is Exa live-crawling
  their URL, and that request carries the URL, not our query. So this is a privacy leak to a company that
  processes our data, which matters for a private upload, not a channel back to the attacker.
- **How far the existing defences bound it.** `validateQueries` strips addresses and operators but not
  the topic. Caps bound the spend. Quote checking bounds made-up quotes, not who gets heard. None of them
  stops the steering.

## 2. Recommendation

Ship A. Two things are worth trying before any follow-up round, and both are safe because the planner
writes the queries: give the planner more searches per lead up front; use situate's deferred "safe dive",
where code builds the query from a checked item, never from the model's free text.

If the measurement says depth is missing, build **B′**: a reader may name one follow-up, chosen by id from
a closed set (a work the planner already named, or a returned result's own title or DOI). Code then writes
the query from that item.

## 3. Minimum security properties for B′

1. No model-written query words: the reader picks an id, code builds the query, then `validateQueries`.
2. No new article text in the query; never the profile.
3. Hard caps in code, and no recursion: at most 1 per lead and N per run, same rate bucket, budget and
   lease re-derived.
4. The paid first pass is banked first (S11): a failed follow-up is dropped, the digest still written.
5. Same boundary as round one: fenced, no tools, quotes checked; each follow-up source shown with the page
   that prompted it.
6. Hostile tests: a planted "search for X" page, a planted article-echo request, an id outside the set,
   each seen to fail before the fix.

What in the measurement (qi-dykn3xjh) would justify B′: the share of leads ending "could not tell" or with
no checked quote (under about 20%, stop); how often dig-further names a specific work round one did not
return; a hand counterfactual in chat (build only if roughly half would change a verdict or add a cited
fact); whether 2–3 planned searches per lead close the same gaps (if so, take that instead); actual spend
and wait per run.
