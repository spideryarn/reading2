# Approval text truncation must preserve the target identity

Code review of [plan 261007o](../plans/261007o-mcp-private-link-and-admin-user-tools.md) found that a long article title could remove the slug from the native approval dialog for `create_private_link`. Two articles with titles sharing the displayed prefix would become indistinguishable when approving disclosure of their private links. This was caught in the uncommitted implementation; no shipped instance was established.

## Approval text truncation must preserve the target identity

The tool built one line containing the article title followed by its slug. [src/mcp/approve.ts](../../src/mcp/approve.ts)'s `dialogText` caps each displayed line at 300 characters. A 400-character title consumed that allowance before the identifying slug appeared. The root cause was composing security-relevant identity after variable-length descriptive text while delegating truncation to another layer.

The existing tests inspected `StubApprover.asked`'s raw operation lines, where the slug remained present. They did not render those lines through the actual `dialogText` boundary. An assertion about the proposed text therefore supplied no evidence about what the person could see.

## Provenance, reproduction and the existing precedent

The private-link dialog is new uncommitted code in [src/mcp/tools.ts](../../src/mcp/tools.ts), reviewed against `a373ada00f5db33125dcdc2ad71cd75447020159`; no introducing commit exists yet. The regression in [tests/mcp-tools.test.ts](../../tests/mcp-tools.test.ts), “keeps the article's slug visible in the actual dialog when its title is long”, used a 400-character title and failed because the rendered message did not contain `on-tools`.

`make_article_public` also combines title and slug, but its independent `Link` line preserves the target identity for the normal production origin and the permitted slug length. It is a precedent for the narrow private-link fix, not another confirmed instance of this defect.

## The fix and countermeasures, ranked

The narrow fix gives the private-link dialog an independent `Slug` line before its `Article title` line. Long descriptive text can then be shortened without consuming the target identity.

1. **Assert identity in the rendered approval message** — cheap, added and observed red against the actual 400-character incident shape before changing the layout. This tests the boundary that decides what the person sees, rather than an earlier representation.
2. **Keep target identity independent of truncatable descriptions** — a small layout change, applied to the new private-link tool, following the public-sharing tool's independent link. Tests for another tool should similarly carry a long description through its real renderer.
3. **Raise the dialog's line-length cap** — rejected. Any finite larger cap can still discard an identity placed after arbitrary-length text, and longer lines make approval harder to read.
4. **Introduce a generic approval schema with separately typed identity fields** — rejected for this fix. It would broaden the change across unrelated tools; separate lines and rendered-message evidence resolve this instance without a new framework.
