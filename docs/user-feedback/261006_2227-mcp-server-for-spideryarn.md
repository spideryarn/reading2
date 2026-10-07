---
reports: spya-bkkjzy
ending: shipped
---
# An MCP server, so an agent can drive Spideryarn as you

Report `spya-bkkjzy` (SPIDERYARN-READING2-EE), a suggestion, from Greg (admin, proved by
`feedback-reporter.ts` exit 0 on the production row), filed 2026-10-06 22:27 UTC from an article
page. The words are from that row:

> I said in a previous suggestion that my intent is to start sending this out to people. So it's good that we have the gift voucher functionality. But actually, the more I think about it, the more I think, you know, I'm going to need to capture big lists of people and why and who and what they might, you know, which articles they might be interested in seeing in Spideryarn and how many, how I know them and, you know, places to look and stuff like that. And in reality, that's probably best done within an agentic interface like Claude CoWork or similar. And so I think probably the most useful thing would be if Spideryarn had an MCP that that agentic interface could query and drive. So in terms of the query, it would want to be able to say things like what articles are there and, I don't know, who have we sent gift vouchers to and lists of user email addresses. Can you think of anything else? And then in terms of what it wants to be able to drive, well, it'd be a superset of that. So it may be, you know, add, create new gift vouchers for people and send them out, and import new articles and create a shareable link and add a tag and, you know, which modes should be default imported and, you know, when you send the gift voucher, what, you know, public notes to include in the email. And so then I can use the agentic interface to sort of trawl through my emails and draft emails to people or messages or notes, and then drive Spideryarn in sending out the gift vouchers, importing the articles and whatever else. So think through, given that this is my intent, as always, like, you know, if there's something Really complex, look for a simpler way to do it that gets most of the value. If there's things that you think would be helpful that I haven't thought of, add those too. Ask me questions if you need to, but try and just get something working first, if you possibly can. And then, you know, obviously run spikes to test this MCP. I don't know how authentication for it should work. It'll probably be just me. In an ideal world, I don't exactly know how this would work. You know, I'd give it to Claude Co-work, and Claude Co-work would prompt an authentication into Spideryarn, which would then, you know, reopen Claude Co-work or something like that. I don't want it to be Claude Co-work specific, but it's a good example. That would be the nicest authentication flow. And then it'd be authenticated as me. It would have admin access and be able to do all this stuff. And maybe you can only use the MCP for now if you're an admin. I mean, actually, I can imagine it being really useful for people in future. Huh, that's interesting. Okay, well, let's, if we could, what would be even better would be if actually the MCP allows you to do whatever you were already allowed to do. So if you're an admin, you can create gift vouchers. If you're not an admin, you can't create gift vouchers. But maybe if you're not an admin, you can still query your own articles and maybe import new ones, as long as you have free articles. If you're an admin, you can do basically anything. So that would be the ideal, would be if the MCP kind of respected whoever the user is and what they're able to do. If that's too complicated, well, let's make a note of that as the dream, and the V1 would just be for admins. And so it would only really allow me to authenticate, because I think I'm the only admin user, and it would allow me to do everything that we think would be valuable. You can from production, you can run spikes. Just don't do anything destructive. I realize it'd be hard for you to test the authentication, but perhaps you can find ways to do it in a kind of careful, or, you know, at least gather some information about what is and isn't working. Yeah, okay. I'm looking forward to trying it out.

**Ending: Shipped**, on `dev`. Plan
[261007j](../plans/261007j-mcp-server-for-spideryarn-admins-first.md).

- **Built: a local MCP server**, `scripts/spideryarn-mcp.ts`, which Claude Desktop, Cowork on the
  desktop or Claude Code runs on your Mac. You sign it in once with your email and password; it
  then calls Spideryarn's own API as you, so **it can do exactly what your account can do** (the
  "dream" in your words: an admin's voucher tools work, anybody else's are refused by the server).
  Tools: list and search your articles, list and edit tags, import a URL and follow the import,
  the run-modes-on-import switch, make an article public or private, and list, create, edit,
  revoke and re-send gift vouchers with their name and note. Set-up:
  [mcp.md](../project/mcp.md).
- **Sending mail and publishing open a dialog on your Mac** naming the exact gift or article, and
  nothing happens without *Approve*: an agent that reads your email can be steered by what an
  email says, and the model cannot press that button. A retried gift is sent once.
- **Tested** against the local stack with two real accounts (30/30), and production read-only
  with no credentials. Signing in to production is yours to try first: an account that has only
  used Google may need *Forgot password* on `/login` to get a password.
- **Not built, questions for you** (question [q-arfr76](questions/q-arfr76.md)): signing in
  from Cowork on the web or phone (`qi-n9ntngfq`), and whether an agent may hold a private link's
  key or every reader's address (`qi-2a8nh33e`).
- **Your list of people** (who, why, which articles) stays in the agent's own notes, as you
  suggested; it answers the open question on [the starter-article note](261006_2222-gift-voucher-name-note-and-a-starter-article.md)
  (`qi-dajb32q7`) in part.
