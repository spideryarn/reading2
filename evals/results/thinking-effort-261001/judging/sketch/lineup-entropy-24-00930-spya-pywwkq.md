# 4 candidates for "Revealing the Dynamics of Neural Information Processing with Multivariate Information Decomposition"

Each candidate is a picture of how the article is put together, for a reader who has not read it yet. They are labelled W, X, Y, Z in an order that
says nothing about how any of them was made. The article itself, with its block ids, is
`article-entropy-24-00930-spya-pywwkq.md` beside this file.

## Candidate W

Picture: /home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/results/thinking-effort-261001/judging/sketch/picture-entropy-24-00930-spya-pywwkq-W.png

Scene:

```json
{
  "title": "Chain with two expansions",
  "caption": "The article runs as one long chain—from motivation through method to evidence to limits and future—with two dense stretches (the PID math, and the empirical findings) pulled out as zooms.",
  "scenes": [
    {
      "id": "overview",
      "title": "Overview",
      "height": 1180,
      "items": [
        {
          "kind": "node",
          "id": "intro",
          "shape": "ellipse",
          "x": 260,
          "y": 30,
          "w": 240,
          "h": 70,
          "text": "Neural information processing: open problem",
          "size": "md",
          "block": "spya-yb735k"
        },
        {
          "kind": "node",
          "id": "track",
          "shape": "box",
          "x": 260,
          "y": 140,
          "w": 240,
          "h": 70,
          "text": "Tracking info: mutual information & transfer entropy",
          "size": "sm",
          "block": "spya-ygkzd8"
        },
        {
          "kind": "node",
          "id": "limit",
          "shape": "box",
          "x": 260,
          "y": 250,
          "w": 240,
          "h": 60,
          "text": "Transfer alone can't show how inputs combine",
          "size": "sm",
          "block": "spya-dhy39x"
        },
        {
          "kind": "region",
          "x": 140,
          "y": 340,
          "w": 480,
          "h": 220,
          "style": "band",
          "label": "PID: THE METHOD",
          "opens": "inside-pid",
          "tone": 1
        },
        {
          "kind": "node",
          "id": "pid",
          "shape": "hex",
          "x": 260,
          "y": 380,
          "w": 240,
          "h": 70,
          "text": "Partial information decomposition",
          "size": "md",
          "detail": "Splits joint information into redundant, unique, synergistic parts",
          "block": "spya-u0wm5e"
        },
        {
          "kind": "node",
          "id": "lattice",
          "shape": "box",
          "x": 260,
          "y": 480,
          "w": 240,
          "h": 60,
          "text": "Lattice + redundancy measure needed",
          "size": "sm",
          "block": "spya-k378fv"
        },
        {
          "kind": "region",
          "x": 120,
          "y": 600,
          "w": 520,
          "h": 340,
          "style": "band",
          "label": "PID IN ACTION",
          "opens": "inside-evidence",
          "tone": 2
        },
        {
          "kind": "node",
          "id": "richclub",
          "shape": "box",
          "x": 160,
          "y": 640,
          "w": 200,
          "h": 60,
          "text": "Synergy concentrated in rich clubs",
          "size": "sm",
          "block": "spya-e3ghxj"
        },
        {
          "kind": "node",
          "id": "recurrent",
          "shape": "box",
          "x": 400,
          "y": 640,
          "w": 200,
          "h": 60,
          "text": "Recurrent links raise synergy",
          "size": "sm",
          "block": "spya-p8by2y"
        },
        {
          "kind": "node",
          "id": "corr",
          "shape": "box",
          "x": 160,
          "y": 740,
          "w": 200,
          "h": 60,
          "text": "Synergy peaks at mid correlation",
          "size": "sm",
          "block": "spya-zfs2z7"
        },
        {
          "kind": "node",
          "id": "primate",
          "shape": "box",
          "x": 400,
          "y": 740,
          "w": 200,
          "h": 70,
          "text": "In monkeys, redundancy rises during movement",
          "size": "sm",
          "block": "spya-aqcngt"
        },
        {
          "kind": "node",
          "id": "caveat",
          "shape": "note",
          "x": 280,
          "y": 850,
          "w": 220,
          "h": 60,
          "text": "Caveats: cultures, bivariate bias",
          "size": "sm",
          "block": "spya-vjzxxm"
        },
        {
          "kind": "node",
          "id": "practical",
          "shape": "box",
          "x": 260,
          "y": 960,
          "w": 240,
          "h": 70,
          "text": "Practical limits: data type, sampling, tools",
          "size": "sm",
          "block": "spya-kmgwhs"
        },
        {
          "kind": "node",
          "id": "future",
          "shape": "box",
          "x": 260,
          "y": 1060,
          "w": 240,
          "h": 60,
          "text": "Future: local & multi-target PID",
          "size": "sm",
          "block": "spya-zz5xxs"
        },
        {
          "kind": "edge",
          "from": "intro",
          "to": "track",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "track",
          "to": "limit",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "limit",
          "to": "pid",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "pid",
          "to": "lattice",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "lattice",
          "to": "richclub",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "lattice",
          "to": "recurrent",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "richclub",
          "to": "caveat",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "recurrent",
          "to": "caveat",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "corr",
          "to": "caveat",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "primate",
          "to": "caveat",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "caveat",
          "to": "practical",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "practical",
          "to": "future",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "A chain from the problem of neural information processing, through the PID method, to empirical tests, practical limits, and future extensions."
    },
    {
      "id": "inside-pid",
      "title": "The PID method",
      "height": 700,
      "items": [
        {
          "kind": "node",
          "id": "joint",
          "shape": "ellipse",
          "x": 280,
          "y": 40,
          "w": 220,
          "h": 70,
          "text": "Joint mutual information (the whole)",
          "size": "md",
          "block": "spya-h5dz45"
        },
        {
          "kind": "node",
          "id": "ineq",
          "shape": "diamond",
          "x": 280,
          "y": 140,
          "w": 220,
          "h": 80,
          "text": "Whole vs sum of parts",
          "size": "sm",
          "block": "spya-e94ury"
        },
        {
          "kind": "node",
          "id": "syn",
          "shape": "box",
          "x": 80,
          "y": 260,
          "w": 200,
          "h": 60,
          "text": "Whole > parts: synergy",
          "size": "sm",
          "block": "spya-e94ury"
        },
        {
          "kind": "node",
          "id": "red",
          "shape": "box",
          "x": 480,
          "y": 260,
          "w": 200,
          "h": 60,
          "text": "Whole < parts: redundancy",
          "size": "sm",
          "block": "spya-e94ury"
        },
        {
          "kind": "node",
          "id": "twoparent",
          "shape": "box",
          "x": 280,
          "y": 360,
          "w": 220,
          "h": 70,
          "text": "Two-parent case: 4 unknowns, 3 equations",
          "size": "sm",
          "block": "spya-y7wdb7"
        },
        {
          "kind": "node",
          "id": "lattice2",
          "shape": "hex",
          "x": 280,
          "y": 460,
          "w": 220,
          "h": 70,
          "text": "General lattice of info atoms",
          "size": "sm",
          "block": "spya-k378fv"
        },
        {
          "kind": "node",
          "id": "mobius",
          "shape": "box",
          "x": 280,
          "y": 560,
          "w": 220,
          "h": 60,
          "text": "Atoms solved via Mobius inversion",
          "size": "sm",
          "block": "spya-t8mg0s"
        },
        {
          "kind": "node",
          "id": "redmeasure",
          "shape": "note",
          "x": 280,
          "y": 640,
          "w": 220,
          "h": 60,
          "text": "No single accepted redundancy measure",
          "size": "sm",
          "block": "spya-d2quz5"
        },
        {
          "kind": "edge",
          "from": "joint",
          "to": "ineq",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "ineq",
          "to": "syn",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "ineq",
          "to": "red",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "syn",
          "to": "twoparent",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "red",
          "to": "twoparent",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "twoparent",
          "to": "lattice2",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "lattice2",
          "to": "mobius",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "mobius",
          "to": "redmeasure",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "A funnel: joint mutual information is split, first by intuition with two sources, then generalized via a lattice that needs a chosen redundancy measure."
    },
    {
      "id": "inside-evidence",
      "title": "PID in action",
      "height": 640,
      "items": [
        {
          "kind": "node",
          "id": "setup",
          "shape": "ellipse",
          "x": 280,
          "y": 30,
          "w": 220,
          "h": 60,
          "text": "Cultured cortex, thousands of triads",
          "size": "md",
          "block": "spya-cc282b"
        },
        {
          "kind": "node",
          "id": "ff",
          "shape": "box",
          "x": 60,
          "y": 140,
          "w": 180,
          "h": 60,
          "text": "Synergy tracks feedforward strength",
          "size": "sm",
          "block": "spya-kqkb58"
        },
        {
          "kind": "node",
          "id": "rich",
          "shape": "box",
          "x": 280,
          "y": 140,
          "w": 180,
          "h": 60,
          "text": "Rich club: 88% of synergy",
          "size": "sm",
          "block": "spya-fud8q3"
        },
        {
          "kind": "node",
          "id": "motif",
          "shape": "box",
          "x": 500,
          "y": 140,
          "w": 200,
          "h": 60,
          "text": "Recurrent links boost, feedback doesn't",
          "size": "sm",
          "block": "spya-sd9fzd"
        },
        {
          "kind": "node",
          "id": "peak",
          "shape": "box",
          "x": 160,
          "y": 260,
          "w": 220,
          "h": 70,
          "text": "Synergy peaks at intermediate source correlation",
          "size": "sm",
          "block": "spya-ybmve2"
        },
        {
          "kind": "node",
          "id": "concl1",
          "shape": "diamond",
          "x": 280,
          "y": 370,
          "w": 220,
          "h": 70,
          "text": "Synergy is concentrated, structured",
          "size": "sm",
          "block": "spya-e3ghxj"
        },
        {
          "kind": "node",
          "id": "caveats2",
          "shape": "note",
          "x": 280,
          "y": 470,
          "w": 220,
          "h": 60,
          "text": "In vitro, bivariate TE caveats",
          "size": "sm",
          "block": "spya-vjzxxm"
        },
        {
          "kind": "node",
          "id": "primate2",
          "shape": "box",
          "x": 280,
          "y": 560,
          "w": 260,
          "h": 70,
          "text": "Macaques: redundancy rises in motor execution",
          "size": "sm",
          "block": "spya-t8fayf"
        },
        {
          "kind": "edge",
          "from": "setup",
          "to": "ff",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "setup",
          "to": "rich",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "setup",
          "to": "motif",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "ff",
          "to": "peak",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "rich",
          "to": "concl1",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "motif",
          "to": "concl1",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "peak",
          "to": "concl1",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "concl1",
          "to": "caveats2",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "caveats2",
          "to": "primate2",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "Several independent findings from cortical cultures and behaving animals converge on one picture: synergy tracks network structure and task demands."
    }
  ]
}
```

