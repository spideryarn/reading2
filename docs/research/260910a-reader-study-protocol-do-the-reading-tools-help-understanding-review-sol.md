## P0 — would make the study misleading or the consent dishonest

### 1. “What would count”: the main decision rule does not match the counterbalanced design

**Section:** “Rotation across readers” and “What would count”

**Problem:** Each reader’s “paired” comparison is between different articles. The rotation balances article and order effects across the four readers, but only in the aggregate. It does not make an individual reader’s Spideryarn-versus-prose difference attributable to the interface. The “10 percentage points in 3 of 4 readers” rule therefore discards the protection the rotation provides.

It is also too brittle to function as a meaningful threshold:

- With 8–12 idea units scored 0–2, one scoring point is 4.2–6.25 percentage points. A nominal 10-point threshold consequently means either two or three rubric points depending on the article.
- Three positive signs out of four is not persuasive by itself; even if positive and negative differences were equally likely, three-or-more positives occurs 31% of the time.
- “No higher”, “no worse”, and “across readers” do not specify whether the comparison concerns totals, means, reader majorities, or every individual.
- The rule ignores the term result despite explaining a term being one of the required primary tasks.
- Counting doors across readers allows one highly active reader to dominate.

**Why:** The protocol could declare “promising” or “no clear difference” because of article difficulty, order, scoring discretisation, or one reader’s interaction volume. Conversely, a genuine modest improvement could easily miss an effectively 12.5-point cutoff in two readers. The rotation is reasonable; the proposed decision rule is not.

**Concrete proposed rewrite:**

> **How the four-reader result will be interpreted**
>
> This is a formative study and has no efficacy pass/fail result. Report every reader’s two scores and all four article-by-condition cells.
>
> For description only, calculate:
>
> - the mean Spideryarn-minus-prose contrast for article A;
> - the same contrast for article B; and
> - the equally weighted mean of those two contrasts.
>
> The rotation balances article and first-versus-second order in those aggregate contrasts. It does not remove reader differences, carryover, article-by-interface interactions, or scoring error; each article-condition cell contains only two readers.
>
> Call the result **a signal worth testing with more readers** if the equally weighted reconstruction contrast is at least 10 percentage points, neither article shows a comparably large negative contrast, and the claim/evidence, term and weak-point results show no consistent decrement. Ten points is a product-relevance threshold, not a statistical threshold.
>
> Call something **possible harm requiring investigation now** if even one reader adopts a material falsehood traceable to generated text or is prevented from reaching the relevant source. Call an obstacle **recurring** when two or more readers encounter it.
>
> Everything else is inconclusive. Report it without assigning the product a positive or negative verdict.

Retain the individual paired profiles as useful case descriptions, but remove “3 of 4” as the main effect rule.

### 2. “Consent form”: its deletion, retention, access and anonymity promises contradict one another and the product

**Section:** “Consent form” and “Where the data lives”

**Problem:**

- Participants can supposedly request deletion only until results are written, after which “only the anonymous summary” remains. The next paragraph says notes and answers remain for six months.
- “I delete the study articles, and everything attached to them” over-promises. Permanent article deletion removes participant comments, chats and other article work, but the content-addressed original source, content-free operational records, and some device/provider copies may survive, as [privacy.md documents](/home/greg/code/spideryarn2/docs/project/privacy.md:303).
- “Only me” is incompatible with participant input going through Spideryarn’s processors, email replies living with an email provider, and possible Zoom or cloud recording.
- A plain saved comment is stored but is not sent to an AI service unless the reader asks the AI; the current wording says every comment is sent.
- “Nothing … will identify you” is an impossible absolute with four acquaintances and potentially distinctive quotations.
- The form does not identify the controller by full name, state the lawful basis for processing the study data, explain applicable data rights or the right to complain to the ICO, or identify any non-Spideryarn processors used for email/recording.

Participation consent and the lawful basis for processing personal data are not automatically the same thing. ICO guidance also requires informed consent to identify the controller and allow withdrawal, while privacy information normally includes retention, recipients, rights, and transfer information. [ICO consent guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/consent/what-is-valid-consent/), [ICO privacy-information checklist](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/the-right-to-be-informed/what-privacy-information-should-we-provide/).

**Why:** These are promises on which participation is based. Several are presently false or incomplete. Calling this “informal research” does not cure that, and the commercial-research context should not be assumed to qualify for a research exemption.

**Concrete proposed rewrite:** Before recruitment, choose one consistent deletion date and the lawful basis. Replace the relevant paragraphs with language along these lines:

