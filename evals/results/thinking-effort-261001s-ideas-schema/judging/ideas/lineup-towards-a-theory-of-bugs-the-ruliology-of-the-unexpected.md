# 4 candidates for "Towards a Theory of Bugs: The Ruliology of the Unexpected"

Each candidate is the ideas a reader needs in order to get this article, each tied to the passages that carry it. They are labelled W, X, Y, Z in an order that
says nothing about how any of them was made. The article itself, with its block ids, is
`article-towards-a-theory-of-bugs-the-ruliology-of-the-unexpected.md` beside this file.

## Candidate W

```json
[
  {
    "id": "spya-bvt4y4",
    "name": "Toy rule systems are a valid model for real software bugs",
    "provenance": "assumed",
    "statement": "Findings about bugs in minimal systems like small Turing machines and cellular automata are treated as telling us something general and transferable about bugs in real, practical software.",
    "whyYouNeedIt": "Without accepting that tiny abstract rule systems stand in for real programs, the entire argument—built almost exclusively on Turing machine and cellular automaton examples—would only be a curiosity about toy models, not a 'theory of bugs' applicable to programming, security, or AI-generated code.",
    "occurrences": [
      {
        "blockId": "spya-sx0zyh",
        "quote": "the fundamental phenomenon of bugs already occurs even in very simple programs. And that means that we can use the methods and intuition of ruliology to study foundational questions about bugs",
        "reasoning": "Asserts without independent argument that insight from minimal systems generalizes to the foundational nature of bugs everywhere, which the rest of the piece simply presumes.",
        "start": 56,
        "blockText": "In a sense, the key to what we’ll do is to realize that the fundamental phenomenon of bugs already occurs even in very simple programs. And that means that we can use the methods and intuition of ruliology to study foundational questions about bugs."
      },
      {
        "blockId": "spya-dvfn87",
        "quote": "How does what we’ve seen about “bugs” in simple Turing machines generalize?",
        "reasoning": "The question itself takes for granted that the Turing machine results are a stepping stone meant to generalize, rather than being self-contained curiosities.",
        "start": 0,
        "blockText": "How does what we’ve seen about “bugs” in simple Turing machines generalize? As another example, let’s look at cellular automata. And in particular, let’s look at cellular automata that are set up to “double their input” in the sense that starting with a block of n (non-white) cells, they yield 2n (non-white) cells:"
      },
      {
        "blockId": "spya-r32r9j",
        "quote": "In traditional software, things can be even more complicated. Visualizing detailed telemetry from inside a running program can often be revealing.",
        "reasoning": "Moves from toy cellular automata directly to claims about ordinary software, relying on the reader already granting that the earlier toy analysis transfers.",
        "start": 0,
        "blockText": "In traditional software, things can be even more complicated. Visualizing detailed telemetry from inside a running program can often be revealing. But there tends to be no real way to “pull out parts of a program separately”—because there’s complicated shared state encoded in values of variables, etc. And this is one of the great strengths of the symbolic paradigm that’s so deeply embodied in the Wolfram Language. Because within this paradigm, even tiny fragments of programs can be run on their own, giving one at least the raw material to “see in detail what a program is doing”."
      },
      {
        "blockId": "spya-q7khj8",
        "quote": "ruliology is a field where “bugs” are the rule, not the exception",
        "reasoning": "Generalizes a claim about a narrow experimental practice (ruliology) into a universal statement about bugs, which only follows if ruliology is accepted as representative of computation and programs at large.",
        "start": 12,
        "blockText": "In a sense, ruliology is a field where “bugs” are the rule, not the exception. And in fact, the ubiquity of computational irreducibility in the computational universe make it essentially inevitable that it’ll be very common for there to be “surprises” that break our expectations, and that we might call “bugs”."
      }
    ]
  },
  {
    "id": "spya-sjqj9e",
    "name": "Visual simplicity is treated as proof of predictability",
    "provenance": "assumed",
    "statement": "When a pattern looks simple or obviously bounded to the eye, the piece treats that as grounds for confidence that the underlying process is truly reducible and bug-free, and treats visually complex-looking patterns as suspect.",
    "whyYouNeedIt": "The claims that certain cellular automata 'obviously' have no bugs, or that others 'look' dangerous, only make sense if a reader accepts that human visual perception of a spacetime pattern reliably tracks the actual mathematical property of computational reducibility—a link the piece uses constantly but never justifies, and even complicates with the rule-122 counterexample.",
    "occurrences": [
      {
        "blockId": "spya-qm284b",
        "quote": "Many of the cellular automata we saw above give patterns that are simple enough that it’s “visually obvious” that they’ll “correctly double” for all input sizes",
        "reasoning": "Treats visual obviousness itself as sufficient grounds for a guarantee about infinite behavior, without further argument.",
        "start": 0,
        "blockText": "Many of the cellular automata we saw above give patterns that are simple enough that it’s “visually obvious” that they’ll “correctly double” for all input sizes:"
      },
      {
        "blockId": "spya-fg7dg2",
        "quote": "If the behavior of a cellular automaton is “visually simple”, we can immediately tell that it won’t show bugs. And if it’s visually complicated we can be concerned that there might be bugs.",
        "reasoning": "States the heuristic link between visual appearance and bug-freeness as though it were self-evidently reliable.",
        "start": 0,
        "blockText": "If the behavior of a cellular automaton is “visually simple”, we can immediately tell that it won’t show bugs. And if it’s visually complicated we can be concerned that there might be bugs. But there are still cases where—despite that complexity—the feature of behavior that we are concerned about (here, the successful doubling of any input) still always reliably happens, without any bugs."
      },
      {
        "blockId": "spya-asw9eq",
        "quote": "It looks awfully similar to the cases we saw above that eventually show bugs.",
        "reasoning": "Uses visual resemblance to prior buggy cases as evidence of likely bugginess, presuming appearance tracks underlying computational behavior.",
        "start": 0,
        "blockText": "It looks awfully similar to the cases we saw above that eventually show bugs. But if we run this case up to n = 100000, no bugs appear. We can get a little more analytical, and plot the number of steps it takes for the pattern to stabilize as a function of n:"
      }
    ]
  },
  {
    "id": "spya-rdfu25",
    "name": "Irreducibility is the root cause of bugs",
    "provenance": "introduced",
    "statement": "Bugs ultimately arise because a program's actual step-by-step computation can be irreducibly complex, so there is no shortcut to knowing what it will do short of running it.",
    "occurrences": [
      {
        "blockId": "spya-b9z7g9",
        "quote": "And the result is that such programs can exhibit computational irreducibility—which means that they will inevitably be able to do things we can’t foresee and don’t expect, and that we will consider to be bugs.",
        "reasoning": "States directly that unforeseen behavior (bugs) is explained by irreducibility.",
        "start": 236,
        "blockText": "But a big surprise—captured by my Principle of Computational Equivalence—is that even programs (or fragments of them) that are very simple in their structure can end up doing computation that is in a sense as sophisticated as anything. And the result is that such programs can exhibit computational irreducibility—which means that they will inevitably be able to do things we can’t foresee and don’t expect, and that we will consider to be bugs."
      },
      {
        "blockId": "spya-z3ryqd",
        "quote": "Ultimately it’s computational irreducibility—and our inability to know in general what a program will do except in effect by explicitly running it.",
        "reasoning": "Names irreducibility as the ultimate source of the 'unexpected' behavior the whole piece is about.",
        "start": 0,
        "blockText": "Ultimately it’s computational irreducibility—and our inability to know in general what a program will do except in effect by explicitly running it. And what’s critical is that computational irreducibility is not just something that’s in principle possible; it’s something that (according to the Principle of Computational Equivalence) is at some level ubiquitous—and affects essentially any system whose behavior is not obviously simple."
      },
      {
        "blockId": "spya-s247px",
        "quote": "When computational irreducibility is present, it means that the behavior of a system can in general only be predicted by an irreducible amount of computational work.",
        "reasoning": "Spells out the mechanism by which bugs become unavoidable with bounded effort.",
        "start": 0,
        "blockText": "When computational irreducibility is present, it means that the behavior of a system can in general only be predicted by an irreducible amount of computational work. So that means that with a bounded amount of computational work it’s always possible for the system to surprise us—and in particular for the system to unexpectedly exhibit what we consider to be a bug."
      },
      {
        "blockId": "spya-gj554s",
        "quote": "And when there’s computational irreducibility nothing short of explicitly running a computation will determine what will happen.",
        "reasoning": "Makes explicit why no amount of foresight or automated checking can eliminate bugs in general.",
        "start": 336,
        "blockText": "But even if we humans can’t do it unaided, can we expect to build automated systems—with AI or otherwise—that can root out such bugs? There are—as we’ll discuss—necessarily “pockets of computational reducibility” in which we can expect to make progress. But the key point is that “lurking at the edges” is computational irreducibility. And when there’s computational irreducibility nothing short of explicitly running a computation will determine what will happen. And that means that unless we’ve already run our program in a particular case, we won’t be able to know for sure what it will do. And when it does things we don’t want, we’ll call those things “bugs”."
      }
    ]
  },
  {
    "id": "spya-echwhm",
    "name": "Simple rules can produce arbitrarily sophisticated behavior",
    "provenance": "introduced",
    "statement": "According to the Principle of Computational Equivalence, programs with very simple structure can still carry out computation as sophisticated as any other process, and once a system can do one unforeseeable thing it tends to be full of them.",
    "occurrences": [
      {
        "blockId": "spya-b9z7g9",
        "quote": "even programs (or fragments of them) that are very simple in their structure can end up doing computation that is in a sense as sophisticated as anything",
        "reasoning": "States the principle that simplicity of description does not limit richness of behavior.",
        "start": 81,
        "blockText": "But a big surprise—captured by my Principle of Computational Equivalence—is that even programs (or fragments of them) that are very simple in their structure can end up doing computation that is in a sense as sophisticated as anything. And the result is that such programs can exhibit computational irreducibility—which means that they will inevitably be able to do things we can’t foresee and don’t expect, and that we will consider to be bugs."
      },
      {
        "blockId": "spya-z3ryqd",
        "quote": "computational irreducibility is not just something that’s in principle possible; it’s something that (according to the Principle of Computational Equivalence) is at some level ubiquitous",
        "reasoning": "Generalizes the principle to explain why irreducibility is common rather than rare.",
        "start": 176,
        "blockText": "Ultimately it’s computational irreducibility—and our inability to know in general what a program will do except in effect by explicitly running it. And what’s critical is that computational irreducibility is not just something that’s in principle possible; it’s something that (according to the Principle of Computational Equivalence) is at some level ubiquitous—and affects essentially any system whose behavior is not obviously simple."
      },
      {
        "blockId": "spya-nd4kn9",
        "quote": "once there’s anything you can’t foresee, there tends to be a lot you can’t foresee",
        "reasoning": "Draws out the consequence that a little unpredictability implies pervasive unpredictability, which is why minimal bugs point to deep irreducibility.",
        "start": 573,
        "blockText": "But, one might ask, why not just use programs that don’t have these problems? Programs where you can foresee their behavior, and be sure they have no bugs. Well, here’s the issue: if you can completely foresee what a program will do, what’s the point of running it? Why not, in effect, just immediately “write down the answer”, without ever having to run the program? In other words, to make the program worth actually running, there have to be parts of its behavior you can’t foresee. But then there’s a piece of intuition from the Principle of Computational Equivalence: once there’s anything you can’t foresee, there tends to be a lot you can’t foresee. In other words, the system will tend to be full of computational irreducibility."
      }
    ]
  },
  {
    "id": "spya-bss7rb",
    "name": "Irreducibility always leaves pockets of reducibility",
    "provenance": "introduced",
    "statement": "Even in a system riddled with computational irreducibility, there are always some specific facts or properties that remain predictable in advance, and proofs work by exploiting exactly these pockets.",
    "occurrences": [
      {
        "blockId": "spya-gj554s",
        "quote": "There are—as we’ll discuss—necessarily “pockets of computational reducibility” in which we can expect to make progress.",
        "reasoning": "States that reducible pockets necessarily exist alongside irreducibility, which licenses hope for partial guarantees.",
        "start": 134,
        "blockText": "But even if we humans can’t do it unaided, can we expect to build automated systems—with AI or otherwise—that can root out such bugs? There are—as we’ll discuss—necessarily “pockets of computational reducibility” in which we can expect to make progress. But the key point is that “lurking at the edges” is computational irreducibility. And when there’s computational irreducibility nothing short of explicitly running a computation will determine what will happen. And that means that unless we’ve already run our program in a particular case, we won’t be able to know for sure what it will do. And when it does things we don’t want, we’ll call those things “bugs”."
      },
      {
        "blockId": "spya-y9hee0",
        "quote": "One important feature of computational irreducibility is that whenever it’s present, there must also be pockets of computational reducibility present.",
        "reasoning": "Generalizes the claim as a structural feature of any irreducible system.",
        "start": 203,
        "blockText": "Maybe it’s OK for a program to do wild things—so long as it satisfies at least some property (like not going into an infinite loop). Maybe there’s some particular property one wants the program to have. One important feature of computational irreducibility is that whenever it’s present, there must also be pockets of computational reducibility present. In other words, even though computational irreducibility says one can’t predict everything about what a system will do, there will always be certain things about a system that one will be able to predict. And if among those things there are ones that align with the properties one wants, then one may be able to know that the system will “exhibit no bugs”, at least with respect to these properties."
      },
      {
        "blockId": "spya-zz4up4",
        "quote": "One can think of proofs as taking advantage of pockets of computational reducibility, to provide finite summaries of infinite things.",
        "reasoning": "Connects the existence of reducible pockets directly to the possibility of finite correctness proofs.",
        "start": 239,
        "blockText": "We saw above in the case of some simple Turing machines how symbolic proofs can be constructed so that certain programs do certain things, and thus don’t have certain kinds of bugs. So how does this relate to computational irreducibility? One can think of proofs as taking advantage of pockets of computational reducibility, to provide finite summaries of infinite things. But there’s no (static) finite summary that can be given of everything a computationally irreducible system does. And proofs about a computationally irreducible process will inevitably get longer and longer as one tries to talk about more and more steps in the process."
      }
    ]
  },
  {
    "id": "spya-j8patn",
    "name": "A bug only exists relative to a chosen specification",
    "provenance": "introduced",
    "statement": "Whether a behavior counts as a bug depends entirely on some separate, simpler statement of what the program should do; against the program's own actual behavior there is no such thing as a bug.",
    "occurrences": [
      {
        "blockId": "spya-mhwnwh",
        "quote": "To tell if a program has a bug we have to know what the program is supposed to do—or is not supposed to do. And for this we have to have some kind of precise specification.",
        "reasoning": "Explicitly makes bugs dependent on an external specification rather than an intrinsic property.",
        "start": 0,
        "blockText": "To tell if a program has a bug we have to know what the program is supposed to do—or is not supposed to do. And for this we have to have some kind of precise specification. Of course the program itself provides a specification for what it will do. And with respect to this specification the program will always just “do what it does”, with no possibility of “having a bug”. But typically we imagine specifications that aren’t just the program itself, but instead have some easier-to-absorb form (e.g. the simple mathematical formula “n + 1” from the previous section). And it’s relative to specifications like these that programs can have bugs."
      },
      {
        "blockId": "spya-tzs7f4",
        "quote": "There are several different types of specifications that end up being used.",
        "reasoning": "Introduces the idea that multiple kinds of specifications (restatement, negative constraints, parity, equivalence) can each define what a bug is.",
        "start": 0,
        "blockText": "There are several different types of specifications that end up being used. The most direct essentially just restate the program in a different—and normally higher-level—language (say Wolfram Language vs. C++, or math notation vs. Turing machine rules). A more minimal version of this is just restating the program as a different program of the same type. Then one considers it a bug if the two programs don’t do the same thing. (For example, if a compiler optimizer changes what a program does, then it’s a bug.)"
      },
      {
        "blockId": "spya-rt2gb2",
        "quote": "Another general type of specification is one that says not what a program should do, but rather what it should not.",
        "reasoning": "Shows a specification can be a negative constraint, reinforcing that 'bug' is defined by whatever specification is chosen.",
        "start": 0,
        "blockText": "Another general type of specification is one that says not what a program should do, but rather what it should not. So, for example, with our Turing machines we could specify that we never want them to “go out of control” and start using unbounded amounts of memory (i.e. tape). Here’s an example of a Turing machine that seems like it’s just happily computing outputs:"
      },
      {
        "blockId": "spya-uj4rfn",
        "quote": "we set up a specification, and some Turing machines will precisely follow it. But we always seem to also find ones that appear to be following it—at least until they “have a bug”",
        "reasoning": "Shows the pattern recurring across different chosen specifications, confirming bugs are always relative to whichever one is picked.",
        "start": 42,
        "blockText": "And it always seems to be the same story: we set up a specification, and some Turing machines will precisely follow it. But we always seem to also find ones that appear to be following it—at least until they “have a bug”. In other words, it seems as if, whatever constraint we give, there’ll somehow always be machines that will insidiously escape it—in effect “having an insidious bug”."
      }
    ]
  },
  {
    "id": "spya-m984qy",
    "name": "Proving correctness and brute-force testing are equally hard",
    "provenance": "introduced",
    "statement": "Searching for a formal proof of a program's correctness and just running the program over more and more cases are two routes to the same underlying computational effort; if the claim is false (the program is buggy) no proof exists no matter how long one searches.",
    "occurrences": [
      {
        "blockId": "spya-vs44ga",
        "quote": "because, in fact, the result we’re trying to prove isn’t true, so there isn’t a proof. And we know that because, if we test sufficiently many cases of the Turing machine, we can explicitly find the bug.",
        "reasoning": "States explicitly that a buggy machine has no proof, and that this is confirmed only by direct testing, not by analysis of the proof search.",
        "start": 0,
        "blockText": "because, in fact, the result we’re trying to prove isn’t true, so there isn’t a proof. And we know that because, if we test sufficiently many cases of the Turing machine, we can explicitly find the bug."
      },
      {
        "blockId": "spya-ymdpn2",
        "quote": "we don’t get any fundamental advantage by trying to make a proof rather than just running the Turing machine. In both cases we have to expend a potentially unbounded amount of computational effort.",
        "reasoning": "Directly equates proof-search effort with brute-force simulation effort.",
        "start": 16,
        "blockText": "And in the end, we don’t get any fundamental advantage by trying to make a proof rather than just running the Turing machine. In both cases we have to expend a potentially unbounded amount of computational effort. It’s just a choice between putting that effort rather directly into enumerating and running cases of the Turing machine, or instead putting the effort into building up the multiway graph to try and find a proof in it."
      },
      {
        "blockId": "spya-zz4up4",
        "quote": "there’s no (static) finite summary that can be given of everything a computationally irreducible system does. And proofs about a computationally irreducible process will inevitably get longer and longer",
        "reasoning": "Explains why proofs cannot shortcut irreducibility: they must grow without bound just as direct computation would.",
        "start": 377,
        "blockText": "We saw above in the case of some simple Turing machines how symbolic proofs can be constructed so that certain programs do certain things, and thus don’t have certain kinds of bugs. So how does this relate to computational irreducibility? One can think of proofs as taking advantage of pockets of computational reducibility, to provide finite summaries of infinite things. But there’s no (static) finite summary that can be given of everything a computationally irreducible system does. And proofs about a computationally irreducible process will inevitably get longer and longer as one tries to talk about more and more steps in the process."
      }
    ]
  },
  {
    "id": "spya-xvk2wf",
    "name": "Full predictability would make running the program pointless",
    "provenance": "introduced",
    "statement": "If a program's output could be completely foreseen without running it, there would be no reason to run it; so any program worth executing must have some unforeseeable behavior, which is exactly what can show up as a bug.",
    "occurrences": [
      {
        "blockId": "spya-nd4kn9",
        "quote": "if you can completely foresee what a program will do, what’s the point of running it? Why not, in effect, just immediately “write down the answer”, without ever having to run the program?",
        "reasoning": "States the tradeoff directly: usefulness requires unforeseeability, and unforeseeability is the seed of bugs.",
        "start": 180,
        "blockText": "But, one might ask, why not just use programs that don’t have these problems? Programs where you can foresee their behavior, and be sure they have no bugs. Well, here’s the issue: if you can completely foresee what a program will do, what’s the point of running it? Why not, in effect, just immediately “write down the answer”, without ever having to run the program? In other words, to make the program worth actually running, there have to be parts of its behavior you can’t foresee. But then there’s a piece of intuition from the Principle of Computational Equivalence: once there’s anything you can’t foresee, there tends to be a lot you can’t foresee. In other words, the system will tend to be full of computational irreducibility."
      },
      {
        "blockId": "spya-uj0h88",
        "quote": "Computational irreducibility is in a sense what makes computation powerful. But it’s also what makes it unpredictable.",
        "reasoning": "Names the dual nature of irreducibility as both the source of a program's power and of its bug-proneness.",
        "start": 0,
        "blockText": "Computational irreducibility is in a sense what makes computation powerful. But it’s also what makes it unpredictable. And in practice—intentionally or not—it’s very common for programs to have what amounts to a “spark of computational irreducibility inside” that’s somehow kept controlled enough to do what one wants."
      },
      {
        "blockId": "spya-xdwm97",
        "quote": "if our program is written at a lower level, say as a Turing machine, then we can expect (as we saw above) that allowing some bugs can allow the program to be shorter",
        "reasoning": "Shows the tradeoff operating concretely: tolerating bugs buys shorter, more 'raw' programs.",
        "start": 226,
        "blockText": "But what if we were to allow some bugs? If our program is written in a language whose primitives are a good fit to what we want to compute, then allowing bugs is not likely, for example, to let the program be any shorter. But if our program is written at a lower level, say as a Turing machine, then we can expect (as we saw above) that allowing some bugs can allow the program to be shorter. In such a case we can think of ourselves as trying to “harness raw computation”, and it’ll tend be easier to find a “lump of computation” that approximately fits what we’re trying to do than one that exactly does."
      }
    ]
  },
  {
    "id": "spya-mt5apk",
    "name": "Scientific induction only works inside reducible pockets",
    "provenance": "introduced",
    "statement": "Inferring a general law from many observed cases is reliable only where the underlying process has reducible regularities to find; where computational irreducibility dominates, more testing cannot guarantee the pattern will continue to hold.",
    "occurrences": [
      {
        "blockId": "spya-ue5uq4",
        "quote": "Scientific induction is a cornerstone of natural science. You see something in the world happen a certain way enough times, and you assume it’ll always happen that way",
        "reasoning": "States the inductive method whose reliability the rest of the section questions.",
        "start": 0,
        "blockText": "Scientific induction is a cornerstone of natural science. You see something in the world happen a certain way enough times, and you assume it’ll always happen that way (and that there’s a “scientific law” about it). But what about in ruliology? Can we apply scientific induction there? You test a lot of Turing machines. You observe a certain pattern of behavior. Will the pattern always be there? Scientific induction would say yes. But if there’s a “bug” it won’t be. And the point is that in ruliology—courtesy of computational irreducibility—there’s always the potential for surprises, and for “bugs” that violate whatever laws we might have inferred."
      },
      {
        "blockId": "spya-ym6u26",
        "quote": "We look for computationally reducible regularities that we can “summarize” with our scientific laws and our narratives.",
        "reasoning": "Explains why induction succeeds when it does: it is only ever capturing the reducible part of a system.",
        "start": 689,
        "blockText": "Particularly given that from what we know now, it seems that what’s underneath is so computational, one might wonder why scientific induction would ever have worked in the first place. The answer has to do with the fundamental nature of natural science and scientific laws. At some level what science is trying to do is to take what happens in the world, and explain at least certain aspects of it with “narratives” that our minds can grasp. And the point is that such narratives—almost by definition—rely on pockets of computational reducibility. What’s underneath may involve all sorts of computational irreducibility. But that’s not what we concentrate on when we want to “do science”. We look for computationally reducible regularities that we can “summarize” with our scientific laws and our narratives."
      },
      {
        "blockId": "spya-ajc2n8",
        "quote": "Physics has been a big success story. Biology not.",
        "reasoning": "Illustrates the claim with a contrast between a reducible domain and an irreducible one, showing induction's success is domain-dependent.",
        "start": 61,
        "blockText": "Realistically, this works better in some places than others. Physics has been a big success story. Biology not. In our Physics Project we can see that there’s lots of computational irreducibility. It’s just that the physical laws relevant for observers like us manage to largely avoid it. In biology there’s again computational irreducibility—indeed it seems to be essential for life to be able to do what it does. And now if we want to “look inside”—and for example do medicine—we’re forced to confront computational irreducibility. Which shows up as ubiquitous failures of reproducibility in our experiments, and, in effect, a failure of scientific induction. (One can try to save scientific induction by talking about probabilities not certainties, but eventually one always has to confront computational irreducibility.)"
      }
    ]
  },
  {
    "id": "spya-zasr0y",
    "name": "Good language design hides irreducibility inside primitives",
    "provenance": "introduced",
    "statement": "A well-designed programming language packages the bulk of unpredictable, irreducible computation into its built-in primitives, leaving the part the programmer actually writes small and aligned with human intention, which is why short programs in such a language tend to be bug-free.",
    "occurrences": [
      {
        "blockId": "spya-wx09gt",
        "quote": "What a well-designed language does is to provide as primitives lumps of computational work that are things humans typically actually want.",
        "reasoning": "States the core design principle that is supposed to reduce bugs.",
        "start": 170,
        "blockText": "There are an infinite number of programs one can write. Each will do something. But with overwhelming probability the things they do will not be anything we humans want. What a well-designed language does is to provide as primitives lumps of computational work that are things humans typically actually want. They define, in a sense, a framework for the successful computational formalization of human thought."
      },
      {
        "blockId": "spya-x8ag2t",
        "quote": "most of the computational irreducibility has been packed into the primitives of the language, so that what’s left over is the part that’s accessible to us humans",
        "reasoning": "Explicitly frames language primitives as a container for irreducibility, leaving a human-tractable residue.",
        "start": 197,
        "blockText": "And indeed in Wolfram Language it’s possible to express what are ultimately remarkably complex tasks with remarkably small, simple and “understandable” programs. In effect, what’s happened is that most of the computational irreducibility has been packed into the primitives of the language, so that what’s left over is the part that’s accessible to us humans, and that maps into our natural patterns of thinking."
      },
      {
        "blockId": "spya-s0e3qm",
        "quote": "in Wolfram Language it’s the short program that’s the one that does what you want, without what you consider bugs",
        "reasoning": "Draws the practical consequence: shortness in such a language correlates with correctness, because irreducibility has already been absorbed elsewhere.",
        "start": 34,
        "blockText": "I’ve seen it over and over again: in Wolfram Language it’s the short program that’s the one that does what you want, without what you consider bugs. If there’s extra complexity in the program, it’ll probably introduce what you’ll consider bugs. In other words, in the space of all possible programs, the ones we as humans tend to want are those that can be expressed as short programs in Wolfram Language."
      }
    ]
  }
]
```

