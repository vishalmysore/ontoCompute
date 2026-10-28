// Turn a Turtle ontology and a rules file into facts and executable rules.
// The OWL axioms are compiled, not interpreted: each one becomes a rule the engine runs.
import { Parser, type Quad } from "n3";
import { KB, type Pattern, type Rule, type Triple } from "./engine.ts";

const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const OWL = "http://www.w3.org/2002/07/owl#";
const SCHEMA_PREDICATES = new Set([RDFS + "subPropertyOf", RDFS + "subClassOf", RDFS + "domain", RDFS + "range", RDFS + "comment", RDFS + "label", OWL + "propertyChainAxiom", OWL + "inverseOf"]);
const OWL_TYPES = new Set([OWL + "Class", OWL + "ObjectProperty", OWL + "DatatypeProperty", OWL + "TransitiveProperty", OWL + "SymmetricProperty", OWL + "Ontology"]);

export const local = (iri: string) => (iri === RDF + "type" ? "a" : iri.replace(/^.*[#/]/, ""));

export interface Schema {
  properties: Set<string>;
  classes: Set<string>;
  entities: Set<string>; // every individual named in the facts
}

export interface World {
  facts: Triple[];
  rules: Rule[];
  schema: Schema;
  kb: KB;
}

export interface WorldOptions {
  /** Rule ids to leave out, e.g. "transitive dependsOn": used to show what an answer looks like without that rule. */
  without?: string[];
}

export function buildWorld(ttl: string, rulesText: string, opt: WorldOptions = {}): World {
  const quads = new Parser().parse(ttl);
  const facts: Triple[] = [];
  const rules: Rule[] = [];
  const schema: Schema = { properties: new Set(), classes: new Set(), entities: new Set() };
  const lists = listReader(quads);

  for (const q of quads) {
    const s = q.subject.value;
    const p = q.predicate.value;
    const o = q.object.value;
    if (p === RDF + "first" || p === RDF + "rest") continue;
    const S = local(s);
    const O = local(o);

    if (p === RDF + "type" && OWL_TYPES.has(o)) {
      if (o === OWL + "Class") schema.classes.add(S);
      else schema.properties.add(S);
      if (o === OWL + "TransitiveProperty")
        rules.push({ id: `transitive ${S}`, from: `:${S} a owl:TransitiveProperty`, body: [pat("?x", S, "?y"), pat("?y", S, "?z")], head: pat("?x", S, "?z") });
      if (o === OWL + "SymmetricProperty") rules.push({ id: `symmetric ${S}`, from: `:${S} a owl:SymmetricProperty`, body: [pat("?x", S, "?y")], head: pat("?y", S, "?x") });
      continue;
    }
    if (p === RDFS + "subPropertyOf") rules.push({ id: `${S} ⊑ ${O}`, from: `:${S} rdfs:subPropertyOf :${O}`, body: [pat("?x", S, "?y")], head: pat("?x", O, "?y") });
    if (p === RDFS + "subClassOf") rules.push({ id: `${S} ⊑ ${O}`, from: `:${S} rdfs:subClassOf :${O}`, body: [pat("?x", "a", S)], head: pat("?x", "a", O) });
    if (p === OWL + "inverseOf") {
      rules.push({ id: `inverse ${S}`, from: `:${S} owl:inverseOf :${O}`, body: [pat("?x", S, "?y")], head: pat("?y", O, "?x") });
      rules.push({ id: `inverse ${O}`, from: `:${S} owl:inverseOf :${O}`, body: [pat("?x", O, "?y")], head: pat("?y", S, "?x") });
    }
    if (p === OWL + "propertyChainAxiom") {
      const chain = lists(o).map(local);
      const vars = chain.map((_, i) => `?x${i}`).concat(`?x${chain.length}`);
      rules.push({
        id: `chain ${S}`,
        from: `:${S} owl:propertyChainAxiom ( ${chain.map((c) => ":" + c).join(" ")} )`,
        body: chain.map((c, i) => pat(vars[i], c, vars[i + 1])),
        head: pat("?x0", S, vars[chain.length]),
      });
    }
    if (SCHEMA_PREDICATES.has(p)) continue;
    if (p === RDF + "type") {
      if (schema.classes.has(O) || !o.startsWith(OWL)) schema.classes.add(O);
    } else schema.properties.add(local(p));
    facts.push({ s: S, p: local(p), o: O });
  }

  rules.push(...parseRules(rulesText));
  for (const r of rules) for (const b of [...r.body, r.head]) if (b.p !== "a" && !b.p.startsWith("?")) schema.properties.add(b.p);
  for (const t of facts) {
    if (!schema.classes.has(t.s) && !schema.properties.has(t.s)) schema.entities.add(t.s);
    if (t.p !== "a" && !schema.classes.has(t.o)) schema.entities.add(t.o);
  }

  const kept = opt.without?.length ? rules.filter((r) => !opt.without!.includes(r.id)) : rules;
  return { facts, rules: kept, schema, kb: new KB(facts, kept) };
}

/** rules.txt: `IF <pattern> AND <pattern> … THEN <pattern>`, one rule per line, `#` comments. */
export function parseRules(text: string): Rule[] {
  const out: Rule[] = [];
  let n = 3; // rules 1 and 2 are the OWL axioms in the ontology
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = line.match(/^IF\s+(.+?)\s+THEN\s+(.+)$/i);
    if (!m) throw new Error(`Cannot read rule: ${line}`);
    const body = m[1].split(/\s+AND\s+/i).map(parsePattern);
    out.push({ id: `rule ${n++}`, from: line, body, head: parsePattern(m[2]) });
  }
  return out;
}

export function parsePattern(text: string): Pattern {
  const parts = text.trim().split(/\s+/).map(clean);
  if (parts.length !== 3) throw new Error(`A pattern needs subject, property and object: "${text.trim()}"`);
  return pat(parts[0], parts[1], parts[2]);
}

/** Accept `:name`, `<…#name>`, `rdf:type`, quotes and stray punctuation the way people and models write them. */
export function clean(tok: string): string {
  let t = tok.replace(/^[<"'`(]+|[>"'`),;]+$/g, "");
  if (/^(rdf:type|type|isA|a)$/i.test(t)) return "a";
  t = t.replace(/^[a-z]*:(?!\/)/i, "");
  return t.replace(/^.*[#/]/, "");
}

const pat = (s: string, p: string, o: string): Pattern => ({ s, p, o });

function listReader(quads: Quad[]) {
  const first = new Map<string, string>();
  const rest = new Map<string, string>();
  for (const q of quads) {
    if (q.predicate.value === RDF + "first") first.set(q.subject.value, q.object.value);
    if (q.predicate.value === RDF + "rest") rest.set(q.subject.value, q.object.value);
  }
  return (head: string): string[] => {
    const out: string[] = [];
    for (let n = head; n && n !== RDF + "nil" && out.length < 50; n = rest.get(n)!) {
      const v = first.get(n);
      if (v === undefined) break;
      out.push(v);
    }
    return out;
  };
}