> **Who is responsible.** The data controller is Greg Detre, a UK sole trader. Contact: hello@spideryarn.com. [Add the required business/postal contact details.] I use your study data for this product-research study on the basis of [lawful basis Greg has selected].
>
> **Stopping and deletion.** You may stop the session at any time. Until [one date], you may ask me to delete the identifiable material from your participation: the code key, notes, answers, recording and delayed-recall email. On that date I will delete those materials and retain only results that have been anonymised so that I can no longer link them to you. Once material has been fully anonymised and included in an aggregate report, I may no longer be able to identify and remove your contribution.
>
> **Spideryarn data.** A comment you save is stored in Spideryarn. Text or audio is sent to Spideryarn’s AI providers only when you ask the AI or use dictation. At the end of the study I will permanently delete the study article records and participant work linked to them. The imported source file and content-free operational records may remain as described at spideryarn.com/privacy, and deletion cannot recall copies already held on another device or retained by a service provider.
>
> **Who receives the data.** Greg sees the raw study notes, answers and recordings. Spideryarn’s named service providers process anything entered into the live product. [Name the actual email, videoconferencing, recording, backup or sync services used.] The public repository receives only aggregate results and optional de-identified quotations.
>
> **Publication risk.** I will remove names and identifying details, but in a study this small I cannot guarantee that nobody who already knows you took part could infer your identity from context.
>
> **Your rights.** [State the rights applicable to the chosen lawful basis], how to exercise them, and the right to complain to the Information Commissioner’s Office.

The checkboxes for recording, follow-up and quotation are good and should remain separate.

## P1 — should fix before running

### 3. Scoring is too subjective for differences of two or three points

**Section:** “The marking sheet” and “Scoring blind”

**Problem:** “Gist”, “accurate”, “real weak point”, “recognisably the author’s”, and “material distortion” lack scoring anchors. The same person writes the rubrics, watches every session, and scores every response. Random codes help, but handwriting and remembered answers may reveal condition. Different articles can also have different numbers and difficulty of idea units.

**Why:** A one-point judgment is a large fraction of the proposed effect. The current protocol cannot distinguish a product difference from ordinary rescoring variation.

**Concrete proposed rewrite:**

> Give both articles the same number of atomic reconstruction units, preferably ten. For every unit, write examples of a 0, 1 and 2 and list acceptable paraphrases before seeing generated material. Mark evidence units separately from claims; do not award the same content twice. Define a distortion as minor or material and record answer length so raw distortion counts can be interpreted.
>
> Have a second person score all coded answers, or have Greg rescore them blind after at least a week without seeing his first scores. Record agreement and resolve differences before unblinding. If repeat-scoring disagreement is as large as the proposed product difference, do not classify that difference.

### 4. The second condition is tested after participants have learned the examination

**Section:** “Session plan”, “What the reader is told”, and “The tour”

**Problem:** Participants are deliberately not told the task types before article one. After article one they have performed reconstruction, quotation, claim/evidence, term and weak-point tasks, so they read article two with a much more specific test in mind.

The rotation balances a simple first/second effect in the aggregate, but it cannot erase strategy carryover. Spideryarn-first readers may carry its generated framing into prose; prose-first readers meet Spideryarn only after learning exactly what information to seek.

**Why:** The two periods are not procedurally equivalent. With one reader per rotation cell, condition-by-period carryover is uninterpretable.

**Concrete proposed rewrite:**

> After touring P, give every participant a short practice version of the complete response sequence: close P, state its argument briefly, then reopen it for one claim/evidence and one term question. Tell them that the two study articles use the same kinds of tasks but different targets. Do not reveal A’s or B’s actual claim or term.
>
> Report first-period results separately as the only results unaffected by prior study questions, while acknowledging that there are only two readers per condition. Treat second-period results and paired differences as carrying possible task-practice effects.

Reconstruction should still remain before the open-book questions within each article; that ordering is correct.

### 5. Article length and the 15-minute limit have not been piloted

**Section:** “Articles” and “Session plan”

**Problem:** The claim that 3,000–4,000 words is “not quite enough” for 15 minutes is assumed rather than established. Depending on prose and reader, it may produce a ceiling, a floor, or primarily measure reading speed. The brief asked for comparable passages; the protocol silently expands this to complete articles.

**Why:** A floor makes every reconstruction poor. A ceiling removes the proposed advantage of deciding where to spend attention. A strict cutoff may also make the study feel like the “read this quickly” framing the product explicitly rejects.

**Concrete proposed rewrite:**

> Pilot A and B in ordinary prose with one non-study reader. Keep them only if 15 minutes allows meaningful engagement with most of the argument without making close completion routine. Otherwise select matched self-contained passages or change the time. Record approximate prose coverage only as a diagnostic, never as success.
>
> State explicitly whether the unit is a complete article or a self-contained article passage, and why that choice tests the product better.

### 6. “Door or wall” cannot currently be observed reliably

