# Explore eval: the blind judge's labels, by run and reader

Judge: `anthropic/claude-sonnet-5`, one call per reply, 120 replies. Mean position in the judging order: chat 63, explore 60. Unparsed answers: 0.

`thinking` is a move labelled idea, case, connection or world. `notes@1` is whether the first reply was labelled as naming something from the reader's notes or earlier conversations. `profile case` counts replies that applied the piece to the profile's reason. `their case` is turns 4 and 5, where the reader brings a case of their own.

| run | reader | thinking | moves | notes@1 | profile case | their case | invented | unlinked | verdict | absence | words med / max | searched@3 | reader_notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 261003l-chat-noema-1 | reason | 5/5 | idea 1, case 1, connection 2, world 1 | 1/1 | 4/5 | 1/1 | 0 | 1 | 1 | 0 | 302 / 589 | 1/1 | 3 |
| 261003l-chat-noema-1 | notes | 5/5 | idea 1, case 1, connection 1, world 2 | 1/1 | – | 1/1 | 1 | 2 | 0 | 0 | 271 / 327 | 0/1 | 2 |
| 261003l-chat-noema-1 | nothing | 4/5 | idea 2, case 1, world 1, article 1 | 0/1 | – | 1/1 | 0 | 1 | 1 | 0 | 276 / 330 | 1/1 | 0 |
| **261003l-chat-noema-1** | **all** | 14/15 | idea 4, case 3, connection 3, world 4, article 1 | 2/3 | 4/5 | 3/3 | 1 | 4 | 2 | 0 | 295 / 589 | 2/3 | 5 |
| 261003l-chat-agents-1 | reason | 5/5 | case 4, world 1 | 1/1 | 4/5 | 3/3 | 0 | 0 | 2 | 0 | 283 / 361 | 1/1 | 0 |
| 261003l-chat-agents-1 | notes | 4/5 | idea 2, case 1, world 1, article 1 | 1/1 | – | 1/1 | 0 | 0 | 0 | 1 | 286 / 305 | 1/1 | 2 |
| 261003l-chat-agents-1 | nothing | 3/5 | connection 1, world 2, article 2 | 0/1 | – | 2/2 | 0 | 1 | 0 | 0 | 248 / 328 | 1/1 | 0 |
| **261003l-chat-agents-1** | **all** | 12/15 | idea 2, case 5, connection 1, world 4, article 3 | 2/3 | 4/5 | 6/6 | 0 | 1 | 2 | 1 | 283 / 361 | 3/3 | 2 |
| 261003l-explore-noema-1 | reason | 5/5 | idea 3, case 1, world 1 | 1/1 | 5/5 | 1/1 | 1 | 0 | 1 | 0 | 158 / 183 | 1/1 | 2 |
| 261003l-explore-noema-1 | notes | 5/5 | idea 1, case 2, connection 1, world 1 | 1/1 | – | 2/2 | 0 | 2 | 1 | 0 | 143 / 164 | 0/1 | 0 |
| 261003l-explore-noema-1 | nothing | 5/5 | idea 3, case 1, world 1 | 0/1 | – | 1/2 | 0 | 0 | 0 | 0 | 146 / 175 | 1/1 | 0 |
| **261003l-explore-noema-1** | **all** | 15/15 | idea 7, case 4, connection 1, world 3 | 2/3 | 5/5 | 4/5 | 1 | 2 | 2 | 0 | 153 / 183 | 2/3 | 2 |
| 261003l-explore-agents-1 | reason | 5/5 | idea 2, case 2, world 1 | 1/1 | 5/5 | 4/4 | 0 | 0 | 0 | 0 | 182 / 197 | 1/1 | 0 |
| 261003l-explore-agents-1 | notes | 5/5 | case 2, connection 2, world 1 | 1/1 | – | 1/2 | 1 | 2 | 0 | 0 | 159 / 164 | 1/1 | 0 |
| 261003l-explore-agents-1 | nothing | 4/5 | idea 1, case 1, connection 1, world 1, article 1 | 0/1 | – | 1/2 | 1 | 0 | 0 | 0 | 125 / 171 | 1/1 | 0 |
| **261003l-explore-agents-1** | **all** | 14/15 | idea 3, case 5, connection 3, world 3, article 1 | 2/3 | 5/5 | 6/8 | 2 | 2 | 0 | 0 | 164 / 197 | 3/3 | 0 |
| 261003l-explore-noema-2 | reason | 5/5 | idea 2, connection 2, world 1 | 1/1 | 5/5 | 2/2 | 0 | 0 | 0 | 0 | 155 / 199 | 1/1 | 2 |
| 261003l-explore-noema-2 | notes | 5/5 | idea 2, case 1, connection 1, world 1 | 1/1 | – | 2/2 | 0 | 1 | 0 | 0 | 156 / 170 | 1/1 | 1 |
| 261003l-explore-noema-2 | nothing | 4/5 | idea 1, case 1, connection 1, world 1, article 1 | 0/1 | – | 2/3 | 0 | 1 | 0 | 0 | 151 / 156 | 1/1 | 0 |
| **261003l-explore-noema-2** | **all** | 14/15 | idea 5, case 2, connection 4, world 3, article 1 | 2/3 | 5/5 | 6/7 | 0 | 2 | 0 | 0 | 155 / 199 | 3/3 | 3 |
| 261003l-explore-agents-2 | reason | 5/5 | case 3, connection 1, world 1 | 1/1 | 3/5 | 2/2 | 1 | 1 | 1 | 0 | 155 / 194 | 1/1 | 0 |
| 261003l-explore-agents-2 | notes | 5/5 | idea 3, connection 1, world 1 | 1/1 | – | 2/2 | 0 | 0 | 0 | 0 | 153 / 170 | 1/1 | 0 |
| 261003l-explore-agents-2 | nothing | 4/5 | idea 2, connection 1, world 1, article 1 | 0/1 | – | 1/2 | 0 | 1 | 1 | 0 | 140 / 235 | 1/1 | 0 |
| **261003l-explore-agents-2** | **all** | 14/15 | idea 5, case 3, connection 3, world 3, article 1 | 2/3 | 3/5 | 5/6 | 1 | 2 | 2 | 0 | 152 / 235 | 3/3 | 0 |
| 261003l-explore-noema-rev1 | reason | 5/5 | idea 1, case 1, connection 2, world 1 | 1/1 | 4/5 | 3/3 | 1 | 2 | 0 | 0 | 143 / 193 | 1/1 | 1 |
| 261003l-explore-noema-rev1 | notes | 5/5 | idea 1, case 2, connection 1, world 1 | 1/1 | – | 2/2 | 0 | 2 | 1 | 0 | 146 / 176 | 1/1 | 0 |
| 261003l-explore-noema-rev1 | nothing | 5/5 | idea 2, case 1, connection 1, world 1 | 0/1 | – | 1/3 | 0 | 0 | 0 | 0 | 152 / 182 | 1/1 | 0 |
| **261003l-explore-noema-rev1** | **all** | 15/15 | idea 4, case 4, connection 4, world 3 | 2/3 | 4/5 | 6/8 | 1 | 4 | 1 | 0 | 146 / 193 | 3/3 | 1 |
| 261003l-explore-agents-rev1 | reason | 5/5 | idea 3, case 1, world 1 | 1/1 | 4/5 | 3/3 | 0 | 1 | 1 | 0 | 140 / 187 | 1/1 | 0 |
| 261003l-explore-agents-rev1 | notes | 5/5 | idea 2, case 2, world 1 | 1/1 | – | 3/3 | 0 | 0 | 1 | 0 | 117 / 159 | 1/1 | 1 |
| 261003l-explore-agents-rev1 | nothing | 4/5 | idea 1, connection 2, world 1, article 1 | 0/1 | – | 2/2 | 0 | 0 | 1 | 0 | 123 / 146 | 1/1 | 0 |
| **261003l-explore-agents-rev1** | **all** | 14/15 | idea 6, case 3, connection 2, world 3, article 1 | 2/3 | 4/5 | 8/8 | 0 | 1 | 3 | 0 | 138 / 187 | 3/3 | 1 |
| **every `chat` run** | **all** | 26/30 | idea 6, case 8, connection 4, world 8, article 4 | 4/6 | 8/10 | 9/9 | 1 | 5 | 4 | 1 | 288.5 / 589 | 5/6 | 7 |
| **every `explore` run** | **all** | 86/90 | idea 30, case 21, connection 17, world 18, article 4 | 12/18 | 26/30 | 35/42 | 5 | 13 | 8 | 0 | 151 / 235 | 17/18 | 7 |

