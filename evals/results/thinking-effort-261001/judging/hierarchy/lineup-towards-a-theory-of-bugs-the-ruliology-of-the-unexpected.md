# 4 candidates for "Towards a Theory of Bugs: The Ruliology of the Unexpected"

Each candidate is a table of contents that carves the article into sections a first-time reader would navigate by. They are labelled W, X, Y, Z in an order that
says nothing about how any of them was made. The article itself, with its block ids, is
`article-towards-a-theory-of-bugs-the-ruliology-of-the-unexpected.md` beside this file.

## Candidate W

1. **My Program Did the Wrong Thing!**
   gist: Bugs are universal because even very simple programs can perform computation as sophisticated as any other, making their behavior unforeseeable without running them.
   opens: "· ~47 min read"
2. **Bugs in Turing Machines**
   gist: Turing machines built to compute a simple function like n+1 often run correctly for many inputs before failing unexpectedly, with insidious bugs sometimes delayed for very large n.
   opens: "To begin our explorations, we’re going to look at a very simple and longstanding model of computation: Turing machines."
3. **What Counts as a Bug?**
   gist: Whether something counts as a bug depends on the specification used—restating a program, forbidding certain behaviors, or requiring an output property—and cellular automata doubling tasks show the same divergence pattern.
   opens: "To tell if a program has a bug we have to know what the program is supposed to do—or is not supposed to do."
4. **Can One Tell If There's Going to Be a Bug?**
   gist: Visual inspection of simple cellular automaton patterns can sometimes prove a doubling task always works, and symbolic proofs can formally show Turing machines are bug-free, though both fail once computation turns irreducible.
   opens: "Many of the cellular automata we saw above give patterns that are simple enough that it’s “visually obvious” that they’ll “correctly double” for all input sizes:"
5. **Computational Irreducibility and Bugs**
   gist: Computational irreducibility is the ultimate source of bugs, since only irreducible computation can predict behavior, which also explains why testing programs on finite samples can never guarantee none remain.
   opens: "We’ve now seen several minimal examples of what we can think of as “bugs”: unexpected things even very simple programs can do."
6. **Some Typical Ruliological Surprises**
   gist: Across cellular automata, Turing machines, combinators, and even pure mathematics, systems explored by sampling cases eventually reveal rare unexpected behavior, though mathematics largely avoids this by favoring human-graspable regularities.
   opens: "The computational universe is full of surprises."
7. **Bugs in Practice**
   gist: Avoiding bugs in practice means using a well-designed language whose primitives match human intent and relying on visualization to see inside a computation, though useful programs keep some irreducible risk.
   opens: "So let’s say you want to create a program that doesn’t have bugs."
8. **Acknowledgements**
   gist: Thanks to colleagues and the Wolfram software quality assurance team.
   opens: "I’d like to thank several members of the Wolfram Institute for their help: Richard Assar, Júlia Campolim, Nik Murzin and Willem Nielsen."

Sampled deeper gists, each beside the prose it stands in for:
- gist: Cellular automata built to double an input of n cells into 2n cells often work correctly for many values before suddenly failing at some larger n, mirroring the Turing machine bug pattern.
  prose: "A Cellular Automaton Example How does what we’ve seen about “bugs” in simple Turing machines generalize? As another example, let’s look at cellular automata. And in particular, let’s look at cellular automata that are set up to “double their input” in the sense that starting with a block of n (non-white) cells, they yield 2n (non-white) cells:  As with our Turing machine examples above, there are …"
- gist: Some cellular automata patterns are visually simple enough to guarantee correct doubling, but less obvious cases show random-looking fluctuations in their stabilization time that leave no guarantee against a hidden bug.
  prose: "Can One Tell If There’s Going to Be a Bug? Many of the cellular automata we saw above give patterns that are simple enough that it’s “visually obvious” that they’ll “correctly double” for all input sizes:  Sometimes it’s less obvious, but it still seems fairly clear that nothing can escape a certain envelope, and so there can’t be a bug:  But what about in a case like this:  It looks awfully simil…"
- gist: Calling something a bug requires a specification beyond the program itself, often a restatement in another language or an equivalent program, and two Turing machines that look identical can suddenly diverge at n=27.
  prose: "What Counts as a Bug? To tell if a program has a bug we have to know what the program is supposed to do—or is not supposed to do. And for this we have to have some kind of precise specification. Of course the program itself provides a specification for what it will do. And with respect to this specification the program will always just “do what it does”, with no possibility of “having a bug”. But …"

