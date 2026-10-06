No established P0 or P1. No files changed or committed.

- **F4 — P3, reasoned; reported:** the [postmortem](/var/tmp/spideryarn-worktrees/qi-ptvjnvdm-bot-check-page/docs/postmortems/261006c-a-size-floor-stood-in-for-a-recogniser-of-kind.md:77) says someone saw the article’s title in `summary.md`. That file omits titles; the title appears in `results.json`. Correct the evidence pointer without inventing how somebody discovered it.
- **F5 — P3, reasoned; reported:** “Any site behind the same check (Anubis) did the same” in the [opening paragraph](/var/tmp/spideryarn-worktrees/qi-ptvjnvdm-bot-check-page/docs/postmortems/261006c-a-size-floor-stood-in-for-a-recogniser-of-kind.md:9) generalises beyond the captured HAL pages. Other versions, configurations or shorter responses could behave differently.

The four statements:

1. **Accurate with qualifications.** A refusal requires the stated source-DOM element and object shapes. “Every such document” is literally too broad because of the acknowledged duplicate-ID case. Also, `readArticleWithProvenance` remains typed for a string URL; passing `null` works at runtime, which I checked. Production handles both origins.
2. **Accurate for the refusal consumers audited.** I found no remaining unsafe `.chars` access, omitted typed catch, or incorrect challenge classification.
3. **Accurate, independently demonstrated.** Reversing each precedence and removing the suspension exemption produced assertion failures in the existing tests. All mutations were restored.
4. **Mostly accurate, subject to F4–F5.** The named commits and dates check out. So do 1,034 extracted characters, the fixture’s byte count and hash, and 117 changed rows among the 208 previous result entries. The new result contains the complete manifested fixture × arm matrix.

I found no established genuine-article false positive. Upstream Anubis emits the element in its own page template and routes accepted requests onward, supporting the intended boundary. This does not prove that no genuine article could deliberately carry matching inert data. [Anubis template](https://github.com/TecharoHQ/anubis/blob/main/web/index.templ), [request handling](https://github.com/TecharoHQ/anubis/blob/main/lib/anubis.go).

Validation: 30 challenge tests, 19 floor tests, and 56 manifest/message tests passed. Typechecking passed via `node --import tsx scripts/typecheck.ts`; the npm launcher encountered the sandbox’s IPC restriction. I relied on your supplied pipeline-test evidence.

VERDICT: land it