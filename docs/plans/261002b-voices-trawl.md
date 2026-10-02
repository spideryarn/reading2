# Voices trawl: is every voice in its face? (261001d v1, audited 2026-10-02)

Tree: worktree `fb7n-81-ai-typeface-and-voices-trawl` at `886812f5a`. Read-only; no repo file edited.

This was built from four sub-trawls run in parallel, then merged, de-duplicated and spot-checked here.
Their raw notes, with more detail per entry, are in the same scratchpad:
- `voices-part-A.md`: Tweets, Sketch, Illustrated, Diagram, Debate.
- `voices-part-B.md`: Summary, Structure, Spine, cards, Marginalia.
- `voices-part-C.md`: Glossary through the Referee family.
- `voices-part-D.md`: Chat, Comments, Dock, Live, and the pages outside the reading view.

One sub-trawl claim was checked, found false, and dropped: `p.chat-stopped` is NOT wrongly in
Courier, because chat-actions.css:126 sets it to `font-ui`.

## Cascade facts every entry relies on

- **Tailwind utilities beat voices.css on the same element.** voices.css is in `@layer app`, and
  Tailwind utilities are a later layer (`tailwind.css:38`). So a `tw:font-*` on the same element beats
  any voices.css rule. A `tw:font-*` on a parent does not stop a child that has its own voices.css
  rule. The cheap fix under a utility is therefore a child `<span class>`.
- **A voices.css rule reaches only what it names, plus descendants with no face of their own.**
  Every branch is `:root[data-voices] :is(…)`, specificity (0,3,0) or more, which beats every plain
  band rule. But a descendant that sets its own `font-family` keeps it. These elements reset the
  face, so an AI ancestor does not help them:
  - `.mode-band` (font-ui), so anything not named is Geist.
  - `.tooltip` (tooltip.css).
  - `.prose-card-text` (prose-hover-card.css).
  - `.marg-note` and `.marg-head` (marginalia.css:40, :106).
  - `.chat-pointed` (mode-band.css:1027).
  - `.dock-question-state` (dock.css:854).
  - `.fmt-code` and `.fmt-pre code` (mode-band.css:565, :578), which are Geist Mono.
  - `.sk-card` (diagram-sketch.css:359).
  - `.ill-bar`, `.ill-row` and `.ill-brief`.
  - `.dbt-group-head`, `.skim-door` and `.cite-meta`.
- **Templated compounds need a test entry.** A new compound selector built from a template class
  (for example `.dock-question-state.done`) needs a `TEMPLATED_COMPOUNDS` entry in
  tests/voices-css.test.ts, or the compound test goes red.
- **The plan's Summary entries are stale, not the CSS.** The plan's AI list names `.summ-text` and
  `.summ-question`. Those classes no longer exist after 261001p: Summary is now only `SimplePanel`'s
  `p.simple-text`, which is covered.

---

## 1. GAPS: AI text not in the AI face

Ordered by how much text the reader sees.

### 1.1 Tweets: every post (the known suspect, confirmed)
- **Where:** `src/web/Tweets.tsx:336-340`, a `<p className="tw:m-0 tw:font-prose …">` holding the
  counter span and `{tweet.text}`. It has no semantic class, and `tw:font-prose` would beat a
  voices.css rule on that `<p>` anyway. Today the post is in the **reading face**.
- **Provenance:** `PublicTweets.tweets[].text` (src/public-types.ts:423) comes from src/tweets.ts:306,
  the model's JSON `{"tweets":[{"text":…,"blocks":[…]}]}`. It is parsed at :399-419 and trimmed at
  :499-510.
- **Fix:** wrap `{tweet.text}` in `<span className="tweets-text">` and add **`.tweets-text`**.
  - The `{i+1}/{total}` span (`tw:font-mono`) is UI and stays as it is.
  - Alternatively, drop `tw:font-prose` from the `<p>` and give the `<p>` the class.
  - `ThreadPosts` is used only here.

### 1.2 Marginalia: all of it is Geist (five pieces)
`.marg-note` and `.marg-head` set font-ui, so none of this inherits a voice.
- **The part's question.** `MarginaliaColumn.tsx:98-105`, `p.marg-question`, shows `note.text`. That
  is the part's `question`, written by the hierarchy call (marginalia/notes.ts:91-92;
  src/hierarchy.ts § questionFor). Add **`.marg-question`**.
- **The idea's name.** `:143`, `span.marg-idea-name`, shows `note.name`, the Ideas artefact's name.
  That is the same field as `.ideas-name`, which is already AI. Add **`.marg-idea-name`**. The
  `.marg-stamp` beside it is the fixed `PROVENANCE_WORD`, so it is UI.
- **The idea's tooltip.** `:130-131` has `<div className="tip-soon-head">{note.name}</div>` and a
  **classless** `<p>{note.statement}</p>`, which is the Ideas model's statement (notes.ts:117).
  `.tip-soon-head` is a generic UI class used app-wide, so both lines need their own classes:
  `<p className="marg-idea-statement">` and `className="tip-soon-head marg-idea-tipname"`. Add
  **`.marg-idea-statement, .marg-idea-tipname`**. The `.tip-soon-how` line is the fixed
  `PROVENANCE_TIP`, so it is UI.
- **The arc.** `:249-254`, `button.marg-arc`, shows `arc`. That is `arcAt(liveArc, …)`
  (reader/Reader.tsx:2430), the model's arc, the same text `.outln-arc` already sets as AI. Add
  **`.marg-arc`**.