## Candidate X

Picture: /home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/results/thinking-effort-261001/judging/sketch/picture-entropy-24-00930-spya-pywwkq-X.png

Scene:

```json
{
  "title": "Funnel into converging evidence",
  "caption": "The piece funnels from a broad problem (how do neurons process information?) down through a formal tool (PID) and then fans out into converging empirical findings, before closing with limits and a summary that loops back to the opening question.",
  "scenes": [
    {
      "id": "overview",
      "title": "Overview",
      "height": 1180,
      "items": [
        {
          "kind": "node",
          "id": "intro",
          "shape": "ellipse",
          "x": 260,
          "y": 30,
          "w": 240,
          "h": 70,
          "text": "How do brains process information?",
          "size": "md",
          "detail": "New recording tech and analysis methods now make this tractable.",
          "block": "spya-yb735k"
        },
        {
          "kind": "node",
          "id": "mite",
          "shape": "hex",
          "x": 260,
          "y": 140,
          "w": 240,
          "h": 70,
          "text": "Mutual information & transfer entropy track flow",
          "size": "sm",
          "detail": "Measure dependence and directed information flow between neurons.",
          "block": "spya-ygkzd8"
        },
        {
          "kind": "node",
          "id": "limit",
          "shape": "note",
          "x": 260,
          "y": 250,
          "w": 240,
          "h": 60,
          "text": "But flow alone can't show how inputs combine",
          "size": "sm",
          "block": "spya-dhy39x"
        },
        {
          "kind": "node",
          "id": "pid",
          "shape": "hex",
          "x": 260,
          "y": 350,
          "w": 240,
          "h": 70,
          "text": "Partial Information Decomposition (PID)",
          "size": "lg",
          "sub": "redundant, unique, synergistic atoms",
          "detail": "Splits joint information into interpretable pieces via a lattice.",
          "block": "spya-u0wm5e",
          "opens": "inside-pid"
        },
        {
          "kind": "region",
          "x": 40,
          "y": 470,
          "w": 680,
          "h": 330,
          "style": "band",
          "label": "EMPIRICAL FINDINGS (PID IN ACTION)",
          "opens": "inside-findings",
          "tone": 1
        },
        {
          "kind": "node",
          "id": "richclub",
          "shape": "box",
          "x": 60,
          "y": 520,
          "w": 190,
          "h": 70,
          "text": "Synergy concentrates in rich clubs",
          "size": "sm",
          "tone": 1,
          "block": "spya-e3ghxj"
        },
        {
          "kind": "node",
          "id": "recurrent",
          "shape": "box",
          "x": 280,
          "y": 520,
          "w": 190,
          "h": 70,
          "text": "Recurrent connections boost synergy",
          "size": "sm",
          "tone": 1,
          "block": "spya-p8by2y"
        },
        {
          "kind": "node",
          "id": "corr",
          "shape": "box",
          "x": 500,
          "y": 520,
          "w": 190,
          "h": 70,
          "text": "Synergy peaks at moderate correlation",
          "size": "sm",
          "tone": 1,
          "block": "spya-zfs2z7"
        },
        {
          "kind": "node",
          "id": "primate",
          "shape": "box",
          "x": 280,
          "y": 630,
          "w": 190,
          "h": 70,
          "text": "In monkeys, task shifts synergy vs redundancy",
          "size": "sm",
          "tone": 1,
          "block": "spya-aqcngt"
        },
        {
          "kind": "node",
          "id": "caveats",
          "shape": "note",
          "x": 280,
          "y": 730,
          "w": 190,
          "h": 60,
          "text": "Caveats: cultures, bivariate estimates",
          "size": "sm",
          "block": "spya-vjzxxm"
        },
        {
          "kind": "node",
          "id": "practical",
          "shape": "box",
          "x": 260,
          "y": 850,
          "w": 240,
          "h": 70,
          "text": "Practical limits: data type, sample size, lattice explosion",
          "size": "sm",
          "block": "spya-kmgwhs"
        },
        {
          "kind": "node",
          "id": "future",
          "shape": "box",
          "x": 260,
          "y": 960,
          "w": 240,
          "h": 70,
          "text": "Future: local & multi-target PID",
          "size": "sm",
          "block": "spya-zz5xxs",
          "opens": "inside-future"
        },
        {
          "kind": "node",
          "id": "summary",
          "shape": "ellipse",
          "x": 260,
          "y": 1070,
          "w": 240,
          "h": 70,
          "text": "Neurons compute on patterns, not just totals",
          "size": "md",
          "block": "spya-rc5z33"
        },
        {
          "kind": "edge",
          "from": "intro",
          "to": "mite",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "mite",
          "to": "limit",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "limit",
          "to": "pid",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "pid",
          "to": "richclub",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "pid",
          "to": "recurrent",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "pid",
          "to": "corr",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "richclub",
          "to": "primate",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "recurrent",
          "to": "primate",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "corr",
          "to": "primate",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "primate",
          "to": "caveats",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "caveats",
          "to": "practical",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "practical",
          "to": "future",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "future",
          "to": "summary",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "summary:left",
          "to": "intro:left",
          "via": "straight",
          "line": "dashed",
          "arrow": "end",
          "label": "returns to the opening question"
        }
      ],
      "caption": "A funnel: broad question narrows to the PID method, which then opens into several empirical findings that converge on one message, followed by limits and future work."
    },
    {
      "id": "inside-pid",
      "title": "Inside: PID framework",
      "height": 760,
      "items": [
        {
          "kind": "node",
          "id": "puzzle",
          "shape": "diamond",
          "x": 280,
          "y": 40,
          "w": 200,
          "h": 80,
          "text": "Whole vs sum of parts: synergy or redundancy?",
          "size": "sm",
          "block": "spya-u0wm5e"
        },
        {
          "kind": "node",
          "id": "twosource",
          "shape": "box",
          "x": 280,
          "y": 170,
          "w": 200,
          "h": 70,
          "text": "Two-parent case: redundant+unique+synergistic atoms",
          "size": "sm",
          "block": "spya-y7wdb7"
        },
        {
          "kind": "node",
          "id": "underdet",
          "shape": "note",
          "x": 280,
          "y": 280,
          "w": 200,
          "h": 60,
          "text": "Equations underdetermined without more info",
          "size": "sm",
          "block": "spya-y7wdb7"
        },
        {
          "kind": "node",
          "id": "lattice",
          "shape": "hex",
          "x": 280,
          "y": 380,
          "w": 200,
          "h": 80,
          "text": "General case: partial information lattice",
          "size": "sm",
          "detail": "Mobius inversion over a partially ordered set of sources yields each atom.",
          "block": "spya-k378fv"
        },
        {
          "kind": "node",
          "id": "redmeasure",
          "shape": "diamond",
          "x": 280,
          "y": 510,
          "w": 200,
          "h": 80,
          "text": "Which redundancy measure to use?",
          "size": "sm",
          "block": "spya-d2quz5"
        },
        {
          "kind": "node",
          "id": "nomeasure",
          "shape": "note",
          "x": 280,
          "y": 630,
          "w": 200,
          "h": 70,
          "text": "No single accepted answer; choice depends on data",
          "size": "sm",
          "block": "spya-d2quz5"
        },
        {
          "kind": "edge",
          "from": "puzzle",
          "to": "twosource",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "twosource",
          "to": "underdet",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "underdet",
          "to": "lattice",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "lattice",
          "to": "redmeasure",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "redmeasure",
          "to": "nomeasure",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "A chain: from the puzzle that whole ≠ sum of parts, through the two-source special case, to the general lattice, ending at the unresolved choice of redundancy measure."
    },
    {
      "id": "inside-findings",
      "title": "Inside: empirical findings",
      "height": 620,
      "items": [
        {
          "kind": "node",
          "id": "setup",
          "shape": "box",
          "x": 280,
          "y": 30,
          "w": 220,
          "h": 70,
          "text": "Hundreds of cultured neurons, thousands of triads analyzed",
          "size": "sm",
          "block": "spya-cc282b"
        },
        {
          "kind": "node",
          "id": "ff",
          "shape": "box",
          "x": 280,
          "y": 130,
          "w": 220,
          "h": 60,
          "text": "Synergy tracks feedforward transfer entropy",
          "size": "sm",
          "tone": 1,
          "block": "spya-cc282b"
        },
        {
          "kind": "node",
          "id": "rc",
          "shape": "box",
          "x": 60,
          "y": 250,
          "w": 190,
          "h": 80,
          "text": "Rich club: 40% of neurons, ~88% of synergy",
          "size": "sm",
          "tone": 1,
          "block": "spya-e3ghxj"
        },
        {
          "kind": "node",
          "id": "motif",
          "shape": "box",
          "x": 280,
          "y": 250,
          "w": 190,
          "h": 80,
          "text": "Recurrent connections raise synergy; feedback does not",
          "size": "sm",
          "tone": 1,
          "block": "spya-p8by2y"
        },
        {
          "kind": "node",
          "id": "corrdetail",
          "shape": "box",
          "x": 500,
          "y": 250,
          "w": 190,
          "h": 80,
          "text": "Synergy peaks at ~7% of max correlation, then falls",
          "size": "sm",
          "tone": 1,
          "block": "spya-zfs2z7"
        },
        {
          "kind": "node",
          "id": "caveat2",
          "shape": "note",
          "x": 280,
          "y": 370,
          "w": 220,
          "h": 60,
          "text": "Caveats: bivariate TE, in vitro only",
          "size": "sm",
          "block": "spya-vjzxxm"
        },
        {
          "kind": "node",
          "id": "macaque",
          "shape": "box",
          "x": 280,
          "y": 470,
          "w": 220,
          "h": 80,
          "text": "Macaques: redundancy rises during motor execution",
          "size": "sm",
          "detail": "Synergy dominates generally, but shifts with task phase and region.",
          "tone": 2,
          "block": "spya-aqcngt"
        },
        {
          "kind": "edge",
          "from": "setup",
          "to": "ff",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "ff",
          "to": "rc",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "ff",
          "to": "motif",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "ff",
          "to": "corrdetail",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "rc",
          "to": "caveat2",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "motif",
          "to": "caveat2",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "corrdetail",
          "to": "caveat2",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "caveat2",
          "to": "macaque",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "Several independent lines of empirical evidence, from cortical cultures and behaving monkeys, converge on the same idea: synergistic computation is concentrated and context-dependent."
    },
    {
      "id": "inside-future",
      "title": "Inside: future directions",
      "height": 420,
      "items": [
        {
          "kind": "node",
          "id": "classic",
          "shape": "ellipse",
          "x": 260,
          "y": 30,
          "w": 240,
          "h": 60,
          "text": "Classic PID: one target, expected values only",
          "size": "sm",
          "block": "spya-zz5xxs"
        },
        {
          "kind": "node",
          "id": "local",
          "shape": "box",
          "x": 80,
          "y": 160,
          "w": 260,
          "h": 90,
          "text": "Local PID: time-resolved, per-moment decomposition",
          "size": "sm",
          "detail": "Reveals distinct computational profiles during neuronal avalanches.",
          "block": "spya-z39m3x"
        },
        {
          "kind": "node",
          "id": "multitarget",
          "shape": "box",
          "x": 420,
          "y": 160,
          "w": 260,
          "h": 90,
          "text": "Multi-target / temporal PID (ΦID)",
          "size": "sm",
          "detail": "Linked to consciousness loss and brain genetic architecture in fMRI studies.",
          "block": "spya-xn6y4f"
        },
        {
          "kind": "node",
          "id": "openq",
          "shape": "note",
          "x": 260,
          "y": 300,
          "w": 240,
          "h": 70,
          "text": "Both are new; many open questions remain",
          "size": "sm",
          "block": "spya-xn6y4f"
        },
        {
          "kind": "edge",
          "from": "classic",
          "to": "local",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "classic",
          "to": "multitarget",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "local",
          "to": "openq",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "multitarget",
          "to": "openq",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "Two parallel extensions of PID, both relaxing the classic framework's restriction to one moment and one target."
    }
  ]
}
```