## Candidate X

```json
[
  {
    "id": "spya-uy90sa",
    "name": "A test suite only samples a pocket, never the whole behavior space",
    "provenance": "assumed",
    "statement": "Running a program on some finite collection of test inputs, however large, can only ever sample a limited region of its possible behavior, and a region that looks uniform from inside can still conceal rare exceptions just outside it.",
    "whyYouNeedIt": "Without this assumption, the detailed discussion of random sampling, fuzzing, and 'how many cases is enough' wouldn't make sense as a genuine open problem rather than something solvable by just testing more.",
    "occurrences": [
      {
        "blockId": "spya-vy3nfe",
        "quote": "How do we know if we’re “stuck in a pocket of reducibility”, or are actually seeing the whole “spectrum of behavior”, bugs and all?",
        "reasoning": "The question only has bite if one assumes any finite sample is inherently partial and possibly unrepresentative.",
        "start": 90,
        "blockText": "OK, but so let’s say we’re trying to test a program by looking at lots of specific cases. How do we know if we’re “stuck in a pocket of reducibility”, or are actually seeing the whole “spectrum of behavior”, bugs and all? A typical approach in practice is to randomly sample possible inputs (or to introduce random “fuzz” around known inputs). Will this work? Well, it depends on “how good” the “randomness” is, and what the distribution—and density—of bugs is."
      },
      {
        "blockId": "spya-utamf4",
        "quote": "even if the sampling doesn’t “systematically avoid” bugs, it might just not hit them, because the bugs exist only in some “special corner” of possible inputs.",
        "reasoning": "Depends on treating any particular sampling method as inherently limited in coverage.",
        "start": 11,
        "blockText": "Of course, even if the sampling doesn’t “systematically avoid” bugs, it might just not hit them, because the bugs exist only in some “special corner” of possible inputs. But if the randomness is “computationally strong enough” there won’t be any “special corners” that can “hide” from it."
      }
    ]
  },
  {
    "id": "spya-vem7s0",
    "name": "Computational irreducibility forces running to know outcomes",
    "provenance": "introduced",
    "statement": "For many simple-looking systems, the only way to know what they will do on a given input is to actually run them step by step; no shortcut calculation can predict the outcome in general.",
    "whyYouNeedIt": "This is the mechanism that explains why bugs can appear at arbitrarily late inputs with no warning in the earlier behavior.",
    "occurrences": [
      {
        "blockId": "spya-b9z7g9",
        "quote": "such programs can exhibit computational irreducibility—which means that they will inevitably be able to do things we can’t foresee and don’t expect, and that we will consider to be bugs.",
        "reasoning": "States the core mechanism directly.",
        "start": 259,
        "blockText": "But a big surprise—captured by my Principle of Computational Equivalence—is that even programs (or fragments of them) that are very simple in their structure can end up doing computation that is in a sense as sophisticated as anything. And the result is that such programs can exhibit computational irreducibility—which means that they will inevitably be able to do things we can’t foresee and don’t expect, and that we will consider to be bugs."
      },
      {
        "blockId": "spya-gj554s",
        "quote": "when there’s computational irreducibility nothing short of explicitly running a computation will determine what will happen.",
        "reasoning": "Explicit statement of the idea.",
        "start": 340,
        "blockText": "But even if we humans can’t do it unaided, can we expect to build automated systems—with AI or otherwise—that can root out such bugs? There are—as we’ll discuss—necessarily “pockets of computational reducibility” in which we can expect to make progress. But the key point is that “lurking at the edges” is computational irreducibility. And when there’s computational irreducibility nothing short of explicitly running a computation will determine what will happen. And that means that unless we’ve already run our program in a particular case, we won’t be able to know for sure what it will do. And when it does things we don’t want, we’ll call those things “bugs”."
      }
    ]
  },
  {
    "id": "spya-s4euma",
    "name": "Bugs are relative to a chosen specification",
    "provenance": "introduced",
    "statement": "A program cannot be a 'bug' relative to itself; something only counts as a bug when measured against some separate, simpler description of what it should do.",
    "whyYouNeedIt": "Without this framing, the many different kinds of examples (matching a formula, not blowing up memory, always outputting even numbers) wouldn't cohere as the same phenomenon.",
    "occurrences": [
      {
        "blockId": "spya-mhwnwh",
        "quote": "the program itself provides a specification for what it will do. And with respect to this specification the program will always just “do what it does”, with no possibility of “having a bug”.",
        "reasoning": "States the relativity of bugs to specification.",
        "start": 183,
        "blockText": "To tell if a program has a bug we have to know what the program is supposed to do—or is not supposed to do. And for this we have to have some kind of precise specification. Of course the program itself provides a specification for what it will do. And with respect to this specification the program will always just “do what it does”, with no possibility of “having a bug”. But typically we imagine specifications that aren’t just the program itself, but instead have some easier-to-absorb form (e.g. the simple mathematical formula “n + 1” from the previous section). And it’s relative to specifications like these that programs can have bugs."
      },
      {
        "blockId": "spya-tzs7f4",
        "quote": "There are several different types of specifications that end up being used.",
        "reasoning": "Frames subsequent examples as variations on specification type.",
        "start": 0,
        "blockText": "There are several different types of specifications that end up being used. The most direct essentially just restate the program in a different—and normally higher-level—language (say Wolfram Language vs. C++, or math notation vs. Turing machine rules). A more minimal version of this is just restating the program as a different program of the same type. Then one considers it a bug if the two programs don’t do the same thing. (For example, if a compiler optimizer changes what a program does, then it’s a bug.)"
      }
    ]
  },
  {
    "id": "spya-vmnnp8",
    "name": "Pockets of reducibility amid general irreducibility",
    "provenance": "introduced",
    "statement": "Even inside a system that is mostly computationally irreducible, there can be specific, limited facts or properties that remain predictable and provable.",
    "whyYouNeedIt": "This explains why some bug-free proofs (like the n+1 Turing machine proof, or the cellular automaton doubling proof) are possible at all despite irreducibility being ubiquitous.",
    "occurrences": [
      {
        "blockId": "spya-y9hee0",
        "quote": "whenever it’s present, there must also be pockets of computational reducibility present. In other words, even though computational irreducibility says one can’t predict everything about what a system will do, there will always be certain things about a system that one will be able to predict.",
        "reasoning": "Directly introduces the concept.",
        "start": 265,
        "blockText": "Maybe it’s OK for a program to do wild things—so long as it satisfies at least some property (like not going into an infinite loop). Maybe there’s some particular property one wants the program to have. One important feature of computational irreducibility is that whenever it’s present, there must also be pockets of computational reducibility present. In other words, even though computational irreducibility says one can’t predict everything about what a system will do, there will always be certain things about a system that one will be able to predict. And if among those things there are ones that align with the properties one wants, then one may be able to know that the system will “exhibit no bugs”, at least with respect to these properties."
      },
      {
        "blockId": "spya-fg7dg2",
        "quote": "there are still cases where—despite that complexity—the feature of behavior that we are concerned about (here, the successful doubling of any input) still always reliably happens, without any bugs.",
        "reasoning": "Shows a concrete pocket of reducibility being found.",
        "start": 194,
        "blockText": "If the behavior of a cellular automaton is “visually simple”, we can immediately tell that it won’t show bugs. And if it’s visually complicated we can be concerned that there might be bugs. But there are still cases where—despite that complexity—the feature of behavior that we are concerned about (here, the successful doubling of any input) still always reliably happens, without any bugs."
      }
    ]
  },
  {
    "id": "spya-c2pek9",
    "name": "Failure to find a proof can itself mean the claim is false",
    "provenance": "introduced",
    "statement": "When searching a space of possible proof steps turns up no path to the desired theorem, that can be because the statement is actually false (i.e. the program has a bug), not just because the search wasn't thorough enough.",
    "whyYouNeedIt": "This connects the multiway-graph proof-search procedure to the earlier bug examples, showing that proving and bug-hunting are the same kind of search.",
    "occurrences": [
      {
        "blockId": "spya-zkkrs3",
        "quote": "But now—however far we go—we never find a proof",
        "reasoning": "Shows the search failing.",
        "start": 0,
        "blockText": "But now—however far we go—we never find a proof"
      },
      {
        "blockId": "spya-vs44ga",
        "quote": "because, in fact, the result we’re trying to prove isn’t true, so there isn’t a proof. And we know that because, if we test sufficiently many cases of the Turing machine, we can explicitly find the bug.",
        "reasoning": "Explains why the search fails for a buggy machine.",
        "start": 0,
        "blockText": "because, in fact, the result we’re trying to prove isn’t true, so there isn’t a proof. And we know that because, if we test sufficiently many cases of the Turing machine, we can explicitly find the bug."
      }
    ]
  },
  {
    "id": "spya-qm9xcd",
    "name": "Full predictability makes running a program pointless",
    "provenance": "introduced",
    "statement": "If you could completely foresee everything a program would do, there would be no reason to actually execute it—you could just write down the answer directly.",
    "whyYouNeedIt": "This justifies why useful programs must contain unpredictable, irreducible behavior, which is the root cause of bugs.",
    "occurrences": [
      {
        "blockId": "spya-nd4kn9",
        "quote": "if you can completely foresee what a program will do, what’s the point of running it? Why not, in effect, just immediately “write down the answer”, without ever having to run the program?",
        "reasoning": "States the paradox directly.",
        "start": 180,
        "blockText": "But, one might ask, why not just use programs that don’t have these problems? Programs where you can foresee their behavior, and be sure they have no bugs. Well, here’s the issue: if you can completely foresee what a program will do, what’s the point of running it? Why not, in effect, just immediately “write down the answer”, without ever having to run the program? In other words, to make the program worth actually running, there have to be parts of its behavior you can’t foresee. But then there’s a piece of intuition from the Principle of Computational Equivalence: once there’s anything you can’t foresee, there tends to be a lot you can’t foresee. In other words, the system will tend to be full of computational irreducibility."
      },
      {
        "blockId": "spya-uqhm5n",
        "quote": "if you can really understand everything your program can do that basically means the program is doing something computationally reducible, and you probably in the end didn’t actually need to run the program",
        "reasoning": "Restates the same tradeoff in the practice section.",
        "start": 254,
        "blockText": "So let’s say you want to create a program that doesn’t have bugs. How should you do it? Fundamentally the only way to make sure a program will always do what you want is to understand everything it can do. But there’s a kind of paradox implicit in that: if you can really understand everything your program can do that basically means the program is doing something computationally reducible, and you probably in the end didn’t actually need to run the program with all its steps to get the result you wanted."
      }
    ]
  },
  {
    "id": "spya-tz0w9j",
    "name": "Scientific induction depends on hidden pockets of reducibility",
    "provenance": "introduced",
    "statement": "Inferring a general law from repeated observations only works because the regularity you're tracking happens to come from a reducible part of the underlying process; where the process is genuinely irreducible, such induction will eventually be contradicted by a counterexample.",
    "whyYouNeedIt": "This explains why physics mostly succeeds with scientific laws while biology, medicine, and ruliology keep producing exceptions and failures of reproducibility.",
    "occurrences": [
      {
        "blockId": "spya-ym6u26",
        "quote": "such narratives—almost by definition—rely on pockets of computational reducibility. What’s underneath may involve all sorts of computational irreducibility. But that’s not what we concentrate on when we want to “do science”.",
        "reasoning": "States the mechanism behind why induction sometimes works.",
        "start": 464,
        "blockText": "Particularly given that from what we know now, it seems that what’s underneath is so computational, one might wonder why scientific induction would ever have worked in the first place. The answer has to do with the fundamental nature of natural science and scientific laws. At some level what science is trying to do is to take what happens in the world, and explain at least certain aspects of it with “narratives” that our minds can grasp. And the point is that such narratives—almost by definition—rely on pockets of computational reducibility. What’s underneath may involve all sorts of computational irreducibility. But that’s not what we concentrate on when we want to “do science”. We look for computationally reducible regularities that we can “summarize” with our scientific laws and our narratives."
      }
    ]
  },
  {
    "id": "spya-nf82nv",
    "name": "Mathematics avoids ruliology's bugs by staying at human scale",
    "provenance": "introduced",
    "statement": "Mainstream pure mathematics mostly sidesteps the endless surprises of computational irreducibility because mathematicians deliberately choose questions and structures that are tractable for human understanding, rather than sampling the full space of possible formal systems.",
    "whyYouNeedIt": "This explains the contrast between the rarity of surprising counterexamples in mainstream math versus their ubiquity in ruliology and in exhaustive number-theoretic searches.",
    "occurrences": [
      {
        "blockId": "spya-whd6dc",
        "quote": "pure mathematics as it’s normally practiced tends to concentrate on what amount to more “human-level” questions, that in effect exist in pockets of computational reducibility, that avoid the generic computational irreducibility of ruliology.",
        "reasoning": "States the idea directly.",
        "start": 269,
        "blockText": "We know from Gödel’s theorem that questions—even, say, about arithmetic equations involving integers—can be equivalent to arbitrary computations, and therefore are in principle exposed to all the phenomena we see in ruliology. But—as I’ve discussed at length elsewhere—pure mathematics as it’s normally practiced tends to concentrate on what amount to more “human-level” questions, that in effect exist in pockets of computational reducibility, that avoid the generic computational irreducibility of ruliology."
      },
      {
        "blockId": "spya-ppan8f",
        "quote": "it’s a direct reflection of the fact that the development of pure mathematics has at every stage emphasized human understanding.",
        "reasoning": "Reinforces the same claim.",
        "start": 109,
        "blockText": "But what does it really mean that mathematics doesn’t run into ruliology-style bugs all the time? In a sense it’s a direct reflection of the fact that the development of pure mathematics has at every stage emphasized human understanding. If the goal is just to find out what’s true about the structures considered in mathematics, there’s a different—and powerful—approach one can take: experimental mathematics. And indeed serious experimental mathematics is methodologically just like ruliology, albeit operating on the constructs of mathematics rather than just pure rules and programs. And, like ruliology, experimental mathematics is directly exposed to computational irreducibility—with all the surprises and “bugs” that brings."
      },
      {
        "blockId": "spya-y7q6q3",
        "quote": "You try many cases. All of them seem to give results with coefficients ±1. But then you try x105 – 1. And suddenly there’s something different",
        "reasoning": "Shows that when math strays into exhaustive/experimental territory, irreducibility-style surprises do appear.",
        "start": 0,
        "blockText": "You try many cases. All of them seem to give results with coefficients ±1. But then you try x105 – 1. And suddenly there’s something different—a coefficient of 2:"
      }
    ]
  },
  {
    "id": "spya-xj2ad4",
    "name": "Good language design packs irreducibility into primitives",
    "provenance": "introduced",
    "statement": "A well-designed programming language absorbs the messy, irreducible computational work into its built-in primitives, leaving the programmer to compose only the human-understandable, reducible parts, which lowers the chance of unintended behavior.",
    "whyYouNeedIt": "This supports the claim that short, idiomatic programs in a well-designed language are less bug-prone than equivalent low-level code, without which the advice to 'use good language design' would be unmotivated.",
    "occurrences": [
      {
        "blockId": "spya-x8ag2t",
        "quote": "what’s happened is that most of the computational irreducibility has been packed into the primitives of the language, so that what’s left over is the part that’s accessible to us humans, and that maps into our natural patterns of thinking.",
        "reasoning": "States the mechanism directly.",
        "start": 173,
        "blockText": "And indeed in Wolfram Language it’s possible to express what are ultimately remarkably complex tasks with remarkably small, simple and “understandable” programs. In effect, what’s happened is that most of the computational irreducibility has been packed into the primitives of the language, so that what’s left over is the part that’s accessible to us humans, and that maps into our natural patterns of thinking."
      },
      {
        "blockId": "spya-s0e3qm",
        "quote": "in Wolfram Language it’s the short program that’s the one that does what you want, without what you consider bugs.",
        "reasoning": "Draws the practical consequence of the mechanism.",
        "start": 34,
        "blockText": "I’ve seen it over and over again: in Wolfram Language it’s the short program that’s the one that does what you want, without what you consider bugs. If there’s extra complexity in the program, it’ll probably introduce what you’ll consider bugs. In other words, in the space of all possible programs, the ones we as humans tend to want are those that can be expressed as short programs in Wolfram Language."
      }
    ]
  }
]
```