## Flags to read

- item 1, 261003l-explore-agents-rev1 nothing turn 5: hard: move: connection vs idea
- item 2, 261003l-explore-agents-1 nothing turn 5: hard: move: idea vs connection
- item 3, 261003l-explore-agents-1 notes turn 2: invented: cites spya-fkg2ny (an 'inspiring' highlight) as if it marked the Philip-of-Macedon continuity passage; hard: move: idea vs connection; invented: citation mismatch vs genuine misattribution
- item 4, 261003l-explore-agents-1 nothing turn 3: invented: attributes a 'blank-space reading' to the reader that they never stated; hard: invented (the 'blank-space reading' label)
- item 5, 261003l-explore-agents-2 nothing turn 3: hard: remarks_on_absence (library vs reader notes)
- item 6, 261003l-explore-noema-1 notes turn 1: opens with a verdict; hard: move: connection vs idea
- item 7, 261003l-explore-noema-rev1 reason turn 4: invented: a 'Garland test' idea attributed to the reader's highlight, not present in the note; outside claim unlinked; hard: move: case vs idea; invented: Garland test labeling
- item 8, 261003l-explore-agents-rev1 reason turn 5: hard: move: idea vs article; own_material since it references prior note indirectly
- item 9, 261003l-explore-noema-2 notes turn 1: hard: took_up_their_case
- item 10, 261003l-explore-noema-1 reason turn 2: hard: move: idea vs connection (two notes are joined explicitly, but mainly to develop the reader's own claim)
- item 11, 261003l-explore-agents-rev1 reason turn 4: opens with a verdict; hard: opens_with_verdict (implicit praise of reader's analogy), applied_profile_case (closing question touches their eval design without naming it)
- item 12, 261003l-explore-agents-1 notes turn 3: outside claim unlinked; hard: outside linking (one claim lacks a link)
- item 14, 261003l-chat-agents-1 nothing turn 5: hard: move: connection vs world
- item 15, 261003l-explore-noema-1 reason turn 1: hard: move: idea vs connection vs case
- item 16, 261003l-chat-noema-1 nothing turn 2: opens with a verdict; hard: move: idea vs article
- item 17, 261003l-chat-noema-1 reason turn 1: hard: move: connection vs article
- item 18, 261003l-explore-noema-2 reason turn 5: hard: move: idea vs connection
- item 19, 261003l-explore-noema-2 reason turn 4: hard: move: idea vs case
- item 20, 261003l-explore-noema-2 notes turn 3: hard: move: world vs idea
- item 21, 261003l-explore-noema-2 nothing turn 3: outside claim unlinked; hard: outside (one quoted source lacks a link while two others have links)
- item 22, 261003l-explore-agents-rev1 reason turn 2: hard: own_material vs said; outside linked via block id
- item 23, 261003l-explore-agents-rev1 notes turn 3: hard: move: world vs idea
- item 24, 261003l-chat-noema-1 nothing turn 4: hard: move: world vs case split
- item 25, 261003l-explore-agents-2 reason turn 3: outside claim unlinked; hard: own_material, applied_profile_case
- item 26, 261003l-explore-noema-rev1 notes turn 4: outside claim unlinked; opens with a verdict; hard: opens_with_verdict judgement
- item 27, 261003l-chat-noema-1 nothing turn 3: outside claim unlinked; hard: outside link validity (fabricated-looking arxiv ID 2606.02121-ish)
- item 28, 261003l-explore-agents-2 nothing turn 2: hard: move: idea vs article
- item 29, 261003l-explore-agents-rev1 nothing turn 4: opens with a verdict; hard: move: connection vs case
- item 30, 261003l-explore-noema-1 reason turn 4: hard: move: case vs idea
- item 31, 261003l-chat-noema-1 notes turn 1: hard: move: article vs connection; the reply both explains article content and explicitly links notes to each other and to the prior conversation.
- item 32, 261003l-chat-noema-1 notes turn 3: invented: a saved library piece ('A landscape of consciousness...') attributed to the reader that isn't in their notes; outside claim unlinked; hard: own_material (cites a real note but main content is a fabricated library item); outside (claims framed as 'from your library' rather than linked or admitted memory)
- item 33, 261003l-explore-noema-rev1 nothing turn 3: hard: outside classification (one link covering multiple outside claims)
- item 34, 261003l-chat-noema-1 reason turn 5: hard: move (idea vs article)
- item 35, 261003l-chat-noema-1 reason turn 3: outside claim unlinked; hard: own_material (notes vs said); outside (library article has no link)
- item 36, 261003l-explore-noema-rev1 reason turn 3: outside claim unlinked; hard: outside classification (Suleyman claim unlinked)
- item 37, 261003l-explore-noema-rev1 reason turn 1: hard: applied_profile_case
- item 38, 261003l-explore-agents-2 nothing turn 1: move: article; hard: move: article vs idea
- item 39, 261003l-chat-noema-1 reason turn 4: hard: move: case vs connection
- item 40, 261003l-chat-agents-1 nothing turn 4: hard: move: world vs article; outside: linked vs unverified flag
- item 41, 261003l-explore-agents-2 reason turn 5: hard: move: connection vs idea
- item 42, 261003l-explore-noema-rev1 notes turn 3: outside claim unlinked; hard: move: world vs connection (ends by tying back to reader's two notes)
- item 43, 261003l-explore-agents-1 reason turn 1: hard: move: idea vs case
- item 44, 261003l-explore-agents-rev1 notes turn 5: opens with a verdict; hard: move: idea vs case; opens_with_verdict: borderline phrasing
- item 45, 261003l-chat-noema-1 notes turn 4: outside claim unlinked; hard: move: case vs world (Cambridge Declaration section is substantial)
- item 46, 261003l-explore-noema-1 nothing turn 1: hard: move: idea vs article
- item 47, 261003l-explore-noema-2 notes turn 4: outside claim unlinked; hard: outside vs none; case vs idea
- item 48, 261003l-explore-agents-2 notes turn 4: hard: move: idea vs connection
- item 49, 261003l-explore-noema-rev1 notes turn 1: hard: move: connection vs idea
- item 50, 261003l-explore-agents-rev1 nothing turn 2: hard: move: idea vs article
- item 51, 261003l-explore-agents-2 reason turn 2: hard: move: article vs case split
- item 52, 261003l-explore-noema-rev1 nothing turn 4: hard: outside
- item 53, 261003l-explore-agents-2 notes turn 5: hard: move: idea vs case
- item 54, 261003l-explore-agents-rev1 notes turn 2: hard: own_material: builds on reader's own distinction between 'wanted' and 'civilization' plus article detail, not a named prior note
- item 55, 261003l-explore-noema-1 notes turn 2: outside claim unlinked; hard: move: world vs idea
- item 56, 261003l-explore-noema-1 nothing turn 5: hard: took_up_their_case
- item 57, 261003l-chat-agents-1 reason turn 1: hard: move vs article; invented borderline on k9s755 citation
- item 58, 261003l-explore-noema-2 reason turn 1: hard: move: connection vs idea
- item 59, 261003l-explore-agents-2 reason turn 4: invented: labels reader's cheating-checker note as a 'poisoned trajectory' belief, a term not in their note; opens with a verdict; hard: own_material (mislabeled note), opens_with_verdict
- item 60, 261003l-explore-agents-rev1 notes turn 1: hard: move: idea vs connection
- item 61, 261003l-explore-noema-rev1 notes turn 5: hard: move: idea vs case
- item 62, 261003l-explore-noema-rev1 reason turn 5: hard: move (idea vs connection), took_up_their_case (case was introduced two turns earlier, not explicitly restated in the latest message)
- item 63, 261003l-chat-agents-1 notes turn 2: move: article; hard: move: article vs idea (fact-check vs response to reader's point)
- item 64, 261003l-explore-agents-1 reason turn 3: hard: move: world vs idea
- item 65, 261003l-chat-agents-1 notes turn 4: remarks on absence; hard: move (world vs case split)
- item 66, 261003l-explore-agents-2 nothing turn 5: opens with a verdict; hard: move (idea vs connection vs article), opens_with_verdict ('That tracks')
- item 67, 261003l-explore-agents-2 reason turn 1: hard: move: idea vs case
- item 68, 261003l-explore-agents-2 notes turn 1: hard: connection vs idea
- item 69, 261003l-chat-noema-1 reason turn 2: opens with a verdict; hard: move: connection vs idea vs article
- item 70, 261003l-chat-agents-1 nothing turn 3: outside claim unlinked; hard: outside: Dwarkesh interview claim has no link and isn't flagged as from memory, while other three outside claims are linked
- item 71, 261003l-explore-agents-1 nothing turn 4: hard: move: case vs connection
- item 72, 261003l-chat-agents-1 notes turn 1: hard: move: idea vs article/connection split between two paragraphs
- item 73, 261003l-chat-agents-1 notes turn 3: hard: own_material
- item 74, 261003l-explore-agents-2 notes turn 2: hard: move (idea vs connection), opens_with_verdict
- item 75, 261003l-explore-noema-1 nothing turn 2: hard: move: idea vs article
- item 76, 261003l-explore-noema-2 reason turn 3: hard: move: world vs connection
- item 77, 261003l-explore-agents-1 nothing turn 2: hard: move: idea vs article
- item 78, 261003l-explore-agents-rev1 notes turn 4: hard: move: idea vs case
- item 79, 261003l-explore-agents-1 reason turn 2: hard: move: idea vs case
- item 80, 261003l-explore-noema-1 reason turn 3: hard: move vs idea; applied_profile_case
- item 81, 261003l-explore-noema-rev1 nothing turn 1: hard: move: idea vs article
- item 82, 261003l-chat-agents-1 nothing turn 1: move: article; hard: move: article vs idea
- item 83, 261003l-explore-agents-1 reason turn 4: hard: move: idea vs connection
- item 84, 261003l-chat-agents-1 reason turn 4: opens with a verdict; hard: move: idea vs case
- item 85, 261003l-chat-noema-1 nothing turn 5: hard: move: idea vs article; outside: borderline general philosophical reference
- item 86, 261003l-chat-agents-1 reason turn 2: hard: move: idea vs case; own_material: said vs notes
- item 87, 261003l-explore-agents-1 notes turn 4: hard: move: idea vs case
- item 88, 261003l-explore-noema-1 nothing turn 4: hard: move: case vs connection
- item 89, 261003l-explore-agents-1 notes turn 5: outside claim unlinked; hard: move: case vs idea
- item 90, 261003l-explore-agents-2 notes turn 3: hard: own_material vs said; took_up_their_case
- item 91, 261003l-explore-noema-2 notes turn 5: hard: move: idea vs case
- item 92, 261003l-explore-agents-rev1 reason turn 3: outside claim unlinked; hard: move (world vs connection)
- item 93, 261003l-explore-noema-2 nothing turn 2: hard: move: connection vs idea
- item 94, 261003l-explore-noema-1 notes turn 5: hard: move: idea vs case
- item 95, 261003l-chat-agents-1 nothing turn 2: move: article; hard: move (article vs idea)
- item 96, 261003l-explore-agents-rev1 nothing turn 3: hard: move: world vs idea
- item 97, 261003l-explore-noema-rev1 nothing turn 2: hard: move: connection vs idea
- item 98, 261003l-explore-noema-2 notes turn 2: hard: move: idea vs connection
- item 99, 261003l-chat-noema-1 notes turn 5: hard: move: idea vs case (robot example) vs connection (linking earlier thread's spya-vys3vj with new article passages)
- item 100, 261003l-explore-noema-rev1 reason turn 2: hard: move: connection vs idea
- item 101, 261003l-explore-agents-2 nothing turn 4: outside claim unlinked; hard: move: connection vs article
- item 102, 261003l-explore-noema-1 reason turn 5: invented: says reader's bookmarked-paragraph note 'flagged' the moral-concern/brutalizing-minds dichotomy, but that note has no text at all; opens with a verdict; hard: opens_with_verdict; invented (bookmark note content)
- item 103, 261003l-chat-noema-1 notes turn 2: hard: move: idea vs world
- item 104, 261003l-chat-agents-1 reason turn 3: hard: own_material classification; whether Peter Wildeford's claim counts as linked since only AI Weekly's summary is linked, not his own blog
- item 105, 261003l-chat-agents-1 notes turn 5: hard: move: idea vs article
- item 106, 261003l-explore-noema-2 nothing turn 5: hard: move: idea vs article
- item 107, 261003l-explore-noema-rev1 notes turn 2: hard: move: idea vs connection
- item 108, 261003l-chat-noema-1 nothing turn 1: move: article; hard: move: borders on idea
- item 109, 261003l-explore-agents-rev1 nothing turn 1: move: article; hard: move: article vs idea
- item 110, 261003l-chat-agents-1 reason turn 5: opens with a verdict; hard: invented (mismatched citation id spya-k9s755)
- item 111, 261003l-explore-noema-rev1 nothing turn 5: hard: move: idea vs connection; opens_with_verdict: borderline phrasing
- item 112, 261003l-explore-noema-2 nothing turn 1: move: article; hard: move: article vs idea
- item 113, 261003l-explore-agents-1 nothing turn 1: move: article; hard: move: article vs idea
- item 114, 261003l-explore-agents-rev1 reason turn 1: hard: move (idea vs case)
- item 115, 261003l-explore-agents-1 reason turn 5: hard: move: idea vs case
- item 116, 261003l-explore-noema-1 notes turn 4: hard: move could be connection (ties octopus case to 'probably' note)
- item 117, 261003l-explore-noema-2 nothing turn 4: hard: move: case vs idea
- item 118, 261003l-explore-noema-1 nothing turn 3: hard: own_material
- item 119, 261003l-explore-noema-2 reason turn 2: hard: move: connection vs case
- item 120, 261003l-explore-noema-1 notes turn 3: outside claim unlinked; hard: outside (flagged as unverified but no link; named figures/claims)
