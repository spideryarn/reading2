# A front door for people who have never seen this repo

**Status: in progress**, started 2026-09-06, alongside the licence work that landed in `6978e9b5`.

Everything here is downstream of the repo going public. The audit that preceded it
([the conversation that produced `LICENSE`](../../LICENSE)) asked whether it was *safe*; this asks
whether it is *usable* — by somebody who has read nothing, owns none of the history, and has landed
on a GitHub page.

Greg, 2026-09-06:

> Add a CONTRIBUTORS section. Basically say two things:
>
> - The easiest way to contribute is to use the "Feedback" button, and provide really
>   well-described bug-reports and/or feature requests. Those feed directly into the
>   product-building pipeline.
> - Something welcoming for people that want to contribute code, i.e. I'd love to work with
>   contributors. Invite them to contact me at hello@spideryarn.com , point them towards
>   setup-dev.md . If someone wants to submit a pull request, they have to also include the
>   prompts/conversation with their agents that helped them build it, so I can understand their
>   intent/approach.
>
> And improve setup-dev.md to make it easy for someone to follow to set things up. And write up a
> detailed tutorial in docs/tutorials/ with write-tutorial.md re the overall architecture, and
> signpost to that from README.md etc.

## The three pieces, and what each is for

| Piece | Audience | The question it answers |
|---|---|---|
| `README.md` § Contributing | somebody who wants to help and has not decided how | *what can I do, and what will you do with it?* |
| `docs/project/setup-dev.md` | somebody who has decided, and has an empty checkout | *how do I get it running before I lose interest?* |
| `docs/tutorials/architecture.html` | somebody who has it running | *how does this thing actually work?* |

## The one that needed a real decision: setup-dev.md

The doc is 556 lines and it is **good** — but it is written for an agent that already knows the
project, and it is organised by *subject* (secrets, models, stages, components) rather than by
*sequence*. A newcomer's first twenty minutes need six commands in order and a list of what to
install first; what they get today is the sentence "Everything here is one process and one terminal"
followed by a paragraph about a store flag that was deleted, then Postgres history, then the reason a
stopped database refuses to boot.

None of that is wrong and none of it should go. The move is **a quickstart at the top that stands
alone**, with prerequisites named (Node, Docker, an OpenRouter key), the commands in the order you
actually type them, and a "did it work?" check after each — then the existing document, unchanged,
as the depth beneath it.

**Rejected: a separate `QUICKSTART.md`.** Two files about starting the app is two files that drift,
and this repo has the postmortem for exactly that shape (`no-secrets-in-bundle`, two copies of one
rule, the other one shipping the bug the first had already fixed). One doc, ordered so the first
screen is the fast path.

## Stages

1. **`README.md` § Contributing**, and a thin `CONTRIBUTING.md` that GitHub surfaces at pull-request
   time pointing at it. The content lives in one place; the pointer exists because the
   agent-conversation rule is unusual and is only useful where somebody is about to open a PR.
2. **`setup-dev.md`** — the quickstart above.
3. **`docs/tutorials/architecture.html`**, per
   [write-tutorial.md](../reusable/write-tutorial.md), joining the two that already exist
   (`import-pipeline-and-database.html`, `revisions-and-the-schema.html`) — which are deep on one
   area each, and both assume the shape of the whole. This is the one that gives them that shape,
   and signposts down into them.
4. **Signposts** from `README.md` and `docs/project/architecture.md`.
5. **GPT Sol review**, then push.

## Questions and assumptions

- **"CONTRIBUTORS" read as "Contributing".** A `CONTRIBUTORS` file conventionally lists people who
  have contributed, and there are none yet; what Greg described is a *how to contribute* section.
  Written as `## Contributing`.
- **The README's "What exists today" is now false** — it opens *"no users, no accounts, one
  process"*, which predates auth (2026-08-27), the beta gate, Stripe (2026-09-03) and the paying
  readers. Left alone here rather than rewritten, because it is Greg's own prose in his own voice
  and the fix is his call. Flagged to him.
