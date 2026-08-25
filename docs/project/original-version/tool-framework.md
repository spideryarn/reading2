# The tool framework — the clearest "don't" in the codebase

They built a unified registry and execution framework for their reader tools, sent the design to two
different models for critique, and both independently found it over-engineered *and* still buggy.
It is the best-evidenced argument in that repo for the boring approach our
[CLAUDE.md](../../../AGENTS.md) already mandates, so it is worth recording properly rather than
just noting "we're not doing that".

Reference docs: `docs/reference/TOOL_EXECUTION_FRAMEWORK.md`,
`docs/reference/TOOL_ARCHITECTURE_AND_DEVELOPMENT_GUIDE.md`. Critique:
`docs/planning/critiques/250630b_gemini_o3_tools_architecture_critique.md`.

## What it is

A single registry that every reader tool registers itself with, plus an executor that runs them. On
top of that:

- typed wrapper generation
- a six-class error hierarchy
- RFC-9457 problem-detail responses
- a debug mode with execution history, profiling and a mock executor
- dynamic generation of the command palette's entries from the registry

For **seven tools**.

## What two independent critiques found

Gemini and o3 were asked separately. They converged, which is the part that matters — these are not
one reviewer's taste:

- **Inconsistent tool-definition shapes**, able to cause runtime errors.
- **A registry-lock race** that can throw during SSR or from a lazily-loaded chunk.
- **String-heuristic timeout classification** — literally `action.includes('ai')` deciding how long
  something is allowed to take.
- **A stringly-typed `componentPath`** that silently 404s when someone renames a file. A refactor
  breaks a tool and nothing says so until a user clicks it.
- **`Record<string, unknown>` parameters** — zero compile-time safety, after all that ceremony.

Both reviewers' top recommendation was the same: **push the work onto the type system** — a Zod
schema per tool action, literal-union tool ids — rather than validating at runtime.

That is the sting. The framework's entire justification is safety and uniformity, and it delivered
neither: the type system was left with nothing to check, so every guarantee had to be re-established
at runtime, where it could still be got wrong.

## What we take from this

**Don't build it.** Our stages are plain functions that read JSON and write JSON
([architecture.md § Pipeline](../architecture.md#pipeline)), run by `npm run <stage>`. That is the
end state their critics recommended, arrived at by not starting.

Two specific rules worth holding onto as this repo grows:

1. **If a registry ever becomes necessary, make it a flat `const` array with a literal union type**
   — no runtime registration, no locking, no wrapper generation. The compiler then knows every tool
   id, and a rename is a type error rather than a 404.
2. **Never classify behaviour by string-matching a name.** `action.includes('ai')` is the same
   category of mistake as their `error.message.includes('rate limit')`
   ([llm-plumbing.md § Error handling](llm-plumbing.md#error-handling-dont-copy-this)) — behaviour
   inferred from prose that nobody promised to keep stable. It fails silently the day someone
   renames something, which is the pattern in
   [silent-success.md](../../reusable/silent-success.md).

The related **reversible-mutations framework**
(`MUTATIONS_DOCUMENT_CONTENT_REVERSIBLE_TRANSFORMS.md`) is out of scope for the same reason but a
different one: it exists to make edits to a stored document undoable, and **we never edit the
article**. See [ai-headings.md § Where our architecture is already ahead](ai-headings.md#where-our-architecture-is-already-ahead).

## See also

- [overview.md](overview.md) — the map to that codebase
- [llm-plumbing.md](llm-plumbing.md) — the layer underneath this one, where the good ideas are
- [process-and-docs.md](process-and-docs.md) — the critique habit that caught this, which *is* worth stealing
- [../architecture.md](../architecture.md) — our stages, and why they stay plain functions
