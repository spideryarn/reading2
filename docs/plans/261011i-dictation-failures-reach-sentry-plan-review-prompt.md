You are reviewing a plan before it is built, read-only. Repo: Spideryarn (this worktree). Read
docs/plans/261011i-dictation-failures-reach-sentry.md, then the code it touches:
src/web/useDictation.ts (beginCapture near the end, the `error` state, the options type around line 630),
src/web/useDictationField.ts, src/web/transcriber.ts, src/web/monitoring.ts, src/monitoring-scrub.ts
(sanitise, safeEvent), src/web/dictation-errors.ts, src/web/mic-devices.ts (deviceMissing),
tests/dictation-codes.test.ts, and the fleet dashboard users under tools/fleet/web/src/.

Questions:
1. Is reporting from one effect on `error` sound? Can the same failure be reported twice, or a
   failure be missed (e.g. setError with the same string twice in a row, errors set during retry,
   errors set after unmount)? Is there a better single choke point?
2. Is the privacy argument right: nothing a reader said or any article text can reach Sentry via
   the tags, the error name, or the fingerprint? Check sanitise/safeEvent behaviour with
   neverAuthored and a custom err.name.
3. Is the getUserMedia error mapping right per browser (Safari/iOS, Chrome, Firefox), including
   the fallback chain in beginCapture (which error to keep when several requests fail)? Is
   sending NotAllowedError to "[mic-blocked] Allow it for this site" wrong blame anywhere
   (e.g. iOS gesture rules, permission policy in an iframe, insecure context)?
4. Is making `report` a required option the right shape vs. alternatives?
5. Anything missing that would have actually answered Greg's report (#551)?
Write findings as a numbered list with severity (P0-P3) and end with a one-line verdict:
APPROVE, APPROVE WITH CHANGES, or REVISE.
