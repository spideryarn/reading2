# 4 candidates for "Towards a Theory of Bugs: The Ruliology of the Unexpected"

Each candidate is a picture of how the article is put together, for a reader who has not read it yet. They are labelled W, X, Y, Z in an order that
says nothing about how any of them was made. The article itself, with its block ids, is
`article-towards-a-theory-of-bugs-the-ruliology-of-the-unexpected.md` beside this file.

## Candidate W

Picture: /home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/results/thinking-effort-261001/judging/sketch/picture-towards-a-theory-of-bugs-the-ruliology-of-the-unexpected-W.png

Scene:

```json
{
  "title": "Funnel, converge, fan-out, loop",
  "caption": "A funnel (bugs-are-inevitable thesis) into a converging chain of evidence from Turing machines, cellular automata, and formal proofs, meeting at the single idea of computational irreducibility, which then fans out into consequences for testing, mathematics, and practical programming, looping back to reframe 'bug' as 'discovery'.",
  "scenes": [
    {
      "id": "overview",
      "title": "Overview",
      "height": 1300,
      "items": [
        {
          "kind": "node",
          "id": "intro",
          "shape": "ellipse",
          "x": 280,
          "y": 40,
          "w": 200,
          "h": 70,
          "text": "Bugs are inevitable",
          "size": "md",
          "sub": "even in simple programs",
          "detail": "A program's actual computation can outrun the simple mental model we have of what it should do.",
          "block": "spya-d46wsq"
        },
        {
          "kind": "region",
          "x": 24,
          "y": 130,
          "w": 712,
          "h": 650,
          "style": "band",
          "label": "EVIDENCE FROM SIMPLE PROGRAMS",
          "opens": "inside-evidence",
          "tone": 1
        },
        {
          "kind": "node",
          "id": "e1",
          "shape": "box",
          "x": 140,
          "y": 190,
          "w": 480,
          "h": 64,
          "text": "A Turing machine computing n+1 fails at n=7",
          "size": "sm",
          "tone": 1,
          "block": "spya-s7uc4u"
        },
        {
          "kind": "node",
          "id": "e2",
          "shape": "box",
          "x": 140,
          "y": 270,
          "w": 480,
          "h": 64,
          "text": "Larger machines can hide bugs far longer",
          "size": "sm",
          "tone": 1,
          "block": "spya-hqukdz"
        },
        {
          "kind": "node",
          "id": "e3",
          "shape": "box",
          "x": 140,
          "y": 350,
          "w": 480,
          "h": 64,
          "text": "What counts as a bug depends on the spec chosen",
          "size": "sm",
          "tone": 1,
          "block": "spya-gjut02"
        },
        {
          "kind": "node",
          "id": "e4",
          "shape": "box",
          "x": 140,
          "y": 430,
          "w": 480,
          "h": 64,
          "text": "A cellular automaton 'doubler' fails at n=14",
          "size": "sm",
          "tone": 1,
          "block": "spya-cy4dgs"
        },
        {
          "kind": "node",
          "id": "e5",
          "shape": "box",
          "x": 140,
          "y": 510,
          "w": 480,
          "h": 64,
          "text": "But some such rules can be proven bug-free",
          "size": "sm",
          "tone": 1,
          "block": "spya-gagsuk"
        },
        {
          "kind": "node",
          "id": "e6",
          "shape": "box",
          "x": 140,
          "y": 590,
          "w": 480,
          "h": 64,
          "text": "Formal proofs of correctness exist only if there's no bug",
          "size": "sm",
          "tone": 1,
          "block": "spya-qr6x2h"
        },
        {
          "kind": "node",
          "id": "e7",
          "shape": "box",
          "x": 140,
          "y": 670,
          "w": 480,
          "h": 64,
          "text": "For a buggy machine, no proof is ever found",
          "size": "sm",
          "tone": 1,
          "block": "spya-ypka68"
        },
        {
          "kind": "edge",
          "from": "intro",
          "to": "e1",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
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
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "e3",
          "to": "e4",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "e4",
          "to": "e5",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "e5",
          "to": "e6",
          "via": "straight",
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
        },
        {
          "kind": "node",
          "id": "hub",
          "shape": "ellipse",
          "x": 280,
          "y": 830,
          "w": 200,
          "h": 90,
          "text": "Only running it tells you",
          "size": "md",
          "sub": "computational irreducibility",
          "block": "spya-wcnws7"
        },
        {
          "kind": "edge",
          "from": "e5",
          "to": "hub",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "e6",
          "to": "hub",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "e7",
          "to": "hub",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "region",
          "x": 24,
          "y": 960,
          "w": 712,
          "h": 320,
          "style": "band",
          "label": "CONSEQUENCES",
          "opens": "inside-consequences",
          "tone": 2
        },
        {
          "kind": "node",
          "id": "c1",
          "shape": "box",
          "x": 50,
          "y": 1010,
          "w": 320,
          "h": 70,
          "text": "Testing can't guarantee no bugs",
          "size": "sm",
          "tone": 2,
          "block": "spya-yc9e2z"
        },
        {
          "kind": "node",
          "id": "c2",
          "shape": "box",
          "x": 390,
          "y": 1010,
          "w": 320,
          "h": 70,
          "text": "Rare surprises keep turning up everywhere",
          "size": "sm",
          "tone": 2,
          "block": "spya-kjsjh5"
        },
        {
          "kind": "node",
          "id": "c3",
          "shape": "box",
          "x": 50,
          "y": 1100,
          "w": 320,
          "h": 70,
          "text": "Math also hits sudden counterexamples",
          "size": "sm",
          "tone": 2,
          "block": "spya-bhwh4d"
        },
        {
          "kind": "node",
          "id": "c4",
          "shape": "box",
          "x": 390,
          "y": 1100,
          "w": 320,
          "h": 70,
          "text": "Good language design limits, not erases, bugs",
          "size": "sm",
          "tone": 2,
          "block": "spya-kdks69"
        },
        {
          "kind": "node",
          "id": "c5",
          "shape": "box",
          "x": 200,
          "y": 1200,
          "w": 360,
          "h": 70,
          "text": "A 'bug' can be a scientific discovery",
          "size": "sm",
          "tone": 2,
          "block": "spya-xdwm97"
        },
        {
          "kind": "edge",
          "from": "hub",
          "to": "c1",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "hub",
          "to": "c2",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "c1",
          "to": "c3",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "c2",
          "to": "c4",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "c3",
          "to": "c5",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "c4",
          "to": "c5",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "c5:left",
          "to": "intro:left",
          "via": "curve",
          "line": "dashed",
          "arrow": "end",
          "label": "reframes the opening claim"
        }
      ],
      "caption": "Evidence from simple programs converges on computational irreducibility, which then fans out into consequences, looping back to the opening claim."
    },
    {
      "id": "inside-evidence",
      "title": "Evidence from simple programs",
      "height": 1000,
      "items": [
        {
          "kind": "node",
          "id": "z1",
          "shape": "box",
          "x": 220,
          "y": 40,
          "w": 320,
          "h": 70,
          "text": "n+1 machine fails only at n=7",
          "size": "sm",
          "tone": 1,
          "block": "spya-s7uc4u"
        },
        {
          "kind": "node",
          "id": "z2",
          "shape": "box",
          "x": 220,
          "y": 140,
          "w": 320,
          "h": 70,
          "text": "Among many correct machines, one hides a bug until n=15",
          "size": "sm",
          "tone": 1,
          "block": "spya-pt0hmz"
        },
        {
          "kind": "node",
          "id": "z3",
          "shape": "box",
          "x": 220,
          "y": 240,
          "w": 320,
          "h": 70,
          "text": "4-state machines: bugs delayed even further, riskiest at all-1s inputs",
          "size": "sm",
          "tone": 1,
          "block": "spya-hqukdz"
        },
        {
          "kind": "node",
          "id": "z4",
          "shape": "box",
          "x": 220,
          "y": 340,
          "w": 320,
          "h": 70,
          "text": "Two 'equivalent' machines diverge at n=27",
          "size": "sm",
          "tone": 1,
          "block": "spya-gjut02"
        },
        {
          "kind": "node",
          "id": "z5",
          "shape": "box",
          "x": 220,
          "y": 440,
          "w": 320,
          "h": 70,
          "text": "Other specs (no runaway memory, even output only) also get insidiously violated",
          "size": "sm",
          "tone": 1,
          "block": "spya-jdmx0m"
        },
        {
          "kind": "node",
          "id": "z6",
          "shape": "box",
          "x": 220,
          "y": 540,
          "w": 320,
          "h": 70,
          "text": "A doubling cellular automaton fails at n=14, or later at n=24 or 32",
          "size": "sm",
          "tone": 1,
          "block": "spya-pqwf4x"
        },
        {
          "kind": "node",
          "id": "z7",
          "shape": "box",
          "x": 220,
          "y": 640,
          "w": 320,
          "h": 70,
          "text": "Tracking the full computation (not just output) can show a boundary that only ever moves one way",
          "size": "sm",
          "tone": 1,
          "block": "spya-hcdcqp"
        },
        {
          "kind": "node",
          "id": "z8",
          "shape": "box",
          "x": 220,
          "y": 740,
          "w": 320,
          "h": 70,
          "text": "That boundary rule is provably stable — so this automaton has no bugs",
          "size": "sm",
          "tone": 1,
          "block": "spya-gagsuk"
        },
        {
          "kind": "node",
          "id": "z9",
          "shape": "box",
          "x": 220,
          "y": 840,
          "w": 320,
          "h": 70,
          "text": "Symbolic axioms + induction formally prove a correct machine's behavior for all n",
          "size": "sm",
          "tone": 1,
          "block": "spya-q8fg9q"
        },
        {
          "kind": "node",
          "id": "z10",
          "shape": "box",
          "x": 220,
          "y": 940,
          "w": 320,
          "h": 40,
          "text": "A buggy machine: the proof search never terminates, because it's false",
          "size": "xs",
          "tone": 1,
          "block": "spya-ypka68"
        },
        {
          "kind": "edge",
          "from": "z1",
          "to": "z2",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "z2",
          "to": "z3",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "z3",
          "to": "z4",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "z4",
          "to": "z5",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "z5",
          "to": "z6",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "z6",
          "to": "z7",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "z7",
          "to": "z8",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "z8",
          "to": "z9",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "z9",
          "to": "z10",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "A chain through three test-beds — Turing machines, cellular automata, formal proofs — each showing bugs appear, sometimes provably cannot, and proof itself fails exactly where a bug exists."
    },
    {
      "id": "inside-consequences",
      "title": "Consequences of irreducibility",
      "height": 900,
      "items": [
        {
          "kind": "node",
          "id": "y1",
          "shape": "box",
          "x": 40,
          "y": 60,
          "w": 320,
          "h": 70,
          "text": "Sampling and 'fuzzing' can miss rare bugs entirely",
          "size": "sm",
          "tone": 2,
          "block": "spya-yc9e2z"
        },
        {
          "kind": "node",
          "id": "y2",
          "shape": "box",
          "x": 400,
          "y": 60,
          "w": 320,
          "h": 70,
          "text": "Rule 30, a long-running combinator, a '137-million-step halt'",
          "size": "sm",
          "tone": 2,
          "block": "spya-msgzxc"
        },
        {
          "kind": "node",
          "id": "y3",
          "shape": "box",
          "x": 40,
          "y": 170,
          "w": 320,
          "h": 70,
          "text": "Prime-counting trend reverses only at the 23,338,590,792th prime",
          "size": "sm",
          "tone": 2,
          "block": "spya-cc855a"
        },
        {
          "kind": "node",
          "id": "y4",
          "shape": "box",
          "x": 400,
          "y": 170,
          "w": 320,
          "h": 70,
          "text": "Pure math mostly avoids this by sticking to human-graspable questions",
          "size": "sm",
          "tone": 2,
          "block": "spya-zcpn8u"
        },
        {
          "kind": "node",
          "id": "y5",
          "shape": "box",
          "x": 40,
          "y": 280,
          "w": 320,
          "h": 70,
          "text": "Well-designed language primitives steer code toward bug-free",
          "size": "sm",
          "tone": 2,
          "block": "spya-x8ag2t"
        },
        {
          "kind": "node",
          "id": "y6",
          "shape": "box",
          "x": 400,
          "y": 280,
          "w": 320,
          "h": 70,
          "text": "Trained neural nets are especially exposed, being unstructured and unexplainable",
          "size": "sm",
          "tone": 2,
          "block": "spya-sggbeh"
        },
        {
          "kind": "node",
          "id": "y7",
          "shape": "box",
          "x": 220,
          "y": 400,
          "w": 320,
          "h": 70,
          "text": "Seeing a computation's full pattern is the best practical safeguard",
          "size": "sm",
          "tone": 2,
          "block": "spya-qexzj4"
        },
        {
          "kind": "node",
          "id": "y8",
          "shape": "ellipse",
          "x": 220,
          "y": 520,
          "w": 320,
          "h": 80,
          "text": "A 'bug' is just an unexpected discovery, seen differently",
          "size": "md",
          "block": "spya-xdwm97"
        },
        {
          "kind": "edge",
          "from": "y1",
          "to": "y3",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "y2",
          "to": "y4",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "y3",
          "to": "y5",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "y4",
          "to": "y6",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "y5",
          "to": "y7",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "y6",
          "to": "y7",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "y7",
          "to": "y8",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "node",
          "id": "thanks",
          "shape": "note",
          "x": 560,
          "y": 630,
          "w": 170,
          "h": 60,
          "text": "Thanks to QA team & collaborators",
          "size": "xs",
          "tone": 0,
          "block": "spya-y2vpe2"
        }
      ],
      "caption": "From one conclusion — that only running a computation reveals it — four separate lessons follow side by side, meeting in a final reframing of what a bug is."
    }
  ]
}
```