- **The arc's tooltip.** `:244`, `content={<p>{arc}</p>}`, is classless. Add
  `className="marg-arc-full"`, then **`.marg-arc-full`**.

### 1.3 Sketch: the card, the bar, and the tooltips (the SVG labels are in §4)
- **The card under the picture.** `SketchView.tsx:137-143`: `.sk-card-title` (`node.text`),
  `.sk-card-sub` (`node.sub`) and `.sk-card-detail` (`node.detail`). These are `SketchNode` fields
  parsed from the model's JSON (src/sketch-scene.ts:129-138, 444-447). `.sk-card` sets font-ui. Add
  **`.sk-card-title, .sk-card-sub, .sk-card-detail`**.
- **The empty card's caption.** `SketchView.tsx:131`, `.sk-card-caption`, shows
  `scene.caption ?? sketch.caption` (:1290). Model-written (sketch-scene.ts:213-219, 243-244,
  718-719). Add **`.sk-card-caption`**.
- **The bar's titles.** `:991` `.sk-title` (`sketch.title`) and `:946-952` `.sk-scene` chips
  (`sketch.title` / `sc.title`), both model-written (sketch-scene.ts:717, 779). These are titles of
  the model's own picture, not of the author's sections, so "section titles stay UI" does not apply.
  Add **`.sk-title, .sk-scene`**.
- **The tooltips.** `:916-924` and `:973-980` use
  `ControlTip head={sc.title|sketch.title} what={sc.caption ?? sketch.caption}`. ControlTip
  (Tooltip.tsx:429-434) renders `.tip-soon-head` and a **classless** `<p>{what}</p>`; its `how` is our
  copy. Two changes are needed:
  - a caller class on the Tooltip, `className="tip-soon sk-scene-tip"` (Tooltip.tsx:289 puts it on
    the `.tooltip`);
  - a class on ControlTip's `what` `<p>`, `tip-soon-what`.

  Then add **`.sk-scene-tip :is(.tip-soon-head, .tip-soon-what)`**. The alternative is a `voice` prop
  on ControlTip.

### 1.4 Illustrated: plate titles, vignette rows, the brief, the chip tooltip
- **Plate titles.** `IllustratedView.tsx:468-473` `.ill-plate-chip` (`p.title`) and `:480`
  `.ill-title` (`plate.title`). These are `plates[].title` from the model's JSON
  (src/illustrated.ts:605). Add **`.ill-plate-chip, .ill-title`**.
- **Vignette rows.** `:586` `.ill-caption` (`v.title`, illustrated.ts:612) and `:588` `.ill-depicts`
  (`v.depicts`, :611), inside `.ill-row`, which is font-ui. Add **`.ill-caption, .ill-depicts`**.
- **The brief.** `:619` and `:695` `.ill-style` (`illustrated.style`, illustrated.ts:601). The
  prompt is `.ill-aside-prompt` at `:696`, and a **classless** `<p>{plate.prompt}</p>` in
  `.ill-brief` at `:620`; it is the model's own image prompt (illustrated.ts:614). Give the :620 `<p>`
  a class (reuse `ill-aside-prompt`, or a new `ill-prompt`). Add **`.ill-style, .ill-aside-prompt`**,
  plus `.ill-prompt` if that class is new. The `<summary>` "What the illustrator was asked for" is
  fixed, so it is UI.
- **The plate-chip tooltip.** `:445-458` uses `head={p.title}` with a fixed `what`. Same ControlTip
  fix as Sketch: `className="tip-soon ill-plate-tip"`, then **`.ill-plate-tip .tip-soon-head`**.

### 1.5 Quotes: the "why this one" card
- `QuotesPanel.tsx:1134-1140` is `<Tooltip content={quote.reason} className="quotes-why-card">`, and
  the `.tooltip` holds only `quote.reason`.
- That is model-written: src/quotes.ts:156 says "Only `reason` is written; `text` is copied", and it
  is parsed at :676.
- `.tooltip` sets font-ui. Add **`.quotes-why-card`**.

### 1.6 Skim: the door cue and the stop card
- **The door cue.** `SkimPanel.tsx:919`, `p.skim-door-cue`, shows `door.cue`. That is
  `cueOf(nextStop)` (modes/skim/SkimMode.tsx:539, 548), the model's one-line cue (src/skim.ts:90-128).
  The class is **mixed**: `:921` reuses `skim-door-cue` for the fixed "End of {pass} — N stops." Add a
  modifier `skim-door-cue-next` on the :919 element, and the selector **`.skim-door-cue-next`**.
- **A term's sense and an idea's statement.** `:797-800`, `.skim-sense > p`, shows
  `entryProse(term.entry).lead`, the glossary's model-written senseHere, background or gloss.
  `:827-828`, `.skim-sense > p`, shows `idea.statement` (model, src/ideas.ts). The only other child is
  the OpenIn button. Add **`.skim-sense > p`**.
- **Timeline labels in the stop card.** `:843-848`: a `.skim-link` button or a bare `<span>` showing
  `event.label`, the same model field as `.tl-label`. Add **`.skim-cluster li`**, or class the bare
  span `skim-link` and add `.skim-link`.
- **Term and idea chips.** `:787-792` and `:818-820`, `.skim-chip`, show `entry.name` / `i.name`. The
  class is mixed: the term chip also holds `<span className="skim-also">also at stop N</span>`, which
  is UI. Wrap the name in `<span className="skim-chip-name">` and add **`.skim-chip-name`**. Idea names
  are clearly AI; term names are a judgement call (§6).

