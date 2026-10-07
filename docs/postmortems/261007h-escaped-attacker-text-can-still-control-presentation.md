# Escaped attacker text can still control presentation

Up: [postmortems.md](../project/postmortems.md)

Code review found two ways the Hidden text panel treated document-written strings as more inert
than they were. The new location wording had not landed on `dev`; the older bidi and unbounded-value
exposure predated this branch and was found while reviewing the same boundary, not from a reader
report.

The first implementation of plan 261007h split a source-path string on ` > ` and turned apparent
tag names into descriptions such as *marked up as maths*. But the scanner's path also contains an
unescaped document id, so `id="note > math"` forged a tag step. Separately, the panel put returned
text, paths and evidence directly into React text nodes. React escaped HTML, but a bidi override
remained active Unicode and could reorder the evidence on screen. The path and detail were also
uncapped, so a document-controlled id, class or CSS value could fill the panel and push the finding's
own capped words out of reach.

The location inference was introduced by `07a0ab957`. The direct rendering dates to the panel's
first production UI in `be39c194b`; the scanner already reported bidi controls, so this was a
presentation gap rather than a new scanner defect.

## Escaped text is not inert text

The class is **attacker text mistaken for inert display data after HTML escaping**. Escaping closes
markup injection. It does not make delimiters trustworthy, and it does not neutralise Unicode whose
job is to change presentation. Both bugs came from spending a string as structure after the trust
boundary that produced it had already been forgotten.

The plan review had correctly said that `where` was attacker-written, but accepted the narrower
claim that parsing tag names while ignoring ids and classes was safe. The code and its tests shared
that assumption: every fixture used an honestly delimited path. The bidi case had no presentation
test at all; scanner tests proved the control was detected, not that a referee could safely read the
returned string.

## What would have caught it, ranked by ease against value

1. **An adversarial rendering fixture at the browser boundary** — being done. The tests use a path
   separator inside an id, a bidi override in all three displayed fields, and 10,000-character path
   and detail values. Each was watched fail on the original code.
2. **Keep lossy interpretations behind structured fields** — being done for this instance. The UI
   keeps `where` as opaque evidence because the answer shape has no trustworthy element-name field.
3. **A generic control-character display component** — deferred. Other surfaces may need one, but
   introducing an application-wide rendering policy from one audited panel is wider than this fix.
4. **Escaping more punctuation in the scanner's path** — rejected here. That would edit the defence
   and still make a presentation contract depend on a display string's private encoding.

## The long-term fix

The shipped fix is also the right local design: remove the inferred location, visibly replace bidi
controls with their code points, isolate the remaining evidence with `bdi`, and cap the two uncapped
document-written evidence fields at the display boundary. If a future UI needs a semantic location,
the result type should carry a structured, DOM-derived field rather than ask a reader-facing source
hint to become one.

The broader class remains open outside this panel. A future sweep should look for untrusted strings
that are escaped as HTML but then parsed by separators, fed to direction-sensitive text layout, or
otherwise treated as passive because they are in a text node.

## The thing I would tell myself

I knew the path was attacker-written and checked only the obvious class/id forgery. I should have
asked whether the path's grammar itself was authenticated, and whether “React escaped it” said
anything at all about how Unicode would draw it.