## Candidate Y

```json
[
  {
    "id": "spya-retk2u",
    "name": "Irreducibility is the root cause of bugs",
    "provenance": "introduced",
    "statement": "Bugs ultimately come from computational irreducibility: the fact that a program's actual unfolding behavior cannot in general be predicted except by explicitly running it step by step.",
    "whyYouNeedIt": "This is the article's central diagnosis, replacing the idea that bugs are just careless mistakes with the idea that they are a structural inevitability of computation itself.",
    "occurrences": [
      {
        "blockId": "spya-b9z7g9",
        "quote": "such programs can exhibit computational irreducibility—which means that they will inevitably be able to do things we can’t foresee and don’t expect, and that we will consider to be bugs.",
        "reasoning": "States directly that unforeseeable 'bugs' are a consequence of irreducibility.",
        "start": 259,
        "blockText": "But a big surprise—captured by my Principle of Computational Equivalence—is that even programs (or fragments of them) that are very simple in their structure can end up doing computation that is in a sense as sophisticated as anything. And the result is that such programs can exhibit computational irreducibility—which means that they will inevitably be able to do things we can’t foresee and don’t expect, and that we will consider to be bugs."
      },
      {
        "blockId": "spya-gj554s",
        "quote": "when there’s computational irreducibility nothing short of explicitly running a computation will determine what will happen.",
        "reasoning": "Explains the mechanism by which bugs remain undetectable in advance.",
        "start": 340,
        "blockText": "But even if we humans can’t do it unaided, can we expect to build automated systems—with AI or otherwise—that can root out such bugs? There are—as we’ll discuss—necessarily “pockets of computational reducibility” in which we can expect to make progress. But the key point is that “lurking at the edges” is computational irreducibility. And when there’s computational irreducibility nothing short of explicitly running a computation will determine what will happen. And that means that unless we’ve already run our program in a particular case, we won’t be able to know for sure what it will do. And when it does things we don’t want, we’ll call those things “bugs”."
      },
      {
        "blockId": "spya-z3ryqd",
        "quote": "Ultimately it’s computational irreducibility—and our inability to know in general what a program will do except in effect by explicitly running it.",
        "reasoning": "Names irreducibility explicitly as the fundamental source of bugs, tying together all the earlier examples.",
        "start": 0,
        "blockText": "Ultimately it’s computational irreducibility—and our inability to know in general what a program will do except in effect by explicitly running it. And what’s critical is that computational irreducibility is not just something that’s in principle possible; it’s something that (according to the Principle of Computational Equivalence) is at some level ubiquitous—and affects essentially any system whose behavior is not obviously simple."
      },
      {
        "blockId": "spya-s247px",
        "quote": "that means that with a bounded amount of computational work it’s always possible for the system to surprise us—and in particular for the system to unexpectedly exhibit what we consider to be a bug.",
        "reasoning": "Generalizes the mechanism to any finite amount of checking, explaining why no amount of inspection suffices.",
        "start": 169,
        "blockText": "When computational irreducibility is present, it means that the behavior of a system can in general only be predicted by an irreducible amount of computational work. So that means that with a bounded amount of computational work it’s always possible for the system to surprise us—and in particular for the system to unexpectedly exhibit what we consider to be a bug."
      }
    ]
  },
  {
    "id": "spya-r2rknf",
    "name": "Simple-looking rules can hide arbitrary sophistication",
    "provenance": "introduced",
    "statement": "Even programs with very simple structure (few states, few colors, short rules) can perform computation as sophisticated as any system, producing behavior nobody could have anticipated from the rule's simplicity.",
    "whyYouNeedIt": "This is what makes the minimal Turing machines and cellular automata studied in the article relevant at all: without it, their tiny rule tables would seem too trivial to harbor real bugs.",
    "occurrences": [
      {
        "blockId": "spya-b9z7g9",
        "quote": "even programs (or fragments of them) that are very simple in their structure can end up doing computation that is in a sense as sophisticated as anything.",
        "reasoning": "States the surprising scaling between rule simplicity and behavioral sophistication directly.",
        "start": 81,
        "blockText": "But a big surprise—captured by my Principle of Computational Equivalence—is that even programs (or fragments of them) that are very simple in their structure can end up doing computation that is in a sense as sophisticated as anything. And the result is that such programs can exhibit computational irreducibility—which means that they will inevitably be able to do things we can’t foresee and don’t expect, and that we will consider to be bugs."
      },
      {
        "blockId": "spya-zbsh70",
        "quote": "they all seemed to do very regular things. But then, quite unexpectedly, there was rule 30, with all its complexity",
        "reasoning": "Gives the canonical example of a minimal rule producing unforeseen sophistication.",
        "start": 152,
        "blockText": "One of my very early—and very significant—ruliological surprises had to do with the simplest cellular automata. Enumerating possible (quiescent) rules, they all seemed to do very regular things. But then, quite unexpectedly, there was rule 30, with all its complexity:"
      },
      {
        "blockId": "spya-tgkahp",
        "quote": "it’s (2-state, 3-color) machine 596440 that finally does something surprising and complex",
        "reasoning": "Shows the same phenomenon recurring in Turing machines, reinforcing that complexity from simplicity is general, not a one-off.",
        "start": 103,
        "blockText": "For Turing machines, it’s a similar story—though one has to go further to find a big surprise. And now it’s (2-state, 3-color) machine 596440 that finally does something surprising and complex:"
      }
    ]
  },
  {
    "id": "spya-uv09r2",
    "name": "Irreducibility always leaves pockets of reducibility",
    "provenance": "introduced",
    "statement": "Wherever computational irreducibility is present, there must also be some specific, provable facts about the system's behavior that can be known in advance without running it fully.",
    "whyYouNeedIt": "This is what makes partial guarantees (like 'this cellular automaton will always double its input' or 'this machine never runs out of bounds') possible at all, despite the surrounding unpredictability.",
    "occurrences": [
      {
        "blockId": "spya-gj554s",
        "quote": "There are—as we’ll discuss—necessarily “pockets of computational reducibility” in which we can expect to make progress.",
        "reasoning": "States the existence of reducible pockets as a counterbalance to the pervasive irreducibility just described.",
        "start": 134,
        "blockText": "But even if we humans can’t do it unaided, can we expect to build automated systems—with AI or otherwise—that can root out such bugs? There are—as we’ll discuss—necessarily “pockets of computational reducibility” in which we can expect to make progress. But the key point is that “lurking at the edges” is computational irreducibility. And when there’s computational irreducibility nothing short of explicitly running a computation will determine what will happen. And that means that unless we’ve already run our program in a particular case, we won’t be able to know for sure what it will do. And when it does things we don’t want, we’ll call those things “bugs”."
      },
      {
        "blockId": "spya-y9hee0",
        "quote": "there will always be certain things about a system that one will be able to predict. And if among those things there are ones that align with the properties one wants, then one may be able to know that the system will “exhibit no bugs”",
        "reasoning": "Directly explains why some properties can be guaranteed even in an irreducible system.",
        "start": 474,
        "blockText": "Maybe it’s OK for a program to do wild things—so long as it satisfies at least some property (like not going into an infinite loop). Maybe there’s some particular property one wants the program to have. One important feature of computational irreducibility is that whenever it’s present, there must also be pockets of computational reducibility present. In other words, even though computational irreducibility says one can’t predict everything about what a system will do, there will always be certain things about a system that one will be able to predict. And if among those things there are ones that align with the properties one wants, then one may be able to know that the system will “exhibit no bugs”, at least with respect to these properties."
      },
      {
        "blockId": "spya-zz4up4",
        "quote": "One can think of proofs as taking advantage of pockets of computational reducibility, to provide finite summaries of infinite things.",
        "reasoning": "Connects the abstract notion of reducible pockets to the concrete symbolic proofs given earlier in the piece.",
        "start": 239,
        "blockText": "We saw above in the case of some simple Turing machines how symbolic proofs can be constructed so that certain programs do certain things, and thus don’t have certain kinds of bugs. So how does this relate to computational irreducibility? One can think of proofs as taking advantage of pockets of computational reducibility, to provide finite summaries of infinite things. But there’s no (static) finite summary that can be given of everything a computationally irreducible system does. And proofs about a computationally irreducible process will inevitably get longer and longer as one tries to talk about more and more steps in the process."
      }
    ]
  },
  {
    "id": "spya-n7uub0",
    "name": "A bug only exists relative to a chosen specification",
    "provenance": "introduced",
    "statement": "A program always simply does what it does; calling something a 'bug' requires comparing that behavior to some separate, simpler specification of what it should do, and different specifications yield different bugs.",
    "whyYouNeedIt": "Without this, the many examples of 'bugs' (wrong output, runaway memory, infinite loops, odd/even violations) would seem like unrelated phenomena rather than instances of one general pattern.",
    "occurrences": [
      {
        "blockId": "spya-mhwnwh",
        "quote": "with respect to this specification the program will always just “do what it does”, with no possibility of “having a bug”.",
        "reasoning": "Explicitly makes bugs a relation to a specification rather than an intrinsic property of the program.",
        "start": 252,
        "blockText": "To tell if a program has a bug we have to know what the program is supposed to do—or is not supposed to do. And for this we have to have some kind of precise specification. Of course the program itself provides a specification for what it will do. And with respect to this specification the program will always just “do what it does”, with no possibility of “having a bug”. But typically we imagine specifications that aren’t just the program itself, but instead have some easier-to-absorb form (e.g. the simple mathematical formula “n + 1” from the previous section). And it’s relative to specifications like these that programs can have bugs."
      },
      {
        "blockId": "spya-tzs7f4",
        "quote": "There are several different types of specifications that end up being used.",
        "reasoning": "Signals that the concept of 'bug' is parametrized by specification type, setting up the subsequent taxonomy.",
        "start": 0,
        "blockText": "There are several different types of specifications that end up being used. The most direct essentially just restate the program in a different—and normally higher-level—language (say Wolfram Language vs. C++, or math notation vs. Turing machine rules). A more minimal version of this is just restating the program as a different program of the same type. Then one considers it a bug if the two programs don’t do the same thing. (For example, if a compiler optimizer changes what a program does, then it’s a bug.)"
      },
      {
        "blockId": "spya-rt2gb2",
        "quote": "Another general type of specification is one that says not what a program should do, but rather what it should not.",
        "reasoning": "Shows the same bug concept applying to negative constraints, confirming specification-relativity rather than a fixed notion of correctness.",
        "start": 0,
        "blockText": "Another general type of specification is one that says not what a program should do, but rather what it should not. So, for example, with our Turing machines we could specify that we never want them to “go out of control” and start using unbounded amounts of memory (i.e. tape). Here’s an example of a Turing machine that seems like it’s just happily computing outputs:"
      },
      {
        "blockId": "spya-uj4rfn",
        "quote": "it seems as if, whatever constraint we give, there’ll somehow always be machines that will insidiously escape it",
        "reasoning": "Generalizes across all specification types, which only makes sense if 'bug' is defined relative to whichever specification is chosen.",
        "start": 238,
        "blockText": "And it always seems to be the same story: we set up a specification, and some Turing machines will precisely follow it. But we always seem to also find ones that appear to be following it—at least until they “have a bug”. In other words, it seems as if, whatever constraint we give, there’ll somehow always be machines that will insidiously escape it—in effect “having an insidious bug”."
      }
    ]
  },
  {
    "id": "spya-z2y27m",
    "name": "A local invariant can prove global correctness despite visual complexity",
    "provenance": "introduced",
    "statement": "Even when a system's overall pattern looks too complicated to reason about, isolating a bounded 'effective rule' governing just one structural feature (such as a boundary that only moves one way) can yield a rigorous proof that the whole system behaves correctly forever.",
    "whyYouNeedIt": "This shows that 'looks complicated, therefore unprovable' is false, which is necessary to understand why the article treats visual complexity as inconclusive rather than as proof that a bug must eventually appear.",
    "occurrences": [
      {
        "blockId": "spya-r7ty6m",
        "quote": "first, the white “rind” always either stays in the same place, or moves to the left. And second, inside the rind, the pattern involves only",
        "reasoning": "Identifies the specific structural invariant that constrains the otherwise-complex behavior.",
        "start": 54,
        "blockText": "Taking a small example we see two important features: first, the white “rind” always either stays in the same place, or moves to the left. And second, inside the rind, the pattern involves only and :"
      },
      {
        "blockId": "spya-n5acnw",
        "quote": "the underlying cellular automaton must always correctly “double its input”, with no bugs.",
        "reasoning": "States the final guarantee obtained purely from the local invariant argument, without ever simulating all inputs.",
        "start": 107,
        "blockText": "So, yes, even though the patterns in this case look complicated, they must always eventually stabilize—and the underlying cellular automaton must always correctly “double its input”, with no bugs."
      }
    ]
  },
  {
    "id": "spya-bcznky",
    "name": "Proving correctness costs as much as running the program",
    "provenance": "introduced",
    "statement": "Searching for a formal proof that a program behaves correctly is itself an open-ended computational search, and when the program actually has a bug, no proof will ever be found no matter how long one searches, because the statement being sought is false.",
    "whyYouNeedIt": "This undercuts the hope that formal verification offers a shortcut around testing: without it, the multiway-graph proof search would look like a different, superior method rather than the same kind of unbounded effort as exhaustive testing.",
    "occurrences": [
      {
        "blockId": "spya-bn24t3",
        "quote": "In essence we’re forming a multiway graph of possible theorems—then our proof corresponds to what amounts to a path-like subgraph in this graph.",
        "reasoning": "Frames proof-finding as a search process comparable in kind to exploring all machine behaviors.",
        "start": 280,
        "blockText": "So what happens if we try to produce a proof for a machine that has a bug? To see that, we have to talk about how we construct proofs like the ones above. The basic idea is to start from the axioms and then try to find a way to string them together to get to the theorem we want. In essence we’re forming a multiway graph of possible theorems—then our proof corresponds to what amounts to a path-like subgraph in this graph."
      },
      {
        "blockId": "spya-ymdpn2",
        "quote": "we don’t get any fundamental advantage by trying to make a proof rather than just running the Turing machine. In both cases we have to expend a potentially unbounded amount of computational effort.",
        "reasoning": "States explicitly that proving and running are computationally equivalent paths to the same irreducible effort.",
        "start": 16,
        "blockText": "And in the end, we don’t get any fundamental advantage by trying to make a proof rather than just running the Turing machine. In both cases we have to expend a potentially unbounded amount of computational effort. It’s just a choice between putting that effort rather directly into enumerating and running cases of the Turing machine, or instead putting the effort into building up the multiway graph to try and find a proof in it."
      }
    ]
  },
  {
    "id": "spya-y0b3kf",
    "name": "A program worth running must be partly unforeseeable",
    "provenance": "introduced",
    "statement": "If you could completely predict everything a program would do, there would be no point in running it rather than just writing down the answer directly; so any program that's actually useful to run must contain some behavior you cannot foresee in advance.",
    "whyYouNeedIt": "This reframes bugs as an unavoidable cost of usefulness rather than a solvable engineering defect, which is necessary to understand why the article treats bug-elimination as fundamentally limited rather than just difficult.",
    "analogy": "It is like reading a novel whose ending you already know by heart: at that point there is nothing left for the act of reading to give you.",
    "occurrences": [
      {
        "blockId": "spya-nd4kn9",
        "quote": "if you can completely foresee what a program will do, what’s the point of running it? Why not, in effect, just immediately “write down the answer”, without ever having to run the program?",
        "reasoning": "States the paradox directly: full predictability would make the program pointless to execute.",
        "start": 180,
        "blockText": "But, one might ask, why not just use programs that don’t have these problems? Programs where you can foresee their behavior, and be sure they have no bugs. Well, here’s the issue: if you can completely foresee what a program will do, what’s the point of running it? Why not, in effect, just immediately “write down the answer”, without ever having to run the program? In other words, to make the program worth actually running, there have to be parts of its behavior you can’t foresee. But then there’s a piece of intuition from the Principle of Computational Equivalence: once there’s anything you can’t foresee, there tends to be a lot you can’t foresee. In other words, the system will tend to be full of computational irreducibility."
      },
      {
        "blockId": "spya-uj0h88",
        "quote": "Computational irreducibility is in a sense what makes computation powerful. But it’s also what makes it unpredictable.",
        "reasoning": "Links the usefulness of computation to the same property that produces bugs, which only follows from the preceding paradox.",
        "start": 0,
        "blockText": "Computational irreducibility is in a sense what makes computation powerful. But it’s also what makes it unpredictable. And in practice—intentionally or not—it’s very common for programs to have what amounts to a “spark of computational irreducibility inside” that’s somehow kept controlled enough to do what one wants."
      }
    ]
  },
  {
    "id": "spya-aekf2j",
    "name": "Testing many cases cannot establish a general law in computation",
    "provenance": "introduced",
    "statement": "Scientific induction—inferring a permanent rule from many consistent observations—breaks down for computational systems, because computational irreducibility guarantees that a surprising exception can appear no matter how many cases have already confirmed the pattern.",
    "whyYouNeedIt": "Without this, the long sequences of 'it worked for every case up to some huge number, then suddenly failed' examples would look like unlucky anomalies rather than the expected behavior of any sufficiently rich computational system.",
    "occurrences": [
      {
        "blockId": "spya-ue5uq4",
        "quote": "in ruliology—courtesy of computational irreducibility—there’s always the potential for surprises, and for “bugs” that violate whatever laws we might have inferred.",
        "reasoning": "States directly that induction fails precisely because of irreducibility.",
        "start": 492,
        "blockText": "Scientific induction is a cornerstone of natural science. You see something in the world happen a certain way enough times, and you assume it’ll always happen that way (and that there’s a “scientific law” about it). But what about in ruliology? Can we apply scientific induction there? You test a lot of Turing machines. You observe a certain pattern of behavior. Will the pattern always be there? Scientific induction would say yes. But if there’s a “bug” it won’t be. And the point is that in ruliology—courtesy of computational irreducibility—there’s always the potential for surprises, and for “bugs” that violate whatever laws we might have inferred."
      },
      {
        "blockId": "spya-ym6u26",
        "quote": "such narratives—almost by definition—rely on pockets of computational reducibility. What’s underneath may involve all sorts of computational irreducibility.",
        "reasoning": "Explains why science normally seems to work despite this: it quietly restricts itself to reducible pockets.",
        "start": 464,
        "blockText": "Particularly given that from what we know now, it seems that what’s underneath is so computational, one might wonder why scientific induction would ever have worked in the first place. The answer has to do with the fundamental nature of natural science and scientific laws. At some level what science is trying to do is to take what happens in the world, and explain at least certain aspects of it with “narratives” that our minds can grasp. And the point is that such narratives—almost by definition—rely on pockets of computational reducibility. What’s underneath may involve all sorts of computational irreducibility. But that’s not what we concentrate on when we want to “do science”. We look for computationally reducible regularities that we can “summarize” with our scientific laws and our narratives."
      },
      {
        "blockId": "spya-vy3nfe",
        "quote": "How do we know if we’re “stuck in a pocket of reducibility”, or are actually seeing the whole “spectrum of behavior”, bugs and all?",
        "reasoning": "Poses exactly the problem that induction cannot resolve when sampling a computationally irreducible system.",
        "start": 90,
        "blockText": "OK, but so let’s say we’re trying to test a program by looking at lots of specific cases. How do we know if we’re “stuck in a pocket of reducibility”, or are actually seeing the whole “spectrum of behavior”, bugs and all? A typical approach in practice is to randomly sample possible inputs (or to introduce random “fuzz” around known inputs). Will this work? Well, it depends on “how good” the “randomness” is, and what the distribution—and density—of bugs is."
      }
    ]
  },
  {
    "id": "spya-dkjv9b",
    "name": "The rarity of a first bug can be unbounded",
    "provenance": "introduced",
    "statement": "Just as there is no limit to how long a program can run before halting (the busy-beaver phenomenon), there is no limit to how rare or deeply hidden a bug's first occurrence can be, so no fixed amount of sampling can guarantee it will be found.",
    "whyYouNeedIt": "This explains why the article keeps finding bugs only after 'thousands, millions, billions, or trillions' of cases: without this idea, those numbers would look like arbitrary curiosities rather than instances of a principle with no ceiling.",
    "analogy": "It is like a hide-and-seek game where the hiding spots keep getting better the longer the game has been played, so no finite number of searches ever proves no one is still hidden.",
    "occurrences": [
      {
        "blockId": "spya-f7mn34",
        "quote": "the number of samples might just not be large enough to ever hit a bug—given the density of bugs that are present.",
        "reasoning": "States the practical consequence: sampling can fail no matter its size, which only follows if rarity has no bound.",
        "start": 7,
        "blockText": "Still, the number of samples might just not be large enough to ever hit a bug—given the density of bugs that are present. (If one assumes a certain uniformity and independence one can use simple probabilistic arguments to compute how probabilities for hitting bugs would increase if one were to take more samples.)"
      }
    ]
  },
  {
    "id": "spya-urwuec",
    "name": "Good language primitives absorb irreducibility so humans can avoid bugs",
    "provenance": "introduced",
    "statement": "A well-designed programming language packs most of the uncontrollable, irreducible computation into its built-in primitives, leaving the programmer to write short, human-intelligible code whose structure is more likely to match human intent and thus less likely to produce bugs.",
    "whyYouNeedIt": "This supplies the article's practical answer to an otherwise bleak picture: if irreducibility is unavoidable, this is the mechanism by which its danger can still be pushed back in real software engineering.",
    "analogy": "It is like a well-designed kitchen where the dangerous machinery is sealed inside appliances, leaving the cook only simple, safe actions to combine.",
    "occurrences": [
      {
        "blockId": "spya-p2f2cx",
        "quote": "Language design, I believe, is key. Because language design is all about providing primitives that do what we humans want, and that we can understand.",
        "reasoning": "Directly proposes language design as the mechanism for controlling bug-proneness.",
        "start": 176,
        "blockText": "But, OK, so at some level you’re going to have to gloss over certain things your program is doing. So what then gives you the best chance to have the program do what you want? Language design, I believe, is key. Because language design is all about providing primitives that do what we humans want, and that we can understand."
      },
      {
        "blockId": "spya-wx09gt",
        "quote": "What a well-designed language does is to provide as primitives lumps of computational work that are things humans typically actually want.",
        "reasoning": "Explains the mechanism: primitives absorb irreducible work so visible code stays human-aligned.",
        "start": 170,
        "blockText": "There are an infinite number of programs one can write. Each will do something. But with overwhelming probability the things they do will not be anything we humans want. What a well-designed language does is to provide as primitives lumps of computational work that are things humans typically actually want. They define, in a sense, a framework for the successful computational formalization of human thought."
      },
      {
        "blockId": "spya-s0e3qm",
        "quote": "in Wolfram Language it’s the short program that’s the one that does what you want, without what you consider bugs.",
        "reasoning": "States the practical consequence that short programs in such a language tend to be correct, which only follows if primitives have absorbed the risky complexity.",
        "start": 34,
        "blockText": "I’ve seen it over and over again: in Wolfram Language it’s the short program that’s the one that does what you want, without what you consider bugs. If there’s extra complexity in the program, it’ll probably introduce what you’ll consider bugs. In other words, in the space of all possible programs, the ones we as humans tend to want are those that can be expressed as short programs in Wolfram Language."
      }
    ]
  }
]
```