### 1.7 Structure and Spine: navLabel text (not section titles)
- **Paragraph rows.** `StructurePanel.tsx:309`, `span.struct-text` on a `.struct-paragraph` row
  (structure.ts:630). `rowText` is title-first, but paragraph leaves have no title, so this is
  `node.navLabel`: a 6–20-word claim from the `labels` model step (src/labels.ts; hierarchy.md:497).
  It is not a section title. Add **`.struct-paragraph .struct-text`**. Heading leaves are a caveat
  (§6).
- **The spine's band card.** `Spine.tsx:1451-1454`, `.tip-kids li`, shows `childLabel(c)`, which is
  navLabel-first (Spine.tsx:1359-1360). In practice these are depth-3 leaves, so model navLabels.
  It is mixed, because a child with no navLabel shows its title. Make `kids` carry
  `{label, ai: !!c.node.navLabel?.trim()}` and render
  `<li className={ai ? "tip-kid-label" : undefined}>`. Add **`.tip-kid-label`**.
- **The Structure row card.** `StructurePanel.tsx:246-249`, `.tip-kids li`, shows `c.text`
  (structure.ts:355-375), title-first with a navLabel fallback. A part's children are titles (UI); a
  section's are leaf navLabels (AI). Carry `source` in `named` (structure.ts:369) and use the same
  `tip-kid-label`.

### 1.8 Hover cards (`.prose-card-text` declares font-ui, so each one needs naming)
- **Checked on the web.** `ProseHoverCard.tsx:1838-1843`, `.prose-card-part-looked .prose-card-text`,
  shows `entry.lookup.answer`. That is the web-search model's answer (src/term-lookup.ts →
  src/explain.ts), and its band twin is already AI. Add
  **`.prose-card-part-looked .prose-card-text`**.
- **What the paper does.** `:1793-1796`, `p.prose-card-text.prose-card-cite-does`, shows
  `{CITE_DOES_LABEL}: {paperDoes.says}`. `paperDoes.says` is the citation investigation's model
  account; its band twin `.cite-does` is AI. The label span has no font of its own, so naming the
  `<p>` would drag the label into Courier. Wrap the model text instead:
  `<span className="prose-card-cite-does-text">{paperDoes.says}</span>`, and add
  **`.prose-card-cite-does-text`**.
- **A legacy glossary entry's gloss.** `:1823`, in the glossary/1 term card,
  `<p className="prose-card-text">{prose.lead}</p>` shows `entry.gloss` (GlossaryPanel.tsx:968-969),
  which is model-written. It has no distinguishing class. Add `prose-card-term-lead` and
  **`.prose-card-term-lead`**.
