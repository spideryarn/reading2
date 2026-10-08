# Consent described tools instead of the credential

Caught in the uncommitted remote MCP stage of [261007p](../plans/261007p-mcp-remote-sign-in-with-oauth.md).
No introducing commit exists yet; it was found before landing.

The revised plan acknowledged that Supabase OAuth issues a whole account credential. The consent
page still described only MCP tools and said the app could not send mail, publish, or disclose a
private link. Those restrictions belong to the tool server; the token also reaches Supabase's
account endpoints, whose authority depends on its own security settings.

The class is **consent describes an interface rather than the credential's authority**. The test
pinned the original paragraph verbatim, so it could preserve wording while missing the changed
security boundary. Independent root-cause review compared the copy to the revised plan.

The fix qualifies the tool restrictions and discloses broader Supabase account access, including
password changes where account settings permit them. The security map now says enabling this
requires Greg's decision rather than describing the risk as already accepted. Remote MCP remains
off without its configured client. The disclosure test in `tests/oauth-consent-page.test.tsx`
went red because the page said nothing about account settings, then green.

Countermeasures, ranked: first, assert disclosure of the actual credential boundary (done); second,
compare consent again whenever issuance policy changes; creating a separate OAuth issuer was
left as a product/security decision rather than introduced during a narrow code review.

Up: [Postmortems](../project/postmortems.md).