## Candidate X

1. **My Program Did the Wrong Thing**
   gist: Bugs seem like unique accidents, but simple programs can secretly perform sophisticated computation, making unexpected and unforeseeable behavior a basic, unavoidable feature of computation itself.
   opens: "· ~47 min read"
2. **Bugs in Turing Machines**
   gist: Even tiny Turing machines meant to compute simple functions like adding one can run correctly for many inputs before suddenly failing, showing bugs emerge from genuine computational complexity, not just sloppy design.
   opens: "To begin our explorations, we’re going to look at a very simple and longstanding model of computation: Turing machines."
3. **Specifying and Detecting Bugs**
   gist: What counts as a bug depends on the specification chosen, and across many kinds of specifications and example systems, some instances always seem to eventually escape and misbehave.
   opens: "To tell if a program has a bug we have to know what the program is supposed to do—or is not supposed to do."
4. **Formal Proofs and Irreducibility**
   gist: Symbolic proofs can sometimes formally establish that a program has no bugs, but building such proofs takes real computational work comparable to just running the program, and fails under genuine irreducibility.
   opens: "Let’s go back to the Turing machines we discussed above."
5. **Testing, Induction, and Surprises**
   gist: Testing many cases and generalizing by induction can fail badly in computation, because rare but real bugs can lurk arbitrarily far out, hidden by pockets of apparent regularity.
   opens: "Scientific induction is a cornerstone of natural science."
6. **Bugs in Mathematics and Practice**
   gist: Mathematics mostly avoids ruliology-style bugs by focusing on human-understandable structures, while writing genuinely bug-free software means choosing well-designed primitives and visually inspecting what programs actually do inside.
   opens: "If “bugs” are so common in ruliology, what about in mathematics?"
7. **Thanks**
   gist: Acknowledgements and thanks.
   opens: "I’d like to thank several members of the Wolfram Institute for their help: Richard Assar, Júlia Campolim, Nik Murzin and Willem Nielsen."

Sampled deeper gists, each beside the prose it stands in for:
- gist: Cellular automata designed to double an input's size can run correctly for a long stretch of cases before suddenly failing at some larger input, mirroring the same pattern seen with Turing machines.
  prose: "A Cellular Automaton Example How does what we’ve seen about “bugs” in simple Turing machines generalize? As another example, let’s look at cellular automata. And in particular, let’s look at cellular automata that are set up to “double their input” in the sense that starting with a block of n (non-white) cells, they yield 2n (non-white) cells:  As with our Turing machine examples above, there are …"
- gist: Whether something counts as a bug depends entirely on the specification used to judge a program, whether restating it differently, forbidding certain behaviors, or requiring certain output properties, and bugs can hide in any of these.
  prose: "What Counts as a Bug? To tell if a program has a bug we have to know what the program is supposed to do—or is not supposed to do. And for this we have to have some kind of precise specification. Of course the program itself provides a specification for what it will do. And with respect to this specification the program will always just “do what it does”, with no possibility of “having a bug”. But …"
- gist: Among millions of four-state Turing machines that compute n+1 correctly for many steps, some still fail unexpectedly at much larger inputs, with the riskiest inputs being those whose binary form is all ones.
  prose: "What about for larger Turing machines? Of the 4 billion or so 4-state Turing machines, more than 9 million successfully compute n + 1. But there are some that have quite insidious bugs. An example is machine 118050142 (in the standard Wolfram Language TuringMachine numbering scheme) which “correctly” computes n + 1 for all values of n up to 62  but then suddenly at n = 63 doesn’t give 64 but inste…"

## Candidate Y

1. **"My Program Did the Wrong Thing!"**
   gist: Bugs arise because simple mental models of a program can fail to match its actual, computationally sophisticated behavior, a gap rooted in computational irreducibility.
   opens: "· ~47 min read"
2. **Bugs in Turing Machines**
   gist: Testing simple Turing machines meant to compute n+1 shows that even tiny, well-behaved-looking programs eventually produce glitches at larger inputs, and the point where this first happens varies unpredictably.
   opens: "To begin our explorations, we’re going to look at a very simple and longstanding model of computation: Turing machines."
3. **What Counts as a Bug?**
   gist: Calling something a bug requires a precise specification of intended behavior, and different kinds of specifications—equivalence, restriction, or property—all turn out to have hidden counterexamples.
   opens: "To tell if a program has a bug we have to know what the program is supposed to do—or is not supposed to do."
