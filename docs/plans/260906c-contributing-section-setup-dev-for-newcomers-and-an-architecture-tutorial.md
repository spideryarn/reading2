# A front door for people who have never seen this repo

**Status: done.** All three pieces are on `dev` — `4a402663` (Contributing, the quickstart, the
signposts), `1ae2e710` (the tutorial), `232ed732` (a postmortem for a gap the work exposed), after
`6978e9b5` (the licence). What is left is two decisions for Greg, in *Left for Greg* at the bottom;
none of it is unfinished work.

**Started** 2026-09-06, alongside the licence work in `6978e9b5`.

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

## What actually happened

**The quickstart was the piece that mattered, and my first version of it did not work.** That is the
one finding worth carrying: I wrote an ordering that reads correctly, and GPT Sol caught that
`db:seed-owner` reads `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_PUBLISHABLE_KEY`
([`scripts/db-seed-owner.ts`](../../scripts/db-seed-owner.ts) lines 63–64 and 148), both blank in a
freshly copied `.env.example`. So `npm run setup` starts the database, applies the migrations, and
stops — the keys do not exist until the stack is up, and `setup` is what brings it up. The stack now
goes up first and the chicken-and-egg is the first thing the section says.

I could not have found that by reading, and did not: the doc I was improving had never been run from
an empty checkout either.

**Both reviews earned their cost.** Sol returned twelve findings on the tutorial, all applied, and
the ones that mattered were confident wrong claims rather than omissions — sanitising attributed to
stage 2 when it happens inside `blocks` (a security boundary, and naming the wrong owner is how
somebody later removes it); "every request goes through the gate with exactly one bypass" when there
are four, contradicting the page's own diagram; publication described as a pipeline step. The browser
pass found three faults in one diagram that are invisible in the markup. I had already caught four
wrong counts myself, which is why every number in the tutorial's appendix is printed beside the
command that produced it.

**The scope grew twice, both times correctly.** The README's "Running it" turned out to be not merely
stale but unrunnable, and its "no users, no accounts, one process" opening was false — both raised by
the repo-tidying session and both fixed here. And the two existing tutorials were signposted from
nowhere at all, so the README gained a table naming all three.

## What this exposed, and who took it

- **A reference committed before its referent**, written up as
  [260906d](../postmortems/260906d-a-signpost-committed-before-the-thing-it-points-at.md). I turned
  `dev` red for thirteen minutes by landing the `architecture.md` signpost before the tutorial. The
  finding is not the slip: the identical defect hit `README.md` → the same tutorial in the same hour
  and was **silent**, because the root `README.md` is in no link-checking set.
- **`DOC_FILES` does not cover the root `README.md` or `CONTRIBUTING.md`.** Taken by the
  repo-tidying session, proved by breaking a link first. Not mine; do not duplicate it.

## Left for Greg

1. **The Kuhn fixture.** `evals/pdf/titles/kuhn-landscape-of-consciousness/` carries an ND clause,
   and attribution is not what that clause asks for — so it is a different question from the one
   settled on 2026-09-06 about the other two corpora. It is also more than one PDF: six
   `records-*.json` hold roughly 9,800 words of the paper's prose, `tests/pdf-figure-read.test.ts`
   reads it inside `npm test`, and the commits are on `main`, so a working-tree removal does not
   remove it from history. Suggested swap: any CC-BY open-access Elsevier paper, since the fixture
   exists for the page-1 template rather than for that paper.
2. **Four stale counts in `docs/project/`**, found while writing the tutorial and deliberately not
   fixed: [architecture.md](../project/architecture.md) says *"ten of the fourteen"* steps cache
   (11 of 15) and its stage-ownership table stops at 5f; [ai-gateway.md](../project/ai-gateway.md)
   says *"the seven pipeline stages"* (ten steps call `streamMessage`);
   [database.md](../project/database.md) says *"27 migrations"* and eighteen tables (79 and 29).
   `architecture.md` is an entry-point doc, so this is an approval rather than a drive-by.
