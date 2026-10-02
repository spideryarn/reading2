# 4 candidates for "The Mythology Of Conscious AI"

Each candidate is a picture of how the article is put together, for a reader who has not read it yet. They are labelled W, X, Y, Z in an order that
says nothing about how any of them was made. The article itself, with its block ids, is
`article-noema-mythology-of-conscious-ai.md` beside this file.

## Candidate W

Picture: /home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/evals/results/thinking-effort-261001s-sketch-schema/judging/sketch/picture-noema-mythology-of-conscious-ai-W.png

Scene:

```json
{
  "title": "Funnel into convergence, looping back",
  "caption": "A funnel: opening stakes narrow into psychological biases, which narrow further into four converging arguments against machine consciousness, then open back out into ethical guidance that loops back to the opening theme of human self-understanding.",
  "scenes": [
    {
      "id": "overview",
      "title": "Overview",
      "height": 1180,
      "items": [
        {
          "kind": "node",
          "id": "frame",
          "shape": "ellipse",
          "x": 260,
          "y": 30,
          "w": 240,
          "h": 80,
          "text": "Could AI be conscious, and why it matters",
          "size": "md",
          "detail": "Opens with cultural fantasies and the Lemoine case, framing the stakes for AI and for us.",
          "block": "spya-tgnssb"
        },
        {
          "kind": "region",
          "x": 40,
          "y": 150,
          "w": 680,
          "h": 230,
          "style": "band",
          "label": "WHY WE'RE TEMPTED TO SEE CONSCIOUSNESS",
          "opens": "inside-temptations",
          "tone": 1
        },
        {
          "kind": "node",
          "id": "bias1",
          "shape": "hex",
          "x": 60,
          "y": 200,
          "w": 190,
          "h": 70,
          "text": "Intelligence ≠ consciousness",
          "size": "sm",
          "tone": 1,
          "block": "spya-nh8mt7"
        },
        {
          "kind": "node",
          "id": "bias2",
          "shape": "hex",
          "x": 280,
          "y": 200,
          "w": 190,
          "h": 70,
          "text": "Three human-centred biases",
          "size": "sm",
          "tone": 1,
          "block": "spya-cvaqgs"
        },
        {
          "kind": "node",
          "id": "bias3",
          "shape": "hex",
          "x": 500,
          "y": 200,
          "w": 190,
          "h": 70,
          "text": "Language & hype inflate belief",
          "size": "sm",
          "tone": 1,
          "block": "spya-k6fpme"
        },
        {
          "kind": "node",
          "id": "bias4",
          "shape": "note",
          "x": 280,
          "y": 300,
          "w": 200,
          "h": 60,
          "text": "Pareidolia: seeing faces that aren't there",
          "size": "sm",
          "tone": 1,
          "block": "spya-k850tu"
        },
        {
          "kind": "region",
          "x": 40,
          "y": 420,
          "w": 680,
          "h": 380,
          "style": "band",
          "label": "FOUR ARGUMENTS AGAINST COMPUTATION = CONSCIOUSNESS",
          "opens": "inside-arguments",
          "tone": 2
        },
        {
          "kind": "node",
          "id": "arg0",
          "shape": "diamond",
          "x": 270,
          "y": 460,
          "w": 220,
          "h": 60,
          "text": "Computational functionalism assumed",
          "size": "sm",
          "tone": 2,
          "block": "spya-d3g67c"
        },
        {
          "kind": "node",
          "id": "arg1",
          "shape": "box",
          "x": 60,
          "y": 560,
          "w": 170,
          "h": 80,
          "text": "Brains aren't computers",
          "size": "sm",
          "tone": 2,
          "block": "spya-sk4su6"
        },
        {
          "kind": "node",
          "id": "arg2",
          "shape": "box",
          "x": 250,
          "y": 560,
          "w": 170,
          "h": 80,
          "text": "Other non-algorithmic dynamics matter",
          "size": "sm",
          "tone": 2,
          "block": "spya-affgsh"
        },
        {
          "kind": "node",
          "id": "arg3",
          "shape": "box",
          "x": 440,
          "y": 560,
          "w": 170,
          "h": 80,
          "text": "Life itself may be necessary",
          "size": "sm",
          "tone": 2,
          "block": "spya-e7jqx4"
        },
        {
          "kind": "node",
          "id": "arg4",
          "shape": "box",
          "x": 250,
          "y": 660,
          "w": 170,
          "h": 80,
          "text": "Simulation isn't instantiation",
          "size": "sm",
          "tone": 2,
          "block": "spya-cqh5wq"
        },
        {
          "kind": "node",
          "id": "concl",
          "shape": "ellipse",
          "x": 240,
          "y": 760,
          "w": 280,
          "h": 80,
          "text": "Functionalism looks shaky; conscious AI unlikely, not impossible",
          "size": "md",
          "tone": 2,
          "block": "spya-uzr60x"
        },
        {
          "kind": "node",
          "id": "ethics",
          "shape": "box",
          "x": 260,
          "y": 890,
          "w": 260,
          "h": 90,
          "text": "Don't try to build conscious AI; watch out for AI that merely seems conscious",
          "size": "sm",
          "block": "spya-e7fdmb"
        },
        {
          "kind": "node",
          "id": "illusion",
          "shape": "note",
          "x": 560,
          "y": 890,
          "w": 160,
          "h": 90,
          "text": "Feeling of consciousness persists like a visual illusion",
          "size": "xs",
          "block": "spya-gwz5eu"
        },
        {
          "kind": "node",
          "id": "soul",
          "shape": "ellipse",
          "x": 260,
          "y": 1030,
          "w": 240,
          "h": 90,
          "text": "Recover an embodied sense of being human",
          "size": "md",
          "block": "spya-v98v5u"
        },
        {
          "kind": "edge",
          "from": "bias1",
          "to": "arg0",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "bias2",
          "to": "arg0",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "bias3",
          "to": "arg0",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "bias4",
          "to": "arg0",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "arg1",
          "to": "concl",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "arg2",
          "to": "concl",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "arg3",
          "to": "concl",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "arg4",
          "to": "concl",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "concl",
          "to": "ethics",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "ethics",
          "to": "illusion",
          "via": "straight",
          "line": "solid",
          "arrow": "none"
        },
        {
          "kind": "edge",
          "from": "ethics",
          "to": "soul",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "soul:left",
          "to": "frame:left",
          "via": "curve",
          "line": "dashed",
          "arrow": "end",
          "label": "returns to human nature"
        }
      ],
      "caption": "The piece funnels from the stakes of the question, through the biases that make conscious AI tempting, into four arguments that converge on one conclusion, then fans out into ethical guidance that loops back to where it started."
    },
    {
      "id": "inside-temptations",
      "title": "The Temptations Of Conscious AI",
      "height": 620,
      "items": [
        {
          "kind": "node",
          "id": "t1",
          "shape": "box",
          "x": 40,
          "y": 40,
          "w": 220,
          "h": 70,
          "text": "We assume intelligence implies consciousness, since in us they go together",
          "size": "sm",
          "block": "spya-f87ghx"
        },
        {
          "kind": "node",
          "id": "t2",
          "shape": "box",
          "x": 300,
          "y": 40,
          "w": 220,
          "h": 70,
          "text": "Intelligence is doing; consciousness is being",
          "size": "sm",
          "block": "spya-nj888h"
        },
        {
          "kind": "node",
          "id": "t3",
          "shape": "hex",
          "x": 60,
          "y": 160,
          "w": 180,
          "h": 70,
          "text": "Anthropocentrism: human as the default",
          "size": "sm",
          "tone": 1,
          "block": "spya-h4mwb2"
        },
        {
          "kind": "node",
          "id": "t4",
          "shape": "hex",
          "x": 280,
          "y": 160,
          "w": 180,
          "h": 70,
          "text": "Human exceptionalism: us atop every pile",
          "size": "sm",
          "tone": 1,
          "block": "spya-her4zk"
        },
        {
          "kind": "node",
          "id": "t5",
          "shape": "hex",
          "x": 500,
          "y": 160,
          "w": 200,
          "h": 70,
          "text": "Anthropomorphism: projecting human traits",
          "size": "sm",
          "tone": 1,
          "block": "spya-her4zk"
        },
        {
          "kind": "node",
          "id": "t6",
          "shape": "box",
          "x": 60,
          "y": 280,
          "w": 220,
          "h": 80,
          "text": "Fluent chatbot language feels distinctly human, unlike AlphaFold",
          "size": "sm",
          "block": "spya-k6fpme"
        },
        {
          "kind": "node",
          "id": "t7",
          "shape": "note",
          "x": 320,
          "y": 280,
          "w": 220,
          "h": 80,
          "text": "Calling errors 'hallucinations' smuggles in experience",
          "size": "sm",
          "block": "spya-t29n67"
        },
        {
          "kind": "node",
          "id": "t8",
          "shape": "box",
          "x": 60,
          "y": 400,
          "w": 220,
          "h": 80,
          "text": "Exponential growth makes every moment feel like a turning point",
          "size": "sm",
          "block": "spya-cke6sj"
        },
        {
          "kind": "node",
          "id": "t9",
          "shape": "box",
          "x": 320,
          "y": 400,
          "w": 220,
          "h": 80,
          "text": "Techno-rapture: dreams of godlike creation and digital immortality",
          "size": "sm",
          "block": "spya-v4sduf"
        },
        {
          "kind": "node",
          "id": "t10",
          "shape": "ellipse",
          "x": 180,
          "y": 520,
          "w": 260,
          "h": 80,
          "text": "Result: pareidolia—seeing minds that aren't there",
          "size": "md",
          "block": "spya-k850tu"
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
          "from": "t2",
          "to": "t4",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "t2",
          "to": "t5",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "t3",
          "to": "t6",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "t5",
          "to": "t7",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "t6",
          "to": "t8",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "t7",
          "to": "t9",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "t8",
          "to": "t10",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "t9",
          "to": "t10",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "Several overlapping psychological habits, not evidence, make us see minds in machines, reinforced by hype and the lure of transcendence."
    },
    {
      "id": "inside-arguments",
      "title": "Consciousness & Computation",
      "height": 780,
      "items": [
        {
          "kind": "node",
          "id": "a0",
          "shape": "diamond",
          "x": 270,
          "y": 30,
          "w": 220,
          "h": 60,
          "text": "Assumption: computation suffices for consciousness",
          "size": "sm",
          "block": "spya-d3g67c"
        },
        {
          "kind": "node",
          "id": "a1a",
          "shape": "box",
          "x": 40,
          "y": 140,
          "w": 220,
          "h": 70,
          "text": "Turing machines cleanly split software from hardware",
          "size": "sm",
          "tone": 2,
          "block": "spya-cf70dt"
        },
        {
          "kind": "node",
          "id": "a1b",
          "shape": "box",
          "x": 40,
          "y": 230,
          "w": 220,
          "h": 70,
          "text": "Real brains can't be split that way—biology is entangled",
          "size": "sm",
          "tone": 2,
          "block": "spya-b0086e"
        },
        {
          "kind": "node",
          "id": "a1c",
          "shape": "box",
          "x": 40,
          "y": 320,
          "w": 220,
          "h": 70,
          "text": "No perfect silicon neuron can replace a biological one",
          "size": "sm",
          "tone": 2,
          "block": "spya-un9fjn"
        },
        {
          "kind": "node",
          "id": "a2a",
          "shape": "box",
          "x": 290,
          "y": 140,
          "w": 220,
          "h": 70,
          "text": "Turing computation can't capture continuous, random processes",
          "size": "sm",
          "tone": 2,
          "block": "spya-n393ru"
        },
        {
          "kind": "node",
          "id": "a2b",
          "shape": "box",
          "x": 290,
          "y": 230,
          "w": 220,
          "h": 70,
          "text": "Steam governor shows some systems aren't computational at all",
          "size": "sm",
          "tone": 2,
          "block": "spya-sq9v5k"
        },
        {
          "kind": "node",
          "id": "a3a",
          "shape": "box",
          "x": 540,
          "y": 140,
          "w": 180,
          "h": 70,
          "text": "Perception as the brain's best guess (predictive processing)",
          "size": "sm",
          "tone": 2,
          "block": "spya-dp8sem"
        },
        {
          "kind": "node",
          "id": "a3b",
          "shape": "box",
          "x": 540,
          "y": 230,
          "w": 180,
          "h": 70,
          "text": "These guesses are rooted in keeping a living body alive",
          "size": "sm",
          "tone": 2,
          "block": "spya-b59nm2"
        },
        {
          "kind": "node",
          "id": "a4",
          "shape": "box",
          "x": 290,
          "y": 340,
          "w": 220,
          "h": 70,
          "text": "Simulating a storm doesn't make anything wet",
          "size": "sm",
          "tone": 2,
          "block": "spya-cepmwf"
        },
        {
          "kind": "node",
          "id": "conc",
          "shape": "ellipse",
          "x": 250,
          "y": 460,
          "w": 260,
          "h": 90,
          "text": "Functionalism rests on a shaky assumption",
          "size": "md",
          "block": "spya-ymbpwn"
        },
        {
          "kind": "node",
          "id": "caveat",
          "shape": "note",
          "x": 250,
          "y": 590,
          "w": 260,
          "h": 80,
          "text": "Not proof of impossibility—other technologies might still succeed",
          "size": "sm",
          "block": "spya-rn8y3y"
        },
        {
          "kind": "edge",
          "from": "a0",
          "to": "a1a",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "a1a",
          "to": "a1b",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "a1b",
          "to": "a1c",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "a0",
          "to": "a2a",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "a2a",
          "to": "a2b",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "a0",
          "to": "a3a",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "a3a",
          "to": "a3b",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "a2b",
          "to": "a4",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "a1c",
          "to": "conc",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "a3b",
          "to": "conc",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "a4",
          "to": "conc",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "conc",
          "to": "caveat",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "Four separate lines of argument each chip away at the idea that running the right computation is enough for consciousness, and together they converge on one cautious conclusion."
    }
  ]
}
```

