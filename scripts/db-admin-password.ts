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
 * **What that costs, and why it is still the right trade.** The address printed
 * here comes from a constant and the password from a file, so neither is checked
 * against the database — and the two can disagree. GPT Sol found the case,
 * 2026-09-02: pull the commit that renamed the local account and this command
 * prints `dev-admin@spideryarn.local` on a machine whose database still says
 * `greg@gregdetre.com`, exits 0, and the sign-in is refused. That is the
 * repo's own success-over-stale-state shape (docs/reusable/silent-success.md).
 *
 * The fix is the last line rather than a database read, because a read would
 * undo the paragraph above — and Sol's stronger suggestion, a version marker in
 * the password file, is a permanent format change bought for a window that
 * closes the first time anybody runs the seed. The honest cheap answer is to
 * say what to do when the credential is refused, which is useful advice on an
 * unseeded machine too.
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
/* Not decoration: this address is what the constant says, not what the database
   holds, and the two disagree on a machine that has pulled the rename and not
   yet re-seeded. */
console.log("");
console.log("  If that address is refused, this machine has not been seeded since it changed.");
console.log("  Run: npm run db:seed-owner — it renames the existing account and keeps the password.");
