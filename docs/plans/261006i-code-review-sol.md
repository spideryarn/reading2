**K8 — P2, fixed by me:** the paper-only lookup rejected `asked_url` when a valid paper candidate redirected to a final address the registry did not recognise. [The lookup](/var/tmp/spideryarn-worktrees/qi-fbrh4kck-asked-for-address/src/store/find-article.ts:135) now also recognises the published revision’s `requested_url`. Ordinary moving links remain excluded, unpublished rows remain excluded, and final-address matches still win.

[Regression test](/var/tmp/spideryarn-worktrees/qi-fbrh4kck-asked-for-address/tests/asked-url-lookup.test.ts:33): seven cases seen red before the fix, covering every source; now green. The test also exercises the fetch helper accepting these redirected candidates. No checked-in live probe demonstrates this failure today, hence P2.

The requested checks, in order:

1. **K1 and K3:** I found no admitted production job reaching an unpublished row with a generated address. Bare-slug jobs get no URL there; import retries retain the pasted address; uploads have none. K3 needed K8’s fallback. **The candidate’s production writers preserve a published article’s `asked_url`, including null.**

2. **Charging:** no new incorrect import-slot charge established. K2 remains unchanged. The documented canonical-paper-first, unseen-short-link-second sequence can now repeat paid PDF extraction where the predecessor imported the landing page. That wider limitation remains reported and untouched.

3. **Security:** a stranger’s redirect can now select a registered paper and trigger its candidate fetches and PDF processing. Candidates remain fixed addresses built from bounded identifiers, fetched through the existing envelope; reused documents still face kind/marker checks. No exploitable bypass established.

4. **`www.` keys:** no existing source’s key changes. All previous `paperAt` callers construct canonical hosts without `www.`; NBER is the new caller requiring its removal.

5. **NBER:** its patterns satisfy the stated origin, bounded-ID, candidate, round-trip and key rules. Subscriber-held HTML responses remain unmeasured; that suspicion is not an established blocker.

6. **Docs:** the new fetching and queue descriptions match the implementation. I corrected fetching’s claim about unrecognised final addresses to reflect K8’s fallback. Counting a held document in `tried` correctly counts candidates consulted.

Validation: **391 tests passed**, touched-file lint passed, and all-project typechecking passed using `node --import tsx scripts/typecheck.ts`. The requested npm command itself hit the sandbox’s IPC-socket restriction.

Re-run **`tests/find-article.test.ts`** against Postgres. The other listed suites need no re-run for this lookup-only change. No commits or Git-state changes made.

*ship with the fixes I made*