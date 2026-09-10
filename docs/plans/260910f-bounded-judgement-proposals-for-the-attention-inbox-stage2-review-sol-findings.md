# Plan 260910f Stage 2 review findings

Review range: `261b4759..652b5a3d`

Conclusions are appended here as they are established.

## F15 — P2 — established: the three wire parsers do not preserve the quote-in-tail invariant

The model boundary correctly rejects a version-2 `asks` value that is not in the clipped tail, but the later checkpoint/server/browser parsers validate only that `asks` is non-blank. They do not compare it with the same item's prose `evidence.excerpt`. A checkpoint item whose excerpt is `Tell me which one.` and whose proposal says `asks: "This text is not in the excerpt."` is accepted by `parseAttention` as a normal `proposed` item; `AttentionPanel` then labels the invented text **“the sentence this proposal is about.”** The same omission is present in `tools/overseer/store.ts`, `tools/fleet/attention.ts`, and `tools/fleet/web/src/types.ts`. This contradicts the review guarantee that a quote absent from the tail is unreadable on every producer/consumer path.

- Input: a structurally valid prose item with `evidence.excerpt: "Tell me which one."` and `proposal.asks: "This text is not in the excerpt."`; the Node reproduction through the browser parser returned `kind:"list"` and server rendering printed the invented sentence as the proposal's quote.
- Smallest fix: after parsing both evidence and proposal, require every `proposed.asks` to be contained in the prose excerpt under the same whitespace normalisation as the producer; otherwise degrade the list to `unknown`. Put the shared cross-field assertion in each of the three intentionally independent boundary parsers and add one mismatched-quote test per parser.

## F16 — P2 — established: a syntactically “model” author can still render as Greg

Each wire parser accepts any non-blank `by.model`. Therefore `{by:{kind:"model", model:"Greg", via:"overseer"}}` crosses all boundaries and the card renders **“Proposal by Greg via the Overseer”**. The `kind:"model"` check prevents the exact `kind:"person"` fixture in the tests, but it does not preserve the rendered safety property that no proposal can be presented as Greg's. This does not arise from the current classifier response—the pass stamps the live constant and canonicalisation strips a model-written `by`—but it is an accepted persisted/wire input and so breaks the claimed boundary behavior.

- Input: the same valid prose item, with `recipient:"greg"` and `by:{kind:"model",model:"Greg",via:"overseer"}`; the browser parser accepted it and server rendering printed `Proposal by Greg via the Overseer · nothing has been sent`.
- Smallest fix: make the UI's fixed words carry the type, e.g. `Model proposal via the Overseer · model: ${model} · nothing has been sent` (and equivalent unplaced tooltip copy), so no model identifier can occupy the speaker slot. Pin the malformed-but-accepted string `Greg` in a render test. Validating a provider/model identifier at all three parsers is stricter but less future-compatible.

## F17 — P2 — established: `asks` can put the hidden 4,000-character tail back into the phone card

`parseRoute` checks only non-blankness and substring membership. It accepts both a one-character substring (`asks:"I"`) and the whole 4,000-character classifier tail. The card renders `asks` in full above the disclosure, with no length/line clamp. Thus the proposal can recreate the exact mobile failure the existing evidence disclosure was introduced to prevent: one inferred tail taking tens of wrapped lines and pushing every following card away. The prompt asks for a sentence, but neither the parse nor the render bounds that promise.

- Input: a version-2 question whose tail is one 4,000-character continuous sentence and whose `asks` is that entire tail; `parseVerdict` returned a cacheable `question` containing the full 4,000 characters. A second input with tail `I can proceed once you choose.` and `asks:"I"` was also accepted as the claimed sentence.
- Smallest fix: impose a documented maximum on `asks` at the model parse and all persisted/wire parsers (or collapse overlong quotes behind an explicit disclosure). A parser bound is smaller and keeps malformed output out of cache; add a longest-accepted/one-over test and a narrow-card render test for the chosen bound.

## F18 — P2 — reasoned: cached proposals lose the identity of the model that actually made them

`CachedVerdict` records fingerprint, time, prompt version and the verdict, but not the classifier model. On every later pass `proposalFor` constructs `by` from the **current** `ATTENTION_CLASSIFIER_MODEL`. Therefore, after a normal model change with prompt version 2 unchanged, an old cached proposal is attributed to the new model without a call. The cache survives process restarts and code upgrades, so this is not limited to a test seam. The same omission leaves the proposal id (`fingerprint:v2`) unchanged across the two authors. The present live compositions use the constant and are correctly attributed today; the failure appears when that constant changes (or any caller uses the already-supported `ClassifierOptions.model` override).

