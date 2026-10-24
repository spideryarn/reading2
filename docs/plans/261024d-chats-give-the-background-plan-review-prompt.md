Review the plan docs/plans/261024d-chats-give-the-background-for-what-they-bring-in.md before it is built. Read-only: do not edit anything.

Read: the plan; src/chat-principles.ts; src/converse.ts around EXPLORE_SYSTEM (search "const EXPLORE_SYSTEM" and "THE WIDER WORLD"); tests/chat-principles.test.ts; docs/project/prompting-guide.md § What every conversation is for and § Measuring a prompt change; evals/chat-principles/run.ts; docs/investigations/261020g-chat-reading-so-far-measured.md. The conversation that prompted it is quoted in the plan.

Questions:
1. Is the proposed wording likely to fix the failure (named people/works/terms used with no who/what/why), and is it minimal? Would different wording be clearly better? Any conflict with other rules in the prompts that carry CHAT_PRINCIPLES (Chat, Learn/Recall, Explore, guide), e.g. length limits, Recall's hint/nudge structure, the guide's 60-word limit, or Learn's holding back an answer?
2. Is the Explore "sentence or two" edit needed and well-worded?
3. Is the measurement design sound enough to detect the effect and the risk (over-explaining/lecturing to experts, bloat)? What cases or judge wording would you change?
4. Anything else wrong.

Answer as numbered findings, each with severity (high/medium/low), the evidence (file:line), and the fix. Be concise.
