# Review prompt — background PDF upload (plan stage)

You are reviewing a **plan, not code**. Nothing has been built. Your job is to find the design
errors while they are still cheap, and to tell me plainly whether this is ready to build.

## The repo

Spideryarn, an AI-assisted reading app. TypeScript + ESM throughout, one server process, React on
the client, `tsx` to run. Start with `AGENTS.md` at the root (`CLAUDE.md` is a symlink to it) for the
working rules, then `docs/project/architecture.md`.

The tree is read-only to you, but you **can** run one test file or a script:
`npx vitest run tests/<one>.test.ts` and `node --import tsx <script>`. Not `npm test` and not
`npm run typecheck` — the sandbox stops those.

## The plan

`docs/plans/260903j-background-pdf-upload-so-add-does-not-wait.md`

## The problem it is solving

Greg, 2026-09-03:

> When I upload a PDF to the add section of the Home page, sometimes it takes a while to upload over
> a slow connection. I have to wait before I can then click the Add button, because that's disabled
> in the meantime. I'd like to be able to upload and then click Add immediately, which would then
> wait for the upload to finish and run the ingestion queue immediately, so I could go off and do
> something else in the meantime.

## The code the plan changes

Read these before judging it:

- `src/web/UploadPicker.tsx` — where the transfer lives today. Note `send()`, the abort-on-unmount
  `useEffect`, the `sending` ref, and the header's reasoning about why the file never leaves this
  component.
- `src/web/upload.ts` — `uploadPdf`, `put`, `realStatus`, `uploadFailure`. The transport, which the
  plan does not touch.
- `src/web/jobEngine.ts` — the module-singleton pattern the plan copies, and its own header's
  argument for why a background worker must not belong to a mount.
- `src/web/AddArticle.tsx` — the add row and the Add button.
- `src/web/AddPage.tsx` — `/add/upload/<id>`: the post-once ref, the `article` outcome, the
  `failure` vs `queue.error` distinction.
- `src/routes.ts` — `mintAnUpload`, `queueAnUpload`, `jobForUpload`. The plan proposes **no server
  change**; check whether that survives contact.
- `src/pipeline.ts` § `acquireUpload` — the `fetch` step's upload half, including `refuse("missing")`.
- `docs/project/ingest-queue.md` § *Uploading a PDF*.

## What I want from you

For **each finding**, give me:

- **(a) the mutation** — the concrete input, sequence or edit under which the design fails its own
  claim. Something I can actually run or click. A finding with no (a) is an opinion and goes last.
- **(b) the smallest change** that closes it, as a code block or two sentences of design.

Rank by (a). Do **not** hand me a patch to apply — I want the mutation, not the fix applied.

End with a one-line verdict: **ready to build**, **ready with the changes below**, or **not ready**.

## Specific things I already suspect, and want broken rather than confirmed

Turn each of these into a mutation if it is real, and say plainly if it is not.

1. **Two writers of `POST /api/jobs {uploadId}`.** The plan has the upload engine post when the PUT
   lands, and keeps `AddPage`'s existing post for the case where no live transfer exists (a reload, a
   second tab). The safety argument is `queueAnUpload`'s claim-then-`taken` branch. Read that
   function and tell me the interleaving where it produces two jobs, two articles, or two quota
   slots — or where it produces a 409 the reader cannot recover from. Include the case where the
   engine's post and a second tab's post race, and the case where `enqueue` throws between
   `claimUpload` and `noteSlug`.

2. **A quota slot decided twice, minutes apart.** `mintAnUpload` calls `refuseUploadWithoutQuota`
   (a non-reserving check) and `POST /api/jobs` is the gate that actually reserves. Today those are
   seconds apart. Under this plan they are separated by the whole transfer. What does a reader who
   is at their ceiling by the time the bytes land actually see, and where? Is there a state where a
   file uploads fully and is then refused with no way back to it?

3. **The engine outliving the thing that authorises it.** The engine is a tab-level singleton. What
   happens if the session expires, the reader signs out, or `apiFetch` starts 401ing mid-transfer?
   `jobEngine` has an auth pause (`tests/job-engine-auth-pause.test.ts`) — does the upload engine
   need the equivalent, and does the plan's silence about it matter?

4. **`start()` on `jobEngine` from the upload engine.** `jobEngine.start()` being the only way to
   wake the poller was made deliberate on 2026-09-01 for a signed-out guarantee
   (`tests/public-network-trace.test.tsx`). Is poking it from here a hole in that, or fine?

5. **`beforeunload`.** Is a confirmation dialog the right call at all, given that Greg's whole
   request is "go off and do something else"? Is there an interleaving where it fires with no
   transfer running, or fails to fire when one is?

6. **The chosen-file-wins rule.** Add is enabled when there is a valid URL *or* a chosen file, and
   the file wins. Find the sequence where a reader loses a typed URL, or adds the wrong one of the
   two, and say whether the `title` on the button is enough.

7. **Cancellation and the `x`.** One button now means "forget this chosen file" *and* "stop this
   transfer", across two components (the shelf and `/add/upload/<id>`). Find the state where the two
   disagree — e.g. cancel from the add page, then press Back to the shelf.

8. **The abort-on-unmount that is being deleted.** Its comment says it exists so a completed upload
   cannot navigate at somebody who has left. The plan removes it because the engine, not the
   component, now navigates — except the engine does not navigate at all; the navigation happens
   before the transfer starts. Is there anything else that cleanup was quietly buying?

9. **Retry.** The plan's `retry()` re-PUTs the same `File` with the same grant. Grants last two
   hours. Is re-PUTting to a grant that has already been used once actually going to work against
   Supabase Storage, or does a signed upload URL burn on first use? If you cannot tell from the code,
   say so and tell me how to measure it — this is the kind of claim the repo has been wrong about
   before (`realStatus` in `src/web/upload.ts` is the scar).

10. **The staging object and the sweep.** `SWEEP_GRACE_MS` and the never-delete rule in
    `acquireUpload`. Does anything about a longer-lived `pending` record, or a cancelled transfer
    that is now more common, break an assumption in `src/source.ts`?

## What I do not want

- Style notes, naming preferences, or test-count opinions.
- A rewrite of the design into a server-side wait. The plan names that option and rejects it with
  reasons; if you think the reasons are wrong, say which one and why, briefly.
- Praise.
