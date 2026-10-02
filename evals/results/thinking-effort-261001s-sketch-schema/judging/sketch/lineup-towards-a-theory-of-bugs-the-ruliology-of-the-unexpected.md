# 4 candidates for "Towards a Theory of Bugs: The Ruliology of the Unexpected"

Each candidate is a picture of how the article is put together, for a reader who has not read it yet. They are labelled W, X, Y, Z in an order that
says nothing about how any of them was made. The article itself, with its block ids, is
`article-towards-a-theory-of-bugs-the-ruliology-of-the-unexpected.md` beside this file.

## Candidate W

Picture: /home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/evals/results/thinking-effort-261001s-sketch-schema/judging/sketch/picture-towards-a-theory-of-bugs-the-ruliology-of-the-unexpected-W.png

Scene:

```json
{
  "title": "spine with convergence",
  "caption": "A chain running straight down the page: each part demonstrates, with a different kind of system, that the previous part's exact failure also shows up here — culminating in computational irreducibility as the one explanation for all of it, before the final part asks what can still be done in practice.",
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
          "text": "Why do simple programs misbehave?",
          "size": "md",
          "block": "spya-d46wsq"
        },
        {
          "kind": "region",
          "x": 24,
          "y": 130,
          "w": 330,
          "h": 260,
          "style": "band",
          "label": "TURING MACHINES",
          "tone": 1,
          "muted": true
        },
        {
          "kind": "node",
          "id": "tm1",
          "shape": "box",
          "x": 48,
          "y": 160,
          "w": 280,
          "h": 70,
          "text": "n+1 machine fails at n=7",
          "size": "sm",
          "sub": "extra scribbling on 111-endings",
          "tone": 1,
          "block": "spya-h3jx6h"
        },
        {
          "kind": "node",
          "id": "tm2",
          "shape": "box",
          "x": 48,
          "y": 250,
          "w": 280,
          "h": 60,
          "text": "Bugs can hide for arbitrarily many steps",
          "size": "sm",
          "sub": "first bug at n=15, n=63...",
          "tone": 1,
          "block": "spya-pt0hmz",
          "opens": "inside-turing"
        },
        {
          "kind": "node",
          "id": "tm3",
          "shape": "box",
          "x": 48,
          "y": 325,
          "w": 280,
          "h": 55,
          "text": "Whatever you specify, some machine insidiously violates it",
          "size": "sm",
          "tone": 1,
          "block": "spya-jdmx0m"
        },
        {
          "kind": "region",
          "x": 390,
          "y": 130,
          "w": 330,
          "h": 200,
          "style": "band",
          "label": "CELLULAR AUTOMATA",
          "tone": 2,
          "muted": true
        },
        {
          "kind": "node",
          "id": "ca1",
          "shape": "box",
          "x": 414,
          "y": 160,
          "w": 280,
          "h": 65,
          "text": "A doubling rule fails suddenly at n=14",
          "size": "sm",
          "tone": 2,
          "block": "spya-htqcgc"
        },
        {
          "kind": "node",
          "id": "ca2",
          "shape": "diamond",
          "x": 440,
          "y": 245,
          "w": 230,
          "h": 70,
          "text": "Can we tell in advance?",
          "size": "sm",
          "tone": 2,
          "block": "spya-gt6430",
          "opens": "inside-proof"
        },
        {
          "kind": "node",
          "id": "proof1",
          "shape": "hex",
          "x": 414,
          "y": 340,
          "w": 280,
          "h": 65,
          "text": "Sometimes yes: rule 122 analysis proves no bug possible",
          "size": "sm",
          "tone": 2,
          "block": "spya-gagsuk"
        },
        {
          "kind": "node",
          "id": "proof2",
          "shape": "hex",
          "x": 180,
          "y": 440,
          "w": 300,
          "h": 70,
          "text": "Symbolic axioms + induction formally prove a machine bug-free",
          "size": "sm",
          "block": "spya-q8fg9q"
        },
        {
          "kind": "node",
          "id": "proof3",
          "shape": "note",
          "x": 180,
          "y": 525,
          "w": 300,
          "h": 55,
          "text": "A buggy machine yields no proof, however long you search",
          "size": "sm",
          "block": "spya-ypka68"
        },
        {
          "kind": "node",
          "id": "core",
          "shape": "box",
          "x": 200,
          "y": 615,
          "w": 320,
          "h": 90,
          "text": "Computational irreducibility: behavior can only be known by running it",
          "size": "lg",
          "tone": 3,
          "block": "spya-wcnws7"
        },
        {
          "kind": "edge",
          "from": "tm3",
          "to": "core",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "proof1",
          "to": "core",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "proof3",
          "to": "core",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "node",
          "id": "induction",
          "shape": "box",
          "x": 200,
          "y": 740,
          "w": 320,
          "h": 70,
          "text": "So testing can't guarantee a bug won't surface later",
          "size": "sm",
          "block": "spya-yc9e2z"
        },
        {
          "kind": "region",
          "x": 24,
          "y": 840,
          "w": 330,
          "h": 150,
          "style": "band",
          "label": "SURPRISES EVERYWHERE",
          "tone": 4,
          "muted": true
        },
        {
          "kind": "node",
          "id": "surp1",
          "shape": "box",
          "x": 48,
          "y": 870,
          "w": 280,
          "h": 55,
          "text": "Rule 30, long halts, broken symmetry",
          "size": "sm",
          "tone": 4,
          "block": "spya-kjsjh5"
        },
        {
          "kind": "node",
          "id": "surp2",
          "shape": "box",
          "x": 48,
          "y": 935,
          "w": 280,
          "h": 45,
          "text": "Even mathematics finds late counterexamples",
          "size": "sm",
          "tone": 4,
          "block": "spya-cc855a"
        },
        {
          "kind": "node",
          "id": "practical",
          "shape": "box",
          "x": 410,
          "y": 880,
          "w": 300,
          "h": 90,
          "text": "Good language design & visualization push the frontier back, but never erase it",
          "size": "sm",
          "tone": 5,
          "block": "spya-kdks69"
        },
        {
          "kind": "edge",
          "from": "induction",
          "to": "surp1",
          "via": "elbow",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "induction",
          "to": "practical",
          "via": "elbow",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "intro",
          "to": "tm1",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "intro",
          "to": "ca1",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "tm2",
          "to": "tm3",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "ca1",
          "to": "ca2",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "ca2",
          "to": "proof1",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "proof2",
          "to": "proof3",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "core",
          "to": "induction",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "A chain of mounting evidence (Turing machines, cellular automata, proofs, mathematics) converges on computational irreducibility as the root cause of bugs, then diverges into practical responses."
    },
    {
      "id": "inside-turing",
      "title": "Bugs in Turing Machines",
      "height": 760,
      "items": [
        {
          "kind": "node",
          "id": "t1",
          "shape": "ellipse",
          "x": 270,
          "y": 30,
          "w": 220,
          "h": 60,
          "text": "3-state machine seems to compute n+1",
          "size": "md",
          "block": "spya-scjxv8"
        },
        {
          "kind": "node",
          "id": "t2",
          "shape": "box",
          "x": 250,
          "y": 120,
          "w": 260,
          "h": 65,
          "text": "Fails at n=7: outputs 9 instead of 8",
          "size": "sm",
          "sub": "head 'scribbles' on 111-endings",
          "tone": 1,
          "block": "spya-h3jx6h"
        },
        {
          "kind": "node",
          "id": "t3",
          "shape": "box",
          "x": 250,
          "y": 215,
          "w": 260,
          "h": 60,
          "text": "8934 machines correctly compute n+1",
          "size": "sm",
          "sub": "some simple, some wildly nested",
          "tone": 1,
          "block": "spya-rhc6t0"
        },
        {
          "kind": "node",
          "id": "t4",
          "shape": "box",
          "x": 250,
          "y": 305,
          "w": 260,
          "h": 60,
          "text": "Census of where first bugs appear",
          "size": "sm",
          "tone": 1,
          "block": "spya-y7nwnj"
        },
        {
          "kind": "node",
          "id": "t5",
          "shape": "box",
          "x": 250,
          "y": 395,
          "w": 260,
          "h": 70,
          "text": "One machine works flawlessly for n=0..14, then fails at n=15",
          "size": "sm",
          "tone": 1,
          "block": "spya-pt0hmz"
        },
        {
          "kind": "node",
          "id": "t6",
          "shape": "box",
          "x": 250,
          "y": 495,
          "w": 260,
          "h": 75,
          "text": "4-state machine: correct for all n up to 62, fails at 63",
          "size": "sm",
          "tone": 1,
          "block": "spya-hqukdz"
        },
        {
          "kind": "node",
          "id": "t7",
          "shape": "note",
          "x": 250,
          "y": 600,
          "w": 260,
          "h": 65,
          "text": "Highest-risk inputs: binary numbers of all 1s (2^i - 1)",
          "size": "sm",
          "block": "spya-u3d2ws"
        },
        {
          "kind": "edge",
          "from": "t1",
          "to": "t2",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "t2",
          "to": "t3",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "t3",
          "to": "t4",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "t4",
          "to": "t5",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "t5",
          "to": "t6",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "t6",
          "to": "t7",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "A chain: a minimal failure, a census of when such failures first appear, an especially hidden case, and the same pattern recurring at larger scale."
    },
    {
      "id": "inside-proof",
      "title": "Can Bugs Be Proved Away?",
      "height": 780,
      "items": [
        {
          "kind": "node",
          "id": "p1",
          "shape": "ellipse",
          "x": 270,
          "y": 30,
          "w": 220,
          "h": 55,
          "text": "Some patterns are visibly bug-free",
          "size": "md",
          "block": "spya-rhda0x"
        },
        {
          "kind": "node",
          "id": "p2",
          "shape": "box",
          "x": 250,
          "y": 115,
          "w": 260,
          "h": 65,
          "text": "A complex-looking rule survives 100,000 tests",
          "size": "sm",
          "sub": "but fluctuations leave doubt",
          "tone": 2,
          "block": "spya-asw9eq"
        },
        {
          "kind": "node",
          "id": "p3",
          "shape": "box",
          "x": 250,
          "y": 210,
          "w": 260,
          "h": 65,
          "text": "Studying the whole computation, not just outputs",
          "size": "sm",
          "sub": "rind always moves left or stays",
          "tone": 2,
          "block": "spya-r7ty6m"
        },
        {
          "kind": "node",
          "id": "p4",
          "shape": "hex",
          "x": 250,
          "y": 305,
          "w": 260,
          "h": 65,
          "text": "Interior dynamics = known rule 122",
          "size": "sm",
          "tone": 2,
          "block": "spya-gagsuk"
        },
        {
          "kind": "node",
          "id": "p5",
          "shape": "box",
          "x": 250,
          "y": 400,
          "w": 260,
          "h": 55,
          "text": "Rule 122 can never die out → pattern must stabilize, no bug",
          "size": "sm",
          "tone": 2,
          "block": "spya-n5acnw"
        },
        {
          "kind": "node",
          "id": "p6",
          "shape": "box",
          "x": 250,
          "y": 485,
          "w": 260,
          "h": 65,
          "text": "Separately: symbolic axioms + induction prove a Turing machine correct",
          "size": "sm",
          "block": "spya-q8fg9q"
        },
        {
          "kind": "node",
          "id": "p7",
          "shape": "box",
          "x": 250,
          "y": 580,
          "w": 260,
          "h": 65,
          "text": "Proof search = path through a multiway graph of theorems",
          "size": "sm",
          "block": "spya-bn24t3"
        },
        {
          "kind": "node",
          "id": "p8",
          "shape": "box",
          "x": 250,
          "y": 675,
          "w": 260,
          "h": 70,
          "text": "For a buggy machine, no path exists — the claim is false",
          "size": "sm",
          "block": "spya-ypka68"
        },
        {
          "kind": "edge",
          "from": "p1",
          "to": "p2",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "p2",
          "to": "p3",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "p3",
          "to": "p4",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "p4",
          "to": "p5",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "p5",
          "to": "p6",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "p6",
          "to": "p7",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "p7",
          "to": "p8",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "A fork, not a settled question: one path of careful structural reasoning proves a system bug-free, while the formal-proof path for Turing machines only succeeds exactly when there is in fact no bug to find."
    }
  ]
}
```

