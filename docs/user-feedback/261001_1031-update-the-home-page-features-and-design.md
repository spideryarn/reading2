---
reports: spya-mbyuf6, spya-zadvdv
ending: shipped
---
# Update the signed-out home page, /features and /design

Two suggestions from Greg (admin), 2026-10-01, batched by the Overseer as queue item `qi-gmgjenh5`:

- **SPIDERYARN-READING2-86** (report `spya-mbyuf6`), 10:31 UTC, on `https://www.spideryarn.com/`:

  > Update the non-logged-in homepage and Features pages

- **SPIDERYARN-READING2-89** (report `spya-zadvdv`), 10:33 UTC, on `https://www.spideryarn.com/design`:

  > Update /design

**Ending: Shipped**, both of them, on `dev`. The plan, and the two GPT Sol reviews behind it, is
[261002b](../plans/261002b-bring-the-signed-out-home-page-features-and-design-up-to-date.md).

What changed, in plain words:

- **`/` and `/features` describe the product as it is now.**
  - **The lead picture is Structure.** It used to be Outline, which stopped being a mode on
    2026-09-10.
  - **Every mode is on `/features`.** Structure, Skim, Tweets, Citations, Marginalia, FAQ and Debate
    were missing; so were cross-references and maths. A test now fails if a mode is left off.
  - **Modes behind the Experimental switch carry a tag that says so.** The tag is drawn from the
    code, so it follows a mode in and out from behind the switch.
  - **Every landscape screenshot was retaken.** Each one showed a bar offering Hierarchy and Outline.
- **A false sentence came off both pages.** They said a public article's comments and searches "stay
  yours". The privacy policy, and the code, say those go with a public article; only chats and your
  profile stay private.
- **`/design`**:
  - Four wrong notes are fixed.
  - It now draws the Tooltip, a band with its (i), the comment, chat and cross-reference marks, and
    the High-powered AI and Experimental switches.
  - A test now fails if a kind of mark in the prose is missing from it.

**Deferred**, named in the plan:

- new pictures for Tweets, Citations, FAQ, Debate and Marginalia, which have tiles for now;
- a Controls section, the dock buttons, hover cards and reading-time specimens on `/design`.

**One thing outside this work, for Greg.** The header comment of `src/web/shared-inventory.ts`
lists "the owner's comments and notes" among what a public article withholds. That is stale: the
code shares them, and the sharing card itself is built from the code, not the comment. Only the
comment is wrong.
