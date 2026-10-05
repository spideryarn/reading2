# A refusal test gives the forbidden action nothing to act on

Up: [Postmortems](../project/postmortems.md)

Review finding D1 in the command-bar stage of
[261005a](../plans/261005a-dictation-double-press-on-stop-also-sends.md), introduced by
`8ac1d0f6d`. No production failure was found.

The test `runs nothing when no transcript arrived` in
[`command-bar-double-stop.test.tsx`](../../tests/command-bar-double-stop.test.tsx) began with an empty
draft and ended without a transcript. Even an erroneous Enter would have neither a row to run nor
a sentence to ask about. Its empty-result assertions therefore could not distinguish a refused
action from an action that ran and did nothing. This is **a refusal test whose fixture gives the
forbidden action nothing to act on**.

The production hook correctly requires delivery of an authoritative transcript. The fix is in the
fixture: supply Chromium live words through `onText("plain")`, take the double press, fail the
transcript, and assert that Plain did not run and that the rough words survived. A subsequent fresh
Enter proves those same words really could run Plain.

Evidence: the surviving-word assertion first failed against the empty fixture. After supplying live
words, temporarily removing `delivered.current` from the hook's send condition made the test fail:
Enter ran Plain and cleared the draft. The mutation was restored; the shared hook is unchanged.

What would catch the class, ranked by ease against value:

1. Give each refusal test a viable forbidden action, and assert that precondition. Cheap; done here.
2. Temporarily remove the specific refusal and verify that the test detects the consequence. Cheap
   for this hook; done here. See [silent-success.md](../reusable/silent-success.md).
3. Broad mutation infrastructure is unnecessary for this stage: the targeted mutation supplies the
   relevant evidence without another test system.
