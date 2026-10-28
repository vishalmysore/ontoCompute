import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildWorld } from "../src/reason/world.ts";
import { answerKey, runQuery, isCorrect, parseQuery } from "../src/reason/query.ts";
import { QUESTIONS } from "../src/world/questions.ts";

const ttl = readFileSync(new URL("../public/world/packages.ttl", import.meta.url), "utf8");
const rules = readFileSync(new URL("../public/world/rules.txt", import.meta.url), "utf8");
const world = buildWorld(ttl, rules);

// Worked out by hand from the facts, independently of the reasoner.
const EXPECTED: Record<string, string> = {
  Q1: "cobweb-http, ferrous-json",
  Q2: "brindle, cobweb-http, ferrous-json, harbor-core, nimbus-log, skein, tinyhash",
  Q3: "yes",
  Q4: "no",
  Q5: "cobweb-http, harbor-cli, harbor-core, kestrel, skein",
  Q6: "4",
  Q7: "ADV-104, ADV-105",
  Q8: "cobweb-http, harbor-cli, harbor-core, kestrel, skein",
  Q9: "no",
  Q10: "yes",
  Q11: "not modeled",
  Q12: "not modeled",
};

test("the ontology compiles to the expected rules", () => {
  const ids = world.rules.map((r) => r.id).sort();
  assert.deepEqual(ids, ["ReleaseBlocked ⊑ Package", "chain exposedTo", "directlyDependsOn ⊑ dependsOn", "rule 3", "transitive dependsOn"]);
  assert.ok(world.schema.properties.has("exposedTo"));
  assert.ok(world.schema.classes.has("ReleaseBlocked"));
  assert.ok(world.schema.entities.has("harbor-cli") && world.schema.entities.has("ADV-101") && world.schema.entities.has("critical"));
});

for (const q of QUESTIONS)
  test(`${q.id} gold answer: ${q.text}`, () => {
    assert.equal(answerKey(runQuery(q.query, world).answer), EXPECTED[q.id]);
  });

test("each miss gives a different, wrong answer", () => {
  for (const q of QUESTIONS) {
    const gold = runQuery(q.query, world).answer;
    for (const m of q.misses ?? []) {
      const w = buildWorld(ttl, m.rules ?? rules, { without: m.without });
      const got = runQuery(q.query, w).answer;
      assert.ok(!isCorrect(gold, got), `${q.id}: "${m.label}" should change the answer`);
    }
  }
});

test("dropping a clause of the join rule changes Q8 in a recognisable way", () => {
  const noStatus = buildWorld(ttl, "IF ?p exposedTo ?a AND ?a severity critical THEN ?p a ReleaseBlocked");
  assert.equal(answerKey(runQuery("SELECT ?x WHERE ?x a ReleaseBlocked", noStatus).answer), "cobweb-http, ferrous-json, harbor-cli, harbor-core, kestrel, lattice, mothball, otter-ui, pallet, skein");
});

test("queries are read the way models write them", () => {
  const ok = (text: string, expected: string) => assert.equal(answerKey(runQuery(text, world).answer), expected, text);
  ok("```\nSELECT ?x WHERE { :harbor-core :directlyDependsOn ?x . }\n```", "cobweb-http, ferrous-json");
  ok("Query: ASK WHERE Otter-UI dependsOn quill", "yes");
  ok("COUNT(?x) WHERE ?x dependsOn tinyhash", "4");
  ok("SELECT DISTINCT ?p WHERE ?p exposedTo ?a . ?a severity critical . ?a status open", "cobweb-http, harbor-cli, harbor-core, kestrel, skein");
  ok("SELECT ?x WHERE quill maintainer ?x", "not modeled");
  assert.equal(runQuery("SELECT ?x WHERE quill maintainer ?x", world).answer.kind, "abstain");
  assert.equal(parseQuery("I think the answer is harbor-cli").kind, "none");
});

test("proofs reach stated facts", () => {
  const lines = world.kb.explain("otter-ui dependsOn quill");
  assert.match(lines[0], /transitive dependsOn/);
  assert.ok(lines.some((l) => l.includes("mothball directlyDependsOn quill  (stated)")));
});