- **The shelf entry's gist.** `:1350-1351`, `.prose-card-part-shelf .prose-card-text`, shows
  `library.entry.gist` = `root?.gist ?? root?.summary ?? input.excerpt`
  (src/library-scalars.ts:127). That is the model's root gist, falling back to the Readability
  excerpt (the author's words) only when there is no tree. Add
  **`.prose-card-part-shelf .prose-card-text`**. The fallback is a caveat (§6).

### 1.9 Glossary: legacy detail, and the term name
- **Legacy detail.** `GlossaryPanel.tsx:1397`, `.gloss-detail`, shows `entry.detail`, the glossary/1
  model paragraph. The same entry's lead, `.gloss-gloss`, is already AI. Add **`.gloss-detail`**.
- **The term name.** `GlossaryPanel.tsx:1281`, `.gloss-name`, shows `entry.name`.
  - The prompt asks the model for the *canonical* name, "e.g. 'United States of America' rather than
    'America'" (src/glossary.ts:1051), so it is often not the article's spelling.
  - It is inconsistent today: `.ideas-name` is AI while `.gloss-name` is Geist.
  - Add **`.gloss-name`** if Greg agrees (§6).
  - Do not add `.prose-card-name` wholesale, because the citation card reuses it for a work's title
    (ProseHoverCard.tsx:1690, 1704). For TermCard (:1815), use a new class.

### 1.10 Passage pointers in chat and the live strip
- `PassageLinks.tsx:18`, `span.chat-pointed-why`, shows `passage.why`. That is the realtime model's
  `show_passage` argument (src/live.ts:284, "A few words naming what is in the passage").
- It renders in two places:
  - ChatPanel.tsx:1504, inside `.chat-turn.model`, but `.chat-pointed` resets it to font-ui;
  - live/LiveStatus.tsx:120.
- Add **`.chat-pointed-why`**.

### 1.11 Diagram: the footer card's gist
- `DiagramPanel.tsx:2751`, `.diag-card-gist`, shows `node.gist` (graph.ts:376 → diagram.ts:160).
- That is the same field `.struct-gist` and `.root-gist` show as AI. It inherits font-ui from the band.
- Add **`.diag-card-gist`**. The `.diag-card-title` beside it is a section title, so it stays UI.

### 1.12 Dock: an answered comment with no note
- `Dock.tsx:3985`, `span.dock-question-state ${c.status}${c.body ? " own" : ""}`, shows `previewOf(c)`
  (:4006).
- When there is no body and `status === "done"`, that is `firstLine(c.answer)`: the comment's model
  Explanation, the same text as `.cmt-answer`.
- `.dock-question-state` sets font-ui (dock.css:854).
- Add **`.dock-question-state.done:not(.own)`**, plus a `TEMPLATED_COMPOUNDS` entry. The pending and
  error lines stay UI.

### 1.13 Chat thread list: the last-message preview (mixed)
- `ChatPanel.tsx:883`, `.chat-thread-last`, shows `lastSaid(t)` (:946), the last non-empty message.
- It is usually the model's reply. It is the reader's question when that was the last thing said, for
  example while an answer is pending or after one failed.
- Make `lastSaid` return `{text, role}` and render `chat-thread-last ${role}`. Then add
  **`.chat-thread-last.model`** to the AI block and **`.chat-thread-last.you`** to the reader block,
  each with a `TEMPLATED_COMPOUNDS` entry.

### 1.14 Debate: the AI-read headline and byline (judgement)
- **The headline.** `DebatePanel.tsx:1923`, `.dbt-title`, shows `work.headline`. When `titleIsAI` is
  true (readWorkTitle, :1807-1831), it is the model's reading of the page's title. Otherwise it is the
  search engine's or registry's title (third party), or the URL. Fix:
  `className={`dbt-title${work.titleIsAI ? " dbt-title-ai" : ""}`}`, and add **`.dbt-title-ai`**.
- **The byline.** `:1937` `.dbt-byline` and `:2060` `.dbt-authors`. Authors and year are "As the AI
  read it off the page" (:1898) unless the registry filled them, and the fields mix within one row.
  One option: a `dbt-byline-ai` / `dbt-authors-ai` modifier only when every shown field is AI
  (`registryBylineFields.length === 0`, `!work.registryFields.includes("authors")`), leaving mixed
  rows UI.

### 1.15 Code inside a model reply (weak)
- `.chat-turn.model .fmt-pre code` (mode-band.css:564) and `.fmt-code` (:574) set Geist Mono, so code
  in a chat answer, and in `.cnd-answer`, is not in Courier.
- Both faces are monospace. Making code Courier would erase the code-versus-prose distinction inside
  an answer.
- Only if "all AI text" is meant literally, add
  **`.chat-turn.model :is(.fmt-code, .fmt-pre code), .cnd-answer :is(.fmt-code, .fmt-pre code)`**.

### Checked and correctly covered (no action)
- **Summaries, outlines, gists:** `.simple-text`, `.struct-gist`, `.outln-gist`, `.outln-arc`,
  `.outln-card-gist`, `.root-gist`, `.tip-gist`, `.tip-navlabel`.
- **Glossary and the card parts:** `.gloss-gloss`, `.gloss-part-text` (including ask and lookup
  answers), and the relation, why, senseHere and background card parts.
- **Ideas, FAQ, Quiz:** `.ideas-name`, `.ideas-reason`, the ideas detail parts, `.faq-question`, and
  every `.quiz-*` in the list.
- **Chat:** `.chat-turn.model`, including `.fmt-h`. Its UI children `.chat-thinking`, `.chat-failed`,
  `.chat-stopped`, `.chat-tools`, `.chat-sources` and `.chat-edited` all correctly reset to font-ui.
- **Live, comments, Candidates:** `.chat-live-line.companion .chat-live-words`, `.cmt-answer`,
  `.cnd-*`.
- **The rest of the band:** `.skim-cue`, `.tl-label`, `.cite-why`, `.cite-does`, `.cite-inv-*`,
  `.srch-hit-why`, `.clm-*`, `.crit-why`, `.mir-note`, `.dbt-ai`, `.dbt-thread-gist`, `.dbt-key-why`.
- **Remember mode** is ChatPanel (`kind="remember"`) plus QuizPanel, so those rules cover it.
- **FAQ** has no model-written answer text. Its answers are the author's passages (`.faq-quote`).

---

## 2. GAPS: author text and reader text

### 2a. Author (the article's words not in the serif)
1. **Debate, the heading in "by claim" order.** `DebatePanel.tsx:1696`, `.dbt-group-quote`, shows
   `“{group.claimQuote}”`. It is the same verbatim quote as `.dbt-claim-text`, which is already
   author; it is checked as verbatim at src/debate.ts:469, 738. It inherits font-ui from
   `.dbt-group-head`. Add **`.dbt-group-quote`**.
2. **Citations, the "first cited" words.** `CitationsPanel.tsx:1036-1045`,
   `BlockRef className="cite-at"`, has children `quotedCitingWords(cited.quote)`: "the words the
   article cites it with" (:1031, :299). citations.css:70 sets
   `.cite-first .cite-at { font-family: inherit }` inside `.cite-meta`, which is font-ui. Add
   **`.cite-at`**.
3. **The search hit card's passage.** `SearchPanel.tsx:1681`, a classless `<p>{found.long}</p>` in
   the `.tip-hit` tooltip. It is a `snippet()` of the block text (search-hits.ts:359, 561). Add
   `className="tip-hit-quote"` and **`.tip-hit-quote`**.
4. **Timeline, the date phrase.**
   - Where: `TimelinePanel.tsx:645` (dated), `:673` (rejected), and `:660` (words), each
     `<p className="gloss-part-text">“{phrase}”…</p>`.
   - Provenance: `phrase` "is never the model's string. It is the article's own characters"
     (src/timeline.ts:47-49).
   - Why it is missed: `.gloss-part-text:not(.tl-detail *)` excludes all three, though only :660 is
     truly mixed.
   - Fix: wrap the phrase itself in `<q className="tl-phrase">` and add **`.tl-phrase`**. The
     paragraph and our sentence stay UI.
5. **Diagram's footer card, the evidence line.** `DiagramPanel.tsx:2765`, `.diag-card-linkterms`,
   shows `evidence(r)` (:2701-2709). That one string mixes the author's link text (`r.label`) or a
   block-text quote (`r.quote`, :490) with our cosine score or fixed words. `evidence()` has to return
   JSX with `<q className="diag-card-linkquote">` around the quoted part; then add
   **`.diag-card-linkquote`**.
6. (low) **Referee's hidden-instruction scan.** `SourceScanNotice.tsx:434`,
   `<q className="ref-scan-text">`, shows text a deterministic scan found hidden in the source. It is
   the document's words, but hidden and untrusted. Add **`.ref-scan-text`** only if Greg counts it as
   the author's (§6).

### 2b. Reader (what they typed not in Arial)
1. **The "What you're being written for" popover.**
   - Where: `ProfilePanel.tsx:320`, `.prof-panel-text`.
   - What it shows: the reader's own profile and purpose (`load.value.profile`, `.purpose`, :260-270).
   - It is inside the reading view: `WrittenForYou` opens it, from Tweets.tsx:115, IdeasPanel.tsx:205,
     QuotesPanel.tsx:602, GlossaryPanel.tsx:265 and SummaryMode.tsx:103.
   - `.quiet` marks the loading, error and empty copy.
   - Today it is `font-reading` (profile.css:555). Add **`.prof-panel-text:not(.quiet)`**.
2. **The "Why are you reading this?" prompt.** `PurposePrompt.tsx:165` → `ProfileBox.tsx:178`,
   `.prof-box-input`. It is mounted beside `<Reader>` (article/ArticlePage.tsx:577), so the attribute
   is on. Add **`.prof-box-input`**. The same class is used on /profile, Metadata and /add, where the
   attribute is off, so adding it is harmless there.
3. **Dictation's live guess.** `DictationStrip.tsx:327`, `.prof-interim`, is the recogniser's interim
   transcript of the reader's speech, in chat, comments, annotate, quiz and feedback. It is
   `font-reading` (profile.css:206), so it changes face when it lands in the covered textarea. Add
   **`.prof-interim`**.
4. **Chat thread titles.** The title is `titleFrom(question)`, the reader's first question, or their
   rename (src/chat.ts:115, :358, :543, :792). The fallback is the fixed "New chat" or "Remembering"
   (:325, :527).
   - `ChatPanel.tsx:882`, `.chat-thread-title`: add **`.chat-thread-title`**. It shows "New chat" only
     on an empty thread, which is acceptable.
   - `ChatPanel.tsx:494`, `<h2>{remember ? "Remember" : open ? open.title : "Chat"}</h2>`, is
     classless and mixed. Wrap the title arm in `<span className="chat-head-title">` and add
     **`.chat-head-title`**.
   - `ChatDialog.tsx:684-690`, `.chat-dialog-label`, shows "Ask about k3m9qt", "New conversation" or
     `thread.title`. Wrap the title arm (`chat-dialog-title`) and add **`.chat-dialog-title`**.
5. **The reader half of `.chat-thread-last`.** See 1.13.
6. **The search hit card's "Found by {criterion}".** `SearchPanel.tsx:1688`, `<b>{criterion}</b>` in
   `.tip-hit-meta`. `run.criterion` is the reader's own query. Add `className="tip-hit-criterion"` and
   **`.tip-hit-criterion`**.
7. (minor) **Place on a criterion.**
   - `PlaceOnCriterion.tsx:333-337`: each `<option>` is `${criterion} — ${against} ↔ ${favour}`, all
     the reader's words. But an `<option>`'s font follows its `<select>`, so the only practical option
     is `.place-pick select` in the reader face; "Not placed" is the only UI string it would catch.
   - `.place-current-label` and `.place-step` are app templates around the pole words. Leave them UI
     unless the pole words get a span.
8. (minor) **Criteria's result pole word.** `CriteriaPanel.tsx:1563-1569`, `.crit-valence-end`, shows
   the reader's pole (`config.poles.against` / `.favour`) or the fixed "neither end". Put a class on
   the pole arm only.
9. (unsure, see §6) Three more reader-typed boxes:
   - the Feedback dialog's `.fb-input.fb-body` (FeedbackDialog.tsx:1146) and `.fb-earlier-body`
     (FeedbackEarlier.tsx:291);
   - the masthead rename input (TitleEditor.tsx:86, :121);
   - the command bar's `.cmdbar-input` (CommandBar.tsx:746).

---

## 3. WRONG: covered, but with the wrong voice or a mixed element

1. **`.chat-stance-tag` is in Courier.**
   - Where: `ChatPanel.tsx:1520`, inside `.chat-turn.model > .chat-actions`.
   - What it shows: `message.stance` ("socratic" or "respond"), our label for how the reply was
     requested.
   - Why: neither `.chat-stance-tag` (mode-band.css:1069) nor `.chat-actions` sets a font-family, so
     the tag inherits the AI face.
   - Fix: `font-family: var(--font-ui)` on `.chat-stance-tag`, or on `.chat-turn.model .chat-actions`.
   - Verified by reading the CSS; a browser look would confirm it.
2. **`.dbt-thread-name` also covers the fixed "Key sources" thread.** debate-threads.ts:50-55 pushes
   `{kind:"key", label:"Key sources"}`, which renders in the same span (DebatePanel.tsx:1613). Fix:
   `.dbt-thread:not(.dbt-thread-key) .dbt-thread-name`. The button already has `dbt-thread-key`
   (:1599).
3. **`.dbt-relation` is a fixed word, set in Courier.**
   - `row.relation` is clamped to `RELATIONS` (src/debate.ts:845), so it is one of a fixed set:
     "disputes", "qualifies", "unclear". "unclear" is also the fallback when the model gave nothing
     valid.
   - The plan's own rule says a fixed phrase spelling out the model's verdict stays UI. `.dbt-bears`
     and `.dbt-lean`, on the same line, follow that rule.
   - Fix: drop `.dbt-relation` from the AI block, or move bears and lean into it. Greg's call.
4. **`.crit-yours` is in Arial, but it is an app template.** `CriteriaPanel.tsx:1454` shows
   `refereeSide()` = `` `You: ${placementWords(...)} · ${signedValence(...)}` `` (:1611-1612). The
   reader chose the placement but wrote none of the sentence. That differs from `.mir-yours`, which is
   their typed comment. Fix: drop it, or wrap only the pole words.
5. **`.cnd-affil` puts our hedge in Courier.** `CandidatesPanel.tsx:662` renders
   `<span className="cnd-affil"> — said to be at {candidate.affiliation}</span>`, so the fixed
   "said to be at" is Courier too. Fix: wrap the affiliation (`cnd-affil-name`) and target that.
6. **"Whole paragraph" is in the author's serif.** `CommentDialog.tsx:372-374` renders
   `<blockquote className="cmt-quote"><em>Whole paragraph</em> — {text}`, and `Dock.tsx:3933-3935`
   `.dock-question-quote` has the same shape. Fix: give the `<em>` a class (`passage-whole`) with
   `font-family: var(--font-ui)` in annotations.css and dock.css. A `:not()` cannot undo inheritance.
7. **Placeholders in every reader input are Arial.** This covers `.chat-input`, `.chat-edit-box`,
   `textarea.cmt-note` ("Add a comment…", CommentDialog.tsx:791), `.cmt-followup input`,
   `.annotate-dialog textarea`, `.srch-input` and the rest of the reader list. One rule fixes it:
   `:root[data-voices] :is(<reader list>)::placeholder { font-family: var(--font-ui) }`. It is a
   fourth rule, so `selectors.length === 3` in tests/voices-css.test.ts must change. Minor.
8. (a decision, not a bug) **A chat started from a passage is Arial throughout.**
   - `askAboutBlock` (src/web/chat-handoff.ts:80-100) builds
     `About block k3m9qt ("<author's opening words>"):\n\n<question | "Explain this passage.">`.
   - The "?" help press sends `HELP_QUESTION = "Help me understand."` (:56).
   - `askAboutTerm` (:123) is a fixed template around a glossary term.
   - The file says this is deliberately "the reader's own words, editable before they send", so the
     reader face is defensible.

**Checked and right:**
- Every existing `:not()` exclusion: `.faq-quote`, `.tl-detail *`, `.ideas-quote-moved`,
  `.tl-quote-moved`, `.mir-block-id`, `.clm-why-withheld`.
- `.clm-list .clm-claim` correctly misses `OTHER_TEXT_HEADING`.
- `.cite-verdict-text` and `.prose-card-cite-verdict-text` are correctly left out.
- `.dbt-ai-label` resets to font-ui inside `.dbt-ai`.
- `p.chat-stopped` is font-ui (chat-actions.css:126).

---

## 4. SVG, canvas and raster

### Sketch: inline SVG, reachable, with a layout risk
- **CSS can reach it.** `SketchView.tsx:104` renders `<text className={p.cls} fontSize={p.px}>` with
  **no `font-family` attribute and no inline font style**; `style` carries only `--cat-rgb`. The text
  inherits font-ui from `.mode-band`, and diagram-sketch.css:305-310 sets only fill, weight and
  spacing. So `:root[data-voices] :is(.sk-text, .sk-sub, .sk-edge-label, .sk-region-label, .sk-label)`
  **would** apply.
- **All five are model strings:** src/sketch-paint.ts:263, 277, 582, 655, 922, from
  sketch-scene.ts:129, 131, 147/507, 187/551, 204.
- **The layout risk:** every label is pre-wrapped and measured in TypeScript with `CHAR_W = 0.53` em
  (src/sketch-scene.ts:108). That constant is used at:
  - sketch-paint.ts:552, the edge-label plate's width;
  - :665, the region label's width, hit box and "opens" mark;
  - :913, the free-label wrap.

  Courier Prime advances 0.6 em per character, about 13% wider. In Courier, text would spill past its
  shapes and edge labels would overrun their plates.
- **Options:**
  - (a) Voice it, and accept or measure the overflow in a browser.
  - (b) Pass a per-voice `CHAR_W` into `paintScene`. It is a pure function the offline harness also
    uses, so this means a parameter, not a constant change.
  - (c) Leave the SVG in Geist for v1, and voice only the card, bar and tooltips (§1.3).

  The sub-trawl recommends (c). A browser look decides it.

### Diagram: inline SVG, reachable, but no model text drawn today
- **CSS can reach it.** `DiagramPanel.tsx:2648-2671` renders `<text className="diag-label">` with
  `<tspan>`s. Its font is set by CSS (diagram.css:269), not by an attribute.
- **The plan's worry no longer applies.** The plan said title and gist share one `<text>`. But
  `lines` are produced only by diagram-d3.ts:303 (force: the section **number** only,
  `titleLines: 1`) and scatter.ts:459 (empty). `DIAGRAMS` is force, drift, trail, sketch and
  illustrated (diagram.ts:140).
- **If gists come back,** the tspans already know which lines are gist (`i >= node.titleLines`, :2573,
  :2666), so a `diag-label-gist` class could go there. The `CHAR_W = 0.52` wrap (diagram.ts:555)
  carries the same caveat as Sketch.
- **The lane legend** (`.diag-lane`, :1834) is computed words (`laneTerms`), not a model's, so it is UI.

### Illustrated: raster, unreachable
- `Plate` is an `<img>` of a PNG the image model painted (IllustratedView.tsx:277-289).
- The vignette captions are lettered into the pixels (illustrated.ts:573-592, 853-859), so CSS cannot
  reach them. The HTML copies (`.ill-caption`, §1.4) are the only place the face can apply.
- The `alt` text includes `plate.title`, but it is not drawn.

### No canvas
There is no `<canvas>` in any of these surfaces. Skim's sparkline and ScoreBars draw no text.

---

## 5. Outside the reading view (`data-voices` is never on here)

**Metadata is not inside Reader.** `ArticlePage` renders *either* `<Metadata>`
(article/ArticlePage.tsx:415-423, `view === "metadata"`) *or* `<OwnedReader>`, so `useVoiceFaces`
(Reader.tsx:286) is not mounted there. The same is true of the visitor's PublicMetadataPage
(PublicPages.tsx). On top of that, most voice-bearing text below uses `tw:font-prose`, which beats
voices.css by layer even if the attribute were on. Each would need a class (or the utility removed)
as well as the attribute.

### Metadata (src/web/Metadata.tsx; the page is `tw:font-sans`, :793)
- **AI:** "In one sentence": `root.gist` (:899-900) and `root.summary` (:903-905), both
  `tw:font-prose`.
- **Author:**
  - the h1 title (:828, `tw:font-prose`; the reader can rename it);
  - "Where you left off", `“{snippet(lastRead.text)}”` (:1131);
  - authors and affiliations (:937-942). For PDFs a model extracted them (src/pdf-authors.ts); see §6.
- **Reader:**
  - the purpose, `ProfileBox .prof-box-input` (:1088);
  - the `AboutYou` profile text (:1995-1997, `tw:font-prose`).
- **UI:** `meta.note` (:908) is the splitter's or the extraction's note, not a model's.

### The shelf (Library.tsx, ShelfEntry.tsx, library-columns.tsx) and the public shelf (PublicLibraryPage.tsx)
- **AI, but mixed:** `entry.gist`, shown in three places:
  - ShelfEntry.tsx:280-282 (`tw:font-prose`);
  - PublicLibraryPage.tsx:346-348 (`tw:font-prose`);
  - library-columns.tsx:545, `.tip-gist`. That class is in voices.css, but the attribute is off here.

  Its source is `root?.gist ?? root?.summary ?? input.excerpt` (src/library-scalars.ts:127): the
  model's gist **or** Readability's excerpt, and nothing tells the client which. A per-voice face
  needs a `gistSource` flag first.
- **Author:**
  - titles: ShelfEntry.tsx:229-238, library-columns.tsx:342, PublicLibraryPage.tsx:318-327 and
    PublicShowcase.tsx:197-199 (the reader can rename them);
  - `entry.abstract` (ShelfEntry.tsx:294, `tw:font-prose`), transcribed by a cheap model
    (src/paper-metadata.ts);
  - library search hits, `hit.text` (Library.tsx:1169-1170, `tw:font-prose`).
- **Reader:** the shelf search input (Library.tsx:988).
- **UI:** the shelf terms (ShelfTerms*, ShelfTermChip) are picked without a model.

### Other pages
- **UnreadPaperPage** (article/UnreadPaperPage.tsx, rendered instead of Reader at
  ArticlePage.tsx:165): `paper.title` (:96-97) and `paper.abstract` (:121-122). Both are the author's,
  both `tw:font-prose`.
- **PublicPages.tsx:112-113:** `meta.title`, the author's, `tw:font-prose`.
- **/profile** (ProfilePage.tsx:236 → `.prof-box-input`) and **/add** (AddPage.tsx:1061-1069,
  `.prof-box-input`; also the URL input): the reader's.
- **Admin** (AdminFeedbackList and the rest): other readers' feedback. Out of scope.
- **The Feedback dialog** is mounted app-wide (FeedbackHost in App.tsx), so it *is* in the reading
  view when opened there. It is listed under §2b.9.

---

## 6. Unsure: flagged for Greg

1. **Glossary term names** (`.gloss-name`, TermCard's `.prose-card-name`, Skim's term chips). The
   model writes a canonical name, often not the article's spelling, but these are headings, and the
   v1 kept titles UI. Listed as an AI gap (1.9) because `.ideas-name` is already AI; the inconsistency
   is the point. **Glossary aliases** (`.gloss-aliases`, GlossaryPanel.tsx:1390) are "the other forms
   this article actually uses" (glossary.ts:1062): words close to the author's, chosen by the model.
   Left UI.
2. **Heading leaves' navLabel** (1.7). hierarchy.md:503 says a heading leaf's label "is the author's
   own title". So `.struct-paragraph .struct-text` or `tip-kid-label` on a heading block would put the
   author's words in Courier. Per-node provenance (`sourceHeading`, or the block kind) is the honest
   test, the same v2 question as section titles. Untitled nodes that fall back to their navLabel in a
   title slot are rare (two in the corpus, Spine.tsx:1366), so leave them UI. Those slots are
   `outln-text` and `outln-card-title` (outline.ts:119-127) and the Spine's `.tip-title` via
   `bandLabel` (:1380-1386).
3. **The shelf gist's excerpt fallback** (1.8, §5). It puts the author's words in Courier when there
   is no tree, unless a `gistSource` flag is carried.
4. **Debate bylines** (1.14). Registry and AI fields mix within one row.
5. **Code in a model reply** (1.15). Geist Mono or Courier Prime?
6. **Citation titles and by-lines** (`.cite-title`, `.cite-by`, and their card twins). The model
   transcribes them "as the article gives it" (src/citations.ts:1641-1643), sometimes filled from a
   registry. They are bibliographic, so author or third-party, but not verified verbatim. Left UI.
   The same question applies to author names and affiliations in the masthead
   (AuthorNames.tsx:72-121) and on Metadata.
7. **Tool-strip labels** (ChatPanel.tsx:1611-1612, LiveStatus.tsx:125, and Candidates'
   `.chat-tool-detail` at CandidatesPanel.tsx:840-841). Each is our template around an argument the
   model chose, for example `searched this article for “${query}”` (src/chat-tools.ts:1017, :1049,
   :1098). By the v1's "a fixed phrase stays UI" rule, they are UI. The query inside the quotes is the
   model's words, if Greg wants it.
8. **Mixed lines left UI:**
   - `.dbt-thread-showing`, "Showing 3 excerpts on “X”" (DebatePanel.tsx:1626-1628), where X is the
     model's theme label;
   - `.place-step` and `.place-current-label`, templates around the pole words.
9. **Reader-typed, but not about the article:** Feedback's `.fb-body` and `.fb-earlier-body`; the
   masthead rename input (the v1 kept titles UI); the command bar's input. "Anything the reader typed"
   says yes to all three.
10. **Hidden source text,** `.ref-scan-text` (2a.6): the author's voice, or an untrusted voice of its
    own?
11. **The third-party "fifth voice"** is out of v1 by decision. It is listed so none of it is
    mistaken for a gap:
    - Debate's `.dbt-quote`, `.dbt-ref`, `.dbt-site`, the non-AI `.dbt-title`, and the
      identification lines (DebatePanel.tsx:786-805);
    - `.cite-quote blockquote` and `.prose-card-cite-quote`;
    - `.cite-inv-source-title`;
    - `.gloss-sources` titles;
    - `.crit-cites a` and `.cnd-sources a`;
    - `.cite-here-how`;
    - the Wikipedia extract and the page's opening (`.prose-card-part-wiki`,
      `.prose-card-part-page .prose-card-text`).
