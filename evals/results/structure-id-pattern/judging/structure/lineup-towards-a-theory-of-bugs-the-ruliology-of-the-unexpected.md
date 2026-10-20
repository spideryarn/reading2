# 4 candidates for "Towards a Theory of Bugs: The Ruliology of the Unexpected"

Each candidate is a table of contents that carves the article into sections a first-time reader would navigate by. They are labelled W, X, Y, Z in an order that
says nothing about how any of them was made. The article itself, with its block ids, is
`article-towards-a-theory-of-bugs-the-ruliology-of-the-unexpected.md` beside this file.

## Candidate W

1. **“My Program Did the Wrong Thing!”**
   gist: Even very simple programs can do unexpected things, so bugs can be studied scientifically through the unpredictability of computation.
   opens: "· ~47 min read"
2. **Bugs in Turing Machines**
   gist: Tiny Turing machines that seem to compute n + 1 can hide failures that appear only at large inputs, often those whose binary form is all 1s.
   opens: "To begin our explorations, we’re going to look at a very simple and longstanding model of computation: Turing machines."
3. **What Counts as a Bug?**
   gist: A bug only exists relative to a specification other than the program itself, and for every kind of specification some machines appear to obey it until they suddenly fail.
   opens: "To tell if a program has a bug we have to know what the program is supposed to do—or is not supposed to do."
4. **A Cellular Automaton Example**
   gist: Cellular automata built to double a block of cells show the same pattern: many rules work, but some fail only at inputs like 14, 24 or 32.
   opens: "How does what we’ve seen about “bugs” in simple Turing machines generalize?"
5. **Can One Tell If There’s Going to Be a Bug?**
   gist: Visual simplicity guarantees correctness and visual complexity raises suspicion, but a complicated pattern can still be proven bug-free by seeing how its inner rule works, while others stay undecidable by inspection.
   opens: "Many of the cellular automata we saw above give patterns that are simple enough that it’s “visually obvious” that they’ll “correctly double” for all input sizes:"
6. **But What about Formal Proofs?**
   gist: Formal symbolic proofs can show simple Turing machines never fail, but searching for a proof costs as much as running cases, and no proof exists when a bug does.
   opens: "Let’s go back to the Turing machines we discussed above."
7. **Computational Irreducibility and Bugs**
   gist: Bugs ultimately come from computational irreducibility, since power and unpredictability go together, but pockets of reducibility let us prove some properties of a program, with proofs lengthening as irreducibility grows.
   opens: "We’ve now seen several minimal examples of what we can think of as “bugs”: unexpected things even very simple programs can do."
8. **Did I Test Enough Cases? The Failure of Ruliological Induction**
   gist: Testing and scientific induction fail wherever irreducibility lurks, because bugs can be arbitrarily rare, and exhaustive sampling in ruliology keeps turning up surprises after thousands to trillions of cases.
   opens: "Scientific induction is a cornerstone of natural science."
9. **Some Typical Ruliological Surprises**
   gist: Across cellular automata, Turing machines, combinators and multiway systems, simple rules often behave regularly for a long time before something unexpected happens, so bugs are the rule in ruliology.
   opens: "The computational universe is full of surprises."
10. **Mathematical “Bugs”**
   gist: Mathematics also has counterexamples that appear only astronomically far out, but pure mathematics mostly stays in human-level pockets of reducibility, while experimental mathematics faces the same surprises as ruliology.
   opens: "If “bugs” are so common in ruliology, what about in mathematics?"
11. **Bugs in Practice**
   gist: Since bugs cannot be removed outright, the practical defenses are well-designed languages and seeing inside computations, though deeper bugs persist in conventional programs, AI-written code and trained neural nets.
   opens: "So let’s say you want to create a program that doesn’t have bugs."
12. **Thanks**
   gist: Acknowledgements to Wolfram Institute colleagues, the Software Quality Assurance team and ruliology collaborators.
   opens: "I’d like to thank several members of the Wolfram Institute for their help: Richard Assar, Júlia Campolim, Nik Murzin and Willem Nielsen."

Sampled deeper gists, each beside the prose it stands in for:
- gist: A 3-state machine that looks like it adds 1 gives 9 for input 7, and the glitches recur at inputs of the form 8k – 1, where the head scribbles extra digits.
  prose: "Bugs in Turing Machines To begin our explorations, we’re going to look at a very simple and longstanding model of computation: Turing machines. Consider the (3-state, 2-color) Turing machine with rule:  Imagine we put the binary digits of an integer n initially on the tape of the Turing machine, then run the machine and see what number is on its tape when its head goes further to the right than it…"
