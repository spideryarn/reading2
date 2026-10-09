Verdict: **REVISE** — the permitted files are corrected and tests pass, but one contradiction remains in an out-of-scope file.

1. Corrected factual errors in [security-risks.md](/var/tmp/spideryarn-worktrees/security-risks-register/docs/project/security-risks.md:197):

   - `spideryarn_migrator` cannot currently run migrations referencing `auth.users`.
   - GitHub protection is unavailable on the current private-repository plan; isolating a deploy token alone would not protect `main`.
   - `stripe:setup` needs more permissions than Products and Prices.

2. Added missing R25: opening `/add/<url>` starts paid work without confirmation. The SSRF defence does not remove that risk.

3. Corrected levels:

   - R3: Low → Medium.
   - R11: Medium → High.
   - R17 merged into R2/R8 because it is not a separate risk.

4. Tightened overstated claims:

   - R6 now concerns Claude fleet sessions, not every agent.
   - R12 records the tool names observed on 2026-10-09 rather than claiming they remain current.
   - R14 clearly says remote MCP is presently switched off.
   - R18 is explicitly a point-in-time box observation.
   - “Checked and sound” became the narrower “no new finding reported.”

5. Made the register directly usable: Greg can answer with wording such as `R6 yes; R8 not now`. I also shortened duplicated R1/R2 implementation detail and aligned counts in the [plan](/var/tmp/spideryarn-worktrees/security-risks-register/docs/plans/261009o-security-risks-register-and-a-security-review.md:7) and [feedback note](/var/tmp/spideryarn-worktrees/security-risks-register/docs/user-feedback/261009_1119-security-risks-register-and-a-security-review.md:24). All fixes remain proposals; no defence is described as changed.

6. Not changed because it was outside the permitted files: [q-rstqvz.md](/var/tmp/spideryarn-worktrees/security-risks-register/docs/user-feedback/questions/q-rstqvz.md:44) says both “A itself is built” and “This question stays open until A is built.” The underlying plan says nothing is built.

7. Final requested test run passed: **2 files, 71 tests**.

No remote service was contacted and no secret value was printed.