12. **The Sketch band could become almost all Courier.** If all of §1.3 and the Sketch labels in §4
    are taken, nearly the whole band turns Courier, including labels at about 5px in the band. Worth
    a look before deciding.

---

## Proposed additions in one place (if everything in §1–§2 is taken)

`*` marks a judgement call from §6.

**AI:**
- Tweets: `.tweets-text`.
- Marginalia: `.marg-question`, `.marg-idea-name`, `.marg-idea-statement`, `.marg-idea-tipname`,
  `.marg-arc`, `.marg-arc-full`.
- Sketch: `.sk-card-title`, `.sk-card-sub`, `.sk-card-detail`, `.sk-card-caption`, `.sk-title`,
  `.sk-scene`, `.sk-scene-tip :is(.tip-soon-head, .tip-soon-what)`.
- Illustrated: `.ill-plate-chip`, `.ill-title`, `.ill-caption`, `.ill-depicts`, `.ill-style`,
  `.ill-aside-prompt`, `.ill-plate-tip .tip-soon-head`.
- Quotes and Skim: `.quotes-why-card`, `.skim-door-cue-next`, `.skim-sense > p`, `.skim-cluster li`,
  `.skim-chip-name`.
- Structure and Spine: `.struct-paragraph .struct-text`, `.tip-kid-label`.
- Hover cards: `.prose-card-part-looked .prose-card-text`, `.prose-card-cite-does-text`,
  `.prose-card-term-lead`, `.prose-card-part-shelf .prose-card-text`.