## Candidate Z

```json
[
  {
    "id": "spya-f7qvbz",
    "name": "A bug is only a bug relative to a chosen specification",
    "provenance": "assumed",
    "statement": "Calling some behavior a bug presupposes a separate, simpler description of what the program 'should' do against which the actual behavior is being compared; without such a reference there is nothing to deviate from.",
    "whyYouNeedIt": "The whole catalogue of Turing-machine and cellular-automaton examples only reads as 'bugs' because the reader implicitly accepts that the simple formula (n+1, doubling, even output) is the real intention, and the program's actual rule is not.",
    "occurrences": [
      {
        "blockId": "spya-mhwnwh",
        "quote": "To tell if a program has a bug we have to know what the program is supposed to do—or is not supposed to do. And for this we have to have some kind of precise specification.",
        "reasoning": "Makes explicit the dependency that every later example quietly relies on.",
        "start": 0,
        "blockText": "To tell if a program has a bug we have to know what the program is supposed to do—or is not supposed to do. And for this we have to have some kind of precise specification. Of course the program itself provides a specification for what it will do. And with respect to this specification the program will always just “do what it does”, with no possibility of “having a bug”. But typically we imagine specifications that aren’t just the program itself, but instead have some easier-to-absorb form (e.g. the simple mathematical formula “n + 1” from the previous section). And it’s relative to specifications like these that programs can have bugs."
      }
    ]
  },
  {
    "id": "spya-zw3uk7",
    "name": "Rarity of a failure has no inherent floor",
    "provenance": "assumed",
    "statement": "A deviation from expected behavior can be made to occur as infrequently as one likes — at the trillionth case, the googol-th case, or beyond — there is no natural lower bound on how rare a genuine exception can be.",
    "whyYouNeedIt": "Without this, the claim that billions or trillions of successful tests still don't guarantee correctness would seem like mere paranoia rather than a structural fact about possible bug densities.",
    "occurrences": [
      {
        "blockId": "spya-tjybft",
        "quote": "At the 23338590792th prime it flips around, and becomes negative.",
        "reasoning": "Illustrates the extreme rarity the reader must already accept as possible in principle.",
        "start": 31,
        "blockText": "But it doesn’t go on that way. At the 23338590792th prime it flips around, and becomes negative."
      }
    ]
  },
  {
    "id": "spya-v5wwwk",
    "name": "Simple rules can produce arbitrarily sophisticated behavior",
    "provenance": "introduced",
    "statement": "According to the Principle of Computational Equivalence, programs with very simple structure can still perform computations as sophisticated as any other system, no matter how elaborate.",
    "occurrences": [
      {
        "blockId": "spya-b9z7g9",
        "quote": "even programs (or fragments of them) that are very simple in their structure can end up doing computation that is in a sense as sophisticated as anything",
        "reasoning": "Directly states the principle driving the whole argument.",
        "start": 81,
        "blockText": "But a big surprise—captured by my Principle of Computational Equivalence—is that even programs (or fragments of them) that are very simple in their structure can end up doing computation that is in a sense as sophisticated as anything. And the result is that such programs can exhibit computational irreducibility—which means that they will inevitably be able to do things we can’t foresee and don’t expect, and that we will consider to be bugs."
      }
    ]
  },
  {
    "id": "spya-tvhvgc",
    "name": "Computational irreducibility blocks shortcut prediction",
    "provenance": "introduced",
    "statement": "Some computational processes have no shortcut description shorter than actually running them step by step; their future behavior can only be known by simulation, not derived in advance.",
    "occurrences": [
      {
        "blockId": "spya-s247px",
        "quote": "When computational irreducibility is present, it means that the behavior of a system can in general only be predicted by an irreducible amount of computational work.",
        "reasoning": "States the core concept directly.",
        "start": 0,
        "blockText": "When computational irreducibility is present, it means that the behavior of a system can in general only be predicted by an irreducible amount of computational work. So that means that with a bounded amount of computational work it’s always possible for the system to surprise us—and in particular for the system to unexpectedly exhibit what we consider to be a bug."
      },
      {
        "blockId": "spya-gj554s",
        "quote": "when there's computational irreducibility nothing short of explicitly running a computation will determine what will happen",
        "reasoning": "Applies the concept to the bug-detection problem.",
        "start": 340,
        "blockText": "But even if we humans can’t do it unaided, can we expect to build automated systems—with AI or otherwise—that can root out such bugs? There are—as we’ll discuss—necessarily “pockets of computational reducibility” in which we can expect to make progress. But the key point is that “lurking at the edges” is computational irreducibility. And when there’s computational irreducibility nothing short of explicitly running a computation will determine what will happen. And that means that unless we’ve already run our program in a particular case, we won’t be able to know for sure what it will do. And when it does things we don’t want, we’ll call those things “bugs”."
      }
    ]
  },
  {
    "id": "spya-s8apgk",
    "name": "Pockets of reducibility amid irreducibility",
    "provenance": "introduced",
    "statement": "Even inside an irreducible system there are always some specific properties or sub-patterns that can be predicted or proven, even though the system's behavior as a whole cannot be.",
    "whyYouNeedIt": "Explains why some cellular automata and Turing machines can be proven bug-free despite the general impossibility of foreseeing irreducible systems.",
    "occurrences": [
      {
        "blockId": "spya-y9hee0",
        "quote": "whenever it's present, there must also be pockets of computational reducibility present. In other words, even though computational irreducibility says one can't predict everything about what a system will do, there will always be certain things about a system that one will be able to predict",
        "reasoning": "States the idea explicitly.",
        "start": 265,
        "blockText": "Maybe it’s OK for a program to do wild things—so long as it satisfies at least some property (like not going into an infinite loop). Maybe there’s some particular property one wants the program to have. One important feature of computational irreducibility is that whenever it’s present, there must also be pockets of computational reducibility present. In other words, even though computational irreducibility says one can’t predict everything about what a system will do, there will always be certain things about a system that one will be able to predict. And if among those things there are ones that align with the properties one wants, then one may be able to know that the system will “exhibit no bugs”, at least with respect to these properties."
      },
      {
        "blockId": "spya-erqjtv",
        "quote": "The behavior of the rind (which we can easily determine from the underlying cellular automaton rule) ensures that the complicated pattern can never expand.",
        "reasoning": "Demonstrates using a provable sub-regularity to guarantee no bugs despite overall complexity.",
        "start": 0,
        "blockText": "The behavior of the rind (which we can easily determine from the underlying cellular automaton rule) ensures that the complicated pattern can never expand. But could it, for example, end up becoming periodic, so that the whole pattern never stabilizes? Well, that depends on the “effective rule” inside the rind. And we can see what this is by taking the underlying cellular automaton rule"
      }
    ]
  },
  {
    "id": "spya-vavq8j",
    "name": "Proof search and exhaustive simulation are computationally equivalent efforts",
    "provenance": "introduced",
    "statement": "Constructing a formal proof that a program behaves correctly requires an amount of computational work comparable to just running the program through all its cases; there is no fundamental shortcut proofs give you over simulation.",
    "occurrences": [
      {
        "blockId": "spya-ymdpn2",
        "quote": "we don't get any fundamental advantage by trying to make a proof rather than just running the Turing machine. In both cases we have to expend a potentially unbounded amount of computational effort.",
        "reasoning": "States the equivalence directly.",
        "start": 16,
        "blockText": "And in the end, we don’t get any fundamental advantage by trying to make a proof rather than just running the Turing machine. In both cases we have to expend a potentially unbounded amount of computational effort. It’s just a choice between putting that effort rather directly into enumerating and running cases of the Turing machine, or instead putting the effort into building up the multiway graph to try and find a proof in it."
      },
      {
        "blockId": "spya-vs44ga",
        "quote": "because, in fact, the result we're trying to prove isn't true, so there isn't a proof. And we know that because, if we test sufficiently many cases of the Turing machine, we can explicitly find the bug.",
        "reasoning": "Shows the symmetry between failed proof search and found bug.",
        "start": 0,
        "blockText": "because, in fact, the result we’re trying to prove isn’t true, so there isn’t a proof. And we know that because, if we test sufficiently many cases of the Turing machine, we can explicitly find the bug."
      }
    ]
  },
  {
    "id": "spya-mz9abz",
    "name": "Good primitives offload irreducibility so human-level programs stay understandable",
    "provenance": "introduced",
    "statement": "A well-designed programming language packs most of the messy, irreducible computational work into its built-in primitives, leaving the programmer's own short code closer to human intention and less prone to unexpected behavior.",
    "occurrences": [
      {
        "blockId": "spya-x8ag2t",
        "quote": "most of the computational irreducibility has been packed into the primitives of the language, so that what's left over is the part that's accessible to us humans, and that maps into our natural patterns of thinking.",
        "reasoning": "States the mechanism directly.",
        "start": 197,
        "blockText": "And indeed in Wolfram Language it’s possible to express what are ultimately remarkably complex tasks with remarkably small, simple and “understandable” programs. In effect, what’s happened is that most of the computational irreducibility has been packed into the primitives of the language, so that what’s left over is the part that’s accessible to us humans, and that maps into our natural patterns of thinking."
      },
      {
        "blockId": "spya-s0e3qm",
        "quote": "in Wolfram Language it's the short program that's the one that does what you want, without what you consider bugs.",
        "reasoning": "Gives the practical consequence of the idea.",
        "start": 34,
        "blockText": "I’ve seen it over and over again: in Wolfram Language it’s the short program that’s the one that does what you want, without what you consider bugs. If there’s extra complexity in the program, it’ll probably introduce what you’ll consider bugs. In other words, in the space of all possible programs, the ones we as humans tend to want are those that can be expressed as short programs in Wolfram Language."
      }
    ]
  }
]
```
