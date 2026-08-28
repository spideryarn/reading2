/**
 * One account, as the admin page's two halves agree to describe it.
 *
 * A file of its own, holding one interface, because it is the seam between
 * [admin-accounts.ts](admin-accounts.ts) — which asks the Auth service who
 * exists — and [pg-admin.ts](pg-admin.ts)'s `mergeUsers`, which joins that to
 * the counts from our own tables. Putting it in either would make the two
 * import each other.
 *
 * It survives unchanged from when the accounts came out of a `select()` on
 * `auth.users`, and that is the point: `mergeUsers` and its tests never learned
 * that the source moved.
 */
export interface AccountRow {
  id: string;
  email: string | null;
  createdAt: Date | null;
  lastSignInAt: Date | null;
  emailConfirmedAt: Date | null;
  /**
   * The linked sign-in providers — `["google"]`, `["email"]`, both.
   *
   * **Extracted at the boundary, never the whole `app_metadata`.** That object
   * is writable by anyone with the service-role key and Supabase's own examples
   * put roles, plans and team ids in it; carrying it through and narrowing
   * later would mean the page's "counts and dates only" rule depended on every
   * later reader remembering to narrow. GPT Sol, 2026-08-28: the boundary was
   * claimed here and was not actually here.
   */
  providers: string[];
}
