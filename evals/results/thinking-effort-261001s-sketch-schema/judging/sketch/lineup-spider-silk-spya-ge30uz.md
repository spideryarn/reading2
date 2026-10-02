# 4 candidates for "Spider silk"

Each candidate is a picture of how the article is put together, for a reader who has not read it yet. They are labelled W, X, Y, Z in an order that
says nothing about how any of them was made. The article itself, with its block ids, is
`article-spider-silk-spya-ge30uz.md` beside this file.

## Candidate W

Picture: /home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/evals/results/thinking-effort-261001s-sketch-schema/judging/sketch/picture-spider-silk-spya-ge30uz-W.png

Scene:

```json
{
  "title": "Chain with two expansions",
  "caption": "A chain down the page: the article moves from what silk is and does, through how spiders make it, to how humans try to copy it and finally use it.",
  "scenes": [
    {
      "id": "overview",
      "title": "Spider silk overview",
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
          "text": "Silk serves many spider needs",
          "size": "sm",
          "sub": "prey, shelter, mating, flight",
          "block": "spya-gp4t9x"
        },
        {
          "kind": "region",
          "x": 40,
          "y": 140,
          "w": 680,
          "h": 170,
          "style": "band",
          "label": "PROPERTIES",
          "tone": 1
        },
        {
          "kind": "node",
          "id": "props",
          "shape": "box",
          "x": 280,
          "y": 180,
          "w": 200,
          "h": 80,
          "text": "Structure gives strength, stretch, toughness, stickiness",
          "size": "sm",
          "tone": 1,
          "block": "spya-py9zw6",
          "opens": "inside-properties"
        },
        {
          "kind": "edge",
          "from": "intro",
          "to": "props",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "node",
          "id": "uses",
          "shape": "box",
          "x": 280,
          "y": 350,
          "w": 200,
          "h": 70,
          "text": "Different silks for different jobs",
          "size": "sm",
          "sub": "capture, wrap, nest, drift, signal",
          "block": "spya-rty5kb"
        },
        {
          "kind": "edge",
          "from": "props",
          "to": "uses",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "node",
          "id": "types",
          "shape": "box",
          "x": 280,
          "y": 450,
          "w": 200,
          "h": 70,
          "text": "Seven glands, seven silks",
          "size": "sm",
          "sub": "each tied to a use",
          "block": "spya-hg7j7e"
        },
        {
          "kind": "edge",
          "from": "uses",
          "to": "types",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "node",
          "id": "spin",
          "shape": "hex",
          "x": 280,
          "y": 550,
          "w": 200,
          "h": 80,
          "text": "Spun on demand through a tapering duct",
          "size": "sm",
          "sub": "liquid to solid fibre",
          "block": "spya-g3h8qq"
        },
        {
          "kind": "edge",
          "from": "types",
          "to": "spin",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "region",
          "x": 40,
          "y": 660,
          "w": 680,
          "h": 220,
          "style": "band",
          "label": "ARTIFICIAL SYNTHESIS",
          "tone": 2
        },
        {
          "kind": "node",
          "id": "artsynth",
          "shape": "box",
          "x": 280,
          "y": 700,
          "w": 200,
          "h": 80,
          "text": "Copying silk means copying both protein and duct",
          "size": "sm",
          "tone": 2,
          "block": "spya-d7d7m8",
          "opens": "inside-artificial"
        },
        {
          "kind": "edge",
          "from": "spin",
          "to": "artsynth",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "node",
          "id": "research",
          "shape": "box",
          "x": 280,
          "y": 900,
          "w": 200,
          "h": 70,
          "text": "Decades of research map silk's chemistry and spinning",
          "size": "sm",
          "block": "spya-jvxbb8"
        },
        {
          "kind": "edge",
          "from": "artsynth",
          "to": "research",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "node",
          "id": "humanuse",
          "shape": "ellipse",
          "x": 280,
          "y": 1010,
          "w": 200,
          "h": 80,
          "text": "Humans harvest and apply silk",
          "size": "sm",
          "sub": "textiles, medicine, optics",
          "block": "spya-chy97m"
        },
        {
          "kind": "edge",
          "from": "research",
          "to": "humanuse",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "One spine from biology to engineering to human use; properties and artificial synthesis are the two densest links, expanded below."
    },
    {
      "id": "inside-properties",
      "title": "Properties of spider silk",
      "height": 620,
      "items": [
        {
          "kind": "node",
          "id": "struct",
          "shape": "box",
          "x": 40,
          "y": 60,
          "w": 210,
          "h": 90,
          "text": "Hard crystal sheets in a stretchy amorphous matrix",
          "size": "sm",
          "tone": 1,
          "block": "spya-p263u9"
        },
        {
          "kind": "node",
          "id": "strength",
          "shape": "box",
          "x": 280,
          "y": 60,
          "w": 200,
          "h": 80,
          "text": "Stronger than steel, tougher than Kevlar, weight for weight",
          "size": "sm",
          "tone": 1,
          "block": "spya-nwva2u"
        },
        {
          "kind": "node",
          "id": "ym",
          "shape": "box",
          "x": 40,
          "y": 200,
          "w": 210,
          "h": 70,
          "text": "Low stiffness (Young's modulus) vs steel/Kevlar",
          "size": "sm",
          "tone": 1,
          "block": "spya-dq9b7q"
        },
        {
          "kind": "node",
          "id": "ts",
          "shape": "box",
          "x": 280,
          "y": 200,
          "w": 200,
          "h": 70,
          "text": "Tensile strength rivals alloy steel",
          "size": "sm",
          "tone": 1,
          "block": "spya-mhe2r5"
        },
        {
          "kind": "node",
          "id": "duct2",
          "shape": "box",
          "x": 520,
          "y": 60,
          "w": 180,
          "h": 80,
          "text": "Extreme toughness, e.g. Darwin's bark spider",
          "size": "sm",
          "tone": 1,
          "block": "spya-ug9bz2"
        },
        {
          "kind": "node",
          "id": "ductile",
          "shape": "box",
          "x": 40,
          "y": 320,
          "w": 210,
          "h": 70,
          "text": "Stretches up to 5x length before breaking",
          "size": "sm",
          "tone": 1,
          "block": "spya-n93h2f"
        },
        {
          "kind": "node",
          "id": "supercon",
          "shape": "box",
          "x": 280,
          "y": 320,
          "w": 200,
          "h": 70,
          "text": "Shrinks 50% when wet (supercontraction)",
          "size": "sm",
          "tone": 1,
          "block": "spya-qdjb0x"
        },
        {
          "kind": "node",
          "id": "temp",
          "shape": "box",
          "x": 520,
          "y": 200,
          "w": 180,
          "h": 70,
          "text": "Holds strength from -40°C to 220°C",
          "size": "sm",
          "tone": 1,
          "block": "spya-v6hmg4"
        },
        {
          "kind": "node",
          "id": "adhesive",
          "shape": "hex",
          "x": 260,
          "y": 450,
          "w": 240,
          "h": 90,
          "text": "Separately: attachment discs glue instantly, biodegradably",
          "size": "sm",
          "tone": 3,
          "block": "spya-m8z9e7"
        },
        {
          "kind": "edge",
          "from": "struct",
          "to": "ym",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "struct",
          "to": "strength",
          "via": "straight",
          "line": "solid",
          "arrow": "none"
        },
        {
          "kind": "edge",
          "from": "strength",
          "to": "ts",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "strength",
          "to": "duct2",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "ym",
          "to": "ductile",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "ts",
          "to": "supercon",
          "via": "straight",
          "line": "solid",
          "arrow": "none"
        },
        {
          "kind": "edge",
          "from": "duct2",
          "to": "temp",
          "via": "straight",
          "line": "solid",
          "arrow": "none"
        },
        {
          "kind": "edge",
          "from": "ductile",
          "to": "adhesive",
          "via": "curve",
          "line": "dotted",
          "arrow": "none"
        },
        {
          "kind": "edge",
          "from": "supercon",
          "to": "adhesive",
          "via": "straight",
          "line": "dotted",
          "arrow": "none"
        }
      ],
      "caption": "Three sides of one material: its molecular build, the mechanical traits that build gives it, and a separate adhesive trick used only at attachment points."
    },
    {
      "id": "inside-artificial",
      "title": "Artificial synthesis",
      "height": 640,
      "items": [
        {
          "kind": "node",
          "id": "feedstock",
          "shape": "box",
          "x": 40,
          "y": 60,
          "w": 260,
          "h": 90,
          "text": "Feedstock: extract silk-like proteins from E. coli, silkworms, goats",
          "size": "sm",
          "tone": 2,
          "block": "spya-rw0wtg"
        },
        {
          "kind": "node",
          "id": "geometry",
          "shape": "box",
          "x": 460,
          "y": 60,
          "w": 260,
          "h": 90,
          "text": "Geometry: syringes, microfluidics, electrospinning mimic the duct",
          "size": "sm",
          "tone": 2,
          "block": "spya-x4bwhf"
        },
        {
          "kind": "node",
          "id": "converge",
          "shape": "diamond",
          "x": 250,
          "y": 220,
          "w": 260,
          "h": 100,
          "text": "Both needed together for a working fibre",
          "size": "sm",
          "tone": 2,
          "block": "spya-d7d7m8"
        },
        {
          "kind": "edge",
          "from": "feedstock",
          "to": "converge",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "geometry",
          "to": "converge",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "node",
          "id": "shapes",
          "shape": "note",
          "x": 40,
          "y": 380,
          "w": 260,
          "h": 80,
          "text": "Also: capsules, nanowires, membranes for medicine",
          "size": "sm",
          "block": "spya-r4r9au"
        },
        {
          "kind": "node",
          "id": "synthfirms",
          "shape": "box",
          "x": 460,
          "y": 380,
          "w": 260,
          "h": 90,
          "text": "Companies/labs: AMSilk, Bolt Threads, Spiber, Kraig, Nexia",
          "size": "sm",
          "block": "spya-j7hems"
        },
        {
          "kind": "edge",
          "from": "converge",
          "to": "shapes",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "converge",
          "to": "synthfirms",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "node",
          "id": "gap",
          "shape": "box",
          "x": 250,
          "y": 520,
          "w": 260,
          "h": 80,
          "text": "Still thicker, weaker than natural dragline silk",
          "size": "sm",
          "tone": 3,
          "block": "spya-jzcepa"
        },
        {
          "kind": "edge",
          "from": "shapes",
          "to": "gap",
          "via": "curve",
          "line": "dashed",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "synthfirms",
          "to": "gap",
          "via": "curve",
          "line": "dashed",
          "arrow": "end"
        }
      ],
      "caption": "Two separate problems must both be solved — the protein feedstock and the spinning apparatus — before they converge on usable synthetic silk and its other applications."
    }
  ]
}
```