## Candidate X

Picture: /home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/results/thinking-effort-261001/judging/sketch/picture-towards-a-theory-of-bugs-the-ruliology-of-the-unexpected-X.png

Scene:

```json
{
  "title": "Funnel into hub, fanning back out",
  "caption": "A funnel (one opening claim) splits into two converging strands of evidence — broken machines, and the proofs that sometimes rescue them — which meet at a single hub (computational irreducibility), then fan back out into the piece's wider implications, and loop back to reframe the opening claim as a discovery rather than a failure.",
  "scenes": [
    {
      "id": "overview",
      "title": "Towards a Theory of Bugs — overview",
      "height": 960,
      "items": [
        {
          "kind": "node",
          "id": "n1",
          "shape": "ellipse",
          "x": 270,
          "y": 40,
          "w": 220,
          "h": 90,
          "text": "Programs often do more than we expect",
          "size": "md",
          "sub": "why bugs happen",
          "detail": "A program's actual computation can be far more sophisticated than the simple picture in our heads.",
          "tone": 0,
          "block": "spya-d46wsq"
        },
        {
          "kind": "region",
          "x": 24,
          "y": 150,
          "w": 712,
          "h": 150,
          "style": "band",
          "label": "CONCRETE DEMONSTRATIONS",
          "opens": "inside-demonstrations",
          "tone": 1
        },
        {
          "kind": "node",
          "id": "n2",
          "shape": "box",
          "x": 44,
          "y": 190,
          "w": 210,
          "h": 90,
          "text": "Simple Turing machines built for n+1 still fail",
          "size": "sm",
          "sub": "e.g. at n=7, n=15",
          "tone": 1,
          "block": "spya-s7uc4u"
        },
        {
          "kind": "node",
          "id": "n3",
          "shape": "box",
          "x": 275,
          "y": 190,
          "w": 210,
          "h": 90,
          "text": "A 'bug' is only a bug relative to some chosen rule",
          "size": "sm",
          "tone": 1,
          "block": "spya-gjut02"
        },
        {
          "kind": "node",
          "id": "n4",
          "shape": "box",
          "x": 506,
          "y": 190,
          "w": 210,
          "h": 90,
          "text": "Cellular automata built to double also glitch",
          "size": "sm",
          "sub": "first bug at n=14",
          "tone": 1,
          "block": "spya-cy4dgs"
        },
        {
          "kind": "region",
          "x": 24,
          "y": 320,
          "w": 712,
          "h": 150,
          "style": "band",
          "label": "PROVING OR DISPROVING BUGS",
          "opens": "inside-proofs",
          "tone": 2
        },
        {
          "kind": "node",
          "id": "n5",
          "shape": "hex",
          "x": 130,
          "y": 360,
          "w": 230,
          "h": 90,
          "text": "Some complex rules can be proven bug-free",
          "size": "sm",
          "sub": "via the rule-122 trick",
          "tone": 2,
          "block": "spya-gagsuk"
        },
        {
          "kind": "node",
          "id": "n6",
          "shape": "hex",
          "x": 400,
          "y": 360,
          "w": 230,
          "h": 90,
          "text": "A proof exists only when there's truly no bug",
          "size": "sm",
          "sub": "no proof = a bug",
          "tone": 2,
          "block": "spya-ypka68"
        },
        {
          "kind": "node",
          "id": "n7",
          "shape": "hex",
          "x": 230,
          "y": 530,
          "w": 300,
          "h": 100,
          "text": "You can only know a program's behavior by running it",
          "size": "lg",
          "sub": "computational irreducibility",
          "detail": "Because this is ubiquitous even in simple systems, bounded analysis will always eventually be surprised.",
          "tone": 3,
          "block": "spya-wcnws7"
        },
        {
          "kind": "region",
          "x": 24,
          "y": 660,
          "w": 712,
          "h": 150,
          "style": "dashed",
          "label": "WIDER IMPLICATIONS",
          "tone": 4
        },
        {
          "kind": "node",
          "id": "n8",
          "shape": "box",
          "x": 44,
          "y": 700,
          "w": 160,
          "h": 90,
          "text": "Testing can't rule out rare bugs",
          "size": "sm",
          "tone": 4,
          "block": "spya-yc9e2z"
        },
        {
          "kind": "node",
          "id": "n9",
          "shape": "box",
          "x": 224,
          "y": 700,
          "w": 160,
          "h": 90,
          "text": "Simple rules keep surprising us",
          "size": "sm",
          "tone": 4,
          "block": "spya-kjsjh5"
        },
        {
          "kind": "node",
          "id": "n10",
          "shape": "box",
          "x": 404,
          "y": 700,
          "w": 160,
          "h": 90,
          "text": "Even math 'laws' break eventually",
          "size": "sm",
          "tone": 4,
          "block": "spya-bhwh4d"
        },
        {
          "kind": "node",
          "id": "n11",
          "shape": "box",
          "x": 584,
          "y": 700,
          "w": 152,
          "h": 90,
          "text": "Good language design is the best defense",
          "size": "sm",
          "tone": 4,
          "block": "spya-kdks69"
        },
        {
          "kind": "node",
          "id": "n12",
          "shape": "ellipse",
          "x": 230,
          "y": 840,
          "w": 300,
          "h": 80,
          "text": "A bug can be a discovery, not just a failure",
          "size": "md",
          "tone": 0,
          "block": "spya-xdwm97"
        },
        {
          "kind": "edge",
          "from": "n1",
          "to": "n2",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "n1",
          "to": "n3",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "n1",
          "to": "n4",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "n2",
          "to": "n6",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "n4",
          "to": "n5",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "n3",
          "to": "n7",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "n5",
          "to": "n7",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "n6",
          "to": "n7",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "n7",
          "to": "n8",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "n7",
          "to": "n9",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "n7",
          "to": "n10",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "n7",
          "to": "n11",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "n8",
          "to": "n12",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "n9",
          "to": "n12",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "n10",
          "to": "n12",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "n11",
          "to": "n12",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "n12:left",
          "to": "n1:left",
          "via": "curve",
          "line": "dashed",
          "arrow": "end",
          "label": "loops back"
        }
      ],
      "caption": "Evidence from broken Turing machines and automata, and from proofs that sometimes succeed and sometimes can't, converges on one explanation — then that explanation fans out into the piece's closing lessons, which loop back to recast the opening claim."
    },
    {
      "id": "inside-demonstrations",
      "title": "Where bugs are caught in the act",
      "height": 950,
      "items": [
        {
          "kind": "region",
          "x": 24,
          "y": 20,
          "w": 712,
          "h": 400,
          "style": "band",
          "label": "TURING MACHINE BUGS",
          "tone": 1
        },
        {
          "kind": "node",
          "id": "d1",
          "shape": "box",
          "x": 280,
          "y": 60,
          "w": 260,
          "h": 70,
          "text": "A simple Turing machine seems to compute n+1",
          "size": "sm",
          "tone": 1,
          "block": "spya-scjxv8"
        },
        {
          "kind": "node",
          "id": "d2",
          "shape": "box",
          "x": 280,
          "y": 150,
          "w": 260,
          "h": 70,
          "text": "At n=7 it suddenly outputs 9 instead of 8",
          "size": "sm",
          "tone": 1,
          "block": "spya-h3jx6h"
        },
        {
          "kind": "node",
          "id": "d3",
          "shape": "box",
          "x": 280,
          "y": 240,
          "w": 260,
          "h": 70,
          "text": "Thousands succeed, but first bugs appear all over the place",
          "size": "sm",
          "tone": 1,
          "block": "spya-y7nwnj"
        },
        {
          "kind": "node",
          "id": "d4",
          "shape": "box",
          "x": 60,
          "y": 330,
          "w": 220,
          "h": 70,
          "text": "One works perfectly until n=15, then fails",
          "size": "sm",
          "tone": 1,
          "block": "spya-pt0hmz"
        },
        {
          "kind": "node",
          "id": "d5",
          "shape": "box",
          "x": 300,
          "y": 330,
          "w": 220,
          "h": 70,
          "text": "Bigger machines hide bugs even longer, failing at n=63",
          "size": "sm",
          "tone": 1,
          "block": "spya-hqukdz"
        },
        {
          "kind": "node",
          "id": "d6",
          "shape": "box",
          "x": 540,
          "y": 330,
          "w": 180,
          "h": 70,
          "text": "Riskiest inputs are all-1s in binary",
          "size": "sm",
          "tone": 1,
          "block": "spya-u3d2ws"
        },
        {
          "kind": "region",
          "x": 24,
          "y": 450,
          "w": 712,
          "h": 210,
          "style": "band",
          "label": "SPEC-DEPENDENT BUGS",
          "tone": 2
        },
        {
          "kind": "node",
          "id": "d7",
          "shape": "box",
          "x": 280,
          "y": 480,
          "w": 260,
          "h": 70,
          "text": "Two seemingly identical machines diverge at n=27",
          "size": "sm",
          "tone": 2,
          "block": "spya-txuteu"
        },
        {
          "kind": "node",
          "id": "d8",
          "shape": "box",
          "x": 60,
          "y": 570,
          "w": 220,
          "h": 70,
          "text": "Built to avoid infinite loops—still falls into one",
          "size": "sm",
          "tone": 2,
          "block": "spya-fmdw58"
        },
        {
          "kind": "node",
          "id": "d9",
          "shape": "box",
          "x": 300,
          "y": 570,
          "w": 220,
          "h": 70,
          "text": "'Always even' output rule breaks at n=32",
          "size": "sm",
          "tone": 2,
          "block": "spya-hz8ymk"
        },
        {
          "kind": "region",
          "x": 24,
          "y": 690,
          "w": 712,
          "h": 210,
          "style": "band",
          "label": "CELLULAR AUTOMATON BUGS",
          "tone": 3
        },
        {
          "kind": "node",
          "id": "d10",
          "shape": "box",
          "x": 280,
          "y": 720,
          "w": 260,
          "h": 70,
          "text": "A doubling cellular automaton fails first at n=14",
          "size": "sm",
          "tone": 3,
          "block": "spya-htqcgc"
        },
        {
          "kind": "node",
          "id": "d11",
          "shape": "box",
          "x": 280,
          "y": 810,
          "w": 260,
          "h": 70,
          "text": "Other doubling rules last to n=24 or n=32",
          "size": "sm",
          "tone": 3,
          "block": "spya-sk8qh9"
        },
        {
          "kind": "edge",
          "from": "d1",
          "to": "d2",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "d2",
          "to": "d3",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "d3",
          "to": "d4",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "d3",
          "to": "d5",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "d5",
          "to": "d6",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "d6",
          "to": "d7",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "d7",
          "to": "d8",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "d7",
          "to": "d9",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "d9",
          "to": "d10",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "d10",
          "to": "d11",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "A chain of concrete failures: Turing machines built for n+1 break at ever-later, ever-stranger inputs, two machines that look identical suddenly disagree, and cellular automata built to double also glitch — each movement seeding the next."
    },
    {
      "id": "inside-proofs",
      "title": "Where proof succeeds or fails",
      "height": 1060,
      "items": [
        {
          "kind": "region",
          "x": 24,
          "y": 20,
          "w": 712,
          "h": 580,
          "style": "band",
          "label": "VISUAL & STRUCTURAL PROOFS",
          "tone": 1
        },
        {
          "kind": "node",
          "id": "p1",
          "shape": "box",
          "x": 280,
          "y": 60,
          "w": 260,
          "h": 70,
          "text": "Some patterns are visually simple enough to guarantee no bugs",
          "size": "sm",
          "tone": 1,
          "block": "spya-rhda0x"
        },
        {
          "kind": "node",
          "id": "p2",
          "shape": "box",
          "x": 280,
          "y": 150,
          "w": 260,
          "h": 70,
          "text": "A trickier rule shows no bugs even after 100,000 tests",
          "size": "sm",
          "tone": 1,
          "block": "spya-asw9eq"
        },
        {
          "kind": "node",
          "id": "p3",
          "shape": "box",
          "x": 280,
          "y": 240,
          "w": 260,
          "h": 70,
          "text": "But timing fluctuations leave the question open",
          "size": "sm",
          "tone": 1,
          "block": "spya-mj9p5j"
        },
        {
          "kind": "node",
          "id": "p4",
          "shape": "box",
          "x": 280,
          "y": 330,
          "w": 260,
          "h": 70,
          "text": "Looking at the whole computation reveals hidden structure",
          "size": "sm",
          "tone": 1,
          "block": "spya-hcdcqp"
        },
        {
          "kind": "node",
          "id": "p5",
          "shape": "box",
          "x": 60,
          "y": 420,
          "w": 220,
          "h": 70,
          "text": "The pattern's edge always moves left or stays put",
          "size": "sm",
          "tone": 1,
          "block": "spya-r7ty6m"
        },
        {
          "kind": "node",
          "id": "p6",
          "shape": "box",
          "x": 320,
          "y": 420,
          "w": 220,
          "h": 70,
          "text": "Inside, it follows the well-known rule 122",
          "size": "sm",
          "tone": 1,
          "block": "spya-gagsuk"
        },
        {
          "kind": "node",
          "id": "p7",
          "shape": "box",
          "x": 280,
          "y": 510,
          "w": 260,
          "h": 70,
          "text": "That rule can never die out, so it must finish correctly",
          "size": "sm",
          "tone": 1,
          "block": "spya-n5acnw"
        },
        {
          "kind": "region",
          "x": 24,
          "y": 630,
          "w": 712,
          "h": 390,
          "style": "band",
          "label": "SYMBOLIC PROOFS",
          "tone": 2
        },
        {
          "kind": "node",
          "id": "p8",
          "shape": "box",
          "x": 280,
          "y": 660,
          "w": 260,
          "h": 70,
          "text": "Can a machine's correctness be proved, not just observed?",
          "size": "sm",
          "tone": 2,
          "block": "spya-qr6x2h"
        },
        {
          "kind": "node",
          "id": "p9",
          "shape": "box",
          "x": 280,
          "y": 750,
          "w": 260,
          "h": 70,
          "text": "A symbolic notation sets up exact statements to prove",
          "size": "sm",
          "tone": 2,
          "block": "spya-jqmftv"
        },
        {
          "kind": "node",
          "id": "p10",
          "shape": "box",
          "x": 280,
          "y": 840,
          "w": 260,
          "h": 70,
          "text": "Automated proof search plus induction proves it always computes n+1",
          "size": "sm",
          "tone": 2,
          "block": "spya-q8fg9q"
        },
        {
          "kind": "node",
          "id": "p11",
          "shape": "box",
          "x": 280,
          "y": 930,
          "w": 260,
          "h": 70,
          "text": "For a machine with a real bug, the search finds no proof—ever",
          "size": "sm",
          "tone": 2,
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
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "p4",
          "to": "p6",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "p5",
          "to": "p7",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "p6",
          "to": "p7",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "p7",
          "to": "p8",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "p8",
          "to": "p9",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "p9",
          "to": "p10",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "p10",
          "to": "p11",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "Visual and structural reasoning can sometimes prove an odd-looking rule has no bugs; a fully symbolic version of the same idea proves a Turing machine correct by induction — and, for a machine that really has a bug, no amount of searching ever finds a proof."
    }
  ]
}
```

