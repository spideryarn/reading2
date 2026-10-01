# The callback reads a stripped address: a "read it first" that is only first by luck

**Found 2026-10-01, by a real browser, building password reset
([261001i-password-reset.md](../plans/261001i-password-reset.md)). Never reached a reader as a
visible bug: before this change the wrong path happened to do the right thing.**

## What happened

In 3 of about 12 Playwright runs against the dev server, a password-recovery link went
`/auth/callback?code=… → /auth/callback → /auth/callback → /login → /` and landed the reader on their
shelf with no "choose a new password" form. The other runs showed the form.

## The root cause

`AuthCallback.tsx` says, in its header, that it **"reads `location.search` itself, before anything is
stripped"**. It reads it in a `useEffect`, i.e. after React has mounted the component. But the thing
that strips it is the Supabase client, made at module scope in `lib/supabase.ts` with
`detectSessionInUrl: true`: it starts exchanging the code the moment the module is evaluated and
`history.replaceState`s `code` away when the exchange succeeds. Nothing orders those two. Under Vite's
dev server, which serves modules one by one, the exchange — one round trip to a local Supabase — can
finish before React mounts. AuthCallback then sees no `code`, takes its "somebody arrived with nothing
on it" branch, and calls `leave()`. The stored return was `/login` (from the sign-up's
`rememberReturn`), so it went there, and `/login` forwarded the now-signed-in reader to the shelf.

For a sign-in that was harmless — `leave()` is what success does anyway — which is why it went unseen
for five weeks. Password recovery is the first outcome of the exchange that is *not* "move on".

## The class

**A "read it first" that is only first by luck**: code that captures some shared state "before X
changes it", where X runs on a different clock (module load, a timer, a network reply) and nothing
makes the capture happen-before X. The comment states an ordering; the code assumes one; neither
enforces it.

## Which commit introduced it

`796c2883` (2026-08-27, "Put the gate and the door in the same commit…"), the first AuthCallback.
The intent was right — read the parameters before the SDK strips them — and the comment says so. What
was missed is that the SDK's clock starts at module load, not at mount.

## The fix

Shipped in 261001i: `arrivedWithCode()` in `lib/supabase.ts`, read from `location` at module scope
**before** `createClient`, so it is first by construction; AuthCallback ORs it into `hasCode`.
A red-first test in `tests/auth-callback.test.ts` ("still waits for the verdict when the SDK stripped
the code first") mounts the callback on an empty address with `arrivedWithCode()` true.

The long-term fix is arguably to stop sharing the URL with the SDK at all: `detectSessionInUrl: false`
and an explicit `exchangeCodeForSession(code)` from AuthCallback, which would put the read and the
exchange in one place, in order. Not done: it rewrites the callback's verdict logic, which is an
existing defence in [security-map.md](../project/security-map.md), and the module-scope capture
fixes this instance with one line.

## What would have caught it, ranked by ease against value

1. **When a comment claims an ordering, find what enforces it.** "Before anything strips it" should
   have prompted: what strips it, and when does that start? Costs nothing, and is the whole class.
2. **Exercise the callback in a real browser more than once.** A single run passes most of the time;
   the browser pass for 261001i repeated the recovery about twelve times, which is what surfaced it.
   Cheap for anything with a race in it.
3. A unit test that delays React's mount behind the exchange — rejected as the general answer: you
   can only write it once you already suspect the ordering, which is item 1.

---

Up: [postmortems.md](../project/postmortems.md)