## Candidate X

Picture: /home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/evals/results/thinking-effort-261001s-sketch-schema/judging/sketch/picture-noema-mythology-of-conscious-ai-X.png

Scene:

```json
{
  "title": "Funnel, Converge, Diverge, Loop",
  "caption": "A funnel narrows from the broad hype about conscious AI down to psychological biases, then four independent arguments converge on one shaky assumption, which then fans out into ethical consequences, closing with a loop back to the opening theme of human self-understanding.",
  "scenes": [
    {
      "id": "overview",
      "title": "The Mythology of Conscious AI",
      "height": 1180,
      "items": [
        {
          "kind": "node",
          "id": "open",
          "shape": "ellipse",
          "x": 260,
          "y": 30,
          "w": 240,
          "h": 70,
          "text": "Is AI conscious, and why it matters",
          "size": "md",
          "block": "spya-u6w37a"
        },
        {
          "kind": "region",
          "x": 40,
          "y": 140,
          "w": 680,
          "h": 150,
          "style": "band",
          "label": "WHY WE WANT TO BELIEVE IT",
          "tone": 2,
          "muted": true
        },
        {
          "kind": "node",
          "id": "biases",
          "shape": "box",
          "x": 80,
          "y": 185,
          "w": 260,
          "h": 70,
          "text": "Human biases project consciousness onto machines",
          "size": "sm",
          "sub": "anthropocentrism, exceptionalism, anthropomorphism",
          "tone": 2,
          "block": "spya-cvaqgs"
        },
        {
          "kind": "node",
          "id": "hype",
          "shape": "box",
          "x": 400,
          "y": 185,
          "w": 280,
          "h": 70,
          "text": "Language, hype and techno-rapture inflate the illusion",
          "size": "sm",
          "tone": 2,
          "block": "spya-cke6sj",
          "opens": "inside-the-case"
        },
        {
          "kind": "edge",
          "from": "open",
          "to": "biases",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "open",
          "to": "hype",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "label",
          "x": 400,
          "y": 330,
          "text": "BUT IS IT EVEN POSSIBLE?",
          "size": "xs",
          "align": "middle",
          "tone": 0
        },
        {
          "kind": "region",
          "x": 40,
          "y": 350,
          "w": 680,
          "h": 280,
          "style": "band",
          "label": "FOUR ARGUMENTS AGAINST COMPUTATIONAL CONSCIOUSNESS",
          "tone": 1,
          "muted": true
        },
        {
          "kind": "node",
          "id": "a1",
          "shape": "box",
          "x": 60,
          "y": 390,
          "w": 160,
          "h": 80,
          "text": "Brains are not computers",
          "size": "sm",
          "tone": 1,
          "block": "spya-sk4su6"
        },
        {
          "kind": "node",
          "id": "a2",
          "shape": "box",
          "x": 240,
          "y": 390,
          "w": 160,
          "h": 80,
          "text": "Other dynamics beyond algorithms",
          "size": "sm",
          "tone": 1,
          "block": "spya-affgsh"
        },
        {
          "kind": "node",
          "id": "a3",
          "shape": "box",
          "x": 420,
          "y": 390,
          "w": 160,
          "h": 80,
          "text": "Life itself may matter",
          "size": "sm",
          "tone": 1,
          "block": "spya-e7jqx4"
        },
        {
          "kind": "node",
          "id": "a4",
          "shape": "box",
          "x": 600,
          "y": 390,
          "w": 120,
          "h": 80,
          "text": "Simulation isn't instantiation",
          "size": "sm",
          "tone": 1,
          "block": "spya-cqh5wq"
        },
        {
          "kind": "node",
          "id": "concl",
          "shape": "diamond",
          "x": 260,
          "y": 540,
          "w": 240,
          "h": 80,
          "text": "Computational functionalism looks shaky",
          "size": "md",
          "tone": 1,
          "block": "spya-uzr60x",
          "opens": "inside-the-case"
        },
        {
          "kind": "edge",
          "from": "a1",
          "to": "concl",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "a2",
          "to": "concl",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "a3",
          "to": "concl",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "a4",
          "to": "concl",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "label",
          "x": 400,
          "y": 660,
          "text": "SO WHAT SHOULD WE DO?",
          "size": "xs",
          "align": "middle",
          "tone": 0
        },
        {
          "kind": "region",
          "x": 40,
          "y": 680,
          "w": 680,
          "h": 220,
          "style": "band",
          "label": "ETHICS UNDER UNCERTAINTY",
          "tone": 3,
          "muted": true
        },
        {
          "kind": "node",
          "id": "dontmake",
          "shape": "box",
          "x": 60,
          "y": 720,
          "w": 260,
          "h": 70,
          "text": "Don't try to create real machine consciousness",
          "size": "sm",
          "tone": 3,
          "block": "spya-e7fdmb",
          "opens": "inside-the-ethics"
        },
        {
          "kind": "node",
          "id": "seeming",
          "shape": "box",
          "x": 420,
          "y": 720,
          "w": 260,
          "h": 70,
          "text": "Conscious-seeming AI poses its own risks",
          "size": "sm",
          "tone": 3,
          "block": "spya-vs0vpj",
          "opens": "inside-the-ethics"
        },
        {
          "kind": "edge",
          "from": "concl",
          "to": "dontmake",
          "via": "elbow",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "concl",
          "to": "seeming",
          "via": "elbow",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "node",
          "id": "soul",
          "shape": "ellipse",
          "x": 260,
          "y": 850,
          "w": 240,
          "h": 80,
          "text": "More meat than machine: recovering the soul",
          "size": "md",
          "tone": 0,
          "block": "spya-zv36xq"
        },
        {
          "kind": "edge",
          "from": "dontmake",
          "to": "soul",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "seeming",
          "to": "soul",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "soul:left",
          "to": "open:left",
          "via": "curve",
          "line": "dashed",
          "arrow": "end",
          "label": "returns to the human question"
        }
      ],
      "caption": "Framing narrows into the biases behind the hype, four arguments converge on one conclusion, which then fans into ethical risks, looping back to the human question the essay opened with."
    },
    {
      "id": "inside-the-case",
      "title": "Four Arguments Against Computation = Consciousness",
      "height": 760,
      "items": [
        {
          "kind": "node",
          "id": "assume",
          "shape": "pill",
          "x": 260,
          "y": 30,
          "w": 240,
          "h": 60,
          "text": "Computational functionalism",
          "size": "sm",
          "block": "spya-d3g67c"
        },
        {
          "kind": "node",
          "id": "b1",
          "shape": "box",
          "x": 60,
          "y": 130,
          "w": 300,
          "h": 80,
          "text": "Brains have no software/hardware split",
          "size": "sm",
          "sub": "unlike Turing machines",
          "tone": 1,
          "block": "spya-sk4su6"
        },
        {
          "kind": "node",
          "id": "b2",
          "shape": "box",
          "x": 400,
          "y": 130,
          "w": 300,
          "h": 80,
          "text": "Neural replacement thought experiment fails",
          "size": "sm",
          "tone": 1,
          "block": "spya-ahtr6e"
        },
        {
          "kind": "node",
          "id": "b3",
          "shape": "box",
          "x": 60,
          "y": 260,
          "w": 300,
          "h": 80,
          "text": "Analogue, dynamical processes may matter too",
          "size": "sm",
          "tone": 1,
          "block": "spya-affgsh"
        },
        {
          "kind": "node",
          "id": "b4",
          "shape": "box",
          "x": 400,
          "y": 260,
          "w": 300,
          "h": 80,
          "text": "Steam governor shows some systems aren't computers",
          "size": "sm",
          "tone": 1,
          "block": "spya-sq9v5k"
        },
        {
          "kind": "node",
          "id": "b5",
          "shape": "box",
          "x": 60,
          "y": 390,
          "w": 300,
          "h": 80,
          "text": "Perception as controlled hallucination, tied to staying alive",
          "size": "sm",
          "tone": 1,
          "block": "spya-dp8sem"
        },
        {
          "kind": "node",
          "id": "b6",
          "shape": "box",
          "x": 400,
          "y": 390,
          "w": 300,
          "h": 80,
          "text": "Life's self-production may be what generates experience",
          "size": "sm",
          "tone": 1,
          "block": "spya-pfkhtt"
        },
        {
          "kind": "node",
          "id": "b7",
          "shape": "box",
          "x": 60,
          "y": 520,
          "w": 300,
          "h": 80,
          "text": "A simulated rainstorm doesn't get anything wet",
          "size": "sm",
          "tone": 1,
          "block": "spya-npjt4j"
        },
        {
          "kind": "node",
          "id": "b8",
          "shape": "box",
          "x": 400,
          "y": 520,
          "w": 300,
          "h": 80,
          "text": "Mind-uploading dreams assume what they must prove",
          "size": "sm",
          "tone": 1,
          "block": "spya-xvm37k"
        },
        {
          "kind": "node",
          "id": "concl2",
          "shape": "diamond",
          "x": 260,
          "y": 650,
          "w": 240,
          "h": 80,
          "text": "Assumption looks shaky, not disproven",
          "size": "md",
          "block": "spya-nv6tp0"
        },
        {
          "kind": "edge",
          "from": "assume",
          "to": "b1",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "assume",
          "to": "b2",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "b1",
          "to": "b3",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "b2",
          "to": "b4",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "b3",
          "to": "b5",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "b4",
          "to": "b6",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "b5",
          "to": "b7",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "b6",
          "to": "b8",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "b7",
          "to": "concl2",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "b8",
          "to": "concl2",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "A chain within the converge: each argument chips away from a different angle at the assumption that running the right computation is enough to produce consciousness."
    },
    {
      "id": "inside-the-ethics",
      "title": "What Not To Do",
      "height": 620,
      "items": [
        {
          "kind": "node",
          "id": "uncertain",
          "shape": "box",
          "x": 260,
          "y": 30,
          "w": 240,
          "h": 70,
          "text": "We cannot be sure if AI is conscious",
          "size": "sm",
          "block": "spya-e7fdmb"
        },
        {
          "kind": "node",
          "id": "real",
          "shape": "box",
          "x": 60,
          "y": 150,
          "w": 280,
          "h": 80,
          "text": "Don't deliberately create real conscious machines",
          "size": "sm",
          "sub": "new suffering, hard to shut down",
          "tone": 3,
          "block": "spya-yverz7"
        },
        {
          "kind": "node",
          "id": "seem",
          "shape": "box",
          "x": 420,
          "y": 150,
          "w": 280,
          "h": 80,
          "text": "Conscious-seeming machines raise separate risks",
          "size": "sm",
          "tone": 3,
          "block": "spya-x63ycg"
        },
        {
          "kind": "edge",
          "from": "uncertain",
          "to": "real",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "uncertain",
          "to": "seem",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "node",
          "id": "illusion",
          "shape": "box",
          "x": 420,
          "y": 270,
          "w": 280,
          "h": 80,
          "text": "Feeling of consciousness persists like a visual illusion",
          "size": "sm",
          "tone": 3,
          "block": "spya-gwz5eu"
        },
        {
          "kind": "edge",
          "from": "seem",
          "to": "illusion",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "node",
          "id": "test",
          "shape": "note",
          "x": 420,
          "y": 380,
          "w": 280,
          "h": 70,
          "text": "No test can settle the question (the \"Garland test\")",
          "size": "sm",
          "tone": 3,
          "block": "spya-mxxutn"
        },
        {
          "kind": "edge",
          "from": "illusion",
          "to": "test",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "node",
          "id": "falsepos",
          "shape": "box",
          "x": 60,
          "y": 270,
          "w": 280,
          "h": 80,
          "text": "Our biases favor false positives, not false negatives",
          "size": "sm",
          "tone": 3,
          "block": "spya-d89xf7"
        },
        {
          "kind": "edge",
          "from": "real",
          "to": "falsepos",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "node",
          "id": "care",
          "shape": "ellipse",
          "x": 180,
          "y": 480,
          "w": 280,
          "h": 80,
          "text": "Take AI welfare seriously, without losing ourselves",
          "size": "md",
          "block": "spya-fdefb5"
        },
        {
          "kind": "edge",
          "from": "falsepos",
          "to": "care",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "test",
          "to": "care",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "Two live, parallel worries — actual machine consciousness and merely seeming conscious machines — sit side by side rather than on a single fork, because the essay says both demand attention regardless of which is real."
    }
  ]
}
```