## Candidate Y

Picture: /home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/results/thinking-effort-261001/judging/sketch/picture-towards-a-theory-of-bugs-the-ruliology-of-the-unexpected-Y.png

Scene:

```json
{
  "title": "funnel into hub, then diverge",
  "caption": "A funnel of concrete examples (Turing machines, specifications, cellular automata, proofs) narrows into one central claim—computational irreducibility makes bugs inevitable—which then fans out into three consequences: testing can't save you, ruliology keeps finding surprises everywhere, and practice can only push the problem back, never eliminate it.",
  "scenes": [
    {
      "id": "overview",
      "title": "Towards a Theory of Bugs",
      "height": 1040,
      "items": [
        {
          "kind": "node",
          "id": "intro",
          "shape": "ellipse",
          "x": 260,
          "y": 24,
          "w": 240,
          "h": 64,
          "text": "Bugs = simple mental model vs. richer computation",
          "size": "md",
          "detail": "A program's actual computation can be far more sophisticated than our simple picture of what it should do.",
          "block": "spya-d46wsq"
        },
        {
          "kind": "region",
          "x": 30,
          "y": 120,
          "w": 700,
          "h": 430,
          "style": "band",
          "label": "EXAMPLES: WHERE BUGS HIDE",
          "opens": "inside-examples",
          "tone": 1
        },
        {
          "kind": "node",
          "id": "tm",
          "shape": "box",
          "x": 60,
          "y": 160,
          "w": 200,
          "h": 64,
          "text": "Turing machine computing n+1 breaks at n=7",
          "size": "sm",
          "tone": 1,
          "block": "spya-s7uc4u"
        },
        {
          "kind": "node",
          "id": "spec",
          "shape": "box",
          "x": 300,
          "y": 160,
          "w": 200,
          "h": 64,
          "text": "What counts as a bug depends on the spec chosen",
          "size": "sm",
          "tone": 1,
          "block": "spya-gjut02"
        },
        {
          "kind": "node",
          "id": "ca",
          "shape": "box",
          "x": 540,
          "y": 160,
          "w": 160,
          "h": 64,
          "text": "Doubling cellular automata fail at n=14",
          "size": "sm",
          "tone": 1,
          "block": "spya-cy4dgs"
        },
        {
          "kind": "node",
          "id": "tell",
          "shape": "diamond",
          "x": 300,
          "y": 270,
          "w": 200,
          "h": 80,
          "text": "Can you tell in advance?",
          "size": "sm",
          "tone": 1,
          "block": "spya-gt6430"
        },
        {
          "kind": "node",
          "id": "proof",
          "shape": "hex",
          "x": 300,
          "y": 390,
          "w": 220,
          "h": 70,
          "text": "Formal proof possible only if truly bug-free",
          "size": "sm",
          "tone": 1,
          "block": "spya-qr6x2h"
        },
        {
          "kind": "node",
          "id": "irred",
          "shape": "box",
          "x": 260,
          "y": 600,
          "w": 240,
          "h": 90,
          "text": "Computational irreducibility: behavior knowable only by running it",
          "size": "md",
          "tone": 0,
          "block": "spya-wcnws7"
        },
        {
          "kind": "region",
          "x": 30,
          "y": 730,
          "w": 700,
          "h": 280,
          "style": "band",
          "label": "CONSEQUENCES OF IRREDUCIBILITY",
          "opens": "inside-consequences",
          "tone": 2
        },
        {
          "kind": "node",
          "id": "test",
          "shape": "box",
          "x": 60,
          "y": 780,
          "w": 200,
          "h": 70,
          "text": "Testing can't rule out bugs—rare ones hide forever",
          "size": "sm",
          "tone": 2,
          "block": "spya-yc9e2z"
        },
        {
          "kind": "node",
          "id": "surprise",
          "shape": "box",
          "x": 300,
          "y": 780,
          "w": 200,
          "h": 70,
          "text": "Ruliology keeps turning up surprises",
          "size": "sm",
          "tone": 2,
          "block": "spya-kjsjh5"
        },
        {
          "kind": "node",
          "id": "math",
          "shape": "box",
          "x": 540,
          "y": 780,
          "w": 160,
          "h": 70,
          "text": "Even math has rare 'bugs' in conjectures",
          "size": "sm",
          "tone": 2,
          "block": "spya-bhwh4d"
        },
        {
          "kind": "node",
          "id": "practice",
          "shape": "box",
          "x": 240,
          "y": 900,
          "w": 280,
          "h": 80,
          "text": "Good language design pushes bugs back, never removes them",
          "size": "sm",
          "tone": 2,
          "block": "spya-kdks69"
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
          "via": "curve",
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
          "from": "tm",
          "to": "tell",
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
          "from": "ca",
          "to": "tell",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "tell",
          "to": "proof",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "proof",
          "to": "irred",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "irred",
          "to": "test",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "irred",
          "to": "surprise",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "irred",
          "to": "math",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "test",
          "to": "practice",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "surprise",
          "to": "practice",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "math",
          "to": "practice",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "Examples build down to the core claim about irreducibility, which then spreads into three separate consequences."
    },
    {
      "id": "inside-examples",
      "title": "The Examples: Bugs Hiding in Plain Sight",
      "height": 900,
      "items": [
        {
          "kind": "node",
          "id": "e1",
          "shape": "box",
          "x": 260,
          "y": 30,
          "w": 260,
          "h": 70,
          "text": "3-state TM seems to compute n+1, fails at n=7",
          "size": "sm",
          "tone": 1,
          "block": "spya-s7uc4u"
        },
        {
          "kind": "node",
          "id": "e2",
          "shape": "box",
          "x": 260,
          "y": 130,
          "w": 260,
          "h": 70,
          "text": "Among thousands of correct machines, first bugs come at varied, sometimes large n",
          "size": "sm",
          "tone": 1,
          "block": "spya-rhc6t0"
        },
        {
          "kind": "node",
          "id": "e3",
          "shape": "box",
          "x": 260,
          "y": 230,
          "w": 260,
          "h": 70,
          "text": "A machine runs perfectly to n=14, fails at n=15",
          "size": "sm",
          "tone": 1,
          "block": "spya-pt0hmz"
        },
        {
          "kind": "node",
          "id": "e4",
          "shape": "box",
          "x": 260,
          "y": 330,
          "w": 260,
          "h": 70,
          "text": "Larger machines hide bugs even longer; all-1s inputs riskiest",
          "size": "sm",
          "tone": 1,
          "block": "spya-hqukdz"
        },
        {
          "kind": "node",
          "id": "e5",
          "shape": "box",
          "x": 260,
          "y": 430,
          "w": 260,
          "h": 70,
          "text": "Two machines that look equivalent diverge at n=27",
          "size": "sm",
          "tone": 1,
          "block": "spya-gjut02"
        },
        {
          "kind": "node",
          "id": "e6",
          "shape": "box",
          "x": 260,
          "y": 530,
          "w": 260,
          "h": 70,
          "text": "Prohibitions (no runaway memory) also get violated eventually",
          "size": "sm",
          "tone": 1,
          "block": "spya-rt2gb2"
        },
        {
          "kind": "node",
          "id": "e7",
          "shape": "box",
          "x": 260,
          "y": 630,
          "w": 260,
          "h": 70,
          "text": "CA designed to double input fails at n=14, or later at n=24/32",
          "size": "sm",
          "tone": 1,
          "block": "spya-pqwf4x"
        },
        {
          "kind": "node",
          "id": "e8",
          "shape": "box",
          "x": 260,
          "y": 730,
          "w": 260,
          "h": 90,
          "text": "Rule 122 structure lets one PROVE one CA case has no bug, despite complex look",
          "size": "sm",
          "detail": "The pattern's boundary only moves left; interior reduces to rule 122, which can never stabilize wrongly.",
          "tone": 1,
          "block": "spya-gagsuk"
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
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "e3",
          "to": "e4",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "e4",
          "to": "e5",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "e5",
          "to": "e6",
          "via": "straight",
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
        },
        {
          "kind": "edge",
          "from": "e7",
          "to": "e8",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "A chain of increasingly careful tests—Turing machines, specification choice, cellular automata, then rigorous proof—each showing bugs surface late, or can sometimes be ruled out only by deep structural argument."
    },
    {
      "id": "inside-consequences",
      "title": "Living With Irreducibility",
      "height": 760,
      "items": [
        {
          "kind": "node",
          "id": "c0",
          "shape": "ellipse",
          "x": 280,
          "y": 24,
          "w": 200,
          "h": 60,
          "text": "Irreducibility: must run it to know",
          "size": "md",
          "tone": 0,
          "block": "spya-wcnws7"
        },
        {
          "kind": "node",
          "id": "c1",
          "shape": "box",
          "x": 40,
          "y": 150,
          "w": 210,
          "h": 80,
          "text": "Scientific induction from testing fails—rare bugs can escape even huge samples",
          "size": "sm",
          "tone": 2,
          "block": "spya-yc9e2z"
        },
        {
          "kind": "node",
          "id": "c2",
          "shape": "box",
          "x": 280,
          "y": 150,
          "w": 200,
          "h": 80,
          "text": "Rule 30, a long-delayed halt, a broken symmetry—surprises recur across systems",
          "size": "sm",
          "tone": 2,
          "block": "spya-kjsjh5"
        },
        {
          "kind": "node",
          "id": "c3",
          "shape": "box",
          "x": 520,
          "y": 150,
          "w": 200,
          "h": 80,
          "text": "Prime-counting trend flips sign only after 23 billion primes",
          "size": "sm",
          "tone": 2,
          "block": "spya-cc855a"
        },
        {
          "kind": "node",
          "id": "c4",
          "shape": "box",
          "x": 160,
          "y": 290,
          "w": 200,
          "h": 70,
          "text": "Math mostly avoids this by sticking to human-graspable questions",
          "size": "sm",
          "tone": 2,
          "block": "spya-zcpn8u"
        },
        {
          "kind": "node",
          "id": "c5",
          "shape": "box",
          "x": 400,
          "y": 290,
          "w": 200,
          "h": 70,
          "text": "Good language design packs irreducibility into primitives",
          "size": "sm",
          "tone": 2,
          "block": "spya-kdks69"
        },
        {
          "kind": "node",
          "id": "c6",
          "shape": "box",
          "x": 160,
          "y": 410,
          "w": 200,
          "h": 70,
          "text": "Short, well-designed programs tend to be bug-free ones",
          "size": "sm",
          "tone": 2,
          "block": "spya-x8ag2t"
        },
        {
          "kind": "node",
          "id": "c7",
          "shape": "box",
          "x": 400,
          "y": 410,
          "w": 200,
          "h": 70,
          "text": "Seeing the whole computation (visualization) builds confidence",
          "size": "sm",
          "tone": 2,
          "block": "spya-qexzj4"
        },
        {
          "kind": "node",
          "id": "c8",
          "shape": "box",
          "x": 160,
          "y": 530,
          "w": 200,
          "h": 70,
          "text": "Trained neural nets are especially exposed—mechanisms aren't human-understandable",
          "size": "sm",
          "tone": 2,
          "block": "spya-sggbeh"
        },
        {
          "kind": "node",
          "id": "c9",
          "shape": "box",
          "x": 400,
          "y": 530,
          "w": 200,
          "h": 80,
          "text": "A 'bug' can be reframed as scientific discovery, not failure",
          "size": "sm",
          "tone": 2,
          "block": "spya-xdwm97"
        },
        {
          "kind": "edge",
          "from": "c0",
          "to": "c1",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "c0",
          "to": "c2",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "c0",
          "to": "c3",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "c1",
          "to": "c4",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "c2",
          "to": "c4",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "c2",
          "to": "c5",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "c3",
          "to": "c5",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "c4",
          "to": "c6",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "c5",
          "to": "c7",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "c6",
          "to": "c8",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "c7",
          "to": "c9",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "Three parallel consequences fan out from the same root cause, side by side rather than ranked, since the piece treats them as equally live effects of irreducibility."
    }
  ]
}
```

