---
reports: spya-esua8w, spya-pexkj4
ending: shipped
---
# Ask why you are reading, and a Trajectory for that intent

SPIDERYARN-READING2-60, from Greg (admin, verified by account id), on `nihms-536461-spya-nr87dn`. The
time in the file name is when this session received the report; it runs on a pool account and could
not read Sentry.

> So the feedback I keep getting is that people want to come with an intent and perhaps a
> background, but a specific focused intent for what they want to get from the paper. So we
> definitely do want to ask people that, you know, why are you reading this in a prompt when they
> first open it. And then, so the follow-up idea to that is maybe, so they can already use the
> semantic search, but maybe they could also, maybe there'd be a way to create custom trajectories.
> So there'd be a search box in the trajectory mode to add a new custom trajectory, because that
> would keep them grounded in the paper, but also, you know, I don't know, think about whether
> there's a best of both worlds that somehow marries the trajectory and search without, or maybe
> there's a single extra trajectory that's added that's specific to their reading intent if they
> provided one.

**Ending: Shipped** — on `dev`, not deployed. Resolve 60 (the next feedback sweep does the Sentry
status write).

What we did:

- **The add page asks "Why are you reading this?"** while the import runs. If you have typed
  something when it finishes, it waits for *Save and open* or *Open without it*. The answer is saved
  before the main modes are queued, so Quotes, Ideas, Glossary, Tweets and the Trajectory route are
  all written for it from the start, with no second spend. It is the same per-article box Metadata
  has had since August; it was just never asked for.
- **Trajectory says what the route was planned for**: *Reading for: …* with an Edit link. On an
  article with a route and no answer yet, it asks *What do you want from this piece?* and
  re-plans the route for it in one press.
- Found and fixed on the way: a failed import that you retried never opened the article, even when
  the retry succeeded.

**Deferred, and yours to decide:** the "Your question" walk. This is a search over the whole paper
for your intent, walked like a trajectory, and it is the real marriage of search and trajectory. It
is designed but not built. Saved searches are shown to visitors of a public article, so a search
made from your intent would publish it. Keeping it private means editing the public page's allowlist,
which is a defence, and an unattended run does not edit one. The question is in the plan's
§ For Greg.

Plan: [260930e](../plans/260930e-ask-why-you-are-reading-and-a-trajectory-for-that-intent.md).

## An earlier report asking for the same prompt

`spya-pexkj4` (2026-09-29 15:15Z, from Greg, read from its row in production on 2026-10-01). It
never got a note, so the Earlier tab showed it as not shipped:

> The concern is that users are not setting the, they're not aware that they can provide information
> about their background and needs for a specific article, which will then inform, you know, the
> glossary and summary and everything else that we generate for them. And so I was thinking when you
> open an article for the first time, we would perhaps give them the option to do this and maybe
> include a tiny message saying where else they could do this in future.
>
> In other words, when I open an article for the first time, pop up a dialogue that gives me the
> option to say what I'm trying to get from it and what my background is. And while you're at it, it
> could also include a box for the general user profile, perhaps default collapsed, so I can edit
> that too at the same time. This is the, and it should use the same microphone input machinery that
> I have for feedback. And then obviously, if I choose to skip it, I can always edit the article
> label, background and needs metadata in the metadata section, because that's where it currently is
> accessible from.

The core of it shipped above: the question is asked as the article arrives, and skipping it leaves
Metadata as the place to answer later. **Three parts of it were not done**: it is asked on the add
page while the import runs, not in a dialog on first open; there is no collapsed box for the general
profile beside it; and the box has no microphone (the plan deferred dictation from v1 on purpose).
