/**
 * SPIKE (throwaway): prove `expectClaimed` actually reports contention.
 *
 * Holds `spideryarn.queue_state` the way a foreign claimant does — `for update`
 * on its own connection, inside a transaction — and runs one claim while it is
 * held. Without this, the contention branch is a branch nobody has watched
 * fail, which is not evidence (docs/reusable/silent-success.md).
 *
 * It rolls back and never commits, so it leaves no rows behind. It DOES make
 * other agents' claims answer `busy` for the few seconds it runs, which is the
 * same graceful refusal they already handle.
 *
 *   npx tsx scripts/spike-contended-claim.ts
 */
import { Client } from "pg";

import { loadEnvLocal } from "../src/env.js";
import { expectClaimed } from "../tests/helpers/expect-claimed.js";
import { pgJobStore } from "../src/store/pg-jobs.js";
import { mintAttempt } from "../src/store/jobs.js";
import { mintId } from "../src/ids.js";
import type { OwnerId } from "../src/types.js";

loadEnvLocal();

const LEASE = 60_000;
const CAP = 100;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL unset");
  console.log(`target: ${url.replace(/:[^:@]*@/, ":***@")}`);

  const holder = new Client({ connectionString: url });
  await holder.connect();
  await holder.query("begin");
  await holder.query("select 1 from spideryarn.queue_state where id = 1 for update");
  console.log("holder: queue_state singleton is held\n");

  try {
    /* A claim on a job id that does not exist is enough: `claim` takes the
       singleton BEFORE it looks the job up, so the NOWAIT refusal happens
       first and that is the path under test. */
    const nobody = "00000000-0000-0000-0000-000000000000" as OwnerId;
    const outcome = await pgJobStore.claim(mintId(), nobody, mintAttempt(), LEASE, CAP);
    console.log(`claim returned: ${JSON.stringify(outcome)}\n`);

    try {
      expectClaimed(outcome, "the spike's claim");
      console.log("!! expectClaimed did NOT throw — the spike proved nothing");
    } catch (err) {
      console.log("expectClaimed threw:\n");
      console.log(String(err instanceof Error ? err.message : err));
    }
  } finally {
    await holder.query("rollback");
    await holder.end();
    console.log("\nholder: released, nothing committed");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
