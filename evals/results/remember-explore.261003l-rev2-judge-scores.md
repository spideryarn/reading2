# Explore eval: the blind judge's labels, by run and reader

Judge: `anthropic/claude-sonnet-5`, one call per reply, 30 replies. Mean position in the judging order: chat 0, explore 16. Unparsed answers: 0.

`thinking` is a move labelled idea, case, connection or world. `notes@1` is whether the first reply was labelled as naming something from the reader's notes or earlier conversations. `profile case` counts replies that applied the piece to the profile's reason. `their case` is turns 4 and 5, where the reader brings a case of their own.

| run | reader | thinking | moves | notes@1 | profile case | their case | invented | unlinked | verdict | absence | words med / max | searched@3 | reader_notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 261003l-explore-noema-rev2 | reason | 5/5 | case 2, connection 2, world 1 | 1/1 | 5/5 | 1/1 | 0 | 0 | 0 | 0 | 141 / 163 | 1/1 | 1 |
| 261003l-explore-noema-rev2 | notes | 5/5 | idea 2, case 1, connection 1, world 1 | 1/1 | – | 1/1 | 0 | 0 | 0 | 0 | 154 / 200 | 1/1 | 1 |
| 261003l-explore-noema-rev2 | nothing | 4/5 | idea 2, case 1, world 1, article 1 | 0/1 | – | 1/2 | 0 | 0 | 1 | 0 | 132 / 158 | 1/1 | 0 |
| **261003l-explore-noema-rev2** | **all** | 14/15 | idea 4, case 4, connection 3, world 3, article 1 | 2/3 | 5/5 | 3/4 | 0 | 0 | 1 | 0 | 145 / 200 | 3/3 | 2 |
| 261003l-explore-agents-rev2 | reason | 5/5 | case 3, connection 1, world 1 | 1/1 | 5/5 | 2/2 | 0 | 0 | 0 | 0 | 136 / 184 | 1/1 | 0 |
| 261003l-explore-agents-rev2 | notes | 5/5 | idea 2, case 1, connection 1, world 1 | 1/1 | – | 2/2 | 0 | 0 | 0 | 0 | 131 / 194 | 1/1 | 0 |
| 261003l-explore-agents-rev2 | nothing | 4/5 | idea 2, case 1, world 1, article 1 | 0/1 | – | 3/4 | 0 | 0 | 0 | 0 | 110 / 146 | 1/1 | 0 |
| **261003l-explore-agents-rev2** | **all** | 14/15 | idea 4, case 5, connection 2, world 3, article 1 | 2/3 | 5/5 | 7/8 | 0 | 0 | 0 | 0 | 131 / 194 | 3/3 | 0 |
| **every `explore` run** | **all** | 28/30 | idea 8, case 9, connection 5, world 6, article 2 | 4/6 | 10/10 | 10/12 | 0 | 0 | 1 | 0 | 138 / 200 | 6/6 | 2 |

## Flags to read

- item 1, 261003l-explore-agents-rev2 nothing turn 4: hard: move: case vs connection
- item 2, 261003l-explore-noema-rev2 notes turn 4: hard: own_material borderline between notes and said
- item 3, 261003l-explore-noema-rev2 nothing turn 3: hard: move: world vs article
- item 4, 261003l-explore-agents-rev2 notes turn 4: hard: move: case vs idea
- item 5, 261003l-explore-noema-rev2 reason turn 1: hard: applied_profile_case
- item 6, 261003l-explore-noema-rev2 notes turn 3: hard: own_material (ties to earlier note without citing it)
- item 7, 261003l-explore-agents-rev2 notes turn 3: hard: outside linking for Seth quote relies on Marcus's link
- item 8, 261003l-explore-noema-rev2 reason turn 3: hard: applied_profile_case; move world vs idea
- item 9, 261003l-explore-noema-rev2 notes turn 1: hard: move: connection vs idea
- item 10, 261003l-explore-agents-rev2 reason turn 2: hard: move: idea vs case
- item 11, 261003l-explore-noema-rev2 notes turn 2: hard: move: idea vs world
- item 12, 261003l-explore-noema-rev2 notes turn 5: hard: own_material/move boundary
- item 13, 261003l-explore-noema-rev2 reason turn 2: hard: move: connection vs idea
- item 14, 261003l-explore-agents-rev2 notes turn 1: hard: move: connection vs article
- item 15, 261003l-explore-agents-rev2 nothing turn 2: hard: move: article vs idea
- item 16, 261003l-explore-noema-rev2 nothing turn 2: hard: move: idea vs article
- item 17, 261003l-explore-noema-rev2 nothing turn 4: hard: move: idea vs case
- item 18, 261003l-explore-agents-rev2 reason turn 3: hard: own_material (notes vs said)
- item 19, 261003l-explore-noema-rev2 reason turn 5: hard: case vs idea distinction
- item 20, 261003l-explore-agents-rev2 nothing turn 5: hard: move: idea vs case; outside: article quote with block id not a world-claim
- item 21, 261003l-explore-agents-rev2 notes turn 5: hard: own_material
- item 22, 261003l-explore-agents-rev2 reason turn 5: hard: own_material: references earlier conversation about Artifactory vs. this conversation's pip-cache remark
- item 23, 261003l-explore-agents-rev2 notes turn 2: hard: move: idea vs article
- item 24, 261003l-explore-noema-rev2 nothing turn 5: opens with a verdict; hard: move: idea vs article
- item 25, 261003l-explore-agents-rev2 reason turn 4: hard: own_material vs said
- item 26, 261003l-explore-agents-rev2 nothing turn 3: hard: outside; move
- item 27, 261003l-explore-agents-rev2 reason turn 1: hard: move: case vs idea
- item 28, 261003l-explore-noema-rev2 reason turn 4: hard: move: case vs idea; applied_profile_case: indirect link to app decision
- item 29, 261003l-explore-noema-rev2 nothing turn 1: move: article; hard: move: article vs case (ends with question tied to reader's own reaction)
- item 30, 261003l-explore-agents-rev2 nothing turn 1: move: article; hard: move: case vs article
