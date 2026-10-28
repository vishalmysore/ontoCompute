# Rules as Code, Not Prose: Letting an Ontology Compute Its Own Rules in a Browser Tab

*Inspired by Miodrag Cekikj, ["Give the Knowledge Layer Something to Compute: Foundry IQ and the Fabric IQ Ontology, Measured"](https://medium.com/p/56aea5e1549f), AI Advances, October 2026.*

![OntoCompute: the rules both ways, the question grid, the proof for the selected question, and the inferred triples drawn on the dependency graph](images/page.png)

## The problem

Miodrag Cekikj's article is a careful measurement of what happens when Microsoft's knowledge layer gets an ontology as a source. The result most people will remember is the good one: a multi-hop dependency chain that document retrieval never answered fell once an ontology was attached. The details around that result are just as interesting:

- A rule with two clauses (a join) was applied one clause at a time. It never came back fully right.
- The same question, sent word for word, often got different answers on different runs.
- When the ontology honestly reported that something was not modeled, and it was the only source, the caller received an error instead of that answer.
- Each answer took about half a minute.

Cekikj places most of this in the connection between the ontology and the layer that asks it, and that reading holds. One thing runs through the whole setup: the rules were written in English for a language model to interpret. The transitive rule was two sentences. The join rule was a sentence. Nothing executed them.

That's an old problem with an old answer. OWL has had `owl:TransitiveProperty` since 2004, and property chains since OWL 2 in 2009. Rules with joins are what SWRL and Datalog are for. A rule written as an axiom gets *run*, so it gives the same answer every time and applies every clause.

OntoCompute puts both approaches side by side so you can watch the difference instead of reading about it.

## What it does

OntoCompute is a single web page. It holds an invented open-source package ecosystem: 14 packages, dependency chains up to four hops deep, and five security advisories, each with a severity and a status. Three rules sit on top of the facts:

| # | In English | As code |
|---|---|---|
| 1 | Dependencies are transitive. A direct dependency is a dependency. | `:dependsOn a owl:TransitiveProperty` and `:directlyDependsOn rdfs:subPropertyOf :dependsOn` |
| 2 | A package is exposed to every advisory on anything it depends on. | `:exposedTo owl:propertyChainAxiom ( :dependsOn :hasAdvisory )` |
| 3 | A package is release-blocked if it is exposed to an advisory that is critical **and** open. | `IF ?p exposedTo ?a AND ?a severity critical AND ?a status open THEN ?p a ReleaseBlocked` |

Rule 3 is the join. It has two conditions on the same advisory, so it plays the role of the two-clause rule in Cekikj's measurements.

The page asks twelve questions, each tagged by shape: a direct lookup, transitive chains (yes/no, list, reverse, count), a property chain, the join rule, and two questions the ontology doesn't model at all, such as "Who maintains quill?" Every question is answered three ways:

- **Prose.** The facts and the three English rules go into the prompt. The model reads them and works the answer out. This is the "rules in plain words" approach.
- **Compiled.** The model only translates the question into a one-line query, such as `SELECT ?x WHERE ?x a ReleaseBlocked`. A reasoner runs that query over every triple the rules imply.
- **Reasoner only.** The same reasoner runs a hand-written query with no model at all. This is the upper bound for compiled mode, and the source of the right answers.

Each question can be asked several times in each mode. For every question the page shows how often the answer was right, how many *different* answers came back, and how long a run took.

Everything runs in the browser tab. The reasoner is a few hundred lines of TypeScript. The model runs on your own GPU through WebLLM. Nothing is sent anywhere.

## How the compiled side works

The ontology is plain Turtle. On load, each OWL axiom is compiled into a rule of one simple form: a few triple patterns in, one triple out. `TransitiveProperty`, `subPropertyOf`, `propertyChainAxiom`, `subClassOf`, `inverseOf` and the Datalog-style rules file all become that one form.

The reasoner applies the rules repeatedly until nothing new appears. In this world that's 54 inferred triples in four rounds, in well under a millisecond. It also remembers how it derived each triple, so every answer comes with a step-by-step proof down to the stated facts. For example, kestrel is release-blocked because it depends on skein, skein depends on brindle, brindle has advisory ADV-101, and ADV-101 is critical and open.

Two more things come out of this design:

**"Not modeled" is an answer, not an error.** If the model's query uses a property, class or name the ontology doesn't have, the result is `NOT_IN_SCHEMA maintainer`, a typed answer a caller can act on, for example by falling through to documents. That's the failure Cekikj saw turn into an HTTP 502, handled as ordinary data.

**Wrong answers can be diagnosed.** For each question, the page also computes what you'd get if a rule were applied halfway: without transitivity, or with one clause of the join dropped. When a prose answer is wrong and matches one of those, the page labels it, for example "stopped at direct dependencies." A wrong answer becomes a specific missing step.

## What it showed

One run in my browser: Qwen2.5-3B, temperature 0.7, three runs per question, on the five questions that cover the main shapes. Two prose runs on the harbor-cli chain question went through before I stopped the run.

| Question | Prose | Compiled |
|---|---|---|
| Which packages does harbor-core depend on directly? | 2 of 3 right, 2 different answers | 3 of 3, same answer every time |
| Which packages does harbor-cli depend on, directly or indirectly? | 0 of 2 right, 2 different answers | 2 of 2 |
| Which packages are release-blocked? (join) | 0 of 3 right, 3 different answers | 3 of 3, same answer every time |
| Is otter-ui release-blocked? (join) | 3 of 3 | 3 of 3 |
| Is kestrel release-blocked? (join) | 1 of 3 right | 3 of 3 |

Prose mode got 43% of its runs right; compiled mode got all of them.

The wrong answers are the interesting part. In two of the three kestrel runs, the model answered "no" and the page labelled them *stopped at direct dependencies*: kestrel is blocked through skein to brindle, two hops away, and the model never followed the path past skein. One of the harbor-cli runs listed only the two direct dependencies; the other walked most of the chain but left out brindle, four hops down. On "which packages are release-blocked?" the three prose runs gave three different wrong lists. In compiled mode the model wrote the same one-line query every time, and the reasoner returned the same five packages every time.

This is a small model on a laptop GPU, not the large hosted models in Cekikj's study. A bigger model will apply English rules more reliably. The page lets you pick larger models and repeat the runs. What doesn't depend on the model is that compiled mode can't drop a clause and has no randomness of its own: once the query is written, the answer is fixed. The model's job shrinks to translation, which even a small model does well.

Speed was similar in both modes, about 10 to 12 seconds a run, mostly spent reading the prompt. The reasoner itself takes under a millisecond. Prose mode gets slow when the model starts reasoning out loud: one chain question took 75 seconds and was still wrong.

## Why this is useful

- **For anyone building on an ontology:** if a rule can be written as an axiom, write it as an axiom. Use transitivity, property chains and a rules engine for joins. Let the language model do what it's good at, turning a person's question into a query, and let the reasoner do the counting and the chaining.
- **For anyone evaluating a knowledge layer:** ask each question more than once. A single run hides the variance; repeated runs show whether an answer is stable.
- **For anyone designing the "I don't know" path:** make "not modeled" a typed result. Then the layer above can route the question to documents instead of failing.
- **For teaching:** the page shows each rule in English next to its OWL form, draws the inferred triples on the graph, and gives a proof for every answer. It shows what "the ontology computes it" means.

## Try it

- Live: https://vishalmysore.github.io/ontoCompute/
- Code: https://github.com/vishalmysore/ontoCompute

Pick a model, choose how many runs per question, and press **Run every question**, or select one row and run just that question. The reasoner column, the proofs and the diagram work even in a browser without WebGPU. Results are measured in your browser and depend on the model, the temperature and your GPU.

Everything in the package ecosystem is invented. Credit for the measurements that prompted this goes to Miodrag Cekikj's article above; OntoCompute is an independent companion demo and isn't connected to that work or to Microsoft.