## Candidate Y

Picture: /home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/results/thinking-effort-261001/judging/sketch/picture-entropy-24-00930-spya-pywwkq-Y.png

Scene:

```json
{
  "title": "Chain into a loop",
  "caption": "The article runs as one long chain—problem, tools, their limits, the PID math that fixes those limits, then empirical findings that fan out and converge, then practical limits and future work—before looping back to restate the opening problem in sharper terms.",
  "scenes": [
    {
      "id": "overview",
      "title": "From the problem of neural computation to its resolution",
      "height": 1520,
      "items": [
        {
          "kind": "node",
          "id": "A",
          "shape": "ellipse",
          "x": 260,
          "y": 30,
          "w": 240,
          "h": 70,
          "text": "How brains compute",
          "size": "md",
          "detail": "Brains take in sensory signals and transform them into adaptive behavior, but how that transformation works is poorly understood.",
          "tone": 1,
          "block": "spya-rxcze4"
        },
        {
          "kind": "node",
          "id": "B",
          "shape": "box",
          "x": 260,
          "y": 130,
          "w": 240,
          "h": 70,
          "text": "Lacked data and tools to study it",
          "size": "sm",
          "detail": "Studying synergy needs huge amounts of data and the right analysis method; both were missing until recently.",
          "tone": 1,
          "block": "spya-s9kmxa"
        },
        {
          "kind": "node",
          "id": "C",
          "shape": "hex",
          "x": 240,
          "y": 230,
          "w": 280,
          "h": 80,
          "text": "Two measures of info flow",
          "size": "sm",
          "sub": "mutual info vs transfer entropy",
          "detail": "Mutual information measures undirected shared dependence; transfer entropy measures directed, time-ordered information flow.",
          "tone": 1,
          "block": "spya-mx45r0"
        },
        {
          "kind": "node",
          "id": "E",
          "shape": "note",
          "x": 260,
          "y": 340,
          "w": 240,
          "h": 70,
          "text": "Flow alone misses how inputs combine",
          "size": "sm",
          "detail": "Information transfer shows flow between pairs but not how a neuron integrates multiple sources into something new.",
          "tone": 1,
          "block": "spya-s0db2g"
        },
        {
          "kind": "region",
          "x": 24,
          "y": 440,
          "w": 712,
          "h": 360,
          "style": "band",
          "label": "DECOMPOSING INFORMATION",
          "opens": "pid-framework",
          "tone": 2
        },
        {
          "kind": "node",
          "id": "F",
          "shape": "diamond",
          "x": 260,
          "y": 490,
          "w": 240,
          "h": 90,
          "text": "Whole ≠ sum of parts",
          "size": "sm",
          "sub": "synergy or redundancy",
          "detail": "If the joint information exceeds the sum of the individual parts, the excess is synergy; if it falls short, the deficit is redundancy.",
          "tone": 2,
          "block": "spya-e94ury"
        },
        {
          "kind": "node",
          "id": "G",
          "shape": "hex",
          "x": 240,
          "y": 610,
          "w": 280,
          "h": 80,
          "text": "Lattice of info atoms",
          "size": "sm",
          "sub": "redundant, unique, synergistic",
          "detail": "Partial information decomposition arranges all possible source combinations into an ordered lattice and solves for each unique atom.",
          "tone": 2,
          "block": "spya-k378fv"
        },
        {
          "kind": "node",
          "id": "H",
          "shape": "note",
          "x": 260,
          "y": 720,
          "w": 240,
          "h": 70,
          "text": "No agreed way to define redundancy",
          "size": "sm",
          "detail": "Close to a dozen competing redundancy functions exist, each with trade-offs, so the choice depends on the data at hand.",
          "tone": 2,
          "block": "spya-d2quz5"
        },
        {
          "kind": "region",
          "x": 24,
          "y": 830,
          "w": 712,
          "h": 260,
          "style": "band",
          "label": "PID IN ACTION: FINDINGS",
          "opens": "pid-in-action",
          "tone": 3
        },
        {
          "kind": "node",
          "id": "I",
          "shape": "box",
          "x": 60,
          "y": 880,
          "w": 200,
          "h": 80,
          "text": "Synergy tracks feedforward flow",
          "size": "xs",
          "detail": "Across 25 recordings, synergy in a triad was reliably about a quarter of that triad's feedforward transfer entropy.",
          "tone": 3,
          "block": "spya-kqkb58"
        },
        {
          "kind": "node",
          "id": "J",
          "shape": "box",
          "x": 280,
          "y": 880,
          "w": 200,
          "h": 80,
          "text": "Rich clubs do most computing",
          "size": "xs",
          "detail": "Under 40% of neurons sat in the rich club, yet rich-club triads accounted for about 88% of all network-wide synergy.",
          "tone": 3,
          "block": "spya-fud8q3"
        },
        {
          "kind": "node",
          "id": "K",
          "shape": "box",
          "x": 500,
          "y": 880,
          "w": 200,
          "h": 80,
          "text": "More recurrent links, more synergy",
          "size": "xs",
          "detail": "Triads with two recurrent connections had 50% more synergy than triads with none; feedback links were not reliably linked to synergy.",
          "tone": 3,
          "block": "spya-sd9fzd"
        },
        {
          "kind": "node",
          "id": "L",
          "shape": "box",
          "x": 170,
          "y": 980,
          "w": 200,
          "h": 80,
          "text": "Synergy peaks, then falls",
          "size": "xs",
          "sub": "with source correlation",
          "detail": "Synergy rose with source-neuron similarity at short timescales but peaked around 7% of maximal mutual information, then declined.",
          "tone": 3,
          "block": "spya-hkhpex"
        },
        {
          "kind": "node",
          "id": "M",
          "shape": "box",
          "x": 390,
          "y": 980,
          "w": 200,
          "h": 80,
          "text": "Movement boosts redundancy",
          "size": "xs",
          "sub": "in behaving monkeys",
          "detail": "In macaques, redundant information rose sharply during the reach-and-grasp phase, plausibly to send a reliable 'move' signal.",
          "tone": 3,
          "block": "spya-t8fayf"
        },
        {
          "kind": "node",
          "id": "N",
          "shape": "box",
          "x": 260,
          "y": 1120,
          "w": 240,
          "h": 70,
          "text": "Synergy reflects structure and task",
          "size": "sm",
          "detail": "Synergistic computation is shaped by local network position and by the behavioral state of the animal, not fixed per neuron.",
          "tone": 3,
          "block": "spya-b32ecw"
        },
        {
          "kind": "node",
          "id": "O",
          "shape": "box",
          "x": 260,
          "y": 1220,
          "w": 240,
          "h": 70,
          "text": "Data type, sampling, tools limit PID",
          "size": "sm",
          "detail": "Choosing a redundancy measure depends on discrete vs continuous data, and estimates need enough samples to avoid finite-size bias.",
          "tone": 4,
          "block": "spya-kmgwhs"
        },
        {
          "kind": "node",
          "id": "P",
          "shape": "box",
          "x": 260,
          "y": 1320,
          "w": 240,
          "h": 70,
          "text": "Next: local & multi-target PID",
          "size": "sm",
          "detail": "Localizing PID to single moments, and extending it to multiple targets, opens time-resolved and richer multivariate analyses.",
          "tone": 4,
          "block": "spya-zz5xxs"
        },
        {
          "kind": "node",
          "id": "Q",
          "shape": "ellipse",
          "x": 250,
          "y": 1420,
          "w": 260,
          "h": 70,
          "text": "Patterns matter, not totals",
          "size": "md",
          "detail": "Synergy shows neurons respond to the pattern of inputs, not just their sum — a sharper answer to the opening question.",
          "tone": 4,
          "block": "spya-rc5z33"
        },
        {
          "kind": "edge",
          "from": "A",
          "to": "B",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "B",
          "to": "C",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "C",
          "to": "E",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "E",
          "to": "F",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "F",
          "to": "G",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "G",
          "to": "H",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "H",
          "to": "I",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "H",
          "to": "J",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "H",
          "to": "K",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "H",
          "to": "L",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "H",
          "to": "M",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "I",
          "to": "N",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "J",
          "to": "N",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "K",
          "to": "N",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "L",
          "to": "N",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "M",
          "to": "N",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "N",
          "to": "O",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "O",
          "to": "P",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "P",
          "to": "Q",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "Q:left",
          "to": "A:left",
          "via": "curve",
          "line": "dashed",
          "arrow": "end",
          "label": "sharper answer"
        }
      ],
      "caption": "A single descending chain: the opening puzzle leads to tools, their blind spot, the PID framework that fills it, a fan of empirical findings that converge on one picture, and practical/future notes — before looping back to the opening claim, now sharpened."
    },
    {
      "id": "pid-framework",
      "title": "How PID turns the inequality into named pieces",
      "height": 920,
      "items": [
        {
          "kind": "node",
          "id": "q2b0e5",
          "shape": "box",
          "x": 260,
          "y": 40,
          "w": 240,
          "h": 70,
          "text": "Split info into additive pieces",
          "size": "sm",
          "sub": "two parents, one target",
          "detail": "The goal: decompose the joint mutual information from two source neurons into non-overlapping named components.",
          "tone": 2,
          "block": "spya-q2b0e5"
        },
        {
          "kind": "node",
          "id": "h5jzvm",
          "shape": "box",
          "x": 260,
          "y": 150,
          "w": 240,
          "h": 70,
          "text": "Redundant + unique + synergy = total",
          "size": "sm",
          "detail": "Redundancy is info either source alone discloses; unique is info only one source gives; synergy is info only the pair together gives.",
          "tone": 2,
          "block": "spya-h5jzvm"
        },
        {
          "kind": "node",
          "id": "bgsd4n",
          "shape": "note",
          "x": 260,
          "y": 260,
          "w": 240,
          "h": 70,
          "text": "One definition unlocks all four terms",
          "size": "sm",
          "detail": "Three known mutual-information values and four unknown partial-information terms leave the system underdetermined without more input.",
          "tone": 2,
          "block": "spya-bgsd4n"
        },
        {
          "kind": "node",
          "id": "pvavq4",
          "shape": "box",
          "x": 260,
          "y": 370,
          "w": 240,
          "h": 70,
          "text": "List every possible source subset",
          "size": "sm",
          "detail": "General PID starts by defining every non-empty subset of sources that could uniquely disclose information about the target.",
          "tone": 2,
          "block": "spya-pvavq4"
        },
        {
          "kind": "node",
          "id": "t8mg0s",
          "shape": "hex",
          "x": 250,
          "y": 480,
          "w": 260,
          "h": 80,
          "text": "One function builds the whole lattice",
          "size": "sm",
          "detail": "Given an idealized redundancy function satisfying certain axioms, the subsets can be organized into a partially ordered lattice.",
          "tone": 2,
          "block": "spya-t8mg0s"
        },
        {
          "kind": "node",
          "id": "m37w5y",
          "shape": "box",
          "x": 260,
          "y": 590,
          "w": 240,
          "h": 70,
          "text": "Lattice orders sources by overlap",
          "size": "sm",
          "detail": "One combination of sources precedes another on the lattice if its information is subsumed by the other's.",
          "tone": 2,
          "block": "spya-m37w5y"
        },
        {
          "kind": "node",
          "id": "aft2rx",
          "shape": "hex",
          "x": 250,
          "y": 700,
          "w": 260,
          "h": 80,
          "text": "Möbius inversion extracts each atom",
          "size": "sm",
          "detail": "Recursively subtracting what's already disclosed by simpler combinations isolates the information unique to each lattice node.",
          "tone": 2,
          "block": "spya-aft2rx"
        },
        {
          "kind": "node",
          "id": "rc76qn",
          "shape": "note",
          "x": 260,
          "y": 810,
          "w": 240,
          "h": 70,
          "text": "Pick a redundancy measure that fits",
          "size": "sm",
          "detail": "No single accepted measure exists; choice depends on data type and number of sources, trading completeness for practicality.",
          "tone": 2,
          "block": "spya-rc76qn"
        },
        {
          "kind": "edge",
          "from": "q2b0e5",
          "to": "h5jzvm",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "h5jzvm",
          "to": "bgsd4n",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "bgsd4n",
          "to": "pvavq4",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "pvavq4",
          "to": "t8mg0s",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "t8mg0s",
          "to": "m37w5y",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "m37w5y",
          "to": "aft2rx",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "aft2rx",
          "to": "rc76qn",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "A ladder: each step builds on the one before, from the raw problem of two parents and one target down to the practical need to pick a redundancy measure."
    },
    {
      "id": "pid-in-action",
      "title": "What the empirical studies found, in order",
      "height": 940,
      "items": [
        {
          "kind": "node",
          "id": "dk32tp",
          "shape": "box",
          "x": 260,
          "y": 30,
          "w": 240,
          "h": 70,
          "text": "Record hundreds of cultured neurons",
          "size": "sm",
          "detail": "512-channel arrays on mouse cortical cultures let the authors build effective networks via transfer entropy and extract thousands of triads.",
          "tone": 3,
          "block": "spya-dk32tp"
        },
        {
          "kind": "node",
          "id": "kqkb58",
          "shape": "box",
          "x": 260,
          "y": 130,
          "w": 240,
          "h": 70,
          "text": "Synergy scales with feedforward flow",
          "size": "sm",
          "detail": "Across 25 recordings and several timescales, synergy was strongly correlated with the transfer entropy feeding each triad.",
          "tone": 3,
          "block": "spya-kqkb58"
        },
        {
          "kind": "node",
          "id": "fud8q3",
          "shape": "box",
          "x": 260,
          "y": 230,
          "w": 240,
          "h": 70,
          "text": "Rich-club triads hold most synergy",
          "size": "sm",
          "detail": "Rich-club triads averaged 2.7 times the synergy of non-rich-club triads, accounting for ~88% of network-wide synergy.",
          "tone": 3,
          "block": "spya-fud8q3"
        },
        {
          "kind": "node",
          "id": "sd9fzd",
          "shape": "box",
          "x": 260,
          "y": 330,
          "w": 240,
          "h": 70,
          "text": "Recurrent links add the most synergy",
          "size": "sm",
          "detail": "Triads with two recurrent connections had 50% more synergy than the simplest triads; feedback links did not reliably help.",
          "tone": 3,
          "block": "spya-sd9fzd"
        },
        {
          "kind": "node",
          "id": "hkhpex",
          "shape": "box",
          "x": 260,
          "y": 430,
          "w": 240,
          "h": 70,
          "text": "Synergy rises, peaks, then falls",
          "size": "sm",
          "sub": "with source correlation",
          "detail": "At short timescales synergy climbed with source similarity; it peaked near 7% of maximal mutual information and then dropped.",
          "tone": 3,
          "block": "spya-hkhpex"
        },
        {
          "kind": "node",
          "id": "cs9fdy",
          "shape": "box",
          "x": 260,
          "y": 530,
          "w": 240,
          "h": 70,
          "text": "Redundancy keeps climbing regardless",
          "size": "sm",
          "sub": "overtaking synergy at long scales",
          "detail": "As timescales lengthened, redundancy rose steadily with similarity, eventually suppressing the net synergistic output.",
          "tone": 3,
          "block": "spya-cs9fdy"
        },
        {
          "kind": "node",
          "id": "j4cy9j",
          "shape": "note",
          "x": 540,
          "y": 580,
          "w": 180,
          "h": 70,
          "text": "Caveat: bivariate nets, cultures only",
          "size": "xs",
          "detail": "Results rest on bivariate transfer-entropy networks, which can overstate connections, and on cultures rather than live behavior.",
          "tone": 3,
          "block": "spya-j4cy9j"
        },
        {
          "kind": "node",
          "id": "aqcngt",
          "shape": "box",
          "x": 260,
          "y": 630,
          "w": 240,
          "h": 70,
          "text": "Test real behaving monkeys instead",
          "size": "sm",
          "detail": "Macaque pre-motor and motor spiking during a multi-phase task was analyzed with multivariate transfer entropy and PID.",
          "tone": 3,
          "block": "spya-aqcngt"
        },
        {
          "kind": "node",
          "id": "t8fayf",
          "shape": "box",
          "x": 260,
          "y": 730,
          "w": 240,
          "h": 70,
          "text": "Movement execution favors redundancy",
          "size": "sm",
          "detail": "Activity was generally synergy-dominated, but redundancy spiked during reach-and-grasp, perhaps to send a reliable 'move' command.",
          "tone": 3,
          "block": "spya-t8fayf"
        },
        {
          "kind": "node",
          "id": "b32ecw",
          "shape": "ellipse",
          "x": 260,
          "y": 830,
          "w": 240,
          "h": 70,
          "text": "Synergy shows up at rest and in tasks",
          "size": "md",
          "detail": "Synergistic dynamics appear in both spontaneous activity and task-driven states, tracking behaviorally specific patterns.",
          "tone": 3,
          "block": "spya-b32ecw"
        },
        {
          "kind": "edge",
          "from": "dk32tp",
          "to": "kqkb58",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "kqkb58",
          "to": "fud8q3",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "fud8q3",
          "to": "sd9fzd",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "sd9fzd",
          "to": "hkhpex",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "hkhpex",
          "to": "cs9fdy",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "cs9fdy",
          "to": "j4cy9j",
          "via": "curve",
          "line": "dashed",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "cs9fdy",
          "to": "aqcngt",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "aqcngt",
          "to": "t8fayf",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "t8fayf",
          "to": "b32ecw",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "A spine of sequential findings from cultured cortical circuits, with a caveat hanging off to the side, continuing into behaving-animal results and a closing conclusion."
    }
  ]
}
```

