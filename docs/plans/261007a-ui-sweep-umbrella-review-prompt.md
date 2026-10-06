# Plan review: the UI sweep's umbrella (nonce: UI-PLAN-9K)

Begin your answer with the nonce above. Read-only: change no file.

Review `docs/plans/261007a-ui-sweep-umbrella.md` in this checkout (branch
`worktree-ui-sweep-umbrella`; the tree audited was `bf78e90c7`, and `origin/dev` has been merged
since). It is the plan for four small clusters of UI fixes, K1 to K4, each to be built by a separate
agent in its own worktree. Nothing is built yet. Your review decides what the builders are told.

Method it follows: `docs/reusable/improve-the-codebase.md`. Sibling plans for context:
`docs/plans/261006j-sixth-codebase-sweep-umbrella.md` (and its `-review-sol.md`), and
`docs/plans/261006m-seventh-codebase-sweep-depth-umbrella.md`, which is being built now by another
session; its clusters C2 and C10 touch some of the same hooks and panels.

Every finding in the plan is a claim taken from a nominator. I re-read the code for the ones
marked with a tick; the rest I did not. **Check the claims against the code, by content, not by
line number.** In particular:

1. For each bullet of K1, K2 and K3: is the defect real as described? Is there a reachable state
   that shows it? Is the stated fix the right one, and the smallest? What already exists that the
   fix would duplicate? Name any bullet whose fix would change something a reader sees beyond what
   the plan says.
2. K1's `.loading, .error` item: find every element that carries a bare `error` or `loading`
   class (components, and any class built at runtime). Would scoping the rule to `pre.error`
   break one?
3. K1's decision to use `--destructive` directly and add no `--danger` token: is `--destructive`
   right for those two rows in both themes (compute the contrast of each theme's value on the
   surfaces those rows sit on)? I was asked to "define `--danger` from the colour scale" and chose
   not to add a token; my decision, not the user's. Say if that is wrong.
4. K1's focus marks: for each named control, what draws focus today, and would
   `2px solid var(--highlight-text)` collide with a neighbour, be clipped by an
   `overflow: hidden` ancestor, or double up with an existing ring?
5. K2's composition guards: read `src/web/key-chord.ts`. For each of the four handlers, is
   `isImeComposing` the right guard, and does the guard need to sit before or after the existing
   `stopPropagation`? Is there a fifth handler of the same shape the plan missed (grep every
   `e.key === "Enter"` and `"Escape"` on an input or textarea in `src/web`)?
6. K2's shelf passage filter: is the proposed derivation right, and does it apply the text query
   twice, or change the separately scoped public/archive suggestions?
7. K3's failure sentences: for each of the six sites, what can throw there, and does
   `describeFetchFailure` give the right sentence for each thrower? For the further
   `(e as Error).message` sites the plan calls hypotheses, say which a non-`ReaderFacingError`
   can reach.
8. K3's Search order row moving onto `OrderGroup`: what does `OrderGroup` do that would change
   Search's look or behaviour (scrolling, wrapping, the class names it adds)?
9. K4: is "39 of 40 rule pairs identical" true (compare the declarations yourself)? Which tests
   read these stylesheets or class names as text, and which other selectors elsewhere
   (`narrow-window.css`, `voices.css`, `:has()` rules) name the classes to be merged? Does the
   dedup earn its keep, or does it only move the duplication into the components? Is a modifier
   for Debate's value one flag too many?
10. The file sets and waves: are K1 and K2 disjoint? Does anything in K3 collide with the seventh
    sweep's C2 or C10 beyond a mergeable line?
11. § For Greg: is anything in the three questions actually a no-trade-off fix that should be
    built, or anything in the clusters actually a design change that should be a question? Is any
    question unanswerable as written by someone who has not read the code?
12. What is missing: a live defect in the UI that the scope line says was looked at and the plan
    does not mention.

Severity scale: P0 the plan would ship a defect or break something; P1 a claim is false or a fix
is wrong; P2 unclear or incomplete; P3 wording. Give every finding an ID (U1, U2, ...), the
evidence (file and the content you matched), and what the plan should say instead. End with a
verdict: ready / ready with these fixes / not ready.

You may run a single test file (`npx vitest run tests/<one>.test.ts`) or a script
(`node --import tsx <script>`) if it needs no network or database. You cannot run a browser.

My own suspicions, last on purpose: that K1 is too many unrelated edits for one review; that the
focus-mark item is a design change in disguise; that K4's "no pixel moved" is easier to claim than
to show; and that one or two of Sol's own breadth findings (G1, G2) that I did not re-read are
wrong.
