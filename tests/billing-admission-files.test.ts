/**
 * **Under the filesystem store, admission is inert — and inert means silent.**
 *
 * Quota is a Postgres feature (docs/project/billing.md § *Billing is a Postgres
 * feature*): the settlement joins the Postgres publish transaction, which has no
 * filesystem counterpart, and a second ledger would be two implementations of
 * one count. So on a laptop running the default store, `POST /api/jobs` must
 * neither reserve nor refuse — it must behave exactly as it did before the wall
 * went up.
 *
 * There are two ways to get that wrong and only one of them is loud. A
 * `getDb()` where there is no database throws, and a suite would notice. But
 * every developer machine *has* a `DATABASE_URL` in `.env.local`, so a missing
 * `STORE !== "postgres"` guard would quietly work here — reserving slots against
 * the Postgres ledger for jobs that live in `data/_jobs/` and can never settle
 * them, which is a leaked slot per ingest and no error anywhere.
 *
 * Hence the assertion is on the **slot**: empty, always. This file deliberately
 * does not set `SPIDERYARN_STORE`, so it runs whatever the default is
 * (src/store/live.ts) — the same store the rest of a plain `npm test` uses.
 *
 * **Watched red** on 2026-09-03 by deleting the `STORE !== "postgres"` line from
 * `admitIngest`: the first case fails with a real reservation id where `{}`
 * belongs. The retry case stays green under that mutation and is kept anyway —
 * it has its own guard in `withRetrySlot`, and what saves it is that the job id
 * it names is in no store, so nothing was reserved for it either way.
 */
import { describe, expect, it } from "vitest";

import { refuseUploadWithoutQuota, withIngestSlot, withRetrySlot } from "../src/billing/admission.js";
import { loadEnvLocal } from "../src/env.js";
import type { OwnerId } from "../src/owner.js";
import { STORE } from "../src/store/live.js";

/* So that a missing guard would find a *working* database and really reserve —
   which is the failure this file is here to catch. Without it the same bug
   would throw, and throwing is not the shape it has on a developer's machine. */
loadEnvLocal();

/** Nothing is inserted anywhere, so a fixed id is fine. tests/fixture-ids.test.ts. */
const OWNER = "000000af-0000-4000-8000-00000000ad01" as OwnerId;

/**
 * Skipped rather than inverted when a peer has left `SPIDERYARN_STORE=postgres`
 * in the environment: under Postgres these calls take real slots, and the file
 * would be asserting the opposite of what it says.
 */
const filesIt = STORE === "postgres" ? it.skip : it;

describe("admission under the filesystem store", () => {
  filesIt("runs the ingest with no slot at all", async () => {
    const slot = await withIngestSlot({ ownerId: OWNER, slug: "test-admission-files" }, async (s) => s);
    expect(slot).toEqual({});
  });

  filesIt("asks nothing about the job a retry repeats", async () => {
    /* A job id nobody has. Under Postgres this would be a read of `jobs`; here
       there is no store to read, and the empty slot says it was never tried. */
    const slot = await withRetrySlot({ jobId: "spya-nosuchj", ownerId: OWNER }, async (s) => s);
    expect(slot).toEqual({});
  });

  filesIt("lets an upload through without consulting a ledger", async () => {
    await expect(refuseUploadWithoutQuota(OWNER)).resolves.toBeUndefined();
  });
});
