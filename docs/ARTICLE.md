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

All twelve questions, five runs each in each mode, temperature 0.7, on two models running on a laptop's integrated GPU: 240 runs in total.

| | Prose | Compiled | Reasoner only |
|---|---|---|---|
| Qwen2.5-7B | 32 of 60 (53%) | 60 of 60 (100%) | 12 of 12 |
| Qwen2.5-3B | 30 of 60 (50%) | 39 of 60 (65%) | 12 of 12 |

![Qwen2.5-7B after all 120 runs, with the join question selected](images/run-qwen2.5-7b.png)

Per question, for Qwen2.5-7B (right out of five):

| Question | Shape | Prose | Compiled |
|---|---|---|---|
| Which packages does harbor-core depend on directly? | direct | 5 | 5 |
| Which packages does harbor-cli depend on, directly or indirectly? | chain | 4 | 5 |
| Does otter-ui depend on quill, directly or indirectly? | chain | 1 | 5 |
| Does ferrous-json depend on brindle, directly or indirectly? | chain | 5 | 5 |
| Which packages depend on brindle, directly or indirectly? | chain | 0 | 5 |
| How many packages depend on tinyhash, directly or indirectly? | chain | 0 | 5 |
| Which advisories is pallet exposed to? | property chain | 0 | 5 |
| Which packages are release-blocked? | join | 0 | 5 |
| Is otter-ui release-blocked? | join | 4 | 5 |
| Is kestrel release-blocked? | join | 3 | 5 |
| Who maintains quill? | not modeled | 5 | 5 |
| When was ADV-105 published? | not modeled | 5 | 5 |

The larger model barely moved prose mode, from 50% to 53%. It moved compiled mode from 65% to 100%. Applying English rules is the hard part, and it stayed hard. Translating a question into a query is the easy part, and the larger model did it without a single mistake.

Three things stand out in the wrong answers.

**Consistent is not the same as correct.** On "which packages are release-blocked?" the 7B model gave the same wrong list, harbor-cli and otter-ui, all five times. On "how many packages depend on tinyhash?" it said 3 all five times; the answer is 4. Repeating a question exposes randomness, but a model that is wrong the same way every time passes that test. Only an answer that is computed catches it.

**Missing steps can be named.** On "does otter-ui depend on quill?", four of the five prose runs said no, and the page labelled each one *stopped at direct dependencies*: quill is four hops away, through pallet, lattice and mothball. On "is otter-ui release-blocked?", the one wrong run is the answer you get when a clause of the join is dropped. The property chain question, "which advisories is pallet exposed to?", was never answered correctly in prose by either model.

**Compiled failures are visible.** The smaller model's compiled mistakes were all translation mistakes: a typo in a package name, SPARQL syntax the query language doesn't accept, an invented "publishedOn" property, or the maintainer question turned into an unrelated yes/no query. Every one of them is a one-line query you can read and see is wrong. A wrong prose answer is just a wrong list. To be fair to prose mode, the 3B model was better at saying "not modeled" in prose (10 of 10) than through a query (2 of 10).

Speed was about the same in both modes for each model: around 13 seconds a run for 3B and 30 seconds for 7B, almost all of it the model reading its prompt. The reasoner takes under 4 milliseconds.

These are small models on a laptop, not the large hosted models in Cekikj's study, and a larger model will apply English rules more reliably. What doesn't depend on the model is that compiled mode can't drop a clause and has no randomness of its own: once the query is written, the answer is fixed. The raw results for both models are in the repository under `docs/results/`.

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
