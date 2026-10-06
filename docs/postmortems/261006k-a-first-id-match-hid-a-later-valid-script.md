# A first ID match hid a later valid script

Up: [postmortems.md](../project/postmortems.md)

Found during review of `61b440abd`, 2026-10-06. In memory, an earlier `<div>` or invalid script
with `id="anubis_version"` was inserted before WineHQ's valid version script. The parsed source
still carried both elements required by the new Anubis shape, but both read paths returned no
refusal and `runExtract` published *"Making sure you're not a bot!"*. These were constructed
inputs; no live page with duplicate IDs or affected reader was established.

## First-match lookup substituted for an existence test

The new shape asks whether a valid version script exists alongside the module solver. Its shared
`jsonScript` helper used `getElementById`, which returns the first element with that ID. Testing
that element's tag, type and JSON cannot inspect a later matching script.

Commit `61b440abd` reused this lookup for the new version branch. The first challenge branch
had the same lookup since `677404435`, where its review named the limit and kept it. Every positive fixture and synthetic control had one version ID, so first-match and
existence semantics gave the same answer. The solver scan already considered every script.

## The fix and what would catch the class

Both branches now go through one helper, `hasJsonScript`, which checks every script with the ID
and asks whether any of them passes. The reviewer fixed the second branch; the first was changed
straight afterwards, with three tests of its own seen red (an earlier non-script, wrong-type script
and empty object in front of the real challenge script). For the second branch, four new
tests in [extract-challenge-page.test.ts](../../tests/extract-challenge-page.test.ts) were seen
red before the fix: an earlier non-script, wrong-type script, malformed JSON script and empty
version string. They exercise both read paths and production extraction, including uploads.
A negative control requires duplicate invalid version scripts to remain an article.

1. **Put a nonmatching element before a matching element in an existence-test fixture.** Cheap,
   done here, and distinguishes existence from first-match lookup.
2. **Keep the predicate's quantifier when choosing its lookup.** “There is a valid element”
   requires inspecting candidates; “the first element is valid” is a different rule.
3. Reject every document with duplicate IDs — rejected. It would refuse readable input for a
   markup defect unrelated to whether the document is a bot check.
