# 4 candidates for "Revealing the Dynamics of Neural Information Processing with Multivariate Information Decomposition"

Each candidate is a picture of how the article is put together, for a reader who has not read it yet. They are labelled W, X, Y, Z in an order that
says nothing about how any of them was made. The article itself, with its block ids, is
`article-entropy-24-00930-spya-pywwkq.md` beside this file.

## Candidate W

Picture: /home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/evals/results/thinking-effort-261001s-sketch-schema/judging/sketch/picture-entropy-24-00930-spya-pywwkq-W.png

Scene:

```json
{
  "title": "Funnel into convergence",
  "caption": "A funnel from motivation into the PID method, then a converge of empirical findings onto one picture of synergy, followed by a practical/future coda — a chain of three movements, not a single line.",
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
          "x": 280,
          "y": 30,
          "w": 220,
          "h": 70,
          "text": "How do neurons process information?",
          "size": "md",
          "block": "spya-yb735k"
        },
        {
          "kind": "node",
          "id": "limits",
          "shape": "note",
          "x": 40,
          "y": 140,
          "w": 220,
          "h": 70,
          "text": "Old limits: too little data, no good tools",
          "size": "sm",
          "block": "spya-s9kmxa"
        },
        {
          "kind": "node",
          "id": "mi_te",
          "shape": "hex",
          "x": 300,
          "y": 140,
          "w": 220,
          "h": 70,
          "text": "Mutual info & transfer entropy track flow",
          "size": "sm",
          "block": "spya-mx45r0"
        },
        {
          "kind": "node",
          "id": "transfer_limit",
          "shape": "note",
          "x": 540,
          "y": 140,
          "w": 180,
          "h": 70,
          "text": "But flow ≠ processing",
          "size": "sm",
          "block": "spya-dhy39x"
        },
        {
          "kind": "node",
          "id": "pid_core",
          "shape": "diamond",
          "x": 290,
          "y": 250,
          "w": 220,
          "h": 100,
          "text": "PID splits info into redundant / unique / synergistic",
          "size": "lg",
          "detail": "The whole can exceed or fall short of the sum of its parts.",
          "block": "spya-u0wm5e"
        },
        {
          "kind": "node",
          "id": "lattice",
          "shape": "hex",
          "x": 60,
          "y": 390,
          "w": 220,
          "h": 70,
          "text": "General lattice needs a redundancy measure",
          "size": "sm",
          "block": "spya-k378fv"
        },
        {
          "kind": "node",
          "id": "redund_choice",
          "shape": "note",
          "x": 480,
          "y": 390,
          "w": 220,
          "h": 70,
          "text": "No single accepted redundancy measure",
          "size": "sm",
          "block": "spya-d2quz5"
        },
        {
          "kind": "region",
          "x": 40,
          "y": 500,
          "w": 680,
          "h": 330,
          "style": "band",
          "label": "EMPIRICAL FINDINGS CONVERGE",
          "opens": "empirical-findings",
          "tone": 2
        },
        {
          "kind": "node",
          "id": "setup",
          "shape": "box",
          "x": 280,
          "y": 540,
          "w": 220,
          "h": 60,
          "text": "Cortical cultures, thousands of triads",
          "size": "sm",
          "block": "spya-cc282b"
        },
        {
          "kind": "node",
          "id": "richclub",
          "shape": "box",
          "x": 60,
          "y": 630,
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
          "x": 280,
          "y": 630,
          "w": 200,
          "h": 60,
          "text": "Recurrent connections boost synergy",
          "size": "sm",
          "block": "spya-p8by2y"
        },
        {
          "kind": "node",
          "id": "correlated",
          "shape": "box",
          "x": 500,
          "y": 630,
          "w": 200,
          "h": 60,
          "text": "Synergy peaks at moderate correlation",
          "size": "sm",
          "block": "spya-zfs2z7"
        },
        {
          "kind": "node",
          "id": "primates",
          "shape": "box",
          "x": 280,
          "y": 720,
          "w": 220,
          "h": 70,
          "text": "In behaving monkeys, task shifts synergy↔redundancy",
          "size": "sm",
          "block": "spya-aqcngt"
        },
        {
          "kind": "node",
          "id": "synergy_claim",
          "shape": "ellipse",
          "x": 280,
          "y": 840,
          "w": 220,
          "h": 80,
          "text": "Synergy marks real neural computation",
          "size": "lg",
          "block": "spya-b32ecw"
        },
        {
          "kind": "region",
          "x": 40,
          "y": 960,
          "w": 680,
          "h": 180,
          "style": "band",
          "label": "PRACTICE, LIMITS, FUTURE",
          "opens": "practice-and-future",
          "tone": 3
        },
        {
          "kind": "node",
          "id": "practical",
          "shape": "note",
          "x": 60,
          "y": 1000,
          "w": 220,
          "h": 60,
          "text": "Tools, sampling needs, scalability limits",
          "size": "sm",
          "block": "spya-kmgwhs"
        },
        {
          "kind": "node",
          "id": "future",
          "shape": "note",
          "x": 480,
          "y": 1000,
          "w": 220,
          "h": 60,
          "text": "Local & multi-target PID ahead",
          "size": "sm",
          "block": "spya-zz5xxs"
        },
        {
          "kind": "node",
          "id": "summary",
          "shape": "box",
          "x": 280,
          "y": 1090,
          "w": 220,
          "h": 50,
          "text": "Summary: patterns, not just totals, matter",
          "size": "sm",
          "block": "spya-rc5z33"
        },
        {
          "kind": "edge",
          "from": "intro",
          "to": "mi_te",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "limits",
          "to": "mi_te",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "mi_te",
          "to": "transfer_limit",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "transfer_limit",
          "to": "pid_core",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "pid_core",
          "to": "lattice",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "pid_core",
          "to": "redund_choice",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "lattice",
          "to": "setup",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "redund_choice",
          "to": "setup",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "setup",
          "to": "richclub",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "setup",
          "to": "recurrent",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "setup",
          "to": "correlated",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "richclub",
          "to": "synergy_claim",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "recurrent",
          "to": "synergy_claim",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "correlated",
          "to": "synergy_claim",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "primates",
          "to": "synergy_claim",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "setup",
          "to": "primates",
          "via": "elbow",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "synergy_claim",
          "to": "practical",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "synergy_claim",
          "to": "future",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "practical",
          "to": "summary",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "future",
          "to": "summary",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "The piece narrows from a general problem to one technical tool (PID), then fans that tool out across several experiments that all converge on 'synergy is concentrated and task-sensitive', before closing with limits and extensions."
    },
    {
      "id": "empirical-findings",
      "title": "Empirical findings converge",
      "height": 760,
      "items": [
        {
          "kind": "node",
          "id": "setup2",
          "shape": "box",
          "x": 290,
          "y": 30,
          "w": 220,
          "h": 70,
          "text": "512-channel recordings, triads scored by PID",
          "size": "sm",
          "block": "spya-cc282b"
        },
        {
          "kind": "node",
          "id": "ff_corr",
          "shape": "box",
          "x": 290,
          "y": 140,
          "w": 220,
          "h": 60,
          "text": "Synergy tracks feedforward transfer entropy",
          "size": "sm",
          "block": "spya-kqkb58"
        },
        {
          "kind": "node",
          "id": "richclub2",
          "shape": "box",
          "x": 60,
          "y": 260,
          "w": 220,
          "h": 70,
          "text": "Rich club: 40% of neurons, 88% of synergy",
          "size": "sm",
          "block": "spya-fud8q3"
        },
        {
          "kind": "node",
          "id": "motifs",
          "shape": "box",
          "x": 300,
          "y": 260,
          "w": 220,
          "h": 80,
          "text": "More recurrent links → more synergy; feedback links don't help",
          "size": "sm",
          "block": "spya-sd9fzd"
        },
        {
          "kind": "node",
          "id": "correlated2",
          "shape": "box",
          "x": 540,
          "y": 260,
          "w": 200,
          "h": 90,
          "text": "Synergy rises then falls as source correlation grows",
          "size": "sm",
          "block": "spya-hkhpex"
        },
        {
          "kind": "node",
          "id": "caveats",
          "shape": "note",
          "x": 60,
          "y": 390,
          "w": 260,
          "h": 70,
          "text": "Caveat: bivariate TE overstates edges; cultures ≠ in vivo",
          "size": "sm",
          "block": "spya-vjzxxm"
        },
        {
          "kind": "node",
          "id": "primates2",
          "shape": "box",
          "x": 380,
          "y": 390,
          "w": 260,
          "h": 90,
          "text": "In macaques: synergy dominant generally, redundancy spikes during movement execution",
          "size": "sm",
          "block": "spya-t8fayf"
        },
        {
          "kind": "node",
          "id": "conclusion2",
          "shape": "ellipse",
          "x": 260,
          "y": 540,
          "w": 260,
          "h": 80,
          "text": "Computation structure follows network position and task state",
          "size": "md",
          "block": "spya-b32ecw"
        },
        {
          "kind": "edge",
          "from": "setup2",
          "to": "ff_corr",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "ff_corr",
          "to": "richclub2",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "ff_corr",
          "to": "motifs",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "ff_corr",
          "to": "correlated2",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "richclub2",
          "to": "caveats",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "motifs",
          "to": "primates2",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "caveats",
          "to": "conclusion2",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "primates2",
          "to": "conclusion2",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "correlated2",
          "to": "conclusion2",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "Independent lines of evidence from cultured cortex and behaving primates all point to the same picture: synergy is concentrated, structurally driven, and task-dependent."
    },
    {
      "id": "practice-and-future",
      "title": "Practice, limits, and what's next",
      "height": 620,
      "items": [
        {
          "kind": "region",
          "x": 30,
          "y": 60,
          "w": 320,
          "h": 480,
          "style": "band",
          "label": "DOING PID TODAY",
          "tone": 3
        },
        {
          "kind": "region",
          "x": 400,
          "y": 60,
          "w": 320,
          "h": 480,
          "style": "band",
          "label": "WHERE IT'S HEADED",
          "tone": 4
        },
        {
          "kind": "node",
          "id": "datatype",
          "shape": "box",
          "x": 50,
          "y": 110,
          "w": 280,
          "h": 70,
          "text": "Choice of redundancy measure depends on data type",
          "size": "sm",
          "block": "spya-kmgwhs"
        },
        {
          "kind": "node",
          "id": "sampling",
          "shape": "box",
          "x": 50,
          "y": 200,
          "w": 280,
          "h": 70,
          "text": "Needs enough data to avoid undersampling bias",
          "size": "sm",
          "block": "spya-tz99zn"
        },
        {
          "kind": "node",
          "id": "tools",
          "shape": "box",
          "x": 50,
          "y": 290,
          "w": 280,
          "h": 70,
          "text": "Software: DIT, IDTxl, SxPID, MATLAB toolbox",
          "size": "sm",
          "block": "spya-rf4pp0"
        },
        {
          "kind": "node",
          "id": "interp",
          "shape": "note",
          "x": 50,
          "y": 380,
          "w": 280,
          "h": 70,
          "text": "Statistical, not mechanistic, explanation",
          "size": "sm",
          "block": "spya-h6h922"
        },
        {
          "kind": "node",
          "id": "scaling",
          "shape": "note",
          "x": 50,
          "y": 470,
          "w": 280,
          "h": 60,
          "text": "Lattice explodes with more parent neurons",
          "size": "sm",
          "block": "spya-djfyag"
        },
        {
          "kind": "node",
          "id": "localpid",
          "shape": "box",
          "x": 420,
          "y": 110,
          "w": 280,
          "h": 80,
          "text": "Local PID: time-resolved synergy per moment",
          "size": "sm",
          "block": "spya-z39m3x"
        },
        {
          "kind": "node",
          "id": "avalanche",
          "shape": "box",
          "x": 420,
          "y": 220,
          "w": 280,
          "h": 70,
          "text": "Found distinct profiles in neuronal avalanches",
          "size": "sm",
          "block": "spya-ckpq7e"
        },
        {
          "kind": "node",
          "id": "multitarget",
          "shape": "box",
          "x": 420,
          "y": 320,
          "w": 280,
          "h": 80,
          "text": "Multi-target PID (ΦID): several targets at once",
          "size": "sm",
          "block": "spya-cds6mm"
        },
        {
          "kind": "node",
          "id": "consciousness",
          "shape": "box",
          "x": 420,
          "y": 430,
          "w": 280,
          "h": 80,
          "text": "Linked to consciousness loss and brain genetics in fMRI",
          "size": "sm",
          "block": "spya-xn6y4f"
        },
        {
          "kind": "edge",
          "from": "datatype",
          "to": "sampling",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "sampling",
          "to": "tools",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "tools",
          "to": "interp",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "interp",
          "to": "scaling",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "localpid",
          "to": "avalanche",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "avalanche",
          "to": "multitarget",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "multitarget",
          "to": "consciousness",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "Side by side: the practical constraints on doing PID today, and the directions (local, multi-target) that aim past those constraints."
    }
  ]
}
```