- gist: Machines can seem to obey a rule such as no unbounded tape use, no infinite loop, or only even outputs, then break it at n = 42, 151 or 32, so some always escape.
  prose: "Another general type of specification is one that says not what a program should do, but rather what it should not. So, for example, with our Turing machines we could specify that we never want them to “go out of control” and start using unbounded amounts of memory (i.e. tape). Here’s an example of a Turing machine that seems like it’s just happily computing outputs:  But then suddenly, at n = 42,…"
- gist: In a second case the pattern sits inside a leftward-moving white rind and follows rule 122 inside it, which can never die out, so it must always stabilize and double correctly.
  prose: "Well, it turns out that in this case there’s an argument we can give that this will never happen. It’d be very difficult to see this if one just looked at something like stabilization times. But it looks at the whole process of computation—which is easy to do for a cellular automaton—things become clearer. Taking a small example we see two important features: first, the white “rind” always either …"

## Candidate X

1. **“My Program Did the Wrong Thing!”**
   gist: Bugs appear even in very simple programs, so the study of simple programs can explain them; unforeseeable behavior is what we end up calling a bug.
   opens: "· ~47 min read"
2. **Bugs in Turing Machines**
   gist: Small Turing machines that look like they compute n + 1 can fail suddenly at some larger input, and the failures cluster at inputs whose binary digits are all 1s.
   opens: "To begin our explorations, we’re going to look at a very simple and longstanding model of computation: Turing machines."
3. **What Counts as a Bug?**
   gist: A bug exists only relative to a simpler specification, and for each kind of specification we find machines that follow it for a while and then escape it.
   opens: "To tell if a program has a bug we have to know what the program is supposed to do—or is not supposed to do."
4. **A Cellular Automaton Example**
   gist: Cellular automata built to double their input show the same pattern: many work, but some fail only at surprisingly large input sizes.
   opens: "How does what we’ve seen about “bugs” in simple Turing machines generalize?"
5. **Can One Tell If There’s Going to Be a Bug?**
   gist: Simple patterns are visibly safe, but for complicated ones only an argument about the whole computation can show bug-freedom, since statistics like stabilization times cannot.
   opens: "Many of the cellular automata we saw above give patterns that are simple enough that it’s “visually obvious” that they’ll “correctly double” for all input sizes:"
6. **But What about Formal Proofs?**
   gist: Proofs can show simple machines never fail, but a proof is no cheaper than running cases, and a machine with a bug simply has no proof.
   opens: "Let’s go back to the Turing machines we discussed above."
7. **Computational Irreducibility and Bugs**
   gist: Bugs come from computational irreducibility: only running a program reveals what it does, so a useful program is never fully foreseeable, though pockets of predictability allow some guarantees.
   opens: "We’ve now seen several minimal examples of what we can think of as “bugs”: unexpected things even very simple programs can do."
8. **Did I Test Enough Cases? The Failure of Ruliological Induction**
   gist: Testing many cases can fail because bugs may be arbitrarily rare, so inferring a general rule from samples misleads, as it often does in exploring simple programs.
   opens: "Scientific induction is a cornerstone of natural science."
9. **Some Typical Ruliological Surprises**
   gist: Ruliology repeatedly meets sudden, unforeseen behavior in many kinds of systems, so bugs in this sense are the rule rather than the exception.
   opens: "The computational universe is full of surprises."
10. **Mathematical “Bugs”**
   gist: Mathematics has counterexamples too, sometimes astronomically far out, but mainstream pure mathematics mostly stays in human-level pockets of reducibility, while experimental mathematics is as exposed as ruliology.
   opens: "If “bugs” are so common in ruliology, what about in mathematics?"
11. **Bugs in Practice**
   gist: Bug-free programs are impossible when real computation is needed, but good language design and seeing inside a program help, while deeper bugs persist even in AI-built and trained systems.
   opens: "So let’s say you want to create a program that doesn’t have bugs."
12. **Thanks**
   gist: Acknowledgements to colleagues and the software quality team.
   opens: "I’d like to thank several members of the Wolfram Institute for their help: Richard Assar, Júlia Campolim, Nik Murzin and Willem Nielsen."

Sampled deeper gists, each beside the prose it stands in for:
- gist: A 3-state machine seems to compute n + 1, but at input 7 it outputs 9; its glitches recur at inputs of the form 8k – 1.
  prose: "Bugs in Turing Machines To begin our explorations, we’re going to look at a very simple and longstanding model of computation: Turing machines. Consider the (3-state, 2-color) Turing machine with rule:  Imagine we put the binary digits of an integer n initially on the tape of the Turing machine, then run the machine and see what number is on its tape when its head goes further to the right than it…"
