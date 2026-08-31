# CHANGES REQUIRED

Two correctness bugs should block this version.

## Findings

1. **High — permanent refusals are still reported as retryable outages.**  
   [embeddings.ts:273](/Users/greg/Dropbox/dev/experim/spideryarn2/src/embeddings.ts:273) classifies every refusal except the exact `no-endpoints` body as `provider`. I directly checked 400, 401, 402, 403, ordinary 404, and 413: all became retryable `provider` failures. That repeats the original mistake for an invalid key, exhausted credit, bad model, rejected payload, and similar permanent failures.

   Three reasons are insufficient as currently defined. Keep `config` merged for missing key/account policy—the operator message already distinguishes them—but add a non-retryable `refused`/`request` reason, or otherwise map permanent statuses separately. `provider` should mean transient network/timeout/429/5xx failures.

2. **High — malformed provider data can still escape untyped.**  
   [embeddings.ts:350](/Users/greg/Dropbox/dev/experim/spideryarn2/src/embeddings.ts:350) reads `d.index` before proving `d` is an object. `{data:[null]}` produces:

   ```text
   TypeError: Cannot read properties of null (reading 'index')
   ```

   Validate every array member as unknown before property access, and add the red/green test. The claim that every embedding-boundary failure is typed is currently false.

3. **Medium — caller cancellation is misclassified as provider failure.**  
   [embeddings.ts:228](/Users/greg/Dropbox/dev/experim/spideryarn2/src/embeddings.ts:228) wraps any abort from the supplied signal as `provider`; I confirmed it. The production routes are currently safe because [article-vectors.ts:238](/Users/greg/Dropbox/dev/experim/spideryarn2/src/article-vectors.ts:238) and [similar.ts:255](/Users/greg/Dropbox/dev/experim/spideryarn2/src/similar.ts:255) deliberately pass no caller signal. Browser navigation only aborts the browser request.

   So the claim is merely currently true. Either preserve caller cancellation distinctly or remove the public caller-signal contract. Internal timeouts should remain `provider`.

4. **Medium — two messages state causes their reasons do not guarantee.**

   - [PLACING_NOT_CONFIGURED](/Users/greg/Dropbox/dev/experim/spideryarn2/src/messages.ts:559) says the account is not allowed, but `config` also means no key.
   - [PLACING_UNREACHABLE](/Users/greg/Dropbox/dev/experim/spideryarn2/src/messages.ts:567) says the model was unreachable, but `provider` includes refusals and malformed 200 responses.

   `PLACING_BUSY` correctly blames this app, though “reading as many articles for the model…” is awkward. Prefer “This app is already placing passages for as many articles as it can at once.”

## Direct answers

- **Type location:** In the current working tree, the claimed constraint is no longer true. [client-imports.test.ts:245](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/client-imports.test.ts:245) explicitly permits type-only imports from non-shared modules. `EmbeddingReason` can therefore live beside `EmbeddingFailure`; the re-export then disappears. At minimum, the current comments claiming type-only imports are forbidden must change.

- **`embeddingHttpError`:** `throw embeddingHttpError(...)` is clear enough. It is an error translator; a conditional handle-and-rethrow would be less direct. No actual double-wrapping path exists in the recursive retry flow.

- **Status codes:** `503` for local admission control and `502` for a transient upstream failure are right. `config` should be `500`, because the server is misconfigured; it is not acting as a healthy gateway whose upstream failed.

- **Legacy `[emb1]`/`[emb2]`:** No runtime compatibility problem exists if nothing persisted them; they were never registered, so aliases would add parsing behaviour rather than preserve it. The only contrary argument is `copy.md`’s support-code stability rule. Since the diagnosis retains both codes and makes them searchable, I would record this as a deliberate exception, not block on aliases.

- **Missing tests:** Nothing tests the route contract: each reason’s status and copy, generic-error passthrough, or both endpoints using identical mapping. Add those, plus tests for malformed members, permanent 4xx, busy, and caller abort.

- **Deploy probe:** There is no honest automated equivalent without a credential that lets `deploy.ts` call into the deployed runtime. The smallest useful interim is an admin/owner-authenticated manual probe using the existing session. It would run inside the deployment and provide red/green evidence, but it is not a deployment gate. Do not treat public health or `/models/user` as sufficient.

Verification: the two affected test files passed, 40/40; diff check was clean. Lint reported only existing complexity notices. No files changed.