## Candidate X

Picture: /home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/evals/results/thinking-effort-261001s-sketch-schema/judging/sketch/picture-entropy-24-00930-spya-pywwkq-X.png

Scene:

```json
{
  "title": "chain into fan-out",
  "caption": "The piece is a chain: it builds up the PID method step by step, then fans that method out across a cluster of empirical findings, before narrowing back to practical limits and a closing summary.",
  "scenes": [
    {
      "id": "overview",
      "title": "From method to findings and back",
      "height": 1180,
      "items": [
        {
          "kind": "node",
          "id": "intro",
          "shape": "box",
          "x": 280,
          "y": 30,
          "w": 220,
          "h": 70,
          "text": "New recording data need new analysis tools",
          "size": "sm",
          "block": "spya-yb735k"
        },
        {
          "kind": "node",
          "id": "track",
          "shape": "box",
          "x": 280,
          "y": 130,
          "w": 220,
          "h": 70,
          "text": "Mutual information and transfer entropy track information flow",
          "size": "sm",
          "block": "spya-ygkzd8"
        },
        {
          "kind": "node",
          "id": "limit",
          "shape": "box",
          "x": 280,
          "y": 230,
          "w": 220,
          "h": 70,
          "text": "But flow alone can't show how inputs are combined",
          "size": "sm",
          "block": "spya-dhy39x"
        },
        {
          "kind": "region",
          "x": 60,
          "y": 320,
          "w": 640,
          "h": 220,
          "style": "band",
          "label": "BUILDING PARTIAL INFORMATION DECOMPOSITION (PID)",
          "opens": "inside-pid",
          "tone": 1
        },
        {
          "kind": "node",
          "id": "pid1",
          "shape": "hex",
          "x": 90,
          "y": 365,
          "w": 180,
          "h": 65,
          "text": "Whole ≠ sum of parts: redundancy vs synergy",
          "size": "sm",
          "block": "spya-u0wm5e",
          "opens": "inside-pid"
        },
        {
          "kind": "node",
          "id": "pid2",
          "shape": "hex",
          "x": 300,
          "y": 365,
          "w": 180,
          "h": 65,
          "text": "Lattice of information atoms, via Möbius inversion",
          "size": "sm",
          "block": "spya-k378fv",
          "opens": "inside-pid"
        },
        {
          "kind": "node",
          "id": "pid3",
          "shape": "hex",
          "x": 510,
          "y": 365,
          "w": 170,
          "h": 65,
          "text": "No single agreed redundancy measure",
          "size": "sm",
          "block": "spya-d2quz5",
          "opens": "inside-pid"
        },
        {
          "kind": "region",
          "x": 40,
          "y": 590,
          "w": 680,
          "h": 320,
          "style": "band",
          "label": "PID IN ACTION: WHERE SYNERGY CONCENTRATES",
          "opens": "inside-empirical",
          "tone": 2
        },
        {
          "kind": "node",
          "id": "rich",
          "shape": "box",
          "x": 60,
          "y": 640,
          "w": 180,
          "h": 70,
          "text": "Rich-club neurons hold most of the synergy",
          "size": "sm",
          "block": "spya-e3ghxj",
          "opens": "inside-empirical"
        },
        {
          "kind": "node",
          "id": "recur",
          "shape": "box",
          "x": 280,
          "y": 640,
          "w": 180,
          "h": 70,
          "text": "Recurrent links raise synergy; feedback doesn't",
          "size": "sm",
          "block": "spya-p8by2y",
          "opens": "inside-empirical"
        },
        {
          "kind": "node",
          "id": "corr",
          "shape": "box",
          "x": 500,
          "y": 640,
          "w": 180,
          "h": 70,
          "text": "Correlated inputs boost synergy, up to a point",
          "size": "sm",
          "block": "spya-zfs2z7",
          "opens": "inside-empirical"
        },
        {
          "kind": "node",
          "id": "primate",
          "shape": "box",
          "x": 280,
          "y": 750,
          "w": 220,
          "h": 70,
          "text": "In behaving monkeys, synergy shifts with task demands",
          "size": "sm",
          "block": "spya-aqcngt",
          "opens": "inside-empirical"
        },
        {
          "kind": "node",
          "id": "caveat",
          "shape": "note",
          "x": 540,
          "y": 750,
          "w": 160,
          "h": 70,
          "text": "Caveats: cultures, bivariate TE",
          "size": "xs",
          "block": "spya-vjzxxm"
        },
        {
          "kind": "node",
          "id": "practical",
          "shape": "box",
          "x": 280,
          "y": 940,
          "w": 220,
          "h": 70,
          "text": "Practical limits: data type, sample size, tools, lattice explosion",
          "size": "sm",
          "block": "spya-kmgwhs"
        },
        {
          "kind": "node",
          "id": "future",
          "shape": "box",
          "x": 280,
          "y": 1040,
          "w": 220,
          "h": 70,
          "text": "Future: local and multi-target PID",
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
          "to": "pid1",
          "via": "elbow",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "pid1",
          "to": "pid2",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "pid2",
          "to": "pid3",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "pid3",
          "to": "rich",
          "via": "elbow",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "pid3",
          "to": "recur",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "pid3",
          "to": "corr",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "rich",
          "to": "primate",
          "via": "elbow",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "recur",
          "to": "primate",
          "via": "elbow",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "corr",
          "to": "primate",
          "via": "elbow",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "primate",
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
      "caption": "Each stage builds on the one above; the empirical section (one region) applies the method in several directions at once before the piece narrows to limits and a summary."
    },
    {
      "id": "inside-pid",
      "title": "Building the decomposition",
      "height": 680,
      "items": [
        {
          "kind": "node",
          "id": "basic",
          "shape": "box",
          "x": 280,
          "y": 30,
          "w": 220,
          "h": 70,
          "text": "Joint info from two sources need not equal the sum of each alone",
          "size": "sm",
          "block": "spya-u0wm5e"
        },
        {
          "kind": "node",
          "id": "synred",
          "shape": "box",
          "x": 280,
          "y": 130,
          "w": 220,
          "h": 70,
          "text": "Excess = synergy; shortfall = redundancy",
          "size": "sm",
          "block": "spya-e94ury"
        },
        {
          "kind": "node",
          "id": "twoparent",
          "shape": "box",
          "x": 280,
          "y": 230,
          "w": 220,
          "h": 80,
          "text": "Two-parent case: four unknowns, three equations — underdetermined",
          "size": "sm",
          "block": "spya-y7wdb7"
        },
        {
          "kind": "node",
          "id": "lattice",
          "shape": "hex",
          "x": 280,
          "y": 340,
          "w": 220,
          "h": 80,
          "text": "General case: sources arranged in a partial-information lattice",
          "size": "sm",
          "block": "spya-k378fv"
        },
        {
          "kind": "node",
          "id": "mobius",
          "shape": "box",
          "x": 280,
          "y": 450,
          "w": 220,
          "h": 70,
          "text": "Möbius inversion recovers each unique information atom",
          "size": "sm",
          "block": "spya-aft2rx"
        },
        {
          "kind": "node",
          "id": "redund",
          "shape": "diamond",
          "x": 270,
          "y": 560,
          "w": 240,
          "h": 90,
          "text": "Which redundancy measure to use?",
          "size": "sm",
          "block": "spya-d2quz5"
        },
        {
          "kind": "node",
          "id": "nouniv",
          "shape": "note",
          "x": 550,
          "y": 570,
          "w": 170,
          "h": 70,
          "text": "No universal answer — choice depends on data type",
          "size": "xs",
          "block": "spya-rc76qn"
        },
        {
          "kind": "edge",
          "from": "basic",
          "to": "synred",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "synred",
          "to": "twoparent",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "twoparent",
          "to": "lattice",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "lattice",
          "to": "mobius",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "mobius",
          "to": "redund",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "redund",
          "to": "nouniv",
          "via": "straight",
          "line": "dashed",
          "arrow": "end"
        }
      ],
      "caption": "A chain: from the basic puzzle (whole vs. sum of parts), through the general lattice machinery, to the unresolved choice of redundancy measure."
    },
    {
      "id": "inside-empirical",
      "title": "Where synergy shows up",
      "height": 620,
      "items": [
        {
          "kind": "node",
          "id": "setup",
          "shape": "box",
          "x": 280,
          "y": 30,
          "w": 220,
          "h": 80,
          "text": "Cortical culture recordings decomposed into thousands of triads",
          "size": "sm",
          "block": "spya-cc282b"
        },
        {
          "kind": "node",
          "id": "r1",
          "shape": "box",
          "x": 60,
          "y": 160,
          "w": 190,
          "h": 80,
          "text": "Rich-club neurons (minority) hold most network synergy",
          "size": "sm",
          "detail": "~40% of neurons account for ~88% of network-wide synergy.",
          "block": "spya-e3ghxj"
        },
        {
          "kind": "node",
          "id": "r2",
          "shape": "box",
          "x": 280,
          "y": 160,
          "w": 190,
          "h": 80,
          "text": "Recurrent connections raise synergy; feedback does not",
          "size": "sm",
          "block": "spya-p8by2y"
        },
        {
          "kind": "node",
          "id": "r3",
          "shape": "box",
          "x": 500,
          "y": 160,
          "w": 190,
          "h": 80,
          "text": "Synergy peaks at intermediate source correlation, then falls",
          "size": "sm",
          "block": "spya-zfs2z7"
        },
        {
          "kind": "node",
          "id": "caveats",
          "shape": "note",
          "x": 280,
          "y": 280,
          "w": 220,
          "h": 70,
          "text": "Caveats: bivariate TE bias; cultures, not living behaving brains",
          "size": "xs",
          "block": "spya-vjzxxm"
        },
        {
          "kind": "node",
          "id": "primate2",
          "shape": "box",
          "x": 280,
          "y": 390,
          "w": 220,
          "h": 90,
          "text": "In behaving macaques, synergy gives way to redundancy during movement execution",
          "size": "sm",
          "block": "spya-aqcngt"
        },
        {
          "kind": "edge",
          "from": "setup",
          "to": "r1",
          "via": "elbow",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "setup",
          "to": "r2",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "setup",
          "to": "r3",
          "via": "elbow",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "r1",
          "to": "caveats",
          "via": "elbow",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "r2",
          "to": "caveats",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "r3",
          "to": "caveats",
          "via": "elbow",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "caveats",
          "to": "primate2",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "One empirical setup feeds three parallel findings about where synergy concentrates, a caveat on their scope, and a further finding from a different (behaving-animal) setting."
    }
  ]
}
```