## Candidate Z

Picture: /home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/results/thinking-effort-261001/judging/sketch/picture-entropy-24-00930-spya-pywwkq-Z.png

Scene:

```json
{
  "title": "Spine with a fan",
  "caption": "A spine running from the problem (how do neurons combine signals?) through a method built to answer it (PID), into a fan of empirical findings about where synergy lives, and out to the method's limits and what comes next.",
  "scenes": [
    {
      "id": "overview",
      "title": "From the problem to the payoff",
      "height": 1200,
      "items": [
        {
          "kind": "node",
          "id": "n1",
          "shape": "ellipse",
          "x": 230,
          "y": 40,
          "w": 300,
          "h": 70,
          "text": "Brains process information — but how?",
          "size": "md",
          "detail": "New recording tech and new analysis tools now make this question tractable.",
          "tone": 1,
          "block": "spya-yb735k"
        },
        {
          "kind": "node",
          "id": "n2",
          "shape": "box",
          "x": 230,
          "y": 140,
          "w": 300,
          "h": 70,
          "text": "Mutual information vs. transfer entropy",
          "size": "sm",
          "sub": "shared pattern vs. directed flow",
          "detail": "Mutual information shows undirected similarity between neurons; transfer entropy shows directed information flow from one to another.",
          "tone": 1,
          "block": "spya-mx45r0"
        },
        {
          "kind": "node",
          "id": "n3",
          "shape": "note",
          "x": 230,
          "y": 240,
          "w": 300,
          "h": 70,
          "text": "But flow alone can't show how inputs combine",
          "size": "sm",
          "detail": "Transfer entropy tracks propagation, not how a neuron integrates multiple sources into a new signal.",
          "tone": 1,
          "block": "spya-dhy39x"
        },
        {
          "kind": "node",
          "id": "n4",
          "shape": "hex",
          "x": 230,
          "y": 345,
          "w": 300,
          "h": 85,
          "text": "PID: split joint information into redundant, unique, synergistic parts",
          "size": "md",
          "detail": "Partial information decomposition formally separates overlapping, individual, and combination-only information.",
          "tone": 2,
          "block": "spya-u0wm5e"
        },
        {
          "kind": "node",
          "id": "n5",
          "shape": "box",
          "x": 230,
          "y": 460,
          "w": 300,
          "h": 70,
          "text": "Needs a choice of redundancy measure — none is universal",
          "size": "sm",
          "detail": "The decomposition is underdetermined until one defines redundancy; a dozen competing definitions exist.",
          "tone": 2,
          "block": "spya-d2quz5"
        },
        {
          "kind": "node",
          "id": "n6",
          "shape": "ellipse",
          "x": 230,
          "y": 565,
          "w": 300,
          "h": 80,
          "text": "Applying PID to real recordings",
          "size": "md",
          "detail": "Hundreds of cultured cortical neurons, decomposed triad by triad, reveal where synergy concentrates.",
          "tone": 3,
          "block": "spya-cc282b"
        },
        {
          "kind": "node",
          "id": "s1",
          "shape": "box",
          "x": 30,
          "y": 685,
          "w": 160,
          "h": 85,
          "text": "Rich-club neurons hold most of the network's synergy",
          "size": "xs",
          "detail": "A minority of best-connected neurons account for about 88% of all synergy.",
          "tone": 3,
          "block": "spya-e3ghxj"
        },
        {
          "kind": "node",
          "id": "s2",
          "shape": "box",
          "x": 210,
          "y": 765,
          "w": 160,
          "h": 85,
          "text": "Recurrent connections raise synergy; feedback doesn't",
          "size": "xs",
          "detail": "Loops between source neurons add to synergy; feedback to the sources mostly doesn't.",
          "tone": 3,
          "block": "spya-p8by2y"
        },
        {
          "kind": "node",
          "id": "s3",
          "shape": "box",
          "x": 400,
          "y": 765,
          "w": 160,
          "h": 85,
          "text": "Synergy peaks, then falls, as inputs grow more alike",
          "size": "xs",
          "detail": "Mildly correlated sources produce the most synergy; highly correlated ones become redundant instead.",
          "tone": 3,
          "block": "spya-zfs2z7"
        },
        {
          "kind": "node",
          "id": "s4",
          "shape": "box",
          "x": 570,
          "y": 685,
          "w": 160,
          "h": 85,
          "text": "In monkeys, redundancy rises during movement",
          "size": "xs",
          "detail": "Behaving-animal recordings show the balance of synergy and redundancy shifts with the task at hand.",
          "tone": 3,
          "block": "spya-aqcngt"
        },
        {
          "kind": "node",
          "id": "n7",
          "shape": "box",
          "x": 230,
          "y": 885,
          "w": 300,
          "h": 70,
          "text": "Practical limits: data type, sample size, software tools",
          "size": "sm",
          "detail": "Choosing a redundancy function and gathering enough data are both real constraints in practice.",
          "tone": 4,
          "block": "spya-kmgwhs"
        },
        {
          "kind": "node",
          "id": "n8",
          "shape": "box",
          "x": 230,
          "y": 985,
          "w": 300,
          "h": 70,
          "text": "Future: moment-by-moment and multi-target PID",
          "size": "sm",
          "detail": "Local PID resolves synergy over time; integrated information decomposition extends it to multiple targets.",
          "tone": 4,
          "block": "spya-zz5xxs"
        },
        {
          "kind": "node",
          "id": "n9",
          "shape": "ellipse",
          "x": 230,
          "y": 1085,
          "w": 300,
          "h": 80,
          "text": "Synergy: neurons compute on patterns, not just totals",
          "size": "md",
          "detail": "The closing summary ties the empirical findings back to what synergy means for neural computation.",
          "tone": 4,
          "block": "spya-rc5z33"
        },
        {
          "kind": "edge",
          "from": "n1",
          "to": "n2",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "n2",
          "to": "n3",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "n3",
          "to": "n4",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "n4",
          "to": "n5",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "n5",
          "to": "n6",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "n6",
          "to": "s1",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "n6",
          "to": "s2",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "n6",
          "to": "s3",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "n6",
          "to": "s4",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "s1",
          "to": "n7",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "s2",
          "to": "n7",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "s3",
          "to": "n7",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "s4",
          "to": "n7",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "n7",
          "to": "n8",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "n8",
          "to": "n9",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "region",
          "x": 24,
          "y": 320,
          "w": 680,
          "h": 230,
          "style": "dashed",
          "label": "BUILDING THE PID FRAMEWORK",
          "opens": "pid-framework",
          "tone": 2
        },
        {
          "kind": "region",
          "x": 24,
          "y": 540,
          "w": 712,
          "h": 335,
          "style": "band",
          "label": "EMPIRICAL FINDINGS",
          "opens": "empirical-findings",
          "tone": 3
        }
      ],
      "caption": "Down the page is the article's own order: motivation, tools, the gap those tools leave, the PID framework built to fill it, a fan of empirical discoveries about synergy, then the method's limits, its future, and a closing summary."
    },
    {
      "id": "pid-framework",
      "title": "Inside: building partial information decomposition",
      "height": 720,
      "items": [
        {
          "kind": "node",
          "id": "a1",
          "shape": "box",
          "x": 230,
          "y": 40,
          "w": 300,
          "h": 70,
          "text": "Joint information isn't just the sum of each source's part",
          "size": "sm",
          "detail": "Summing each parent neuron's individual information about the target doesn't equal the information from all of them together.",
          "tone": 2,
          "block": "spya-h5dz45"
        },
        {
          "kind": "node",
          "id": "a2",
          "shape": "box",
          "x": 230,
          "y": 140,
          "w": 300,
          "h": 80,
          "text": "Whole > parts means synergy; whole < parts means redundancy",
          "size": "sm",
          "detail": "Extra information beyond the sum signals genuine integration (synergy); a shortfall signals double-counted overlap (redundancy).",
          "tone": 2,
          "block": "spya-e94ury"
        },
        {
          "kind": "node",
          "id": "a3",
          "shape": "note",
          "x": 230,
          "y": 250,
          "w": 300,
          "h": 70,
          "text": "Williams & Beer found how to split it algebraically",
          "size": "sm",
          "detail": "Their partial information decomposition framework made this split exact, not just descriptive.",
          "tone": 2,
          "block": "spya-t02v4p"
        },
        {
          "kind": "node",
          "id": "a4",
          "shape": "box",
          "x": 230,
          "y": 350,
          "w": 300,
          "h": 80,
          "text": "Two parents: redundant + unique(1) + unique(2) + synergistic",
          "size": "sm",
          "detail": "With two source neurons, the joint information splits into four distinct, non-overlapping pieces.",
          "tone": 2,
          "block": "spya-q2b0e5"
        },
        {
          "kind": "node",
          "id": "a5",
          "shape": "diamond",
          "x": 255,
          "y": 460,
          "w": 250,
          "h": 75,
          "text": "Underdetermined — pick one piece to define",
          "size": "xs",
          "detail": "Three known mutual-information values but four unknown pieces: defining any one term yields the rest.",
          "tone": 2,
          "block": "spya-bgsd4n"
        },
        {
          "kind": "node",
          "id": "a6",
          "shape": "hex",
          "x": 230,
          "y": 565,
          "w": 300,
          "h": 75,
          "text": "More than two parents: need the partial information lattice",
          "size": "sm",
          "detail": "With three or more sources the simple algebra isn't enough; a structured lattice of all possible source combinations is required.",
          "tone": 2,
          "block": "spya-k378fv"
        },
        {
          "kind": "node",
          "id": "a7",
          "shape": "box",
          "x": 230,
          "y": 665,
          "w": 300,
          "h": 55,
          "text": "Lattice atoms computed by Möbius inversion",
          "size": "xs",
          "detail": "A recursive formula extracts each unique information atom once a redundancy measure is chosen.",
          "tone": 2,
          "block": "spya-m37w5y"
        },
        {
          "kind": "edge",
          "from": "a1",
          "to": "a2",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "a2",
          "to": "a3",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "a3",
          "to": "a4",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "a4",
          "to": "a5",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "a5",
          "to": "a6",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "a6",
          "to": "a7",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "A chain of logical steps: the discovery that information doesn't simply add up, the algebra that first split it into parts for two sources, and the lattice machinery needed once there are more than two — all resting on one still-unsettled choice, the definition of redundancy."
    },
    {
      "id": "empirical-findings",
      "title": "Inside: what PID found in real circuits",
      "height": 620,
      "items": [
        {
          "kind": "node",
          "id": "e1",
          "shape": "ellipse",
          "x": 230,
          "y": 40,
          "w": 300,
          "h": 70,
          "text": "512-channel recordings from cultured mouse cortex",
          "size": "sm",
          "detail": "Hundreds of neurons recorded at once, with thousands of source-source-target triads analyzed by PID.",
          "tone": 3,
          "block": "spya-sw5ukx"
        },
        {
          "kind": "node",
          "id": "e2",
          "shape": "box",
          "x": 230,
          "y": 140,
          "w": 300,
          "h": 70,
          "text": "Synergy tracks the strength of feedforward information flow",
          "size": "sm",
          "detail": "Across 25 recordings, synergy was reliably about a quarter of the feedforward transfer entropy.",
          "tone": 3,
          "block": "spya-kqkb58"
        },
        {
          "kind": "node",
          "id": "e3",
          "shape": "box",
          "x": 40,
          "y": 260,
          "w": 200,
          "h": 90,
          "text": "Rich-club triads: 2.7x more synergy, ~88% of total",
          "size": "xs",
          "detail": "Densely interconnected 'rich club' neurons are small in number but dominant in synergy.",
          "tone": 3,
          "block": "spya-fud8q3"
        },
        {
          "kind": "node",
          "id": "e4",
          "shape": "box",
          "x": 270,
          "y": 260,
          "w": 200,
          "h": 90,
          "text": "Recurrent links help synergy; feedback links don't",
          "size": "xs",
          "detail": "Connections between source neurons raised synergy; connections back from target to sources mostly didn't.",
          "tone": 3,
          "block": "spya-sd9fzd"
        },
        {
          "kind": "node",
          "id": "e5",
          "shape": "box",
          "x": 500,
          "y": 260,
          "w": 200,
          "h": 90,
          "text": "Synergy peaks then falls as sources grow more alike",
          "size": "xs",
          "detail": "Mild similarity between source neurons boosts synergy; too much similarity turns it into redundancy instead.",
          "tone": 3,
          "block": "spya-ybmve2"
        },
        {
          "kind": "node",
          "id": "e6",
          "shape": "note",
          "x": 230,
          "y": 400,
          "w": 300,
          "h": 70,
          "text": "Caveats: bias from simple pairwise flow estimates; culture, not living brain",
          "size": "xs",
          "detail": "Results depend on bivariate transfer-entropy networks and on in-vitro cortical cultures, not behaving animals.",
          "tone": 3,
          "block": "spya-j4cy9j"
        },
        {
          "kind": "node",
          "id": "e7",
          "shape": "box",
          "x": 230,
          "y": 500,
          "w": 300,
          "h": 70,
          "text": "In behaving monkeys, redundancy rises during movement execution",
          "size": "sm",
          "detail": "Task demands shift the balance: redundancy increases when reliable transmission to distant muscles matters most.",
          "tone": 3,
          "block": "spya-t8fayf"
        },
        {
          "kind": "edge",
          "from": "e1",
          "to": "e2",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "e2",
          "to": "e3",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "e2",
          "to": "e4",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "e2",
          "to": "e5",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "e3",
          "to": "e6",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "e4",
          "to": "e6",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "e5",
          "to": "e6",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "e6",
          "to": "e7",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "A chain into a fan and back: recordings feed one overall finding (synergy tracks feedforward flow), which splits into three parallel discoveries about where and why synergy concentrates, which converge on caveats and then on a result from behaving animals."
    }
  ]
}
```
