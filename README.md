# OntoCompute

**Rules as code, not prose.** An ontology can state a rule two ways:

- **Prose:** write the rule as English sentences and let a language model apply it while it reads the facts.
- **Compiled:** write the rule as an OWL axiom or a Datalog rule, let a reasoner apply it, and use the model only to turn the question into a query.

OntoCompute asks the same twelve questions both ways, several times each, in a browser tab. For every question it shows how often the answer was right, how many *different* answers came back, and how long it took. A third column runs a hand-written query on the reasoner with no model at all.

Live demo: https://vishalmysore.github.io/ontoCompute/ · Article: [docs/ARTICLE.md](docs/ARTICLE.md)

Inspired by Miodrag Cekikj, ["Give the Knowledge Layer Something to Compute: Foundry IQ and the Fabric IQ Ontology, Measured"](https://medium.com/p/56aea5e1549f) (AI Advances, October 2026).

## The world

An invented open-source package ecosystem (`public/world/packages.ttl`): 14 packages, direct dependencies up to four hops deep, and five security advisories with a severity and a status. Three rules sit on top:

| # | In English (prose mode) | As code (compiled mode) |
|---|---|---|
| 1 | Dependencies are transitive; a direct dependency is a dependency. | `:dependsOn a owl:TransitiveProperty` and `:directlyDependsOn rdfs:subPropertyOf :dependsOn` |
| 2 | A package is exposed to every advisory on anything it depends on. | `:exposedTo owl:propertyChainAxiom ( :dependsOn :hasAdvisory )` |
| 3 | A package is release-blocked if it is exposed to an advisory whose severity is critical **and** whose status is open. | `IF ?p exposedTo ?a AND ?a severity critical AND ?a status open THEN ?p a ReleaseBlocked` |

Rule 3 is a join: two conditions on the same advisory. When a model applies it one clause at a time, the answer changes in a recognisable way, so the page can tell which clause was dropped. For every question it computes the "rule applied halfway" answers (no transitivity, a missing clause) and labels a wrong run that matches one.

## The questions

Twelve questions, tagged by shape: a direct lookup, transitive chains (yes/no, list, reverse, count), a property chain, the join rule, and two questions the ontology does not model at all (who maintains a package, when an advisory was published). The right answer for "not modeled" is to say so. In compiled mode that is a typed result, `NOT_IN_SCHEMA maintainer`, not an error.

Gold answers come from running hand-written queries on the reasoner, and `tests/questions.test.ts` pins every one against answers worked out by hand.

## How it works

- `src/reason/world.ts` reads the Turtle with N3.js and compiles the OWL axioms (`TransitiveProperty`, `SymmetricProperty`, `subPropertyOf`, `subClassOf`, `inverseOf`, `propertyChainAxiom`) and the rules file into one kind of rule: triple patterns in, one triple out.
- `src/reason/engine.ts` runs those rules forward to a fixpoint and records the first derivation of every triple, so each answer comes with a step-by-step proof.
- `src/reason/query.ts` is the small query language the model writes in compiled mode (`SELECT ?x WHERE harbor-cli dependsOn ?x`, `ASK …`, `COUNT …`, `NOT_IN_SCHEMA …`). Unknown properties, classes or names become a "not in schema" answer.
- `src/llm/prompts.ts` holds both prompts and the parser for prose replies.
- The diagram is drawn with [Pele](https://pele.run). Stated dependencies are solid; inferred triples are dashed and appear for the selected question's proof, or all at once.
- Models run on your GPU with [WebLLM](https://github.com/mlc-ai/web-llm). Every run is a fresh conversation at the temperature you pick.

## Run it

```bash
npm install
npm run dev
```

```bash
npm test
```

Needs a browser with WebGPU (recent Chrome or Edge) for the model columns. The reasoner column, proofs and diagram work without one.

## License

MIT