## Candidate X

This candidate produced no usable output.

## Candidate Y

Picture: /home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/evals/results/thinking-effort-261001s-sketch-schema/judging/sketch/picture-spider-silk-spya-ge30uz-Y.png

Scene:

```json
{
  "title": "Biology-to-technology chain",
  "caption": "A chain down the page: spider silk's properties lead into its natural uses and glandular types, then into how spiders spin it, then into humanity's struggle to copy that spinning, ending in real-world applications — a funnel from biology to technology.",
  "scenes": [
    {
      "id": "overview",
      "title": "Spider Silk: Overview",
      "height": 1150,
      "items": [
        {
          "kind": "node",
          "id": "intro",
          "shape": "ellipse",
          "x": 260,
          "y": 30,
          "w": 240,
          "h": 70,
          "text": "Silk: a protein fibre spiders spin",
          "size": "md",
          "sub": "for prey, shelter, mating",
          "block": "spya-gp4t9x"
        },
        {
          "kind": "node",
          "id": "props",
          "shape": "hex",
          "x": 260,
          "y": 140,
          "w": 240,
          "h": 80,
          "text": "Structure gives strength, toughness, stretch",
          "size": "md",
          "detail": "Crystalline beta-sheets plus amorphous stretchy regions, protective salts, adhesive discs.",
          "block": "spya-py9zw6"
        },
        {
          "kind": "region",
          "x": 30,
          "y": 260,
          "w": 330,
          "h": 210,
          "style": "band",
          "label": "ECOLOGICAL USES",
          "opens": "inside-uses",
          "tone": 1
        },
        {
          "kind": "node",
          "id": "uses",
          "shape": "box",
          "x": 60,
          "y": 300,
          "w": 270,
          "h": 70,
          "text": "Up to seven silk types, many uses",
          "size": "sm",
          "sub": "capture, wrap, nest, mate, float",
          "tone": 1,
          "block": "spya-rty5kb"
        },
        {
          "kind": "node",
          "id": "usecases",
          "shape": "note",
          "x": 60,
          "y": 400,
          "w": 270,
          "h": 55,
          "text": "Table: web, wrap, egg sac, ballooning, trails",
          "size": "xs",
          "tone": 1,
          "block": "spya-jyg3uw"
        },
        {
          "kind": "region",
          "x": 410,
          "y": 260,
          "w": 330,
          "h": 210,
          "style": "band",
          "label": "GLANDS & SILK TYPES",
          "tone": 2
        },
        {
          "kind": "node",
          "id": "types",
          "shape": "box",
          "x": 440,
          "y": 300,
          "w": 270,
          "h": 70,
          "text": "Each gland makes a specialised silk",
          "size": "sm",
          "sub": "dragline, capture-spiral, wrap, egg",
          "tone": 2,
          "block": "spya-hg7j7e"
        },
        {
          "kind": "node",
          "id": "glanddetail",
          "shape": "note",
          "x": 440,
          "y": 400,
          "w": 270,
          "h": 55,
          "text": "Function traced to originating gland",
          "size": "xs",
          "tone": 2,
          "block": "spya-bgtqr0"
        },
        {
          "kind": "node",
          "id": "spin",
          "shape": "hex",
          "x": 260,
          "y": 500,
          "w": 240,
          "h": 80,
          "text": "Spiders pull silk, not squeeze it",
          "size": "md",
          "sub": "gland: tail→ampulla→duct→spigot",
          "block": "spya-g3h8qq"
        },
        {
          "kind": "region",
          "x": 30,
          "y": 620,
          "w": 700,
          "h": 260,
          "style": "band",
          "label": "ARTIFICIAL SYNTHESIS",
          "opens": "inside-synthesis",
          "tone": 3
        },
        {
          "kind": "node",
          "id": "feedstock",
          "shape": "box",
          "x": 60,
          "y": 660,
          "w": 280,
          "h": 70,
          "text": "Copying the protein (feedstock)",
          "size": "sm",
          "sub": "E. coli, silkworms, goats",
          "tone": 3,
          "block": "spya-rw0wtg"
        },
        {
          "kind": "node",
          "id": "geometry",
          "shape": "box",
          "x": 400,
          "y": 660,
          "w": 280,
          "h": 70,
          "text": "Copying the spinning apparatus",
          "size": "sm",
          "sub": "syringes, microfluidics, electrospinning",
          "tone": 3,
          "block": "spya-x4bwhf"
        },
        {
          "kind": "node",
          "id": "synth",
          "shape": "box",
          "x": 230,
          "y": 770,
          "w": 300,
          "h": 80,
          "text": "Synthetic silk: weaker, thicker than natural",
          "size": "sm",
          "sub": "AMSilk, Bolt Threads, Spiber, Kraig",
          "tone": 3,
          "block": "spya-j7hems"
        },
        {
          "kind": "node",
          "id": "research",
          "shape": "note",
          "x": 560,
          "y": 770,
          "w": 170,
          "h": 70,
          "text": "Decades of research mapped structure",
          "size": "xs",
          "block": "spya-jvxbb8"
        },
        {
          "kind": "node",
          "id": "humanuses",
          "shape": "box",
          "x": 230,
          "y": 920,
          "w": 300,
          "h": 90,
          "text": "Applications: textiles, medicine, optics, fusion targets",
          "size": "md",
          "sub": "limited by production difficulty",
          "block": "spya-chy97m"
        },
        {
          "kind": "edge",
          "from": "intro",
          "to": "props",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "props",
          "to": "uses",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "props",
          "to": "types",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "uses",
          "to": "usecases",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "types",
          "to": "glanddetail",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "usecases:bottom",
          "to": "spin:top",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "glanddetail:bottom",
          "to": "spin:top",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "spin",
          "to": "feedstock",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "spin",
          "to": "geometry",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "feedstock",
          "to": "synth",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "geometry",
          "to": "synth",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "synth",
          "to": "research",
          "via": "straight",
          "line": "dashed",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "synth",
          "to": "humanuses",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "The article moves in one long chain: what silk is, what makes it work, how spiders use and produce it, how humans try to copy it, and where that copy ends up being used."
    },
    {
      "id": "inside-uses",
      "title": "Ecological Uses of Silk",
      "height": 620,
      "items": [
        {
          "kind": "node",
          "id": "hub",
          "shape": "ellipse",
          "x": 280,
          "y": 40,
          "w": 200,
          "h": 70,
          "text": "One fibre, many jobs",
          "size": "md",
          "block": "spya-ybqc4f"
        },
        {
          "kind": "node",
          "id": "capture",
          "shape": "box",
          "x": 40,
          "y": 180,
          "w": 170,
          "h": 70,
          "text": "Prey capture: webs, bolas",
          "size": "sm",
          "block": "spya-jyg3uw"
        },
        {
          "kind": "node",
          "id": "immob",
          "shape": "box",
          "x": 40,
          "y": 280,
          "w": 170,
          "h": 70,
          "text": "Immobilising prey with wrap silk",
          "size": "sm",
          "block": "spya-sxy3ve"
        },
        {
          "kind": "node",
          "id": "repro",
          "shape": "box",
          "x": 230,
          "y": 360,
          "w": 170,
          "h": 70,
          "text": "Reproduction: sperm webs, egg sacs",
          "size": "sm",
          "block": "spya-ybqc4f"
        },
        {
          "kind": "node",
          "id": "disperse",
          "shape": "box",
          "x": 420,
          "y": 280,
          "w": 170,
          "h": 70,
          "text": "Ballooning for dispersal",
          "size": "sm",
          "block": "spya-jyg3uw"
        },
        {
          "kind": "node",
          "id": "food",
          "shape": "box",
          "x": 420,
          "y": 180,
          "w": 170,
          "h": 70,
          "text": "Eating own silk as food",
          "size": "sm",
          "block": "spya-k8j9fe"
        },
        {
          "kind": "node",
          "id": "nestline",
          "shape": "box",
          "x": 40,
          "y": 460,
          "w": 170,
          "h": 70,
          "text": "Nest lining, trapdoors, drop lines",
          "size": "sm",
          "block": "spya-jyg3uw"
        },
        {
          "kind": "node",
          "id": "pherom",
          "shape": "box",
          "x": 420,
          "y": 460,
          "w": 170,
          "h": 70,
          "text": "Pheromone trails, alarm lines",
          "size": "sm",
          "block": "spya-jyg3uw"
        },
        {
          "kind": "edge",
          "from": "hub",
          "to": "capture",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "hub",
          "to": "food",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "hub",
          "to": "immob",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "hub",
          "to": "repro",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "hub",
          "to": "disperse",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "hub",
          "to": "nestline",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "hub",
          "to": "pherom",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "A hub: silk's varied ecological functions all branch from the fact that spiders can tune thickness and stickiness for the job at hand."
    },
    {
      "id": "inside-synthesis",
      "title": "Artificial Synthesis",
      "height": 680,
      "items": [
        {
          "kind": "label",
          "x": 380,
          "y": 30,
          "text": "TWO REQUIREMENTS",
          "size": "sm",
          "align": "middle"
        },
        {
          "kind": "node",
          "id": "feed1",
          "shape": "box",
          "x": 40,
          "y": 80,
          "w": 280,
          "h": 70,
          "text": "Protein feedstock from E. coli, silkworms, goats",
          "size": "sm",
          "block": "spya-rw0wtg"
        },
        {
          "kind": "node",
          "id": "feedtable",
          "shape": "note",
          "x": 40,
          "y": 180,
          "w": 280,
          "h": 70,
          "text": "Natural silk still tougher, stretchier",
          "size": "xs",
          "block": "spya-gjan3e"
        },
        {
          "kind": "node",
          "id": "geo1",
          "shape": "box",
          "x": 440,
          "y": 80,
          "w": 280,
          "h": 70,
          "text": "Apparatus: syringe, microfluidics, electrospinning",
          "size": "sm",
          "block": "spya-x4bwhf"
        },
        {
          "kind": "node",
          "id": "shapes",
          "shape": "note",
          "x": 440,
          "y": 180,
          "w": 280,
          "h": 70,
          "text": "Also makes sheets, nanowires, membranes",
          "size": "xs",
          "block": "spya-r4r9au"
        },
        {
          "kind": "node",
          "id": "combine",
          "shape": "diamond",
          "x": 280,
          "y": 300,
          "w": 220,
          "h": 90,
          "text": "Wet-spinning combines both",
          "size": "md",
          "block": "spya-jzcepa"
        },
        {
          "kind": "node",
          "id": "products",
          "shape": "box",
          "x": 230,
          "y": 440,
          "w": 300,
          "h": 80,
          "text": "Commercial attempts: AMSilk, Bolt Threads, Spiber, Kraig, Nexia",
          "size": "sm",
          "block": "spya-j7hems"
        },
        {
          "kind": "node",
          "id": "limit",
          "shape": "note",
          "x": 230,
          "y": 560,
          "w": 300,
          "h": 70,
          "text": "Still half the strength/flexibility of natural silk",
          "size": "xs",
          "block": "spya-jzcepa"
        },
        {
          "kind": "edge",
          "from": "feed1",
          "to": "feedtable",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "geo1",
          "to": "shapes",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "feedtable",
          "to": "combine",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "shapes",
          "to": "combine",
          "via": "curve",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "combine",
          "to": "products",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "products",
          "to": "limit",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "Two columns converge: copying silk needs both the right protein and the right apparatus to pull it into fibre, and both still fall short of nature."
    }
  ]
}
```