## Candidate X

This candidate produced no usable output.

## Candidate Y

Picture: /home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/evals/results/thinking-effort-261001s-sketch-schema/judging/sketch/picture-towards-a-theory-of-bugs-the-ruliology-of-the-unexpected-Y.png

Scene:

```json
{
  "title": "Spine with two zooms",
  "caption": "A chain runs straight down through the article's main argument—bugs are unavoidable because of computational irreducibility—with two thick links (Turing-machine proofs, and the parade of ruliological surprises) opened out into their own scenes.",
  "scenes": [
    {
      "id": "overview",
      "title": "Overview",
      "height": 1180,
      "items": [
        {
          "kind": "node",
          "id": "n1",
          "shape": "ellipse",
          "x": 280,
          "y": 40,
          "w": 240,
          "h": 70,
          "text": "A program's real behavior can outrun our simple mental model of it",
          "size": "sm",
          "block": "spya-d46wsq"
        },
        {
          "kind": "node",
          "id": "n2",
          "shape": "box",
          "x": 260,
          "y": 140,
          "w": 280,
          "h": 80,
          "text": "Minimal Turing machines built to compute n+1 fail at specific, sometimes very delayed, inputs",
          "size": "sm",
          "tone": 1,
          "block": "spya-s7uc4u",
          "opens": "zoom-tm"
        },
        {
          "kind": "node",
          "id": "n3",
          "shape": "box",
          "x": 260,
          "y": 250,
          "w": 280,
          "h": 70,
          "text": "What counts as a bug depends on the spec—and some machine always seems to escape it",
          "size": "sm",
          "tone": 1,
          "block": "spya-gjut02"
        },
        {
          "kind": "node",
          "id": "n4",
          "shape": "box",
          "x": 260,
          "y": 350,
          "w": 280,
          "h": 70,
          "text": "Cellular automata built to double their input fail the same way, sometimes after dozens of steps",
          "size": "sm",
          "block": "spya-cy4dgs"
        },
        {
          "kind": "node",
          "id": "n5",
          "shape": "box",
          "x": 260,
          "y": 450,
          "w": 280,
          "h": 70,
          "text": "Some complex-looking rules can still be proven to never fail",
          "size": "sm",
          "block": "spya-gt6430"
        },
        {
          "kind": "node",
          "id": "n6",
          "shape": "hex",
          "x": 260,
          "y": 550,
          "w": 280,
          "h": 80,
          "text": "Symbolic axioms + induction can formally prove a machine bug-free—but only if it truly is",
          "size": "sm",
          "tone": 1,
          "block": "spya-qr6x2h",
          "opens": "zoom-tm"
        },
        {
          "kind": "node",
          "id": "n7",
          "shape": "diamond",
          "x": 270,
          "y": 660,
          "w": 260,
          "h": 90,
          "text": "Computational irreducibility: behavior is knowable only by running it",
          "size": "sm",
          "block": "spya-wcnws7"
        },
        {
          "kind": "node",
          "id": "n8",
          "shape": "box",
          "x": 260,
          "y": 780,
          "w": 280,
          "h": 70,
          "text": "Testing and sampling can miss rare bugs no matter how much you do",
          "size": "sm",
          "block": "spya-yc9e2z"
        },
        {
          "kind": "node",
          "id": "n9",
          "shape": "box",
          "x": 260,
          "y": 880,
          "w": 280,
          "h": 80,
          "text": "Across cellular automata, Turing machines, combinators, multiway systems: dramatic surprises keep appearing",
          "size": "sm",
          "tone": 2,
          "block": "spya-kjsjh5",
          "opens": "zoom-surprises"
        },
        {
          "kind": "node",
          "id": "n10",
          "shape": "box",
          "x": 260,
          "y": 990,
          "w": 280,
          "h": 70,
          "text": "Mathematics mostly avoids this by sticking to human-graspable, reducible questions",
          "size": "sm",
          "tone": 2,
          "block": "spya-bhwh4d"
        },
        {
          "kind": "node",
          "id": "n11",
          "shape": "box",
          "x": 260,
          "y": 1090,
          "w": 280,
          "h": 70,
          "text": "Good language design and seeing inside a computation push back the problem, but never erase it",
          "size": "sm",
          "tone": 2,
          "block": "spya-kdks69"
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
          "to": "n7",
          "via": "straight",
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
          "kind": "edge",
          "from": "n9",
          "to": "n10",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "n10",
          "to": "n11",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "Main spine: simple programs can already hide bugs; proofs can rule them out only in special pockets; irreducibility makes this generic, as confirmed across many systems and even mathematics; practical mitigation (language design, visualization) helps but never eliminates it."
    },
    {
      "id": "zoom-tm",
      "title": "Turing machines: bugs and proofs",
      "height": 1080,
      "items": [
        {
          "kind": "node",
          "id": "a1",
          "shape": "box",
          "x": 260,
          "y": 40,
          "w": 260,
          "h": 70,
          "text": "A 3-state machine seems to compute n+1 for small inputs",
          "size": "sm",
          "block": "spya-kk6a0n"
        },
        {
          "kind": "node",
          "id": "a2",
          "shape": "box",
          "x": 260,
          "y": 140,
          "w": 260,
          "h": 70,
          "text": "Bug found at n=7: outputs 9 instead of 8",
          "size": "sm",
          "tone": 1,
          "block": "spya-h3jx6h"
        },
        {
          "kind": "node",
          "id": "a3",
          "shape": "box",
          "x": 260,
          "y": 240,
          "w": 260,
          "h": 70,
          "text": "Among thousands of correct machines, first bugs can be greatly delayed",
          "size": "sm",
          "block": "spya-rhc6t0"
        },
        {
          "kind": "node",
          "id": "a4",
          "shape": "box",
          "x": 260,
          "y": 340,
          "w": 260,
          "h": 70,
          "text": "One machine is correct for every input up to 14, then fails at 15",
          "size": "sm",
          "tone": 1,
          "block": "spya-pt0hmz"
        },
        {
          "kind": "node",
          "id": "a5",
          "shape": "box",
          "x": 260,
          "y": 440,
          "w": 260,
          "h": 70,
          "text": "A 4-state machine hides its bug until n=63",
          "size": "sm",
          "tone": 1,
          "block": "spya-hqukdz"
        },
        {
          "kind": "node",
          "id": "a6",
          "shape": "diamond",
          "x": 270,
          "y": 550,
          "w": 240,
          "h": 90,
          "text": "Being a 'bug' depends on which specification you judge against",
          "size": "sm",
          "block": "spya-gjut02"
        },
        {
          "kind": "node",
          "id": "a7",
          "shape": "box",
          "x": 40,
          "y": 670,
          "w": 220,
          "h": 70,
          "text": "Two seemingly-equal machines diverge starting at n=27",
          "size": "xs",
          "block": "spya-ssqhfr"
        },
        {
          "kind": "node",
          "id": "a8",
          "shape": "box",
          "x": 290,
          "y": 670,
          "w": 220,
          "h": 70,
          "text": "Others run wild or loop forever after looking fine for a while",
          "size": "xs",
          "block": "spya-rt2gb2"
        },
        {
          "kind": "node",
          "id": "a9",
          "shape": "hex",
          "x": 260,
          "y": 780,
          "w": 260,
          "h": 90,
          "text": "Symbolic tape axioms + induction formally prove a correct machine always gives n+1",
          "size": "sm",
          "tone": 1,
          "block": "spya-jqmftv"
        },
        {
          "kind": "node",
          "id": "a10",
          "shape": "box",
          "x": 260,
          "y": 910,
          "w": 260,
          "h": 80,
          "text": "For a buggy machine, searching the same proof-graph forever finds no proof, because none exists",
          "size": "sm",
          "tone": 1,
          "block": "spya-ypka68"
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
          "via": "elbow",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "a6",
          "to": "a8",
          "via": "elbow",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "a7",
          "to": "a9",
          "via": "elbow",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "a8",
          "to": "a9",
          "via": "elbow",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "a9",
          "to": "a10",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "Inside the Turing-machine thread: simple machines meant to compute n+1 develop bugs at delayed, insidious inputs; what counts as a bug depends on the chosen specification; and a formal symbolic proof can rule bugs out, but only succeeds when the machine is actually correct."
    },
    {
      "id": "zoom-surprises",
      "title": "Surprises across the computational universe",
      "height": 1080,
      "items": [
        {
          "kind": "node",
          "id": "b1",
          "shape": "box",
          "x": 260,
          "y": 40,
          "w": 260,
          "h": 70,
          "text": "Simple cellular automata mostly behave regularly—until rule 30's sudden complexity",
          "size": "sm",
          "block": "spya-kjsjh5"
        },
        {
          "kind": "node",
          "id": "b2",
          "shape": "box",
          "x": 260,
          "y": 140,
          "w": 260,
          "h": 70,
          "text": "Varying one rule's starting input produces a cascade of escalating surprises",
          "size": "sm",
          "block": "spya-n7j593"
        },
        {
          "kind": "node",
          "id": "b3",
          "shape": "box",
          "x": 260,
          "y": 240,
          "w": 260,
          "h": 70,
          "text": "A combinator expression seems to grow forever, then halts after 137,356,329 steps",
          "size": "sm",
          "block": "spya-msgzxc"
        },
        {
          "kind": "node",
          "id": "b4",
          "shape": "box",
          "x": 260,
          "y": 340,
          "w": 260,
          "h": 70,
          "text": "A circular 2D pattern suddenly sprouts an asymmetric 'beak'",
          "size": "sm",
          "block": "spya-p3ume6"
        },
        {
          "kind": "node",
          "id": "b5",
          "shape": "box",
          "x": 260,
          "y": 440,
          "w": 260,
          "h": 70,
          "text": "A constrained-growth system that seems endless hits a cluster that can't grow further",
          "size": "sm",
          "block": "spya-ey7bx7"
        },
        {
          "kind": "node",
          "id": "b6",
          "shape": "box",
          "x": 260,
          "y": 550,
          "w": 260,
          "h": 70,
          "text": "Even in mathematics, patterns holding for huge numbers of cases suddenly break (prime counts flip sign at the 23,338,590,792th prime)",
          "size": "sm",
          "tone": 2,
          "block": "spya-bhwh4d"
        },
        {
          "kind": "node",
          "id": "b7",
          "shape": "box",
          "x": 260,
          "y": 660,
          "w": 260,
          "h": 70,
          "text": "Pure math mostly dodges this by focusing on human-graspable, reducible questions",
          "size": "sm",
          "tone": 2,
          "block": "spya-zcpn8u"
        },
        {
          "kind": "node",
          "id": "b8",
          "shape": "box",
          "x": 260,
          "y": 760,
          "w": 260,
          "h": 70,
          "text": "Well-designed language primitives and visualizing a computation can build confidence it's bug-free",
          "size": "sm",
          "tone": 2,
          "block": "spya-kdks69"
        },
        {
          "kind": "node",
          "id": "b9",
          "shape": "ellipse",
          "x": 260,
          "y": 870,
          "w": 260,
          "h": 80,
          "text": "An unexpected result is a failure for engineering, but a discovery for science",
          "size": "sm",
          "block": "spya-xdwm97"
        },
        {
          "kind": "edge",
          "from": "b1",
          "to": "b2",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "b2",
          "to": "b3",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "b3",
          "to": "b4",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "b4",
          "to": "b5",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "b5",
          "to": "b6",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "b6",
          "to": "b7",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "b7",
          "to": "b8",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "b8",
          "to": "b9",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "The same pattern—confident regularity, then a sudden break—shows up again and again across very different systems, and even in mathematics, which mostly escapes it only by sticking to reducible questions."
    }
  ]
}
```