**Section:** measure 7 and “What would count”

**Problem:** Greg cannot know every time somebody “reads” a gist or glossary entry by watching the screen. The categories have no time window, action boundary, ambiguity category, or minimum denominator.

**Why:** The measure is central to the vision but is presently impressionistic. Repeated actions by one reader could decide “more doors than walls”.

**Concrete proposed rewrite:**

> Code only observable generated-text episodes. An episode begins when the reader explicitly opens, selects or hovers a generated item. It is a **door** if, before opening another generated item, they navigate to or inspect its cited prose. It is a **wall** if they leave the item and continue without inspecting its source. Mark uncertain episodes **uncodable**; do not guess from gaze.
>
> Report doors, walls and uncodable episodes separately for each reader. Do not pool presses as if they were independent readers. For a helping signal, require a reader-level pattern among readers with at least two codable episodes.

### 7. The shared study account can leak one participant’s state into the next

**Section:** “Each session”

**Problem:** Deleting comments and chats does not necessarily reset saved searches, notes/highlights, mode and URL state, scroll position, cached copies, or other reader traces. The protocol also says both “before each session” and “once before the first session” for pre-generation.

**Why:** A later reader could encounter another reader’s work or start from a different interface state. That is both contamination and a consent problem.

**Concrete proposed rewrite:**

> Generate each mode once before the first session and keep those generated outputs fixed. Before every session, remove all participant-created comments, notes/highlights, chats and saved searches; return A, B and P to documented canonical URLs, modes and top-of-article positions; clear or replace the browser profile’s local study state; and verify that no previous participant trace is visible. If any class of trace cannot be cleared reliably, prepare a separate identically configured study account for that reader.

### 8. Founder demand effects need a firmer interaction script

**Section:** “What the reader is told” and “Each session”

**Problem:** Greg built the product, demonstrates it and watches its use. “Honest criticism” helps, but participants still know which result he wants. The protocol does not say how to answer questions during timed work or how to record accidental prompting.

**Why:** Opinions, tool choice and even persistence in finding evidence can be influenced by small interventions.

**Concrete proposed rewrite:**

> During timed tasks, answer only procedural questions using fixed phrases. Do not explain a mode, suggest a route, reassure a struggling reader or react visibly to an answer. Record every intervention. In the debrief ask, “What result did you think I hoped for?” and treat the response as context, not a score.

## P2 — worth improving

### 9. Optional delayed recall needs its own analysis rule

**Section:** measure 9

**Problem:** Only consenting responders produce delayed data, and the first-session reconstruction/open-book questions themselves rehearse the material.

**Why:** Follow-up results will be selectively missing and measure retention after testing, not unaided retention from reading alone.

**Concrete proposed rewrite:**

> Analyse delayed recall only within readers who answer for both articles. Report the numerator and denominator, do not combine it with the primary result, and describe it as retention after the full study procedure, including the immediate questions.

### 10. The quote measure is weak and expendable

**Section:** measure 3

**Problem:** A freely chosen “recognisably the author’s” phrase is difficult to score and could be memorable but irrelevant to the argument.

**Why:** It adds time and another noisy binary-ish outcome without affecting the decision rule.

**Concrete proposed rewrite:** Either remove it, or fold it into reconstruction:

> Tag whether the reconstruction contains at least one article-specific phrase or formulation and verify its source after scoring. Treat this as descriptive evidence about retaining the author’s language, not a separate 0–2 endpoint.

### 11. Several passages can be cut without losing operational value

**Sections:** “Articles”, “Designs passed over”, and repeated setup explanations

**Problem:** The free-account allowance, the three larger rejected designs, and repeated explanations of pre-generation and deletion do not help Greg conduct an individual session.

**Concrete proposed rewrite:**

- Remove the free-allowance paragraph; it is operational trivia, not study design.
- Keep the two simpler designs passed over, because the brief requires them; reduce the three larger alternatives to one sentence.
- State pre-generation once in the setup checklist.
- Keep deletion wording in the standalone consent form and make the researcher checklist point to that exact promise rather than paraphrasing it.

## Overall verdict

The protocol is unusually strong on product intent: it tests reconstruction and interrogation rather than engagement, keeps answers and grades out of Spideryarn, uses human-authored rubrics, observes whether generated text leads back to prose, counterbalances article and order, and explicitly limits any claim from four readers. I found no violation of the vision’s core anti-goals or the brief’s prohibition on telemetry, model scoring or agent contact. However, it should not be run unchanged: the 3-of-4 decision rule does not use the rotation in an identifiable way, and the consent form contains contradictory and over-broad promises. Fix those P0 issues, then operationalise scoring, task practice, timing, door/wall coding and account reset. I found findings at all three priority levels.