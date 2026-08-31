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
 */
import { homedir } from "node:os";
import { existsSync, readFileSync } from "node:fs";

import { ADMIN_EMAIL } from "../src/admin.js";
import { adminPasswordPath, passwordFileIsUsable } from "./seed-accounts.js";

const file = adminPasswordPath(homedir());

if (!existsSync(file)) {
  console.error(
    `no password file at ${file}.\n` +
      "  This machine has not been seeded yet. Run: npm run db:seed-owner\n" +
      "  (it makes one, prints it once, and creates the account it belongs to).",
  );
  process.exit(1);
}

const contents = readFileSync(file, "utf8");
if (!passwordFileIsUsable(contents)) {
  console.error(
    `the password file at ${file} is empty or too short to be a password.\n` +
      "  Delete it and run: npm run db:seed-owner — which will make a new one and\n" +
      "  set it on the account. Every open session for that account is signed out.",
  );
  process.exit(1);
}

console.log(`  email:    ${ADMIN_EMAIL}`);
console.log(`  password: ${contents.trim()}`);
console.log(`  file:     ${file}`);