- gist: Stabilization time grows roughly linearly, but random-looking fluctuations leave no way to be sure they will never cause a bug.
  prose: "What about a case like this:  Will the pattern always be “contained”, or will there eventually be a “leak” that leads to a bug? Once again we can plot the stabilization time, which again seems to increase close to linearly—and is now well fit by 9n:  There are random-looking fluctuations though:  And the question again is whether these will ever somehow “go wild”, and lead to a bug.…"
- gist: Writing the tape and rules as symbolic expressions and axioms lets us state that the machine computes n + 1 as one finite claim covering all inputs.
  prose: "But What about Formal Proofs? Let’s go back to the Turing machines we discussed above. Consider a machine with the rule:  We can run it for a sequence of inputs n and see that it always seems to compute n + 1:  And indeed looking at the actual behavior of this machine it’s not too difficult to figure out that it must always compute n + 1. But can we formally prove this? To set up a streamlined pro…"

## Candidate Y

1. **“My Program Did the Wrong Thing!”**
   gist: Bugs can be studied scientifically, since even tiny programs show them, and the unforeseeable behavior of simple programs explains why they arise.
   opens: "· ~47 min read"
2. **Bugs in Turing Machines**
   gist: Tiny Turing machines that seem to add 1 to a number fail at surprisingly large inputs, such as 7 or 63.
   opens: "To begin our explorations, we’re going to look at a very simple and longstanding model of computation: Turing machines."
3. **What Counts as a Bug?**
   gist: A bug exists only relative to a specification other than the program itself, and for every kind of specification some machines obey it until suddenly failing.
   opens: "To tell if a program has a bug we have to know what the program is supposed to do—or is not supposed to do."
4. **A Cellular Automaton Example**
   gist: Cellular automata built to double their input show the same pattern: many work, but some fail only after a long wait.
   opens: "How does what we’ve seen about “bugs” in simple Turing machines generalize?"
5. **Can One Tell If There’s Going to Be a Bug?**
   gist: Visual simplicity can rule out bugs, but complicated cases cannot be settled by testing or fluctuation statistics, though a structural argument sometimes proves no bug ever occurs.
   opens: "Many of the cellular automata we saw above give patterns that are simple enough that it’s “visually obvious” that they’ll “correctly double” for all input sizes:"
6. **But What about Formal Proofs?**
   gist: Formal proofs can show some machines never fail, but a proof is no cheaper than running the machine, and no proof exists for a buggy one.
   opens: "Let’s go back to the Turing machines we discussed above."
7. **Computational Irreducibility and Bugs**
   gist: Bugs ultimately come from computational irreducibility, where behavior can only be found by running the program, and that is also what makes computation worth doing.
   opens: "We’ve now seen several minimal examples of what we can think of as “bugs”: unexpected things even very simple programs can do."
8. **Did I Test Enough Cases? The Failure of Ruliological Induction**
   gist: Testing many cases and assuming the pattern holds fails in the study of simple programs, because bugs can be arbitrarily rare and show up only after huge numbers of samples.
   opens: "Scientific induction is a cornerstone of natural science."
9. **Some Typical Ruliological Surprises**
   gist: Across rules, machines, initial conditions and other systems, surprising behavior appears often and late, so bugs are the rule rather than the exception in this field.
   opens: "The computational universe is full of surprises."
10. **Mathematical “Bugs”**
   gist: Mathematics has counterexamples like x105 – 1 and a prime-count flip, but pure mathematics mostly stays in human-level pockets of predictability, though experimental mathematics is exposed like ruliology.
   opens: "If “bugs” are so common in ruliology, what about in mathematics?"
11. **Bugs in Practice**
   gist: Bugs cannot be eliminated from useful programs, but good language design, seeing inside the computation, and tolerating some approximation help, and bugs count as discoveries in science.
   opens: "So let’s say you want to create a program that doesn’t have bugs."
12. **Thanks**
   gist: Acknowledgements to colleagues and the quality assurance team.
   opens: "I’d like to thank several members of the Wolfram Institute for their help: Richard Assar, Júlia Campolim, Nik Murzin and Willem Nielsen."

Sampled deeper gists, each beside the prose it stands in for:
- gist: A program is meant to follow a simple picture in our heads, but even simple programs can compute in ways we cannot foresee, and we call those surprises bugs.
  prose: "When we write a program we normally know what we want the program to do. And if in some case it unexpectedly doesn’t do it, we consider that a bug. In more abstract terms, we normally have in our minds a representation for what the program should do. And for it to fit in our minds this has to be computationally quite simple. But then the question is whether the computational process associated wit…"
