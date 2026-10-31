# Principles

**How we build.** Each one is short and general on purpose. The detail lives in the doc that owns
its area, which links here. **A new principle, or a change to one, needs Greg's yes first.**
Propose it plainly, with its wording, before writing it. Greg, 2026-10-27:

> Let's actually have a markdown file for enshrining things as principles. The key is they should
> be pretty minimal and pretty general, perhaps with some examples or nuance. … You have to get my
> permission for writing down a principle, and then you would write it in the right place as usual

The principles about *reading* stay in [vision.md § Principles](vision.md#principles), and so do
the two tiebreaks for building, [Prefer boring](vision.md#prefer-boring) and
[Simpler first](vision.md#simpler-first).

## 1. Improve forwards; backfill only when it is cheap or simpler

A change to a stage, a prompt or a stored field applies to new articles and new runs. By default we
don't re-run or re-import the articles already on the shelf, most of which have been read and
archived.

- **Backfill when it is cheap**: under about **$5** of model spend across everything, and touching
  nothing a reader made.
- **Backfill when keeping the old data working is the bigger burden.** One shape in the code beats
  two. If supporting old rows means a compatibility branch that every future change has to
  remember, convert the old rows and delete the branch.
- **Otherwise ask**, and only for something really valuable, with its cost.

Re-importing existing articles counts as a backfill, and so does applying a new step to them.
Being able to re-run a stage is not a reason to re-run it across the shelf
([architecture.md § Conventions](architecture.md#conventions)).

Greg, 2026-10-27:

> for the most part I really just care about improving things going forwards … if the complexity
> of maintaining the backwards compatibility outweighs the complexity of doing the re-import or the
> backfill, then we should definitely, basically we want to keep things simple … pick the better
> option … I'd rather do the effort up front to make things easier and smoother and more reliable
> and faster going forwards. … if it's small, we should always do it. If it's large, probably less
> often unless it's really, really valuable. Because I have loads of articles now that I've been
> reading but I've mostly archived, and I don't want to spend, you know, tens of dollars or
> whatever every time you add a new feature to reprocess everything.

The same default, said earlier. Greg, 2026-10-11: *"if we improve things, we're not going to go
back and rerun everything on all the existing articles because it's too much of a hassle and
expense. Instead we're almost always going to be content just to fix them going forwards unless I
explicitly say otherwise, or if it's really important it's okay to ask me, but otherwise just
default to this."* And 2026-10-18 (`spya-r8arjm`): *"assume that we're not going to re-import all
of the existing articles unless I explicitly ask you to, because that would be somewhat expensive
and probably a bit disruptive. So assume that we're just going to fix or improve things for new."*

## 2. Progressive disclosure: start clean, and always a way further

The first thing a reader meets is short and uncluttered; everything has more one press away: an
(i) saying what it is and how it was made, a More that opens the detail, the sources, and finally a
chat.

Greg asked for it in `spya-vqmfrs` (2026-10-30), and said yes to this wording on 2026-10-31
(`spya-dvq5b4`, answering [q-v03wmh](../user-feedback/questions/q-v03wmh.md)). The Sources digest
is built this way ([sources.md § Digest](sources.md#digest)).

## 3. Build a version, then ask in small pieces

When the right design is unclear, build the simplest good version for Greg to play with, and
alongside it show the alternatives as ASCII sketches, broken into several small questions he can
mix and match rather than one big A/B/C.

Greg asked for it in `spya-vqmfrs` (2026-10-30), and said yes to this wording on 2026-10-31
(`spya-dvq5b4`). How to ask is [ask-me-questions.md](../reusable/ask-me-questions.md).

---

Up: [vision.md](vision.md)