## Candidate Y

Picture: /home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/evals/results/thinking-effort-261001s-sketch-schema/judging/sketch/picture-entropy-24-00930-spya-pywwkq-Y.png

Scene:

```json
{
  "title": "chain with two expansions",
  "caption": "The piece runs as one long chain from problem to method to evidence to open questions, with two dense stretches—building the PID framework, and testing it empirically—each worth opening up.",
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
          "h": 80,
          "text": "Brains process information, but how?",
          "size": "sm",
          "sub": "old limits: data & tools now easing",
          "block": "spya-yb735k"
        },
        {
          "kind": "node",
          "id": "track",
          "shape": "box",
          "x": 260,
          "y": 150,
          "w": 240,
          "h": 80,
          "text": "Mutual information & transfer entropy track flow between neurons",
          "size": "sm",
          "block": "spya-ygkzd8"
        },
        {
          "kind": "node",
          "id": "limits",
          "shape": "note",
          "x": 260,
          "y": 270,
          "w": 240,
          "h": 70,
          "text": "But flow alone can't show how inputs are combined",
          "size": "sm",
          "block": "spya-dhy39x"
        },
        {
          "kind": "region",
          "x": 40,
          "y": 370,
          "w": 680,
          "h": 280,
          "style": "band",
          "label": "BUILDING PARTIAL INFORMATION DECOMPOSITION (PID)",
          "tone": 1,
          "muted": true
        },
        {
          "kind": "node",
          "id": "basic",
          "shape": "diamond",
          "x": 80,
          "y": 420,
          "w": 190,
          "h": 90,
          "text": "Whole ≠ sum of parts: synergy or redundancy?",
          "size": "sm",
          "tone": 1,
          "block": "spya-u0wm5e",
          "opens": "inside-pid"
        },
        {
          "kind": "node",
          "id": "twoparent",
          "shape": "hex",
          "x": 300,
          "y": 420,
          "w": 180,
          "h": 90,
          "text": "Two-parent case: redundant, unique, synergistic atoms",
          "size": "sm",
          "tone": 1,
          "block": "spya-y7wdb7"
        },
        {
          "kind": "node",
          "id": "lattice",
          "shape": "hex",
          "x": 510,
          "y": 420,
          "w": 180,
          "h": 90,
          "text": "General lattice needs a chosen redundancy measure",
          "size": "sm",
          "tone": 1,
          "block": "spya-k378fv"
        },
        {
          "kind": "region",
          "x": 40,
          "y": 690,
          "w": 680,
          "h": 330,
          "style": "band",
          "label": "PID IN ACTION: EVIDENCE FROM CORTICAL DATA AND BEHAVING ANIMALS",
          "tone": 2,
          "muted": true
        },
        {
          "kind": "node",
          "id": "setup",
          "shape": "box",
          "x": 80,
          "y": 740,
          "w": 190,
          "h": 80,
          "text": "Cortical cultures: synergy tracks feedforward flow",
          "size": "sm",
          "tone": 2,
          "block": "spya-cc282b",
          "opens": "inside-evidence"
        },
        {
          "kind": "node",
          "id": "richclub",
          "shape": "box",
          "x": 300,
          "y": 740,
          "w": 190,
          "h": 80,
          "text": "Rich-club neurons hold most of the synergy",
          "size": "sm",
          "tone": 2,
          "block": "spya-e3ghxj"
        },
        {
          "kind": "node",
          "id": "primate",
          "shape": "box",
          "x": 510,
          "y": 740,
          "w": 180,
          "h": 80,
          "text": "In behaving macaques, synergy shifts with task",
          "size": "sm",
          "tone": 2,
          "block": "spya-aqcngt"
        },
        {
          "kind": "node",
          "id": "caveats",
          "shape": "note",
          "x": 300,
          "y": 850,
          "w": 190,
          "h": 80,
          "text": "Caveats: bivariate estimates, cultures not live brains",
          "size": "sm",
          "tone": 2,
          "block": "spya-vjzxxm"
        },
        {
          "kind": "node",
          "id": "practical",
          "shape": "box",
          "x": 260,
          "y": 1050,
          "w": 240,
          "h": 70,
          "text": "Practical limits: data type, sample size, tools, scaling",
          "size": "sm",
          "block": "spya-kmgwhs"
        },
        {
          "kind": "node",
          "id": "future",
          "shape": "box",
          "x": 40,
          "y": 1050,
          "w": 190,
          "h": 70,
          "text": "Future: local, time-resolved & multi-target PID",
          "size": "sm",
          "block": "spya-zz5xxs"
        },
        {
          "kind": "node",
          "id": "summary",
          "shape": "ellipse",
          "x": 510,
          "y": 1050,
          "w": 190,
          "h": 70,
          "text": "Synergy shows neurons read patterns, not sums",
          "size": "sm",
          "block": "spya-rc5z33"
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
          "to": "limits",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "limits",
          "to": "basic",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "basic",
          "to": "twoparent",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "twoparent",
          "to": "lattice",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "lattice",
          "to": "setup",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "setup",
          "to": "richclub",
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
          "from": "primate",
          "to": "caveats",
          "via": "curve",
          "line": "dashed",
          "arrow": "none"
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
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "practical",
          "to": "summary",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "A chain down the page: the need for better tools leads to the PID framework, which is then applied to real neural data, then qualified and extended."
    },
    {
      "id": "inside-pid",
      "title": "Building PID",
      "height": 760,
      "items": [
        {
          "kind": "node",
          "id": "puzzle",
          "shape": "diamond",
          "x": 280,
          "y": 30,
          "w": 220,
          "h": 90,
          "text": "Joint info ≠ sum of individual contributions",
          "size": "sm",
          "block": "spya-h5dz45"
        },
        {
          "kind": "node",
          "id": "synred",
          "shape": "box",
          "x": 280,
          "y": 160,
          "w": 220,
          "h": 80,
          "text": "Excess = synergy; shortfall = redundancy",
          "size": "sm",
          "block": "spya-e94ury"
        },
        {
          "kind": "node",
          "id": "figure1",
          "shape": "note",
          "x": 540,
          "y": 160,
          "w": 180,
          "h": 80,
          "text": "Venn diagram of redundant, unique, synergistic parts",
          "size": "xs",
          "block": "spya-pjdgu6"
        },
        {
          "kind": "node",
          "id": "twop",
          "shape": "hex",
          "x": 280,
          "y": 280,
          "w": 220,
          "h": 90,
          "text": "Two parents: four unknowns, three equations",
          "size": "sm",
          "block": "spya-q2b0e5"
        },
        {
          "kind": "node",
          "id": "underdet",
          "shape": "note",
          "x": 540,
          "y": 280,
          "w": 180,
          "h": 90,
          "text": "System is underdetermined without a redundancy definition",
          "size": "xs",
          "block": "spya-bgsd4n"
        },
        {
          "kind": "node",
          "id": "manyparents",
          "shape": "box",
          "x": 280,
          "y": 400,
          "w": 220,
          "h": 80,
          "text": "With 3+ parents, atoms multiply fast",
          "size": "sm",
          "block": "spya-q9gytb"
        },
        {
          "kind": "node",
          "id": "powerset",
          "shape": "box",
          "x": 280,
          "y": 500,
          "w": 220,
          "h": 80,
          "text": "Sources form a lattice of non-redundant combinations",
          "size": "sm",
          "block": "spya-pvavq4"
        },
        {
          "kind": "node",
          "id": "mobius",
          "shape": "hex",
          "x": 280,
          "y": 610,
          "w": 220,
          "h": 90,
          "text": "Möbius inversion extracts each atom's unique value",
          "size": "sm",
          "block": "spya-m37w5y"
        },
        {
          "kind": "node",
          "id": "redmeasure",
          "shape": "box",
          "x": 280,
          "y": 720,
          "w": 220,
          "h": 40,
          "text": "No single accepted redundancy measure — choice depends on context",
          "size": "sm",
          "block": "spya-d2quz5"
        },
        {
          "kind": "edge",
          "from": "puzzle",
          "to": "synred",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "synred",
          "to": "figure1",
          "via": "straight",
          "line": "dashed",
          "arrow": "none"
        },
        {
          "kind": "edge",
          "from": "synred",
          "to": "twop",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "twop",
          "to": "underdet",
          "via": "straight",
          "line": "dashed",
          "arrow": "none"
        },
        {
          "kind": "edge",
          "from": "twop",
          "to": "manyparents",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "manyparents",
          "to": "powerset",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "powerset",
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
      "caption": "A chain of concepts: from the basic puzzle that totals don't add up, through the two-source toy case, to the full lattice that needs a chosen redundancy rule."
    },
    {
      "id": "inside-evidence",
      "title": "PID in Action",
      "height": 760,
      "items": [
        {
          "kind": "node",
          "id": "cultures",
          "shape": "ellipse",
          "x": 280,
          "y": 30,
          "w": 220,
          "h": 80,
          "text": "512-channel recordings of cortical cultures",
          "size": "sm",
          "block": "spya-sw5ukx"
        },
        {
          "kind": "node",
          "id": "ffcorr",
          "shape": "box",
          "x": 60,
          "y": 160,
          "w": 210,
          "h": 80,
          "text": "Synergy tracks feedforward transfer entropy",
          "size": "sm",
          "tone": 1,
          "block": "spya-kqkb58"
        },
        {
          "kind": "node",
          "id": "richclub2",
          "shape": "box",
          "x": 290,
          "y": 160,
          "w": 210,
          "h": 80,
          "text": "Rich-club triads hold ~88% of network synergy",
          "size": "sm",
          "tone": 1,
          "block": "spya-fud8q3"
        },
        {
          "kind": "node",
          "id": "recurrent",
          "shape": "box",
          "x": 520,
          "y": 160,
          "w": 210,
          "h": 80,
          "text": "More recurrent connections, more synergy",
          "size": "sm",
          "tone": 1,
          "block": "spya-sd9fzd"
        },
        {
          "kind": "node",
          "id": "convergence",
          "shape": "box",
          "x": 175,
          "y": 280,
          "w": 210,
          "h": 90,
          "text": "Synergy rises then falls as source correlation grows",
          "size": "sm",
          "tone": 1,
          "block": "spya-hkhpex"
        },
        {
          "kind": "node",
          "id": "timescale",
          "shape": "note",
          "x": 410,
          "y": 280,
          "w": 210,
          "h": 90,
          "text": "At long timescales, redundancy dominates instead",
          "size": "sm",
          "tone": 1,
          "block": "spya-cs9fdy"
        },
        {
          "kind": "node",
          "id": "conclusion1",
          "shape": "box",
          "x": 280,
          "y": 400,
          "w": 220,
          "h": 80,
          "text": "Computation concentrates in densely-linked, correlated cores",
          "size": "sm",
          "block": "spya-akxt70"
        },
        {
          "kind": "node",
          "id": "caveats2",
          "shape": "note",
          "x": 280,
          "y": 500,
          "w": 220,
          "h": 80,
          "text": "Caveats: bivariate TE bias; cultures ≠ live behaving brains",
          "size": "sm",
          "block": "spya-j4cy9j"
        },
        {
          "kind": "node",
          "id": "primates2",
          "shape": "box",
          "x": 280,
          "y": 610,
          "w": 220,
          "h": 90,
          "text": "Macaques: synergy drops, redundancy rises during motor execution",
          "size": "sm",
          "block": "spya-t8fayf"
        },
        {
          "kind": "edge",
          "from": "cultures",
          "to": "ffcorr",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "cultures",
          "to": "richclub2",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "cultures",
          "to": "recurrent",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "ffcorr",
          "to": "conclusion1",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "richclub2",
          "to": "conclusion1",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "recurrent",
          "to": "conclusion1",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "convergence",
          "to": "conclusion1",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "timescale",
          "to": "conclusion1",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "conclusion1",
          "to": "caveats2",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "caveats2",
          "to": "primates2",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "Several independent empirical findings converge on one picture: synergy concentrates where connections and correlations are strongest, and shifts with behavior."
    }
  ]
}
```