## Candidate Y

Picture: /home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/evals/results/thinking-effort-261001s-sketch-schema/judging/sketch/picture-noema-mythology-of-conscious-ai-Y.png

Scene:

```json
{
  "title": "Funnel, Converge, Then Loop",
  "caption": "A funnel (cultural hype and bias narrows to one hidden assumption) feeds a converge (four independent arguments meeting at one verdict), which then fans out into ethical consequences, and the closing loop returns to the opening worry about mistaking machines for ourselves.",
  "scenes": [
    {
      "id": "overview",
      "title": "Overview",
      "height": 1000,
      "items": [
        {
          "kind": "node",
          "id": "frame",
          "shape": "ellipse",
          "x": 260,
          "y": 20,
          "w": 240,
          "h": 70,
          "text": "Could AI be conscious?",
          "size": "md",
          "sub": "stakes: rights, suffering, self-understanding",
          "block": "spya-tgnssb"
        },
        {
          "kind": "node",
          "id": "myths",
          "shape": "box",
          "x": 60,
          "y": 130,
          "w": 260,
          "h": 60,
          "text": "Old fantasies of artificial minds, revived by claims like Lemoine's LaMDA",
          "size": "sm",
          "block": "spya-u6w37a"
        },
        {
          "kind": "node",
          "id": "why",
          "shape": "box",
          "x": 440,
          "y": 130,
          "w": 260,
          "h": 60,
          "text": "Why it matters: AI welfare and our own self-image",
          "size": "sm",
          "block": "spya-e68t9h"
        },
        {
          "kind": "region",
          "x": 40,
          "y": 225,
          "w": 680,
          "h": 170,
          "style": "band",
          "label": "WHY WE'RE TEMPTED TO SEE CONSCIOUSNESS",
          "opens": "inside-temptations",
          "tone": 1
        },
        {
          "kind": "node",
          "id": "biases",
          "shape": "box",
          "x": 70,
          "y": 270,
          "w": 280,
          "h": 60,
          "text": "Anthropocentrism, exceptionalism, anthropomorphism",
          "size": "sm",
          "tone": 1,
          "block": "spya-cvaqgs"
        },
        {
          "kind": "node",
          "id": "language",
          "shape": "box",
          "x": 410,
          "y": 270,
          "w": 280,
          "h": 60,
          "text": "Fluent language and words like 'hallucinate' mislead us",
          "size": "sm",
          "tone": 1,
          "block": "spya-k6fpme"
        },
        {
          "kind": "node",
          "id": "rapture",
          "shape": "box",
          "x": 240,
          "y": 340,
          "w": 280,
          "h": 45,
          "text": "Exponential hype and techno-rapture dreams",
          "size": "sm",
          "tone": 1,
          "block": "spya-cke6sj"
        },
        {
          "kind": "node",
          "id": "assumption",
          "shape": "diamond",
          "x": 280,
          "y": 430,
          "w": 200,
          "h": 80,
          "text": "Hidden assumption: computation is enough",
          "size": "sm",
          "block": "spya-d3g67c"
        },
        {
          "kind": "region",
          "x": 40,
          "y": 540,
          "w": 680,
          "h": 260,
          "style": "band",
          "label": "FOUR ARGUMENTS AGAINST THAT ASSUMPTION",
          "opens": "inside-arguments",
          "tone": 2
        },
        {
          "kind": "node",
          "id": "a1",
          "shape": "hex",
          "x": 60,
          "y": 580,
          "w": 160,
          "h": 70,
          "text": "Brains aren't computers",
          "size": "sm",
          "tone": 2,
          "block": "spya-sk4su6"
        },
        {
          "kind": "node",
          "id": "a2",
          "shape": "hex",
          "x": 240,
          "y": 580,
          "w": 160,
          "h": 70,
          "text": "Other kinds of dynamics matter too",
          "size": "sm",
          "tone": 2,
          "block": "spya-affgsh"
        },
        {
          "kind": "node",
          "id": "a3",
          "shape": "hex",
          "x": 420,
          "y": 580,
          "w": 160,
          "h": 70,
          "text": "Life itself may be required",
          "size": "sm",
          "tone": 2,
          "block": "spya-e7jqx4"
        },
        {
          "kind": "node",
          "id": "a4",
          "shape": "hex",
          "x": 600,
          "y": 580,
          "w": 120,
          "h": 70,
          "text": "Simulating isn't creating",
          "size": "xs",
          "tone": 2,
          "block": "spya-cqh5wq"
        },
        {
          "kind": "node",
          "id": "verdict",
          "shape": "box",
          "x": 220,
          "y": 690,
          "w": 320,
          "h": 70,
          "text": "Functionalism looks shaky; real machine consciousness is unlikely, not impossible",
          "size": "md",
          "block": "spya-uzr60x"
        },
        {
          "kind": "region",
          "x": 40,
          "y": 800,
          "w": 680,
          "h": 130,
          "style": "band",
          "label": "WHAT THIS MEANS FOR ACTION",
          "tone": 3
        },
        {
          "kind": "node",
          "id": "dontmake",
          "shape": "box",
          "x": 60,
          "y": 830,
          "w": 280,
          "h": 60,
          "text": "Don't deliberately create conscious AI",
          "size": "sm",
          "tone": 3,
          "block": "spya-e7fdmb"
        },
        {
          "kind": "node",
          "id": "seeming",
          "shape": "box",
          "x": 410,
          "y": 830,
          "w": 280,
          "h": 60,
          "text": "Conscious-seeming AI raises its own, separate dangers",
          "size": "sm",
          "tone": 3,
          "block": "spya-vs0vpj"
        },
        {
          "kind": "node",
          "id": "soul",
          "shape": "ellipse",
          "x": 260,
          "y": 950,
          "w": 240,
          "h": 50,
          "text": "We are 'more meat than machine'",
          "size": "md",
          "sub": "don't sell ourselves cheap to our creations",
          "block": "spya-zv36xq"
        },
        {
          "kind": "edge",
          "from": "frame",
          "to": "myths",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "frame",
          "to": "why",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "myths",
          "to": "biases",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "why",
          "to": "language",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "biases",
          "to": "rapture",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "language",
          "to": "rapture",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "rapture",
          "to": "assumption",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "assumption",
          "to": "a1",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "assumption",
          "to": "a2",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "assumption",
          "to": "a3",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "assumption",
          "to": "a4",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "a1",
          "to": "verdict",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "a2",
          "to": "verdict",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "a3",
          "to": "verdict",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "a4",
          "to": "verdict",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "verdict",
          "to": "dontmake",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "verdict",
          "to": "seeming",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "dontmake",
          "to": "soul",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "seeming",
          "to": "soul",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "soul:left",
          "to": "frame:left",
          "via": "curve",
          "line": "dashed",
          "arrow": "end",
          "label": "returns to the opening worry"
        }
      ],
      "caption": "Hype and bias funnel down to one assumption; four arguments converge against it; the verdict fans out into ethical duties; the ending loops back to the opening worry."
    },
    {
      "id": "inside-temptations",
      "title": "The Temptations Of Conscious AI",
      "height": 620,
      "items": [
        {
          "kind": "node",
          "id": "iq",
          "shape": "box",
          "x": 260,
          "y": 20,
          "w": 260,
          "h": 60,
          "text": "Intelligence (doing) is not consciousness (being)",
          "size": "sm",
          "block": "spya-nh8mt7"
        },
        {
          "kind": "node",
          "id": "anthro",
          "shape": "box",
          "x": 40,
          "y": 130,
          "w": 200,
          "h": 70,
          "text": "Anthropocentrism: judging by the human case",
          "size": "sm",
          "tone": 1,
          "block": "spya-h4mwb2"
        },
        {
          "kind": "node",
          "id": "except",
          "shape": "box",
          "x": 280,
          "y": 130,
          "w": 200,
          "h": 70,
          "text": "Human exceptionalism: putting ourselves at the top",
          "size": "sm",
          "tone": 1,
          "block": "spya-her4zk"
        },
        {
          "kind": "node",
          "id": "morph",
          "shape": "box",
          "x": 520,
          "y": 130,
          "w": 200,
          "h": 70,
          "text": "Anthropomorphism: projecting human traits",
          "size": "sm",
          "tone": 1,
          "block": "spya-her4zk"
        },
        {
          "kind": "node",
          "id": "lang2",
          "shape": "box",
          "x": 260,
          "y": 240,
          "w": 260,
          "h": 60,
          "text": "Fluent LLM speech triggers these biases hardest",
          "size": "sm",
          "block": "spya-k6fpme"
        },
        {
          "kind": "node",
          "id": "hallu",
          "shape": "note",
          "x": 560,
          "y": 240,
          "w": 160,
          "h": 60,
          "text": "Calling errors 'hallucinations' implies experience",
          "size": "xs",
          "block": "spya-t29n67"
        },
        {
          "kind": "node",
          "id": "expo",
          "shape": "box",
          "x": 60,
          "y": 350,
          "w": 260,
          "h": 60,
          "text": "Exponential growth feels like we're always at a turning point",
          "size": "sm",
          "block": "spya-cke6sj"
        },
        {
          "kind": "node",
          "id": "rapture2",
          "shape": "box",
          "x": 440,
          "y": 350,
          "w": 260,
          "h": 60,
          "text": "Techno-rapture: dreams of godlike creation, digital immortality",
          "size": "sm",
          "block": "spya-v4sduf"
        },
        {
          "kind": "node",
          "id": "pareidolia",
          "shape": "box",
          "x": 260,
          "y": 460,
          "w": 260,
          "h": 70,
          "text": "Seeing consciousness in AI is a kind of pareidolia, like faces in toast",
          "size": "sm",
          "block": "spya-k850tu"
        },
        {
          "kind": "edge",
          "from": "iq",
          "to": "anthro",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "iq",
          "to": "except",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "iq",
          "to": "morph",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "anthro",
          "to": "lang2",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "except",
          "to": "lang2",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "morph",
          "to": "hallu",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "lang2",
          "to": "expo",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "hallu",
          "to": "rapture2",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "expo",
          "to": "pareidolia",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "rapture2",
          "to": "pareidolia",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "Several overlapping biases, not evidence, converge to make AI seem conscious; language and hype intensify each other."
    },
    {
      "id": "inside-arguments",
      "title": "Four Arguments Against Computational Functionalism",
      "height": 680,
      "items": [
        {
          "kind": "node",
          "id": "assume2",
          "shape": "diamond",
          "x": 280,
          "y": 20,
          "w": 200,
          "h": 70,
          "text": "Assumption: computation suffices for consciousness",
          "size": "sm",
          "block": "spya-d3g67c"
        },
        {
          "kind": "node",
          "id": "b1",
          "shape": "hex",
          "x": 40,
          "y": 140,
          "w": 180,
          "h": 80,
          "text": "Brains fuse 'software' and 'hardware'; no clean split like in computers",
          "size": "xs",
          "block": "spya-b0086e"
        },
        {
          "kind": "node",
          "id": "b2",
          "shape": "hex",
          "x": 260,
          "y": 140,
          "w": 180,
          "h": 80,
          "text": "Continuous, analogue, dynamical processes go beyond Turing-style algorithms",
          "size": "xs",
          "block": "spya-gr2k02"
        },
        {
          "kind": "node",
          "id": "b3",
          "shape": "hex",
          "x": 480,
          "y": 140,
          "w": 220,
          "h": 80,
          "text": "Experience may need living, self-sustaining bodies, not just information",
          "size": "xs",
          "block": "spya-pfkhtt"
        },
        {
          "kind": "node",
          "id": "b4",
          "shape": "hex",
          "x": 260,
          "y": 260,
          "w": 200,
          "h": 70,
          "text": "A simulated brain is a model, not the mechanism itself",
          "size": "sm",
          "block": "spya-cepmwf"
        },
        {
          "kind": "node",
          "id": "neuron",
          "shape": "note",
          "x": 40,
          "y": 260,
          "w": 180,
          "h": 70,
          "text": "Even one neuron can't be perfectly swapped for silicon",
          "size": "xs",
          "block": "spya-ahtr6e"
        },
        {
          "kind": "node",
          "id": "uploading",
          "shape": "note",
          "x": 500,
          "y": 260,
          "w": 200,
          "h": 70,
          "text": "Mind-uploading dreams quietly assume the very thing in question",
          "size": "xs",
          "block": "spya-xvm37k"
        },
        {
          "kind": "node",
          "id": "verdict2",
          "shape": "box",
          "x": 220,
          "y": 380,
          "w": 320,
          "h": 80,
          "text": "Together: the case for conscious AI is weaker than assumed, though not disproved",
          "size": "md",
          "block": "spya-nv6tp0"
        },
        {
          "kind": "edge",
          "from": "assume2",
          "to": "b1",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "assume2",
          "to": "b2",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "assume2",
          "to": "b3",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "b1",
          "to": "neuron",
          "via": "straight",
          "line": "dashed",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "b3",
          "to": "uploading",
          "via": "straight",
          "line": "dashed",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "b2",
          "to": "b4",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "b1",
          "to": "verdict2",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "b4",
          "to": "verdict2",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "b3",
          "to": "verdict2",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "Four separate lines of reasoning, each standing on its own, meet at one shared doubt about machine consciousness."
    }
  ]
}
```