## Candidate Z

Picture: /home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/evals/results/thinking-effort-261001s-sketch-schema/judging/sketch/picture-spider-silk-spya-ge30uz-Z.png

Scene:

```json
{
  "title": "Chain with asides",
  "caption": "The article is a chain running from what silk is and does, through its natural properties and manufacture, to human attempts to copy and use it — with a research-history aside hanging off the middle and reference matter at the end.",
  "scenes": [
    {
      "id": "overview",
      "title": "Spider silk: from web to lab",
      "height": 1040,
      "items": [
        {
          "kind": "node",
          "id": "intro",
          "shape": "ellipse",
          "x": 260,
          "y": 30,
          "w": 240,
          "h": 70,
          "text": "Silk serves many spider needs",
          "size": "md",
          "detail": "Prey capture, protection, mobility, courtship, even food.",
          "block": "spya-gp4t9x"
        },
        {
          "kind": "region",
          "x": 30,
          "y": 140,
          "w": 700,
          "h": 150,
          "style": "band",
          "label": "PROPERTIES",
          "opens": "inside-properties"
        },
        {
          "kind": "node",
          "id": "props",
          "shape": "box",
          "x": 280,
          "y": 180,
          "w": 200,
          "h": 70,
          "text": "Structure gives strength, toughness, stickiness",
          "size": "sm",
          "block": "spya-py9zw6"
        },
        {
          "kind": "node",
          "id": "uses",
          "shape": "box",
          "x": 280,
          "y": 330,
          "w": 200,
          "h": 70,
          "text": "Many ecological uses",
          "size": "sm",
          "sub": "capture, nests, dispersal...",
          "block": "spya-rty5kb"
        },
        {
          "kind": "region",
          "x": 30,
          "y": 430,
          "w": 700,
          "h": 150,
          "style": "band",
          "label": "SILK TYPES & GLANDS"
        },
        {
          "kind": "node",
          "id": "types",
          "shape": "hex",
          "x": 280,
          "y": 470,
          "w": 200,
          "h": 70,
          "text": "Distinct glands make distinct silks",
          "size": "sm",
          "block": "spya-hg7j7e"
        },
        {
          "kind": "node",
          "id": "spin",
          "shape": "box",
          "x": 280,
          "y": 620,
          "w": 200,
          "h": 70,
          "text": "Spinning pulls dope into fibre",
          "size": "sm",
          "block": "spya-g3h8qq",
          "opens": "inside-synthesis"
        },
        {
          "kind": "node",
          "id": "artificial",
          "shape": "box",
          "x": 280,
          "y": 740,
          "w": 200,
          "h": 80,
          "text": "Replicating it artificially is hard",
          "size": "sm",
          "sub": "feedstock + spinning geometry",
          "block": "spya-d7d7m8",
          "opens": "inside-synthesis"
        },
        {
          "kind": "node",
          "id": "humanuse",
          "shape": "box",
          "x": 280,
          "y": 870,
          "w": 200,
          "h": 70,
          "text": "Human uses: textiles, medicine, tech",
          "size": "sm",
          "block": "spya-chy97m"
        },
        {
          "kind": "node",
          "id": "research",
          "shape": "note",
          "x": 560,
          "y": 620,
          "w": 170,
          "h": 90,
          "text": "Research history",
          "size": "xs",
          "sub": "decades of findings",
          "block": "spya-jvxbb8",
          "opens": "inside-synthesis"
        },
        {
          "kind": "node",
          "id": "back",
          "shape": "note",
          "x": 560,
          "y": 870,
          "w": 170,
          "h": 70,
          "text": "References & see also",
          "size": "xs",
          "muted": true,
          "block": "spya-jdybu5"
        },
        {
          "kind": "edge",
          "from": "intro",
          "to": "props",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "props",
          "to": "uses",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "uses",
          "to": "types",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "types",
          "to": "spin",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "spin",
          "to": "artificial",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "artificial",
          "to": "humanuse",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "spin",
          "to": "research",
          "via": "curve",
          "line": "dashed",
          "arrow": "none"
        },
        {
          "kind": "edge",
          "from": "humanuse",
          "to": "back",
          "via": "straight",
          "line": "dotted",
          "arrow": "none"
        }
      ],
      "caption": "A main line runs top to bottom from biology to human imitation; research history and back matter hang off it as asides rather than sitting on the line."
    },
    {
      "id": "inside-properties",
      "title": "Properties: structure to function",
      "height": 620,
      "items": [
        {
          "kind": "node",
          "id": "struct",
          "shape": "box",
          "x": 260,
          "y": 40,
          "w": 240,
          "h": 80,
          "text": "Crystalline beta-sheets in an elastic matrix",
          "size": "sm",
          "sub": "glycine/alanine blocks",
          "block": "spya-h6ub2r"
        },
        {
          "kind": "node",
          "id": "mech",
          "shape": "box",
          "x": 260,
          "y": 170,
          "w": 240,
          "h": 80,
          "text": "High strength + high stretch = toughness",
          "size": "sm",
          "block": "spya-b0sewq"
        },
        {
          "kind": "node",
          "id": "young",
          "shape": "box",
          "x": 40,
          "y": 290,
          "w": 180,
          "h": 60,
          "text": "Low stiffness (Young's modulus)",
          "size": "xs",
          "block": "spya-w9q80j"
        },
        {
          "kind": "node",
          "id": "tensile",
          "shape": "box",
          "x": 260,
          "y": 290,
          "w": 180,
          "h": 60,
          "text": "Tensile strength near steel",
          "size": "xs",
          "block": "spya-yp288p"
        },
        {
          "kind": "node",
          "id": "ductile",
          "shape": "box",
          "x": 480,
          "y": 290,
          "w": 200,
          "h": 60,
          "text": "Stretches up to 5x length",
          "size": "xs",
          "block": "spya-n93h2f"
        },
        {
          "kind": "node",
          "id": "supercontract",
          "shape": "box",
          "x": 260,
          "y": 400,
          "w": 240,
          "h": 70,
          "text": "Shrinks 50% when wet",
          "size": "sm",
          "sub": "supercontraction",
          "block": "spya-egpeqk"
        },
        {
          "kind": "node",
          "id": "adhesive",
          "shape": "box",
          "x": 260,
          "y": 510,
          "w": 240,
          "h": 80,
          "text": "Attachment discs act like instant glue",
          "size": "sm",
          "block": "spya-m8z9e7"
        },
        {
          "kind": "edge",
          "from": "struct",
          "to": "mech",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "mech",
          "to": "young",
          "via": "elbow",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "mech",
          "to": "tensile",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "mech",
          "to": "ductile",
          "via": "elbow",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "tensile",
          "to": "supercontract",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "supercontract",
          "to": "adhesive",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "A ladder: molecular structure underlies mechanical performance, which underlies the adhesive and ecological uses."
    },
    {
      "id": "inside-synthesis",
      "title": "From natural gland to artificial fibre",
      "height": 760,
      "items": [
        {
          "kind": "node",
          "id": "gland",
          "shape": "box",
          "x": 260,
          "y": 40,
          "w": 240,
          "h": 80,
          "text": "Gland concentrates, aligns, acidifies protein",
          "size": "sm",
          "block": "spya-hdw7yd"
        },
        {
          "kind": "node",
          "id": "spinneret",
          "shape": "box",
          "x": 260,
          "y": 160,
          "w": 240,
          "h": 70,
          "text": "One spider, hundreds of specialised glands",
          "size": "sm",
          "block": "spya-zrcs7h"
        },
        {
          "kind": "node",
          "id": "feedstock",
          "shape": "box",
          "x": 60,
          "y": 290,
          "w": 220,
          "h": 80,
          "text": "Feedstock: proteins from E. coli, silkworms, goats",
          "size": "sm",
          "block": "spya-rw0wtg"
        },
        {
          "kind": "node",
          "id": "geometry",
          "shape": "box",
          "x": 320,
          "y": 290,
          "w": 220,
          "h": 80,
          "text": "Geometry: syringes, microfluidics, electrospinning",
          "size": "sm",
          "block": "spya-x4bwhf"
        },
        {
          "kind": "node",
          "id": "shapes",
          "shape": "box",
          "x": 560,
          "y": 290,
          "w": 160,
          "h": 80,
          "text": "Other shapes: capsules, nanomembranes",
          "size": "xs",
          "block": "spya-r4r9au"
        },
        {
          "kind": "node",
          "id": "synth",
          "shape": "box",
          "x": 260,
          "y": 420,
          "w": 240,
          "h": 80,
          "text": "Synthetic silk still thicker, weaker than natural",
          "size": "sm",
          "block": "spya-j7hems"
        },
        {
          "kind": "node",
          "id": "research2",
          "shape": "note",
          "x": 260,
          "y": 550,
          "w": 240,
          "h": 80,
          "text": "Decades of research track this chase",
          "size": "sm",
          "sub": "chemistry to native spinning",
          "block": "spya-jvxbb8"
        },
        {
          "kind": "node",
          "id": "humanuse2",
          "shape": "box",
          "x": 260,
          "y": 670,
          "w": 240,
          "h": 70,
          "text": "Applied in textiles, medicine, optics",
          "size": "sm",
          "block": "spya-chy97m"
        },
        {
          "kind": "edge",
          "from": "gland",
          "to": "spinneret",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "spinneret",
          "to": "feedstock",
          "via": "elbow",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "spinneret",
          "to": "geometry",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "spinneret",
          "to": "shapes",
          "via": "elbow",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "feedstock",
          "to": "synth",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "geometry",
          "to": "synth",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        },
        {
          "kind": "edge",
          "from": "synth",
          "to": "research2",
          "via": "straight",
          "line": "dashed",
          "arrow": "none"
        },
        {
          "kind": "edge",
          "from": "research2",
          "to": "humanuse2",
          "via": "straight",
          "line": "solid",
          "arrow": "end"
        }
      ],
      "caption": "A chain: the natural gland's process is the template that artificial synthesis tries, and fails, to fully match, with research history tracking the chase."
    }
  ]
}
```
