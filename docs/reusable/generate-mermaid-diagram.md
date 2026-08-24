# Generate Mermaid diagram images

Quick instructions for creating and updating Mermaid diagrams in a project.

> **Provenance.** Copied 2026-08-24 from
> [`docs/instructions/GENERATE_MERMAID_DIAGRAM.md`](https://github.com/gregdetre/gjdutils/blob/main/docs/instructions/GENERATE_MERMAID_DIAGRAM.md)
> in gregdetre/gjdutils, with the `sequential-datetime-prefix.ts` references dropped (no such script
> here) — see [gjdutils-instructions.md](gjdutils-instructions.md).

## Setup

Install Mermaid CLI if not already available:
```bash
npm install -g @mermaid-js/mermaid-cli
```

For detailed configuration options, see the [Mermaid CLI documentation](https://github.com/mermaid-js/mermaid-cli).

## File Organization

- **Source files**: store `.mermaid` files in `docs/diagrams/` (or your preferred documentation directory)
- **Generated files**: save SVG/PNG outputs in the same directory

## File Naming

`yyMMdd[letter]_description_in_normal_case.mermaid`

- Generate the date prefix with `date +%y%m%d` (add the letter suffix by hand if there are several in a day)
- Description: lowercase words separated by underscores (except proper names/acronyms)
- Examples:
  - `250701a_flow_iterative_heading_generation.mermaid`
  - `250701b_architecture_glossary_complete.mermaid`
  - `250701c_diagram_tools_flow_ToC.mermaid`

## Generation Commands

**Prefer SVG format** (scalable, web-friendly):
```bash
npx mmdc -i docs/diagrams/FILENAME.mermaid -o docs/diagrams/FILENAME.svg -w 1400 -H 1600 -s 2 -b transparent -t default
```

**PNG only when specifically requested**:
```bash
npx mmdc -i docs/diagrams/FILENAME.mermaid -o docs/diagrams/FILENAME.png -w 1400 -H 1600 -s 2 -b transparent -t default
```

## Best Practices

### Always Regenerate
**Automatically regenerate the SVG whenever you update a `.mermaid` file** — keep diagrams in sync
with source.

### Simplify Linear Flows
If you have a stack of sequential boxes with no branches, **collapse into a single box** with the
steps as bullet points:

Avoid this:
```
A[Step 1] --> B[Step 2] --> C[Step 3] --> D[Step 4]
```

Prefer this:
```
Process[Process Flow:<br/>• Step 1<br/>• Step 2<br/>• Step 3<br/>• Step 4]
```

### Syntax Tips
- **Avoid special characters** in node labels (quotes, parentheses)
- **Use emojis** for visual clarity
- **Keep labels concise** — detailed descriptions go in documentation
- **Test syntax** before generating images

### Comments

Include a detailed comment in the `.mermaid` file with a prompt to describe/reproduce this diagram
for future reference, including references to relevant files/functions and any other details/intent
mentioned by the user. If asked to update the diagram, update the prompt-comment accordingly.

### Spacing

Reduce spacing so that more information fits on the screen.

### Icons

Include icons sparingly, e.g. for different systems, actions, components.

### Fonts

Use `courier` (or another monospaced font) for API endpoints, urls, function names, variables, etc.

Use *italic* or **bold** in other ways to help aid comprehension.

### Use colour

Use colour appropriately to distinguish major components.

For example, you might give different colours to different systems, e.g.
- purple for user
- brown for browser
- orange for mobile/device
- blue for backend
- yellow for database
- purple for cloud storage (including cloud storage services, S3, etc)
- green for payments

Perhaps use one colour scheme for the outer boxes that group things (e.g. for systems), and another
colour scheme for inner boxes based on a different typology. Use your judgment.

### Shapes, lines, arrows, etc

For database relationships, use database UML-style lines/arrows/shapes.

Likewise, if there's a domain-standard visual-notational scheme that's relevant for (part of) the
diagram, use it there.

## Quick Workflow

1. Generate the filename prefix: `date +%y%m%d` (add a letter suffix if needed)
2. Create/edit the `.mermaid` file with that prefix in `docs/diagrams/`
3. Generate the SVG: `npx mmdc -i docs/diagrams/FILENAME.mermaid -o docs/diagrams/FILENAME.svg -w 1400 -H 1600 -s 2 -b transparent`
4. Open the SVG in the default app: `open docs/diagrams/FILENAME.svg` (or `xdg-open` on Linux)
5. Output the generated filename

### Example Workflow

```bash
# Get the date prefix (add letter suffix manually: 250701a, 250701b, etc.)
date +%y%m%d
# Output: 250701

# Create: docs/diagrams/250701d_tool_execution_flow.mermaid

# Generate the SVG
npx mmdc -i docs/diagrams/250701d_tool_execution_flow.mermaid -o docs/diagrams/250701d_tool_execution_flow.svg -w 1400 -H 1600 -s 2 -b transparent

# Open to verify
open docs/diagrams/250701d_tool_execution_flow.svg
```