## Candidate Z

Picture: /home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/evals/results/thinking-effort-261001s-sketch-schema/judging/sketch/picture-noema-mythology-of-conscious-ai-Z.png

Scene:

```json
{
  "title": "Funnel into convergence, looping back",
  "caption": "A funnel runs from the opening question down through the psychological temptations that make AI seem conscious, into four independent arguments that converge on one verdict—then the piece opens into the ethical consequences and loops back, at the end, to the human nature it started with.",
  "scenes": [
    {
      "id": "overview",
      "title": "The Mythology Of Conscious AI",
      "height": 1180,
      "items": [
        {
          "kind": "node",
          "id": "open",
          "shape": "ellipse",
          "x": 260,
          "y": 30,
          "w": 240,
          "h": 70,
          "text": "Is AI conscious, and why does it matter?",
          "size": "md",
          "block": "spya-tgnssb"
        },
        {
          "kind": "region",
          "x": 40,
          "y": 140,
          "w": 680,
          "h": 220,
          "style": "band",
          "label": "WHY WE'RE TEMPTED TO THINK SO",
          "tone": 1,
          "muted": true
        },
        {
          "kind": "node",
          "id": "biases",
          "shape": "hex",
          "x": 70,
          "y": 180,
          "w": 190,
          "h": 70,
          "text": "Three biases: human-centered thinking",
          "size": "sm",
          "tone": 1,
          "block": "spya-cvaqgs"
        },
        {
          "kind": "node",
          "id": "lang",
          "shape": "hex",
          "x": 290,
          "y": 180,
          "w": 190,
          "h": 70,
          "text": "Fluent language fools us",
          "size": "sm",
          "tone": 1,
          "block": "spya-k6fpme"
        },
        {
          "kind": "node",
          "id": "rapture",
          "shape": "hex",
          "x": 510,
          "y": 180,
          "w": 190,
          "h": 70,
          "text": "Hype curves and techno-rapture",
          "size": "sm",
          "tone": 1,
          "block": "spya-cke6sj"
        },
        {
          "kind": "node",
          "id": "pareidolia",
          "shape": "note",
          "x": 290,
          "y": 280,
          "w": 190,
          "h": 60,
          "text": "Like seeing faces in toast",
          "size": "sm",
          "tone": 1,
          "block": "spya-k850tu"
        },
        {
          "kind": "node",
          "id": "assumption",
          "shape": "diamond",
          "x": 280,
          "y": 400,
          "w": 200,
          "h": 90,
          "text": "Does computation alone suffice?",
          "size": "sm",
          "block": "spya-d3g67c"
        },
        {
          "kind": "region",
          "x": 40,
          "y": 520,
          "w": 680,
          "h": 340,
          "style": "band",
          "label": "FOUR ARGUMENTS AGAINST",
          "tone": 2,
          "muted": true
        },
        {
          "kind": "node",
          "id": "arg1",
          "shape": "box",
          "x": 60,
          "y": 560,
          "w": 190,
          "h": 80,
          "text": "Brains aren't computers",
          "size": "sm",
          "tone": 2,
          "block": "spya-sk4su6"
        },
        {
          "kind": "node",
          "id": "arg2",
          "shape": "box",
          "x": 290,
          "y": 560,
          "w": 190,
          "h": 80,
          "text": "Other games: analogue, dynamical",
          "size": "sm",
          "tone": 2,
          "block": "spya-affgsh"
        },
        {
          "kind": "node",
          "id": "arg3",
          "shape": "box",
          "x": 60,
          "y": 670,
          "w": 190,
          "h": 80,
          "text": "Life itself may matter",
          "size": "sm",
          "tone": 2,
          "block": "spya-e7jqx4"
        },
        {
          "kind": "node",
          "id": "arg4",
          "shape": "box",
          "x": 290,
          "y": 670,
          "w": 190,
          "h": 80,
          "text": "Simulation isn't instantiation",
          "size": "sm",
          "tone": 2,
          "block": "spya-cqh5wq"
        },
        {
          "kind": "node",
          "id": "summary",
          "shape": "ellipse",
          "x": 520,
          "y": 620,
          "w": 180,
          "h": 90,
          "text": "Functionalism looks shaky",
          "size": "md",
          "sub": "not impossible, just unlikely",
          "tone": 2,
          "block": "spya-uzr60x"
        },
        {
          "kind": "region",
          "x": 40,
          "y": 900,
          "w": 680,
          "h": 180,
          "style": "band",
          "label": "WHAT (NOT) TO DO",
          "tone": 3,
          "muted": true
        },
        {
          "kind": "node",
          "id": "dontbuild",
          "shape": "box",
          "x": 60,
          "y": 940,
          "w": 190,
          "h": 70,
          "text": "Don't try to build real conscious AI",
          "size": "sm",
          "tone": 3,
          "block": "spya-e7fdmb"
        },
        {
          "kind": "node",
          "id": "seeming",
          "shape": "box",
          "x": 290,
          "y": 940,
          "w": 190,
          "h": 70,
          "text": "Seeming-conscious AI is its own danger",
          "size": "sm",
          "tone": 3,
          "block": "spya-vs0vpj"
        },
        {
          "kind": "node",
          "id": "illusion",
          "shape": "box",
          "x": 510,
          "y": 940,
          "w": 190,
          "h": 70,
          "text": "Illusion persists even when we know better",
          "size": "sm",
          "tone": 3,
          "block": "spya-gwz5eu"
        },
        {
          "kind": "node",
          "id": "soul",
          "shape": "ellipse",
          "x": 260,
          "y": 1110,
          "w": 240,
          "h": 60,
          "text": "More meat than machine",
          "size": "md",
          "block": "spya-zv36xq"
        },
        {
          "kind": "edge",
          "from": "open",
          "to": "biases",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "open",
          "to": "lang",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "open",
          "to": "rapture",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "biases",
          "to": "pareidolia",
          "via": "elbow",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "lang",
          "to": "pareidolia",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "rapture",
          "to": "pareidolia",
          "via": "elbow",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "pareidolia",
          "to": "assumption",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "assumption",
          "to": "arg1",
          "via": "elbow",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "assumption",
          "to": "arg2",
          "via": "elbow",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "arg1",
          "to": "summary",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "arg2",
          "to": "summary",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "arg3",
          "to": "summary",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "arg4",
          "to": "summary",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "summary",
          "to": "dontbuild",
          "via": "elbow",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "summary",
          "to": "seeming",
          "via": "elbow",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "dontbuild",
          "to": "soul",
          "via": "elbow",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "illusion",
          "to": "soul",
          "via": "elbow",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "soul:left",
          "to": "open:left",
          "via": "curve",
          "line": "dashed",
          "arrow": "end",
          "label": "returns to human nature"
        }
      ],
      "caption": "Overview: question narrows through psychological bias, four arguments converge on 'probably not computational', then the ethics fan out before the ending loops back to the opening theme of human self-understanding."
    },
    {
      "id": "inside-temptations",
      "title": "The Temptations Of Conscious AI",
      "height": 640,
      "items": [
        {
          "kind": "node",
          "id": "t1",
          "shape": "box",
          "x": 40,
          "y": 40,
          "w": 220,
          "h": 70,
          "text": "Intelligence and consciousness get confused",
          "size": "sm",
          "block": "spya-nh8mt7"
        },
        {
          "kind": "node",
          "id": "t2a",
          "shape": "hex",
          "x": 40,
          "y": 150,
          "w": 200,
          "h": 70,
          "text": "Anthropocentrism",
          "size": "sm",
          "tone": 1,
          "block": "spya-h4mwb2"
        },
        {
          "kind": "node",
          "id": "t2b",
          "shape": "hex",
          "x": 280,
          "y": 150,
          "w": 200,
          "h": 70,
          "text": "Human exceptionalism",
          "size": "sm",
          "tone": 1,
          "block": "spya-her4zk"
        },
        {
          "kind": "node",
          "id": "t2c",
          "shape": "hex",
          "x": 520,
          "y": 150,
          "w": 200,
          "h": 70,
          "text": "Anthropomorphism",
          "size": "sm",
          "tone": 1,
          "block": "spya-her4zk"
        },
        {
          "kind": "node",
          "id": "t3",
          "shape": "box",
          "x": 280,
          "y": 270,
          "w": 200,
          "h": 80,
          "text": "Chatbots' fluent talk, loaded words like 'hallucinate'",
          "size": "sm",
          "block": "spya-k6fpme"
        },
        {
          "kind": "node",
          "id": "t4a",
          "shape": "note",
          "x": 40,
          "y": 390,
          "w": 220,
          "h": 70,
          "text": "Exponential hype feels like an inflection point",
          "size": "sm",
          "block": "spya-cke6sj"
        },
        {
          "kind": "node",
          "id": "t4b",
          "shape": "note",
          "x": 480,
          "y": 390,
          "w": 220,
          "h": 70,
          "text": "Techno-rapture: creators as gods, minds made immortal",
          "size": "sm",
          "block": "spya-v4sduf"
        },
        {
          "kind": "node",
          "id": "t5",
          "shape": "ellipse",
          "x": 260,
          "y": 510,
          "w": 240,
          "h": 80,
          "text": "Pareidolia: seeing a face in the toast",
          "size": "md",
          "sub": "first step only, not the answer",
          "block": "spya-k850tu"
        },
        {
          "kind": "edge",
          "from": "t1",
          "to": "t2a",
          "via": "elbow",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "t1",
          "to": "t2b",
          "via": "elbow",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "t1",
          "to": "t2c",
          "via": "elbow",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "t2a",
          "to": "t3",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "t2b",
          "to": "t3",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "t2c",
          "to": "t3",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "t3",
          "to": "t4a",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "t3",
          "to": "t4b",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "t4a",
          "to": "t5",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "t4b",
          "to": "t5",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "Three overlapping biases, sharpened by fluent language and by hype, lead people to pareidolia—seeing consciousness in AI the way one sees a face in a cinnamon bun—which is only the first thing to recognize, not an answer."
    },
    {
      "id": "inside-arguments",
      "title": "Four Arguments Against Computational Consciousness",
      "height": 620,
      "items": [
        {
          "kind": "node",
          "id": "q",
          "shape": "diamond",
          "x": 280,
          "y": 30,
          "w": 200,
          "h": 90,
          "text": "Is computation enough for consciousness?",
          "size": "sm",
          "block": "spya-cv97j7"
        },
        {
          "kind": "node",
          "id": "a1",
          "shape": "box",
          "x": 30,
          "y": 180,
          "w": 190,
          "h": 90,
          "text": "Brains have no software/hardware split",
          "size": "sm",
          "sub": "unlike Turing machines",
          "tone": 2,
          "block": "spya-a8jgf4"
        },
        {
          "kind": "node",
          "id": "a2",
          "shape": "box",
          "x": 240,
          "y": 180,
          "w": 190,
          "h": 90,
          "text": "Analogue, dynamical processes may matter too",
          "size": "sm",
          "sub": "beyond Turing-style algorithms",
          "tone": 2,
          "block": "spya-gw0hsq"
        },
        {
          "kind": "node",
          "id": "a3",
          "shape": "box",
          "x": 450,
          "y": 180,
          "w": 280,
          "h": 90,
          "text": "Consciousness may require being alive",
          "size": "sm",
          "sub": "self-sustaining, predictive living systems",
          "tone": 2,
          "block": "spya-hj5y6s"
        },
        {
          "kind": "node",
          "id": "a4",
          "shape": "box",
          "x": 140,
          "y": 320,
          "w": 280,
          "h": 90,
          "text": "Simulating a brain isn't building one",
          "size": "sm",
          "sub": "map vs. territory",
          "tone": 2,
          "block": "spya-fz5xq5"
        },
        {
          "kind": "node",
          "id": "verdict",
          "shape": "ellipse",
          "x": 240,
          "y": 460,
          "w": 280,
          "h": 100,
          "text": "Functionalism looks shaky",
          "size": "md",
          "sub": "unlikely, not strictly ruled out",
          "block": "spya-c5ve5t"
        },
        {
          "kind": "edge",
          "from": "q",
          "to": "a1",
          "via": "elbow",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "q",
          "to": "a2",
          "via": "elbow",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "q",
          "to": "a3",
          "via": "elbow",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "a1",
          "to": "a4",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "a2",
          "to": "a4",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "a1",
          "to": "verdict",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "a2",
          "to": "verdict",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "a3",
          "to": "verdict",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "a4",
          "to": "verdict",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "Four separate lines of argument—about brains, other kinds of computation, life, and simulation—each stand on their own but reinforce each other, converging on one cautious verdict: real machine consciousness is unlikely, though not proven impossible."
    }
  ]
}
```
