---
id: q-xh4y0s
report: spya-j4sg9g
status: answered
asked: 2026-10-10
title: May an unattended agent build A, the script that writes agents' questions into the database?
refs: follows q-rstqvz (replies spya-qnak8d, spya-b3qx08, spya-ybbudu) · qi-dr9nnvjm · docs/plans/261009f-agent-questions-and-replies-in-the-database.md · docs/project/security-risks.md R1 · SPIDERYARN-READING2-GE
acted: spya-k09dpp
---
You chose A three times: agents write their questions and replies into the live database through one script. Nothing is built yet, because building it changes a listed security rule (no agent writes to the live database), and our rules say an agent working with nobody watching may not change a security rule on the strength of a reply alone. So the question is not which option, but who may build it.

A. Yes: the Overseer may give this build to an unattended agent now. One script for asking, replying and closing, the AGENTS.md rule kept with this as its one stated exception, and GPT Sol reviewing the plan and the code. It goes out with the next deploy as usual. Gives up: you will not watch it being built.

B. No: I will start it myself, in a session I am watching, when I am back at a computer. Nothing happens until then, and questions keep reaching you only after a deploy.

Recommended: A. The risk is already written down as R1 in the security-risks register, the design is reviewed, and the rule the agents follow is the only thing being relaxed, through one script.

Details

Why you kept seeing this. Your first reply to q-rstqvz (A, with the risk written down) was acted on: the security-risks register now lists it as R1, and a security review added its findings there. Your second reply (A, a script rather than bespoke queries, the AGENTS.md rule kept with this as the exception) was added to the held build, queue item qi-dr9nnvjm. Your third reply (A) arrived on 9 October at 23:45. All three are recorded. The question stayed open because the agent that answered it decided it should stay open until A was built, and so it kept appearing under Needs a decision with nothing left for you to choose. That question is now closed, and this one asks the thing that is actually blocking.

The rule in question. feedback-reports.md says an admin's reply is trusted, but an unattended run still may not edit a defence, which is anything in security-map.md's list of where the defences live. "No agent writes to the live database" is on that list. Your answer here is what the build is waiting for: with A, the Overseer may dispatch qi-dr9nnvjm; with B, it waits for you.

## Greg's answer, 2026-10-10 (in the Feedback dialog, reply `spya-k09dpp`)

> A

Settled: A, an unattended agent may build it. Recorded on queue item qi-dr9nnvjm, which was held for exactly this permission. Marking an item ready and authorising it are yours alone in the queue, so it goes out once you run: overseer-queue.ts edit qi-dr9nnvjm --by greg --ready, then authorize qi-dr9nnvjm --by greg. (Feedback sweep, 2026-10-10.)
