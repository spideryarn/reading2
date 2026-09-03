CHANGES REQUESTED — three reproducible safety issues.

1. **High — `--apply` can write to production without `--prod`.**  
   [chooseStorage](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/illustrated-415-mac/scripts/storage-buckets.ts:76) accepts any non-prod URL without locality validation; [apply](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/illustrated-415-mac/scripts/check-buckets.ts:194) then writes it.

   Reproduced with `prod: false` and `SUPABASE_URL=https://wrongproject.supabase.co`: it returned that hosted target and a valid `Target:` line. Thus the printed line agrees with the write, but the documented “local” mode can still write remotely if `.env.local` or the shell contains remote credentials. Require `--prod` for every hosted target, and positively verify the local stack before a local write.

   Related hardening: `whyNotProductionStorage` accepts arbitrary labels such as `x.supabase.co` and `api.supabase.co`, not specifically a project-ref-shaped hostname.

2. **Medium — malformed TOML can make the deploy gate report no drift.**  
   [declaredBuckets](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/illustrated-415-mac/scripts/deploy-checks.ts:985) silently continues when an assignment does not match its regex, then supplies defaults.

   Reproduced:

   ```text
   [storage.buckets.sources]
   public =
   file_size_limit =
   allowed_mime_types =
   ```

   This parsed as private, unlimited, any MIME; comparing it with the same running state returned `[]`. That contradicts the parser’s fail-closed contract and lets the deploy record success about a file it could not parse. Parse with the existing direct TOML dependency, or throw on malformed assignments inside bucket sections.

3. **Medium — the new log sanitizer does not enforce its secrecy or size guarantees.**  
   [describeStorageFailure](/Users/greg/dev/spideryarn/reading2/.claude/worktrees/illustrated-415-mac/src/collect-assets.ts:478) redacts only `message`, recognizes only schemeful URLs and JWTs beginning `eyJ`, and returns an empty-message `name` before applying the 200-character cap.

   Reproduced surviving output containing:

   - `sb_secret_SUPERSECRET…`
   - `//cdn.private-letter.test/2026/09/scan.jpeg`
   - fragments of a valid JWT-shaped token whose header has leading whitespace
   - a publisher URL placed in `err.name`; this produced a 539-character entry

   Build one final string, redact that whole string, then slice. More robustly, expose structured details only for known Storage and `CorruptObject` errors rather than attempting to sanitize arbitrary exception text. Redaction-before-slicing is otherwise the correct order.

No serious issue found in:

- `narrowings` for well-typed inputs, including `allowed_mime_types: null`
- deploy failure propagation: `record()` adds a failure and `main()` stops before migrations
- missing `config.toml` at the deployed SHA: it fails closed
- cardinality: five distinct errors plus one correctly computed `+N more` sentinel

Verification: targeted suite passed, 179/179. Direct execution of the typecheck script also passed all three TypeScript projects. No production flags or network calls were used.