- Glossary: `.gloss-detail`, `.gloss-name`*.
- Chat, Diagram and Dock: `.chat-pointed-why`, `.diag-card-gist`,
  `.dock-question-state.done:not(.own)`, `.chat-thread-last.model`.
- Debate: `.dbt-title-ai`*, and `.dbt-byline-ai`, `.dbt-authors-ai`*.
- Code in an answer*.

**Author:** `.dbt-group-quote`, `.cite-at`, `.tip-hit-quote`, `.tl-phrase`, `.diag-card-linkquote`,
`.ref-scan-text`*.

**Reader:** `.prof-panel-text:not(.quiet)`, `.prof-box-input`, `.prof-interim`, `.chat-thread-title`,
`.chat-head-title`, `.chat-dialog-title`, `.chat-thread-last.you`, `.tip-hit-criterion`, and
`.place-pick select`, `.fb-body`, `.fb-earlier-body`, `.cmdbar-input`*.

**Remove or narrow:**
- `.dbt-thread-name` → `.dbt-thread:not(.dbt-thread-key) .dbt-thread-name`;
- `.dbt-relation`*;
- `.crit-yours`;
- `.cnd-affil` → the wrapped name.

**Plus:** font-ui on `.chat-stance-tag` and on the "Whole paragraph" `<em>`, and a `::placeholder`
rule.

**New classes that need component edits:**
- tweets-text;
- marg-idea-statement, marg-idea-tipname, marg-arc-full;
- sk-scene-tip and tip-soon-what, ill-plate-tip, ill-prompt (optional);
- skim-door-cue-next, skim-chip-name, tip-kid-label;
- prose-card-cite-does-text, prose-card-term-lead;
- the chat-thread-last role, chat-head-title, chat-dialog-title;
- dbt-title-ai, cnd-affil-name;
- tl-phrase, diag-card-linkquote, tip-hit-quote, tip-hit-criterion;
- passage-whole.

The existence check in voices-css.test.ts picks up each new class automatically. Compounds built from
templates need `TEMPLATED` entries.