- gist: Specifications can forbid behaviors like unbounded tape use, infinite loops or odd outputs, yet some machines appear to obey until a late input, like n = 42, 151 or 32.
  prose: "Another general type of specification is one that says not what a program should do, but rather what it should not. So, for example, with our Turing machines we could specify that we never want them to “go out of control” and start using unbounded amounts of memory (i.e. tape). Here’s an example of a Turing machine that seems like it’s just happily computing outputs:  But then suddenly, at n = 42,…"
- gist: Some patterns obviously double correctly, but others look like known buggy ones, and the stabilization time fits a trend with random-looking fluctuations that nothing can bound.
  prose: "Can One Tell If There’s Going to Be a Bug? Many of the cellular automata we saw above give patterns that are simple enough that it’s “visually obvious” that they’ll “correctly double” for all input sizes:  Sometimes it’s less obvious, but it still seems fairly clear that nothing can escape a certain envelope, and so there can’t be a bug:  But what about in a case like this:  It looks awfully simil…"

## Candidate Z

1. **My Program Did the Wrong Thing!**
   gist: Bugs appear even in very simple programs, and unpredictable computation explains why neither humans nor automated tools can fully root them out.
   opens: "· ~47 min read"
2. **Bugs in Turing Machines**
   gist: Simple Turing machines that seem to compute n + 1 can fail suddenly at larger inputs, and such late failures are common.
   opens: "To begin our explorations, we’re going to look at a very simple and longstanding model of computation: Turing machines."
3. **What Counts as a Bug?**
   gist: A bug is a mismatch with a simpler specification, whether a rival program, a forbidden behavior or a required property, and every kind of specification gets escaped.
   opens: "To tell if a program has a bug we have to know what the program is supposed to do—or is not supposed to do."
4. **Telling If a Bug Will Occur**
   gist: Cellular automata doubling their input show that simple pictures prove correctness, complex ones raise doubt, and formal proofs help only in pockets and bring no advantage over running.
   opens: "How does what we’ve seen about “bugs” in simple Turing machines generalize?"
5. **Computational Irreducibility and Bugs**
   gist: Bugs ultimately come from computational irreducibility: useful programs must hold unforeseeable behavior, with only pockets of predictability where we can guarantee some properties.
   opens: "We’ve now seen several minimal examples of what we can think of as “bugs”: unexpected things even very simple programs can do."
6. **Did I Test Enough Cases?**
   gist: Testing by sampling cannot give certainty, since bugs can be arbitrarily rare and rare phenomena keep turning up whenever ruliology samples more exhaustively.
   opens: "Scientific induction is a cornerstone of natural science."
7. **Surprises and Mathematical Bugs**
   gist: Ruliology is full of sudden surprises that act like bugs, and mathematics has counterexamples too but mostly stays in pockets of reducibility.
   opens: "The computational universe is full of surprises."
8. **Bugs in Practice**
   gist: Good language design and seeing inside a computation help most, but deeper bugs remain for any program doing irreducible work, including AI-trained ones.
   opens: "So let’s say you want to create a program that doesn’t have bugs."

Sampled deeper gists, each beside the prose it stands in for:
- gist: Cellular automata built to double a block of cells also show late bugs, appearing at sizes such as 14, 24 or 32 after seeming to work.
  prose: "A Cellular Automaton Example How does what we’ve seen about “bugs” in simple Turing machines generalize? As another example, let’s look at cellular automata. And in particular, let’s look at cellular automata that are set up to “double their input” in the sense that starting with a block of n (non-white) cells, they yield 2n (non-white) cells:  As with our Turing machine examples above, there are …"
- gist: Symbolic axioms and induction can prove that simple Turing machines always compute n + 1, but buggy machines yield no proof and proving costs as much as running.
  prose: "But What about Formal Proofs? Let’s go back to the Turing machines we discussed above. Consider a machine with the rule:  We can run it for a sequence of inputs n and see that it always seems to compute n + 1:  And indeed looking at the actual behavior of this machine it’s not too difficult to figure out that it must always compute n + 1. But can we formally prove this? To set up a streamlined pro…"
- gist: Rule 30, rare Turing machines, a cellular automaton changing at input 97,439 and a combinator halting after 137,356,329 steps show that long-quiet systems can suddenly surprise.
  prose: "Some Typical Ruliological Surprises The computational universe is full of surprises. And in my (nearly) half century of exploring it with ruliology, I’ve seen a very large number of them. In fact, in my experience it’s very rare to do ruliology and not have surprises. In some ways it’s a humbling experience—if also an inspiring one. You imagine you know how things are going to work. And then the u…"