4. **A Cellular Automaton Example**
   gist: Cellular automata built to double an input size often work correctly for a long stretch of inputs before developing a bug, and simple visual inspection can sometimes—but not always—guarantee correctness.
   opens: "How does what we’ve seen about “bugs” in simple Turing machines generalize?"
5. **But What about Formal Proofs?**
   gist: A Turing machine's correct behavior can sometimes be formally proved using symbolic representations and induction, but for machines with real bugs no such proof exists because the claim is false.
   opens: "Let’s go back to the Turing machines we discussed above."
6. **Computational Irreducibility and the Limits of Testing**
   gist: Because computational irreducibility is ubiquitous, no finite amount of testing, sampling, or accumulated facts can guarantee a program free of surprising bugs, however rare they may be.
   opens: "We’ve now seen several minimal examples of what we can think of as “bugs”: unexpected things even very simple programs can do."
7. **Some Typical Ruliological Surprises**
   gist: Across cellular automata, Turing machines, combinators, and growth processes, simple rules repeatedly produce behavior far more complex or sudden than their simplicity would suggest, confirming surprises are the norm.
   opens: "The computational universe is full of surprises."
8. **Mathematical "Bugs"**
   gist: Mathematical patterns found from many examples can fail at astronomically large counterexamples, but mainstream mathematics mostly avoids such bugs because it focuses on human-graspable, reducible structures.
   opens: "If “bugs” are so common in ruliology, what about in mathematics?"
9. **Bugs in Practice**
   gist: Avoiding bugs in practice depends on well-designed language primitives and on visualizing a program's inner workings, though any program doing real computation—including trained neural networks—remains exposed to unforeseeable behavior.
   opens: "So let’s say you want to create a program that doesn’t have bugs."
10. **Thanks**
   gist: Acknowledgements to colleagues and the Wolfram quality assurance team who helped shape the author's understanding of bugs.
   opens: "I’d like to thank several members of the Wolfram Institute for their help: Richard Assar, Júlia Campolim, Nik Murzin and Willem Nielsen."

Sampled deeper gists, each beside the prose it stands in for:
- gist: A second seemingly contained pattern also shows random-looking fluctuations in how long it takes to settle, again leaving open whether it might eventually leak and produce a bug.
  prose: "What about a case like this:  Will the pattern always be “contained”, or will there eventually be a “leak” that leads to a bug? Once again we can plot the stabilization time, which again seems to increase close to linearly—and is now well fit by 9n:  There are random-looking fluctuations though:  And the question again is whether these will ever somehow “go wild”, and lead to a bug.…"
- gist: Some cellular automaton patterns are visually simple enough to guarantee no bugs exist, but others that look similarly contained show irregular fluctuations whose long-term safety is not obvious from inspection alone.
  prose: "Can One Tell If There’s Going to Be a Bug? Many of the cellular automata we saw above give patterns that are simple enough that it’s “visually obvious” that they’ll “correctly double” for all input sizes:  Sometimes it’s less obvious, but it still seems fairly clear that nothing can escape a certain envelope, and so there can’t be a bug:  But what about in a case like this:  It looks awfully simil…"
- gist: Cellular automata can be designed to double the size of an input pattern, and many different rules accomplish this task with varying efficiency and complexity.
  prose: "A Cellular Automaton Example How does what we’ve seen about “bugs” in simple Turing machines generalize? As another example, let’s look at cellular automata. And in particular, let’s look at cellular automata that are set up to “double their input” in the sense that starting with a block of n (non-white) cells, they yield 2n (non-white) cells:  As with our Turing machine examples above, there are …"

## Candidate Z

1. **My Program Did the Wrong Thing!**
   gist: Bugs are unexpected outcomes relative to a simple mental model of a program, and they become unavoidable once a program's actual computation is irreducibly complex.
   opens: "· ~47 min read"
2. **Bugs in Turing Machines**
   gist: Even tiny Turing machines meant to compute simple functions like n+1 eventually produce wrong outputs, with the first bug sometimes delayed until surprisingly large inputs.
   opens: "To begin our explorations, we’re going to look at a very simple and longstanding model of computation: Turing machines."