## Candidate Z

Picture: /home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/evals/results/thinking-effort-261001s-sketch-schema/judging/sketch/picture-entropy-24-00930-spya-pywwkq-Z.png

Scene:

```json
{
  "title": "chain into convergence",
  "caption": "The piece runs as one long chain from problem to method to evidence to practice, with a convergence in the middle where several empirical findings all support one claim about synergy, and a fork near the end into forward-looking extensions.",
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
          "x": 280,
          "y": 30,
          "w": 200,
          "h": 70,
          "text": "How do brains process information?",
          "size": "md",
          "detail": "New recording tech and new analysis methods now make this tractable.",
          "block": "spya-yb735k"
        },
        {
          "kind": "node",
          "id": "tracking",
          "shape": "box",
          "x": 280,
          "y": 140,
          "w": 200,
          "h": 70,
          "text": "Mutual information vs. transfer entropy",
          "size": "sm",
          "sub": "connectivity vs. flow",
          "block": "spya-ygkzd8"
        },
        {
          "kind": "node",
          "id": "limit",
          "shape": "note",
          "x": 280,
          "y": 250,
          "w": 200,
          "h": 60,
          "text": "Flow alone can't show how inputs combine",
          "size": "sm",
          "block": "spya-dhy39x"
        },
        {
          "kind": "node",
          "id": "pid",
          "shape": "hex",
          "x": 270,
          "y": 340,
          "w": 220,
          "h": 80,
          "text": "Partial Information Decomposition",
          "size": "lg",
          "sub": "redundant / unique / synergistic",
          "detail": "Splits joint mutual information into non-overlapping pieces via a lattice and a chosen redundancy measure.",
          "block": "spya-u0wm5e",
          "opens": "inside-pid"
        },
        {
          "kind": "region",
          "x": 30,
          "y": 470,
          "w": 700,
          "h": 330,
          "style": "band",
          "label": "EMPIRICAL EVIDENCE FOR SYNERGY AS COMPUTATION",
          "opens": "inside-evidence",
          "tone": 1
        },
        {
          "kind": "node",
          "id": "richclub",
          "shape": "box",
          "x": 50,
          "y": 520,
          "w": 190,
          "h": 70,
          "text": "Rich-club neurons hold most synergy",
          "size": "sm",
          "tone": 1,
          "block": "spya-e3ghxj"
        },
        {
          "kind": "node",
          "id": "motifs",
          "shape": "box",
          "x": 280,
          "y": 520,
          "w": 190,
          "h": 70,
          "text": "Recurrent links raise synergy, feedback doesn't",
          "size": "sm",
          "tone": 1,
          "block": "spya-p8by2y"
        },
        {
          "kind": "node",
          "id": "corr",
          "shape": "box",
          "x": 510,
          "y": 520,
          "w": 190,
          "h": 70,
          "text": "Synergy peaks at moderate input correlation",
          "size": "sm",
          "tone": 1,
          "block": "spya-zfs2z7"
        },
        {
          "kind": "node",
          "id": "primate",
          "shape": "box",
          "x": 165,
          "y": 630,
          "w": 190,
          "h": 70,
          "text": "In behaving monkeys, synergy shifts with task",
          "size": "sm",
          "tone": 1,
          "block": "spya-aqcngt"
        },
        {
          "kind": "node",
          "id": "caveat",
          "shape": "note",
          "x": 395,
          "y": 630,
          "w": 190,
          "h": 70,
          "text": "Caveats: culture data, bivariate estimates",
          "size": "sm",
          "block": "spya-vjzxxm"
        },
        {
          "kind": "node",
          "id": "conclusion1",
          "shape": "ellipse",
          "x": 280,
          "y": 730,
          "w": 200,
          "h": 60,
          "text": "Synergy = where computation happens",
          "size": "md",
          "block": "spya-cc282b"
        },
        {
          "kind": "node",
          "id": "practical",
          "shape": "box",
          "x": 280,
          "y": 830,
          "w": 220,
          "h": 70,
          "text": "Practical limits: data type, sample size, tools",
          "size": "sm",
          "block": "spya-kmgwhs"
        },
        {
          "kind": "node",
          "id": "future",
          "shape": "box",
          "x": 280,
          "y": 940,
          "w": 220,
          "h": 70,
          "text": "Future: local PID, multi-target (ΦID)",
          "size": "sm",
          "block": "spya-zz5xxs"
        },
        {
          "kind": "node",
          "id": "summary",
          "shape": "ellipse",
          "x": 280,
          "y": 1050,
          "w": 200,
          "h": 70,
          "text": "Neurons compute on patterns, not just sums",
          "size": "md",
          "block": "spya-rc5z33"
        },
        {
          "kind": "edge",
          "from": "intro",
          "to": "tracking",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "tracking",
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
          "to": "motifs",
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
          "to": "conclusion1",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "motifs",
          "to": "conclusion1",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "corr",
          "to": "conclusion1",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "primate",
          "to": "conclusion1",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "conclusion1",
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
        }
      ],
      "caption": "A chain from the problem (no good way to measure neural computation) through the PID method to a cluster of findings that all converge on 'synergy marks information processing', then branching into practical limits and future extensions."
    },
    {
      "id": "inside-pid",
      "title": "Building the PID framework",
      "height": 620,
      "items": [
        {
          "kind": "node",
          "id": "puzzle",
          "shape": "diamond",
          "x": 280,
          "y": 30,
          "w": 200,
          "h": 80,
          "text": "Whole ≠ sum of parts",
          "size": "sm",
          "block": "spya-u0wm5e"
        },
        {
          "kind": "node",
          "id": "synergy_def",
          "shape": "box",
          "x": 70,
          "y": 150,
          "w": 200,
          "h": 70,
          "text": "Whole > parts: synergy",
          "size": "sm",
          "block": "spya-e94ury"
        },
        {
          "kind": "node",
          "id": "redund_def",
          "shape": "box",
          "x": 490,
          "y": 150,
          "w": 200,
          "h": 70,
          "text": "Whole < parts: redundancy",
          "size": "sm",
          "block": "spya-e94ury"
        },
        {
          "kind": "node",
          "id": "twoparent",
          "shape": "box",
          "x": 280,
          "y": 260,
          "w": 200,
          "h": 70,
          "text": "Two-parent case: four unknown atoms, three equations",
          "size": "sm",
          "block": "spya-y7wdb7"
        },
        {
          "kind": "node",
          "id": "lattice",
          "shape": "hex",
          "x": 280,
          "y": 370,
          "w": 220,
          "h": 80,
          "text": "General lattice of source subsets",
          "size": "sm",
          "detail": "Mobius inversion over a redundancy function gives every partial information atom.",
          "block": "spya-k378fv"
        },
        {
          "kind": "node",
          "id": "redmeasure",
          "shape": "note",
          "x": 280,
          "y": 480,
          "w": 220,
          "h": 70,
          "text": "No agreed redundancy measure; pick per data type",
          "size": "sm",
          "block": "spya-d2quz5"
        },
        {
          "kind": "edge",
          "from": "puzzle",
          "to": "synergy_def",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "puzzle",
          "to": "redund_def",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "synergy_def",
          "to": "twoparent",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "redund_def",
          "to": "twoparent",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "twoparent",
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
        }
      ],
      "caption": "A ladder: from the puzzle that parts don't sum to the whole, through the two-neuron case, up to the general lattice, which still needs an arbitrary choice of redundancy measure to compute."
    },
    {
      "id": "inside-evidence",
      "title": "Evidence that synergy marks computation",
      "height": 560,
      "items": [
        {
          "kind": "node",
          "id": "setup",
          "shape": "box",
          "x": 280,
          "y": 30,
          "w": 220,
          "h": 70,
          "text": "512-electrode recordings, thousands of triads",
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
          "block": "spya-kqkb58"
        },
        {
          "kind": "node",
          "id": "rich2",
          "shape": "box",
          "x": 60,
          "y": 230,
          "w": 190,
          "h": 70,
          "text": "Rich-club triads: 88% of network synergy",
          "size": "sm",
          "tone": 1,
          "block": "spya-fud8q3"
        },
        {
          "kind": "node",
          "id": "motif2",
          "shape": "box",
          "x": 280,
          "y": 230,
          "w": 190,
          "h": 70,
          "text": "Recurrent > feedback for raising synergy",
          "size": "sm",
          "tone": 1,
          "block": "spya-sd9fzd"
        },
        {
          "kind": "node",
          "id": "corr2",
          "shape": "box",
          "x": 500,
          "y": 230,
          "w": 190,
          "h": 70,
          "text": "Synergy peaks at ~7% of max correlation",
          "size": "sm",
          "tone": 1,
          "block": "spya-ybmve2"
        },
        {
          "kind": "node",
          "id": "caveat2",
          "shape": "note",
          "x": 60,
          "y": 340,
          "w": 190,
          "h": 70,
          "text": "Bivariate TE overstates edges; culture ≠ in vivo",
          "size": "sm",
          "block": "spya-j4cy9j"
        },
        {
          "kind": "node",
          "id": "monkey",
          "shape": "box",
          "x": 280,
          "y": 340,
          "w": 220,
          "h": 70,
          "text": "Macaques: synergy/redundancy shift by task epoch",
          "size": "sm",
          "tone": 1,
          "block": "spya-t8fayf"
        },
        {
          "kind": "node",
          "id": "conv",
          "shape": "ellipse",
          "x": 280,
          "y": 450,
          "w": 220,
          "h": 70,
          "text": "Synergy = behaviorally shaped computation",
          "size": "md",
          "block": "spya-b32ecw"
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
          "to": "rich2",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "ff",
          "to": "motif2",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "ff",
          "to": "corr2",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "rich2",
          "to": "caveat2",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "motif2",
          "to": "monkey",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "caveat2",
          "to": "conv",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "monkey",
          "to": "conv",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "corr2",
          "to": "conv",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "Several independent findings, from cortical cultures and from behaving monkeys, all converge on the same claim: synergy concentrates where the real information processing happens."
    }
  ]
}
```
