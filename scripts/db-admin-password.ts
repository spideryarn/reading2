/**
 * Print this machine's local administrator sign-in, so you can get into the app.
 *
 *     npm run db:admin-password
 *
 * The password is generated per machine and kept in a file rather than written
 * down in this repo — `scripts/seed-accounts.ts` says why, at length. That makes
 * it the one credential here nobody can look up in a doc, so there has to be a
 * command that prints it.
 *
 * **It does not create one.** A read-only command that quietly seeded a database
 * would be a surprise, and worse, on a machine that has never been set up it
 * would print a password for an account that does not exist — which reads as
 * "the password is wrong" rather than "run the seed". So an absent file sends
 * you to `npm run db:seed-owner`.
 *
 * Nothing about the database is touched or even reachable from here: this reads
 * one file. That is deliberate — it means the command still works when Docker is
 * off, which is exactly when somebody is likely to be hunting for it.
 *
 * **The reading lives in `readAdminCredentials`**, not here, because
 * scripts/browser-sign-in.ts needs the same file and the same refusals — and a
 * refusal that lives in one caller is one the other gets wrong.
 */
import { homedir } from "node:os";

import { readAdminCredentials } from "./seed-accounts.js";

const found = readAdminCredentials(homedir());
if (!found.ok) {
  console.error(found.why);
  process.exit(1);
}

console.log(`  email:    ${found.email}`);
console.log(`  password: ${found.password}`);
console.log(`  file:     ${found.path}`);