3. **What Counts as a Bug?**
   gist: Whether something counts as a bug depends on the specification chosen, and for nearly any kind of specification—positive or negative—some machines eventually violate it unexpectedly.
   opens: "To tell if a program has a bug we have to know what the program is supposed to do—or is not supposed to do."
4. **A Cellular Automaton Example**
   gist: Cellular automata designed to double an input size often work correctly for many cases but can suddenly fail at specific, sometimes large, input values.
   opens: "How does what we’ve seen about “bugs” in simple Turing machines generalize?"
5. **Can One Tell If There's Going to Be a Bug?**
   gist: Visual simplicity of a pattern can guarantee no bugs exist, but some cellular automata look complex yet can still be proven, through analysis of their structure, to always work correctly.
   opens: "Many of the cellular automata we saw above give patterns that are simple enough that it’s “visually obvious” that they’ll “correctly double” for all input sizes:"
6. **But What about Formal Proofs?**
   gist: Formal symbolic proofs can show some Turing machines always compute correctly, but when a machine is actually buggy, no such proof exists and testing works just as well.
   opens: "Let’s go back to the Turing machines we discussed above."
7. **Computational Irreducibility and Bugs**
   gist: Computational irreducibility—needing to run a system to know what it does—is common, and it guarantees bugs are always possible, though some narrow guarantees can survive within predictable pockets.
   opens: "We’ve now seen several minimal examples of what we can think of as “bugs”: unexpected things even very simple programs can do."
8. **Did I Test Enough Cases? The Failure of Ruliological Induction**
   gist: Generalizing from many observed cases, as science normally does, can fail for computational systems, because rare bugs may hide until sampling is extensive or exhaustive enough to find them.
   opens: "Scientific induction is a cornerstone of natural science."
9. **Some Typical Ruliological Surprises**
   gist: Across nearly half a century of exploring simple programs, unexpected behavior in cellular automata, Turing machines, combinators, and multiway graphs turns out to be the rule rather than the exception.
   opens: "The computational universe is full of surprises."
10. **Mathematical "Bugs"**
   gist: Mathematics occasionally produces counterexamples to patterns that held for enormous numbers of cases, but mainstream pure mathematics mostly avoids such bugs by focusing on humanly understandable, computationally reducible questions.
   opens: "If “bugs” are so common in ruliology, what about in mathematics?"
11. **Bugs in Practice**
   gist: Avoiding bugs in practice depends on good language design and on finding ways to visually or symbolically 'see inside' a computation, but any program doing real computational work retains some risk of behaving unexpectedly.
   opens: "So let’s say you want to create a program that doesn’t have bugs."
12. **Thanks**
   gist: Acknowledgements to Wolfram Institute colleagues and the Wolfram Software Quality Assurance team.
   opens: "I’d like to thank several members of the Wolfram Institute for their help: Richard Assar, Júlia Campolim, Nik Murzin and Willem Nielsen."

Sampled deeper gists, each beside the prose it stands in for:
- gist: Returning to a Turing machine that appears, across many tested inputs, to always compute n+1 correctly, the question becomes whether this can be formally proven rather than just observed.
  prose: "But What about Formal Proofs? Let’s go back to the Turing machines we discussed above. Consider a machine with the rule:  We can run it for a sequence of inputs n and see that it always seems to compute n + 1:  And indeed looking at the actual behavior of this machine it’s not too difficult to figure out that it must always compute n + 1. But can we formally prove this?…"
- gist: This structural argument proves the cellular automaton always eventually stabilizes and correctly doubles its input, showing that even visually complex behavior can sometimes be proven free of bugs.
  prose: "So, yes, even though the patterns in this case look complicated, they must always eventually stabilize—and the underlying cellular automaton must always correctly “double its input”, with no bugs. If the behavior of a cellular automaton is “visually simple”, we can immediately tell that it won’t show bugs. And if it’s visually complicated we can be concerned that there might be bugs. But there are…"
- gist: Some cellular automata are visually simple enough, or clearly bounded, to guarantee correct doubling, but a less obvious case tested up to 100,000 inputs with no failure shows stabilization time growing roughly linearly yet with unexplained random fluctuations.
  prose: "Can One Tell If There’s Going to Be a Bug? Many of the cellular automata we saw above give patterns that are simple enough that it’s “visually obvious” that they’ll “correctly double” for all input sizes:  Sometimes it’s less obvious, but it still seems fairly clear that nothing can escape a certain envelope, and so there can’t be a bug:  But what about in a case like this:  It looks awfully simil…"