- Input/change: cache a successful version-2 verdict, then change `ATTENTION_CLASSIFIER_MODEL` while leaving `PROPOSAL_PROMPT_VERSION` at 2; the next unchanged pass makes zero calls and `proposalAuthor()` stamps the new model id onto the old verdict. Equivalently, the exported classifier accepts `options.model`, while the pass has no way to receive that identity and always stamps the constant.
- Smallest fix: make the classifier identity part of the cached judgement (producer-stamped beside the verdict) and use it for `by` and proposal identity, or define a single classifier-version key that includes both prompt and model and mechanically forces a bump when the model changes. The first option preserves truthful historical attribution without requiring a re-read.

## Verdict

**Accept Stage 2 with four P2 follow-ups.** I found no established P0 or P1, so this review does not refuse the candidate. F15–F17 are demonstrated boundary/rendering failures; F18 is a reasoned cache-attribution defect that appears on a classifier-model change.

## Guarantees checked

- **Default off:** with `OVERSEER_PROPOSALS` absent, production selects prompt version 1, the version-1 system prompt remains byte-pinned by its test, and every prose card gets `proposal:{kind:"off"}`. All non-visible proposal arms render `null`. A cached version-2 verdict is not drawn while version 1 is active.
- **Strict classifier route:** version 2 accepts only `sol | fable | greg | overseer | self` or the separate `unplaced` arm. An unknown recipient and an `asks` absent from the clipped tail produce `unreadable`, hence cannot be cached. There is no fallback or promotion to Greg.
- **Producer authority:** `canonicalVerdict` rebuilds the recognised verdict shape, so injected extra fields such as model-written `by` and `reach` do not reach memory. Beyond the question's `reason`, `asks`, `why`, and `topic`, the recognised model-written text fields that legitimately survive are `unplacedWhy` and the pre-existing nested `answerability.why`; recognised enum decisions also survive. No arbitrary extra field survives.
- **Live composition:** both the hand-run and daemon compositions default to `LIVE_SEAMS`; the production entry points call them without injected seams. The same selected prompt version is handed to classification and publication. I found no production caller supplying test seams.
- **Reach:** reach is absent from memory and is recomputed from the current checkpoint usage on every pass. Greg/self are available; a limited Claude reading makes Fable unavailable; unmeasured Sol/Overseer capability remains not-checked. No holder is substituted.
- **Nothing is sent:** proposal references terminate in parsing, grouping/publication, CLI description, and rendering. The card has no answer, approval, steering, or send action. Its stretched link still opens the originating session. For valid producer data, the Greg-recipient copy reads “Proposed: this one is yours” and separately attributes the proposal to Luna; it does not say Greg decided it. F16 records the accepted malformed attribution that can say otherwise.
- **Compatibility:** the new parsers map an absent proposal to `not-reported`; old parsers project their known item fields and ignore the additive proposal. Schema 2 reads schema 1, and the parent build rejects/rebuilds schema 2 rather than misreading it. Prompt-version disagreement yields a hidden `not-reached` proposal pending a bounded re-read, not a proposal under the wrong prompt.
- **Worst-case reservation:** `clipForClassifier` runs before prompt construction and parsing. At the 4,000-character tail cap, the computed version-2 bound is 25,291 prompt tokens versus version 1's 20,089; `WORST_CASE_PROMPT_TOKENS` selects the maximum and the request enforces a 1,000-token completion cap. Thus the token reservation covers the longest version-2 call. At the documented Luna rates used by this work, that bound is about $0.0063, below the $0.01 worst-case cost reservation.
- **Small-screen structure:** the quote stays above the original tail, while the tail remains behind its disclosure; `break-words` and viewport-bounded tooltip width prevent horizontal escape. F17 is the remaining vertical-size hole. This was checked statically and with server rendering, not with an interactive 390px browser run.

## Evidence and checks

- Reviewed the exact range `261b4759..652b5a3d`. The shared worktree later advanced to `1eeb59f`, so I rechecked that all core proposal implementation files are byte-unchanged from `652b5a3d`; later changes in the three large parser files do not touch their proposal types/parsers.
- Direct Node reproductions established F15–F17, including parser acceptance and rendered text. Separate source tracing established the production seam and no-send conclusions.
- Focused tests run during this review: 220/220 across seven files (`attention-classify`, `attention-pass`, `attention-memory`, `attention-cli`, the proposal panel, fleet attention, and overseer-store attention).
- Candidate's recorded scoped result: 1,060/1,060 across 20 files; typecheck exit 0.
- Candidate's recorded full suite: 22,143 passed, 4 failed, 39 skipped. All four failures require absent build artefacts (`api-dist/vercel.js` or the built fleet client); none exercises this change. The raw log is `logs/tmux-jobs/bj-s2-fullsuite-1935-617892.log`.
