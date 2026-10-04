# A syntax guard can walk the whole tree and miss a whole import form

Review of [plan 261004c](../plans/261004c-sweep-cluster-11-no-blocking-child-process-on-the-dashboard-or-the-daemon.md)
found that its new synchronous-child-import guard missed TypeScript import-equals declarations.
This was a guard defect caught before restart, not an observed blocking incident. No existing
offending import was found through this form.

## The class: traversal coverage is mistaken for syntax coverage

`import cp = require("node:child_process")` produces a `TSImportEqualsDeclaration` containing a
`TSExternalModuleReference`. Its `require` spelling is not a `CallExpression`, and its declaration
is not an `ImportDeclaration`. `syncChildImports` visited these nodes but recognised neither.
The flat scan therefore returned no value import, admitting a whole module whose synchronous
APIs were one property access away. The reviewer's red regression at line 152 reported
**expected `[]` to deeply equal `['*']`**.

**046396e2f**, “261004c stage 1: a guard against new synchronous child calls, and work-probe quotes
the clock”, introduced the omission. The scanner's own tests claimed every spelling, but their
examples covered JavaScript declarations, calls and dynamic imports only. Walking every node
does not prove that the decision recognises every relevant node kind. The existing `.cts` scan
also makes this form part of the guard's actual input language.

## The fix and the countermeasures, ranked by ease against value

1. **Check distinct parsed forms, with paired value/type cases.** Cheap examples now cover
   import-equals for both `child_process` module spellings and require type-only imports to stay
   clear. The primary reviewer saw the value case fail before fixing it.
2. **Recognise the TypeScript declaration at the policy boundary.** The review patch handles
   `TSImportEqualsDeclaration` and reads its external module reference, marking value imports
   `*`. This is the appropriate long-term fix for the scanner's supported language.
3. **Reject a text search for `require` or synchronous API names.** It would confuse comments,
   strings and type-only imports with value imports, abandoning the distinction the guard exists
   to enforce.
4. **Reject a new lint framework or type-resolution system for this omission.** The known gap is
   one distinct AST form, and adding a second analysis system would cost more than covering that
   form in the existing parser. The literal baseline and whole-tree traversal need no redesign.

Investigation: 2026-10-04, source and git-history inspection in a read-only-code subagent; failing
regression supplied by the primary reviewer. No code or test changes were made by this subagent.

Up: [Postmortems](../project/postmortems.md).
