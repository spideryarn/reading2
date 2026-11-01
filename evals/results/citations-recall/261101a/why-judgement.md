# Blind judgement of the `why` pairs (261101a)

The judge was an Opus subagent, 2026-11-01. It read only `why-pairs.json`, not `why-key.json`.
"better" is the side the judge preferred; "is" unblinds it with `why-key.json`. The judge's own
caveat: many whys state things the article says outside the citing passage, on both sides. These
were marked "not in passage", not wrong.

| id | better | is | reason | errors A | errors B |
|---|---|---|---|---|---|
| LeCun Bryson:1969 | B | haiku | Same claim, but B is plainer; A uses the jargon "Mode-2" | "Mode-2" not in passage | — |
| LeCun Miller:2016 | B | haiku | A ("Model for…") overstates "may be similar"; B is hedged and explains key-value lookup | overstates | — |
| LeCun Kahneman:2011 | A | haiku | "labels the paper borrows" fits "is similar to"; "Inspires" is stronger | — | slight overclaim |
| LeCun Kingma:2013 | B | haiku | Both right; B names the VAE and says how it limits information | — | — |
| Vaswani #1 | A | sonnet | A sticks to the passage | ("and decoder" not in passage) | "so training stays stable" not in passage |
| Vaswani #2 | tie | | Neither matches the passage; both are about additive attention | not in passage | not in passage |
| Vaswani #3 | B | sonnet | B ties the finding to the scaling factor, as the passage does | byte-pair encoding not in passage | — |
| Vaswani #4 | A | sonnet | B picks a task; by citation order [4] is reading comprehension | — | likely wrong task |
| Butlin Block:1995 | A | sonnet | Both fine; A's "fixing the report's topic" is apt | not in passage | same |
| Butlin Nagel:1974 | A | sonnet | B repeats the title for no gain | — | — |
| Butlin Schwitzgebel:2016 | A | haiku | A says the report follows the method; B is a fragment | — | — |
| Butlin Searle:1980 | B | sonnet | A opens with the title and editorialises; B is plain and accurate | — | — |
| C&C McClelland:1986 | tie | | Equivalent | — | — |
| C&C Clark:1989 | tie | | Equivalent | — | — |
| C&C Kirsh:1995 | tie | | Equivalent | — | — |
| C&C Hutchins:1995 | tie | | Both add "cognition spread across groups" | not in passage | not in passage |
| Dropout Nowlan:1992 | B | sonnet | A's "older ways" is not in the passage | "older" unsupported (minor) | — |
| Dropout Xiong:2011 | tie | | Same why; the splicing dataset is not in the passage | not in passage | not in passage |
| Dropout Salakhutdinov:2008 | A | haiku | A is plainer; B says "Bayesian model averaging" | — | — |
| Dropout Livnat:2010 | A | sonnet | A explains the idea; B is vaguer | — | — |
| Synesthesia #2 | tie | | Neither matches the passage; B is plainer | not in passage | not in passage |
| Synesthesia #3 | B | sonnet | B's "definition" matches the passage | "case material" unsupported | diagnostic criteria not in passage |
| Synesthesia #4 | tie | | Both rest on claims from outside the passage | not in passage | not in passage |
| Synesthesia #5 | A | sonnet | B describes the book, not what the article uses it for | — | summary, not a use |

Unblinded:

- **Preferred:** Sonnet 10, Haiku 6, ties 8.
- **Probable errors:** Sonnet 1 (Miller). Haiku 3 (Vaswani #4, Synesthesia #3 "case material",
  Synesthesia #5 summary).
- **Relevance clearly off:** Haiku 3: Xiong 0.9, Block 1.0, Nagel 0.8. Sonnet 1: Bahdanau 0.6.
- **Influence:** Haiku gave Livnat a confident 0.1 where null was safer.