## Candidate Z

Picture: /home/greg/code/spideryarn2/.claude/worktrees/thinking-effort-eval/evals/results/thinking-effort-261001/judging/sketch/picture-towards-a-theory-of-bugs-the-ruliology-of-the-unexpected-Z.png

Scene:

```json
{
  "title": "A Chain, One Fork, Two Strands",
  "caption": "The piece runs as one chain of escalating evidence for a single claim — bugs come from computational irreducibility — broken once by a genuine fork (can this particular case be proven bug-free, yes or no?) and ending in two parallel strands (math's own bugs, and practical ways to hold bugs back) that meet in a final reframing.",
  "scenes": [
    {
      "id": "overview",
      "title": "Overview",
      "height": 1360,
      "items": [
        {
          "kind": "node",
          "id": "A",
          "shape": "ellipse",
          "x": 230,
          "y": 40,
          "w": 300,
          "h": 70,
          "text": "Bugs come from irreducibility",
          "size": "md",
          "sub": "even the simplest programs have it",
          "detail": "The computational process a program actually runs can be far more sophisticated than the simple mental picture we have of what it should do.",
          "block": "spya-sx0zyh"
        },
        {
          "kind": "node",
          "id": "B",
          "shape": "box",
          "x": 230,
          "y": 150,
          "w": 300,
          "h": 70,
          "text": "Tiny Turing machines built for n+1 glitch",
          "size": "sm",
          "sub": "bugs appear after many correct steps",
          "detail": "A 3-state machine that looks like it computes n+1 suddenly outputs 9 instead of 8 at n=7.",
          "tone": 1,
          "block": "spya-s7uc4u"
        },
        {
          "kind": "node",
          "id": "C",
          "shape": "box",
          "x": 230,
          "y": 260,
          "w": 300,
          "h": 70,
          "text": "Whether it's a bug depends on the spec",
          "size": "sm",
          "sub": "behavior, equivalence, or a forbidden outcome",
          "detail": "Judging a program buggy needs some independent statement of what it should do — and machines can escape almost any such statement.",
          "tone": 1,
          "block": "spya-gjut02"
        },
        {
          "kind": "node",
          "id": "D",
          "shape": "box",
          "x": 230,
          "y": 370,
          "w": 300,
          "h": 70,
          "text": "Cellular automata built to double input glitch too",
          "size": "sm",
          "sub": "same pattern, a different kind of machine",
          "detail": "A rule that correctly doubles its input for many steps suddenly fails, for instance at n=14.",
          "tone": 1,
          "block": "spya-cy4dgs"
        },
        {
          "kind": "node",
          "id": "E",
          "shape": "diamond",
          "x": 280,
          "y": 490,
          "w": 200,
          "h": 90,
          "text": "Provable bug-free?",
          "size": "sm",
          "detail": "For some specific rule or machine, can you actually show in advance that it will never misbehave?",
          "block": "spya-gt6430"
        },
        {
          "kind": "node",
          "id": "E1",
          "shape": "box",
          "x": 90,
          "y": 630,
          "w": 220,
          "h": 80,
          "text": "Yes — simple enough, or reduces to a known rule",
          "size": "sm",
          "sub": "e.g. the interior obeys rule 122",
          "detail": "Even a visually complex pattern can be proven to always stabilize once its interior dynamics are identified.",
          "block": "spya-gagsuk"
        },
        {
          "kind": "node",
          "id": "E2",
          "shape": "box",
          "x": 460,
          "y": 630,
          "w": 220,
          "h": 80,
          "text": "No — no proof turns up, a real bug lurks",
          "size": "sm",
          "sub": "same effort as just running it",
          "detail": "Searching the space of possible proofs forever fails for a buggy machine, because the claim is simply false.",
          "block": "spya-ypka68"
        },
        {
          "kind": "node",
          "id": "F",
          "shape": "box",
          "x": 230,
          "y": 760,
          "w": 300,
          "h": 80,
          "text": "Only running the program reveals what it does",
          "size": "sm",
          "sub": "computational irreducibility, laid bare",
          "detail": "Because irreducibility is ubiquitous, no bounded amount of analysis can rule out every surprise.",
          "tone": 2,
          "block": "spya-wcnws7"
        },
        {
          "kind": "node",
          "id": "G",
          "shape": "box",
          "x": 230,
          "y": 870,
          "w": 300,
          "h": 70,
          "text": "Testing alone can't be trusted",
          "size": "sm",
          "sub": "rare bugs hide from even massive sampling",
          "detail": "Scientific induction from repeated tests works only where reducible regularities exist; raw computation has no such guarantee.",
          "tone": 2,
          "block": "spya-yc9e2z"
        },
        {
          "kind": "node",
          "id": "H",
          "shape": "box",
          "x": 230,
          "y": 980,
          "w": 300,
          "h": 70,
          "text": "Ruliology keeps turning up dramatic surprises",
          "size": "sm",
          "sub": "rule 30, a 137-million-step halt, and more",
          "detail": "Exploring the space of simple programs, startling exceptions to apparent regularities show up again and again, sometimes only after exhaustive search.",
          "tone": 3,
          "block": "spya-kjsjh5"
        },
        {
          "kind": "node",
          "id": "I1",
          "shape": "box",
          "x": 60,
          "y": 1110,
          "w": 300,
          "h": 80,
          "text": "Mathematics has its own rare counterexamples",
          "size": "sm",
          "sub": "a trend reverses at the 23-billionth prime",
          "detail": "Conjectures can hold for enormous numbers of tested cases, then suddenly fail far out.",
          "tone": 4,
          "block": "spya-bhwh4d"
        },
        {
          "kind": "node",
          "id": "I2",
          "shape": "box",
          "x": 400,
          "y": 1110,
          "w": 300,
          "h": 80,
          "text": "Good language design & visualization help",
          "size": "sm",
          "sub": "but never erase the risk entirely",
          "detail": "Primitives that match human intent, and seeing a computation's whole pattern, are the best practical defenses — not a cure.",
          "tone": 4,
          "block": "spya-kdks69"
        },
        {
          "kind": "node",
          "id": "J",
          "shape": "ellipse",
          "x": 230,
          "y": 1240,
          "w": 300,
          "h": 80,
          "text": "Bug to an engineer, discovery to a scientist",
          "size": "md",
          "detail": "An unexpected result is a failure if you wanted reliability, but exactly the kind of thing ruliology is built to find.",
          "block": "spya-xdwm97"
        },
        {
          "kind": "region",
          "x": 24,
          "y": 115,
          "w": 712,
          "h": 745,
          "style": "band",
          "label": "TURING MACHINES & PROOFS",
          "opens": "inside-tm-bugs",
          "tone": 1
        },
        {
          "kind": "region",
          "x": 24,
          "y": 950,
          "w": 712,
          "h": 250,
          "style": "band",
          "label": "RULIOLOGY & BEYOND",
          "opens": "inside-ruliology-beyond",
          "tone": 3
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
          "to": "D",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "D",
          "to": "E",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "E",
          "to": "E1",
          "via": "curve",
          "line": "solid",
          "arrow": "end",
          "label": "yes"
        },
        {
          "kind": "edge",
          "from": "E",
          "to": "E2",
          "via": "curve",
          "line": "solid",
          "arrow": "end",
          "label": "no"
        },
        {
          "kind": "edge",
          "from": "E1",
          "to": "F",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "E2",
          "to": "F",
          "via": "curve",
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
          "to": "I1",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "H",
          "to": "I2",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "I1",
          "to": "J",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "I2",
          "to": "J",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "Down the page: the claim, its demonstration in toy machines, a real fork (provable or not?), the irreducibility this reveals, and two parallel consequences meeting in one closing thought."
    },
    {
      "id": "inside-tm-bugs",
      "title": "Turing machines and their proofs",
      "height": 1020,
      "items": [
        {
          "kind": "node",
          "id": "t1",
          "shape": "box",
          "x": 230,
          "y": 60,
          "w": 300,
          "h": 70,
          "text": "A seeming n+1 machine glitches at n=7",
          "size": "sm",
          "sub": "outputs 9 instead of 8",
          "block": "spya-h3jx6h"
        },
        {
          "kind": "node",
          "id": "t2",
          "shape": "box",
          "x": 230,
          "y": 155,
          "w": 300,
          "h": 70,
          "text": "Glitches recur whenever n = 8k−1",
          "size": "sm",
          "sub": "binary ending in 111 triggers extra 'scribbling'",
          "block": "spya-z99x4e"
        },
        {
          "kind": "node",
          "id": "t3",
          "shape": "box",
          "x": 230,
          "y": 250,
          "w": 300,
          "h": 70,
          "text": "Thousands of machines compute n+1 correctly",
          "size": "sm",
          "sub": "but first bugs still show up eventually",
          "block": "spya-rhc6t0"
        },
        {
          "kind": "node",
          "id": "t4",
          "shape": "box",
          "x": 230,
          "y": 345,
          "w": 300,
          "h": 70,
          "text": "One machine is flawless through n=14",
          "size": "sm",
          "sub": "then fails at n=15, giving 20 not 16",
          "block": "spya-pt0hmz"
        },
        {
          "kind": "node",
          "id": "t5",
          "shape": "box",
          "x": 230,
          "y": 440,
          "w": 300,
          "h": 70,
          "text": "Bigger machines hide bugs even longer",
          "size": "sm",
          "sub": "a 4-state machine first fails at n=63",
          "block": "spya-hqukdz"
        },
        {
          "kind": "node",
          "id": "t6",
          "shape": "box",
          "x": 230,
          "y": 535,
          "w": 300,
          "h": 70,
          "text": "Being 'buggy' depends on the spec chosen",
          "size": "sm",
          "sub": "judge by behavior, equivalence, or a forbidden outcome",
          "block": "spya-gjut02"
        },
        {
          "kind": "node",
          "id": "t7",
          "shape": "box",
          "x": 230,
          "y": 630,
          "w": 300,
          "h": 70,
          "text": "Two seemingly identical machines diverge",
          "size": "sm",
          "sub": "they first disagree at n=27",
          "block": "spya-txuteu"
        },
        {
          "kind": "node",
          "id": "t8",
          "shape": "box",
          "x": 230,
          "y": 725,
          "w": 300,
          "h": 70,
          "text": "A correct machine's behavior gets proved",
          "size": "sm",
          "sub": "symbolic axioms plus mathematical induction",
          "block": "spya-q8fg9q"
        },
        {
          "kind": "node",
          "id": "t9",
          "shape": "box",
          "x": 230,
          "y": 820,
          "w": 300,
          "h": 70,
          "text": "A buggy machine yields no proof, ever",
          "size": "sm",
          "sub": "the search finds nothing, because the claim is false",
          "block": "spya-ypka68"
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
        },
        {
          "kind": "edge",
          "from": "t7",
          "to": "t8",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "t8",
          "to": "t9",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "A straight chain in close-up: simple Turing machines develop bugs at specific, often startlingly delayed inputs, and a formal proof can only ever be built for the ones that turn out to be truly bug-free."
    },
    {
      "id": "inside-ruliology-beyond",
      "title": "Ruliology's surprises, and beyond",
      "height": 1080,
      "items": [
        {
          "kind": "node",
          "id": "r1",
          "shape": "box",
          "x": 230,
          "y": 60,
          "w": 300,
          "h": 70,
          "text": "Rule 30 erupts into sudden complexity",
          "size": "sm",
          "sub": "among cellular automata that mostly look tame",
          "tone": 3,
          "block": "spya-zbsh70"
        },
        {
          "kind": "node",
          "id": "r2",
          "shape": "box",
          "x": 230,
          "y": 155,
          "w": 300,
          "h": 70,
          "text": "One Turing machine finally does something wild",
          "size": "sm",
          "sub": "machine 596440, among 2-state, 3-color machines",
          "tone": 3,
          "block": "spya-tgkahp"
        },
        {
          "kind": "node",
          "id": "r3",
          "shape": "box",
          "x": 230,
          "y": 250,
          "w": 300,
          "h": 70,
          "text": "Changing a rule's input brings new surprises",
          "size": "sm",
          "sub": "a cascade of ever stranger behavior",
          "tone": 3,
          "block": "spya-n7j593"
        },
        {
          "kind": "node",
          "id": "r4",
          "shape": "box",
          "x": 230,
          "y": 345,
          "w": 300,
          "h": 70,
          "text": "A combinator seems to grow forever",
          "size": "sm",
          "sub": "then halts, after exactly 137,356,329 steps",
          "tone": 3,
          "block": "spya-msgzxc"
        },
        {
          "kind": "node",
          "id": "r5",
          "shape": "box",
          "x": 230,
          "y": 440,
          "w": 300,
          "h": 70,
          "text": "A circular pattern sprouts a 'beak'",
          "size": "sm",
          "sub": "breaking symmetry after about 3000 steps",
          "tone": 3,
          "block": "spya-p3ume6"
        },
        {
          "kind": "node",
          "id": "r6",
          "shape": "box",
          "x": 230,
          "y": 535,
          "w": 300,
          "h": 70,
          "text": "A system that seems able to grow forever halts",
          "size": "sm",
          "sub": "a cluster of moves simply can't be grown further",
          "tone": 3,
          "block": "spya-ey7bx7"
        },
        {
          "kind": "node",
          "id": "r7",
          "shape": "box",
          "x": 60,
          "y": 660,
          "w": 300,
          "h": 80,
          "text": "Math conjectures can break after huge success",
          "size": "sm",
          "sub": "a factoring pattern fails at x^105 − 1",
          "tone": 4,
          "block": "spya-y7q6q3"
        },
        {
          "kind": "node",
          "id": "r8",
          "shape": "box",
          "x": 60,
          "y": 760,
          "w": 300,
          "h": 80,
          "text": "Pure math mostly dodges this",
          "size": "sm",
          "sub": "by sticking to human-graspable, reducible questions",
          "tone": 4,
          "block": "spya-zcpn8u"
        },
        {
          "kind": "node",
          "id": "r9",
          "shape": "box",
          "x": 400,
          "y": 660,
          "w": 300,
          "h": 80,
          "text": "Good language design heads off many bugs",
          "size": "sm",
          "sub": "primitives that already match human intent",
          "tone": 4,
          "block": "spya-kdks69"
        },
        {
          "kind": "node",
          "id": "r10",
          "shape": "box",
          "x": 400,
          "y": 760,
          "w": 300,
          "h": 80,
          "text": "Trained AI systems stay especially exposed",
          "size": "sm",
          "sub": "their learned mechanisms resist human understanding",
          "tone": 4,
          "block": "spya-sggbeh"
        },
        {
          "kind": "node",
          "id": "r11",
          "shape": "ellipse",
          "x": 230,
          "y": 900,
          "w": 300,
          "h": 90,
          "text": "Bug to an engineer, discovery to a scientist",
          "size": "md",
          "block": "spya-xdwm97"
        },
        {
          "kind": "edge",
          "from": "r1",
          "to": "r2",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "r2",
          "to": "r3",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "r3",
          "to": "r4",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "r4",
          "to": "r5",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "r5",
          "to": "r6",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "r6",
          "to": "r7",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "r6",
          "to": "r9",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "r7",
          "to": "r8",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "r9",
          "to": "r10",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "r8",
          "to": "r11",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "r10",
          "to": "r11",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "The tail of the chain opened up: ruliology keeps finding dramatic last-minute surprises, then splits into two things that are simply both true at once — math has its own rare counterexamples, and practical fixes exist — before converging on one closing thought."
    }
  ]
}
```