## Candidate Z

Picture: /home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/evals/results/thinking-effort-261001s-sketch-schema/judging/sketch/picture-towards-a-theory-of-bugs-the-ruliology-of-the-unexpected-Z.png

Scene:

```json
{
  "title": "funnel into hub, then fan-out",
  "caption": "A funnel through mounting examples of bugs in simple systems narrows to the single explanatory claim (computational irreducibility), which then fans back out into its consequences for proof, testing, math, and practice.",
  "scenes": [
    {
      "id": "overview",
      "title": "Overview",
      "height": 1020,
      "items": [
        {
          "kind": "node",
          "id": "intro",
          "shape": "ellipse",
          "x": 260,
          "y": 30,
          "w": 240,
          "h": 70,
          "text": "Bugs are unforeseeable even in simple programs",
          "size": "md",
          "block": "spya-d46wsq"
        },
        {
          "kind": "region",
          "x": 40,
          "y": 130,
          "w": 680,
          "h": 260,
          "style": "band",
          "label": "BUGS IN SIMPLE SYSTEMS",
          "opens": "simple-systems",
          "tone": 1
        },
        {
          "kind": "node",
          "id": "tm",
          "shape": "box",
          "x": 60,
          "y": 170,
          "w": 200,
          "h": 70,
          "text": "Turing machines meant to compute n+1 glitch at specific n",
          "size": "sm",
          "tone": 1,
          "block": "spya-s7uc4u"
        },
        {
          "kind": "node",
          "id": "spec",
          "shape": "box",
          "x": 290,
          "y": 170,
          "w": 200,
          "h": 70,
          "text": "What counts as a bug depends on the spec chosen",
          "size": "sm",
          "tone": 1,
          "block": "spya-gjut02"
        },
        {
          "kind": "node",
          "id": "ca",
          "shape": "box",
          "x": 520,
          "y": 170,
          "w": 180,
          "h": 70,
          "text": "Doubling cellular automata fail after many good steps",
          "size": "sm",
          "tone": 1,
          "block": "spya-cy4dgs"
        },
        {
          "kind": "node",
          "id": "tell",
          "shape": "box",
          "x": 290,
          "y": 280,
          "w": 200,
          "h": 90,
          "text": "Sometimes structure lets us prove no bug is possible",
          "size": "sm",
          "sub": "rule 122 case",
          "tone": 1,
          "block": "spya-gt6430"
        },
        {
          "kind": "node",
          "id": "hub",
          "shape": "hex",
          "x": 260,
          "y": 430,
          "w": 260,
          "h": 100,
          "text": "Computational irreducibility: only running it reveals what it does",
          "size": "lg",
          "block": "spya-wcnws7"
        },
        {
          "kind": "node",
          "id": "proof",
          "shape": "box",
          "x": 60,
          "y": 590,
          "w": 190,
          "h": 80,
          "text": "Formal proofs exist only for bug-free machines",
          "size": "sm",
          "tone": 2,
          "block": "spya-qr6x2h"
        },
        {
          "kind": "node",
          "id": "testing",
          "shape": "box",
          "x": 290,
          "y": 590,
          "w": 190,
          "h": 80,
          "text": "Testing can't rule out rare hidden bugs",
          "size": "sm",
          "tone": 2,
          "block": "spya-yc9e2z"
        },
        {
          "kind": "node",
          "id": "surprises",
          "shape": "box",
          "x": 520,
          "y": 590,
          "w": 190,
          "h": 80,
          "text": "Ruliology keeps turning up dramatic late surprises",
          "size": "sm",
          "tone": 2,
          "block": "spya-kjsjh5",
          "opens": "beyond"
        },
        {
          "kind": "region",
          "x": 40,
          "y": 720,
          "w": 680,
          "h": 250,
          "style": "band",
          "label": "BUGS BEYOND PROGRAMMING",
          "opens": "beyond",
          "tone": 3
        },
        {
          "kind": "node",
          "id": "math",
          "shape": "box",
          "x": 60,
          "y": 760,
          "w": 200,
          "h": 80,
          "text": "Math conjectures also fail after huge numbers of cases",
          "size": "sm",
          "tone": 3,
          "block": "spya-bhwh4d"
        },
        {
          "kind": "node",
          "id": "lang",
          "shape": "box",
          "x": 290,
          "y": 760,
          "w": 200,
          "h": 80,
          "text": "Good language design pushes bugs back, never removes them",
          "size": "sm",
          "tone": 3,
          "block": "spya-kdks69"
        },
        {
          "kind": "node",
          "id": "discovery",
          "shape": "box",
          "x": 520,
          "y": 760,
          "w": 180,
          "h": 80,
          "text": "An unexpected result can be a discovery, not just a failure",
          "size": "sm",
          "tone": 3,
          "block": "spya-xdwm97"
        },
        {
          "kind": "edge",
          "from": "intro",
          "to": "tm",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "intro",
          "to": "spec",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "intro",
          "to": "ca",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "spec",
          "to": "tell",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "tm",
          "to": "hub",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "tell",
          "to": "hub",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "ca",
          "to": "hub",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "hub",
          "to": "proof",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "hub",
          "to": "testing",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "hub",
          "to": "surprises",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "testing",
          "to": "math",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "testing",
          "to": "lang",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "surprises",
          "to": "discovery",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "Examples of bugs in ever-simpler systems funnel down to one cause, computational irreducibility, which then fans out into what it means for proofs, testing, math, and everyday programming."
    },
    {
      "id": "simple-systems",
      "title": "Bugs in Turing machines and cellular automata",
      "height": 760,
      "items": [
        {
          "kind": "node",
          "id": "s1",
          "shape": "box",
          "x": 260,
          "y": 30,
          "w": 260,
          "h": 80,
          "text": "A 3-state machine computing n+1 breaks first at n=7",
          "size": "sm",
          "block": "spya-kk6a0n"
        },
        {
          "kind": "node",
          "id": "s2",
          "shape": "box",
          "x": 260,
          "y": 140,
          "w": 260,
          "h": 80,
          "text": "Among thousands of correct machines, first bugs can be delayed far out",
          "size": "sm",
          "block": "spya-rhc6t0"
        },
        {
          "kind": "node",
          "id": "s3",
          "shape": "box",
          "x": 260,
          "y": 250,
          "w": 260,
          "h": 80,
          "text": "One machine works for n=0..14, fails only at n=15",
          "size": "sm",
          "block": "spya-pt0hmz"
        },
        {
          "kind": "node",
          "id": "s4",
          "shape": "box",
          "x": 260,
          "y": 360,
          "w": 260,
          "h": 80,
          "text": "Larger machines hide bugs even longer; all-ones inputs are highest risk",
          "size": "sm",
          "block": "spya-hqukdz"
        },
        {
          "kind": "node",
          "id": "s5",
          "shape": "diamond",
          "x": 260,
          "y": 470,
          "w": 260,
          "h": 90,
          "text": "Judged against what spec?",
          "size": "sm",
          "block": "spya-gjut02"
        },
        {
          "kind": "node",
          "id": "s6a",
          "shape": "box",
          "x": 40,
          "y": 600,
          "w": 200,
          "h": 80,
          "text": "Two seemingly-equal machines diverge at n=27",
          "size": "sm",
          "tone": 1,
          "block": "spya-gjut02"
        },
        {
          "kind": "node",
          "id": "s6b",
          "shape": "box",
          "x": 280,
          "y": 600,
          "w": 200,
          "h": 80,
          "text": "A machine forbidden to run wild suddenly runs out of control or loops forever",
          "size": "sm",
          "tone": 1,
          "block": "spya-rt2gb2"
        },
        {
          "kind": "node",
          "id": "s6c",
          "shape": "box",
          "x": 520,
          "y": 600,
          "w": 200,
          "h": 80,
          "text": "Even a parity rule (always-even output) is eventually broken",
          "size": "sm",
          "tone": 1,
          "block": "spya-jdmx0m"
        },
        {
          "kind": "edge",
          "from": "s1",
          "to": "s2",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "s2",
          "to": "s3",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "s3",
          "to": "s4",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "s4",
          "to": "s5",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "s5",
          "to": "s6a",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "s5",
          "to": "s6b",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "s5",
          "to": "s6c",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "A chain: machines that look correct for a stretch, a dependence on which specification is used to judge them, cellular automata with the same pattern, and the rare cases where structural analysis still proves correctness."
    },
    {
      "id": "beyond",
      "title": "Bugs beyond programming",
      "height": 760,
      "items": [
        {
          "kind": "node",
          "id": "b1",
          "shape": "box",
          "x": 60,
          "y": 40,
          "w": 260,
          "h": 80,
          "text": "A polynomial factoring pattern holds for ages, breaks at x^105 - 1",
          "size": "sm",
          "tone": 3,
          "block": "spya-ca4f5c"
        },
        {
          "kind": "node",
          "id": "b2",
          "shape": "box",
          "x": 60,
          "y": 150,
          "w": 260,
          "h": 80,
          "text": "A prime-count trend reverses only at the 23,338,590,792th prime",
          "size": "sm",
          "tone": 3,
          "block": "spya-cc855a"
        },
        {
          "kind": "node",
          "id": "b3",
          "shape": "box",
          "x": 60,
          "y": 260,
          "w": 260,
          "h": 90,
          "text": "Mainstream math avoids this by sticking to human-graspable, reducible questions",
          "size": "sm",
          "tone": 3,
          "block": "spya-zcpn8u"
        },
        {
          "kind": "node",
          "id": "p1",
          "shape": "box",
          "x": 440,
          "y": 40,
          "w": 260,
          "h": 80,
          "text": "A well-designed language's primitives already match human intent",
          "size": "sm",
          "tone": 2,
          "block": "spya-kdks69"
        },
        {
          "kind": "node",
          "id": "p2",
          "shape": "box",
          "x": 440,
          "y": 150,
          "w": 260,
          "h": 80,
          "text": "Short programs in such a language tend to be the bug-free ones",
          "size": "sm",
          "tone": 2,
          "block": "spya-x8ag2t"
        },
        {
          "kind": "node",
          "id": "p3",
          "shape": "box",
          "x": 440,
          "y": 260,
          "w": 260,
          "h": 80,
          "text": "Seeing a computation's full behavior builds real confidence",
          "size": "sm",
          "tone": 2,
          "block": "spya-qexzj4"
        },
        {
          "kind": "node",
          "id": "p4",
          "shape": "box",
          "x": 440,
          "y": 370,
          "w": 260,
          "h": 90,
          "text": "Trained neural nets are especially exposed: no human-graspable mechanism inside",
          "size": "sm",
          "tone": 2,
          "block": "spya-sggbeh"
        },
        {
          "kind": "node",
          "id": "end",
          "shape": "ellipse",
          "x": 220,
          "y": 500,
          "w": 320,
          "h": 90,
          "text": "An unexpected result can be a discovery, not a failure",
          "size": "md",
          "block": "spya-xdwm97"
        },
        {
          "kind": "edge",
          "from": "b1",
          "to": "b2",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "b2",
          "to": "b3",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "p1",
          "to": "p2",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "p2",
          "to": "p3",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "p3",
          "to": "p4",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "b3",
          "to": "end",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "p4",
          "to": "end",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "Two parallel strands — math's own rare counterexamples, and the practical craft of avoiding bugs through language and visualization — both run into the same wall, and the piece ends by reframing a bug as a discovery."
    }
  ]
}
```
