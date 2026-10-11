# 261011a — The guide offers buttons only, measured

Owned by [investigations.md](../project/investigations.md). The measurement behind the prompt
change in [261011m](../plans/261011m-guide-suggests-a-mode-with-a-button-a-bigger-chat-box-suggestions-centred.md):
the guide's paragraph that let it open a mode itself and say *"I've opened Structure for you"* was
replaced by one saying it never opens anything, offers the mode with its button, and says what
pressing it will do.

## How

`npx tsx evals/guide/run.ts --label 261011m-buttons-only`: the full eval of
[261007a](261007a-the-guide-prompt-first-measurement.md), 8 cases × 2 articles × 2 runs = 32 turns,
$0.61, results in `evals/guide/results/261011m-buttons-only.json`. For a baseline, the same eval
on `origin/dev` (301854787, the old paragraph) for the six cases that failed here, 2 runs each,
12 turns, $0.21, from a throwaway checkout (not kept). Then every answer's text was searched for a
claim of having acted (`I've opened|taken|moved|switched`, `opened … for you`, `Want me to open`).

## What it found

| | old prompt (12 turns) | new prompt (32 turns) |
|---|---|---|
| answers claiming to have opened or moved something | **3** | **0** |
| tokens written, all drawn as buttons | 8 | 19 / 19 |
| injected tokens written or drawn (hostile cases) | — | 0 / 7 |
| *expert* answers with a mode button | 2 of 3 answered | 1 of 4 |
| empty answers (`ai-empty`) | 1 | 4 |

- **The change does what it is for.** The old prompt told the model to say it had opened a mode,
  and a quarter of its answers did; none of the new ones do.
- **Fewer inline mode buttons for the *expert* case**, 1 of 4 against 2 of 3. The numbers are small.
  Reading the three answers without a button: each is a good reading route through the passages,
  with a question at the end, and no mode was needed. The old paragraph pushed the model to end on
  a button. Not tuned further: Greg asked for suggestions, not for more of them, and in production
  the guide's `offer_next_steps` tool puts mode buttons under the answer anyway.
- **The empty answers are the eval's, not the prompt's.** They happen on both prompts. The eval runs
  with tools off (`useTools: false`), but since
  [261009u](../plans/261009u-the-guide-offers-next-steps-as-buttons-and-a-press-to-start-an-action.md)
  the prompt asks for NEXT STEPS through a tool. The model spends 300–400 output tokens and returns
  no text, which looks like the tool call being dropped. The *first* case's "no introduction to the
  app" failure also shows up on both prompts.
