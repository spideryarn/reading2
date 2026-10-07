# Await ordering lets a secondary failure defeat absence

Found while reviewing `845373603` for
[261007n](../plans/261007n-the-last-six-artefact-reads-answer-none-yet-as-200-null.md).
Reader impact has not been established. Parent: [postmortems.md](../project/postmortems.md).

The commit replaced Skim's parallel `Promise.all` with a profile-first await to keep the
response-writing absence helper from answering twice. That avoided duplicate responses, but
changed the meaning of a secondary failure: a failed profile returned 500 even when Skim was
not made yet, and a pending profile prevented absence from answering at all. The existing
`withProfileChanged` reads already give absence precedence over the profile.

## The class: await ordering changes failure precedence

Serialising response writes and choosing which failure wins are separate decisions. This fix
treated the former as requiring the profile to settle first. Its tests copied that choice,
asserting 500 in both completion orders, so they defended one response while accepting the
changed precedence. A read-only root-cause subagent confirmed this comparison with the sibling
helper.

The review changed the tests first: **eight failures** on the committed route. Four expected
200 null or legacy 404 but received 500; two timed out with a pending profile; two exposed
missing `private, no-store` on a made Skim whose profile failed before the helper ran.
After the route fix, all **120 catch-boundary tests passed**.

## What would have caught it, ranked by ease against value

1. **Assert outcome as well as write count in both completion orders, and leave the secondary
   read pending.** Applied here, with both header variants and made-Skim profile failures.
   These cheap cases distinguish response safety from outcome precedence.
2. **Compare the failure policy with sibling readers before changing await order.** Their
   observed profile rejection already demonstrates how to keep reads parallel without forcing
   an irrelevant failure into the response.
3. **Make the absence helper return a result without writing a response.** Rejected for this
   review: refactoring every route adds scope when explicit sequential awaits enforce the
   intended policy locally.

## The fix that is right for the long term

Start and observe the profile promise, await the artefact through the helper, and return on
exact null before awaiting the profile. Only a made Skim needs the profile comparison. This
keeps the reads parallel, preserves Skim's cleared-profile semantics, and sets the cache header
before either response outcome. The regression tests enforce the policy at the dispatcher.
