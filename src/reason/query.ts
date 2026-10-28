// The query language the model writes in compiled mode. Small on purpose, so a 1.5B model can keep to it:
//   SELECT ?x WHERE harbor-cli dependsOn ?x
//   ASK WHERE otter-ui a ReleaseBlocked
//   COUNT ?x WHERE ?x dependsOn tinyhash . ?x a Package
//   NOT_IN_SCHEMA maintainer
// A query that names a property, class or package the ontology does not have comes back as a typed
// "not in schema" answer, not as an error: the system knows what it does not model.
import { isVar, type Pattern } from "./engine.ts";
import { clean } from "./world.ts";
import type { World } from "./world.ts";

export type Answer =
  | { kind: "set"; values: string[] }
  | { kind: "bool"; value: boolean }
  | { kind: "count"; value: number }
  | { kind: "abstain"; reason: string }
  | { kind: "none"; reason: string }; // nothing usable came back

export interface Query {
  form: "SELECT" | "ASK" | "COUNT";
  variable: string;
  patterns: Pattern[];
  text: string;
}

export function parseQuery(text: string): Query | Answer {
  const line = text
    .replace(/```[a-z]*/gi, "")
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^(query|answer|a)\s*:\s*/i, ""))
    .find((l) => /^(SELECT|ASK|COUNT|NOT_IN_SCHEMA)\b/i.test(l));
  if (!line) return { kind: "none", reason: "no query in the reply" };
  const ns = line.match(/^NOT_IN_SCHEMA\b\s*(.*)$/i);
  if (ns) return { kind: "abstain", reason: `not in schema: ${ns[1].trim() || "?"}` };

  const m = line.replace(/\bDISTINCT\s+/i, "").replace(/^COUNT\s*\(\s*(\?\w+)\s*\)/i, "COUNT $1").match(/^(SELECT|ASK|COUNT)\s*(\?\w+)?\s*(?:WHERE)?\s*\{?\s*(.*?)\s*\}?\s*\.?$/i);
  if (!m) return { kind: "none", reason: `cannot read "${line}"` };
  const form = m[1].toUpperCase() as Query["form"];
  const patterns: Pattern[] = [];
  for (const part of m[3].split(/\s+(?:\.|AND)\s+|\s*\.\s+(?=\S)|\s*;\s*/i)) {
    const toks = part.trim().replace(/\.$/, "").split(/\s+/).filter(Boolean).map(clean);
    if (!toks.length) continue;
    if (toks.length !== 3) return { kind: "none", reason: `a pattern needs three parts: "${part.trim()}"` };
    patterns.push({ s: toks[0], p: toks[1], o: toks[2] });
  }
  if (!patterns.length) return { kind: "none", reason: "the query has no patterns" };
  const vars = patterns.flatMap((p) => [p.s, p.p, p.o]).filter(isVar);
  const variable = m[2] ?? vars[0] ?? "?x";
  return { form, variable, patterns, text: line };
}

/** Names in the query that the ontology does not have. Matching ignores case, then the query is rewritten to the real spelling. */
export function checkSchema(q: Query, w: World): string[] {
  const missing: string[] = [];
  const lookup = (set: Set<string>, t: string) => [...set].find((x) => x.toLowerCase() === t.toLowerCase());
  for (const p of q.patterns) {
    if (!isVar(p.p) && p.p !== "a") {
      const real = lookup(w.schema.properties, p.p);
      if (real) p.p = real;
      else missing.push(`property ${p.p}`);
    }
    for (const side of ["s", "o"] as const) {
      const t = p[side];
      if (isVar(t)) continue;
      const pool = p.p === "a" && side === "o" ? w.schema.classes : w.schema.entities;
      const real = lookup(pool, t) ?? lookup(w.schema.entities, t) ?? lookup(w.schema.classes, t);
      if (real) p[side] = real;
      else missing.push(`${p.p === "a" && side === "o" ? "class" : "name"} ${t}`);
    }
  }
  return missing;
}

export function runQuery(text: string, w: World): { answer: Answer; query?: Query } {
  const q = parseQuery(text);
  if (!("form" in q)) return { answer: q };
  const missing = checkSchema(q, w);
  if (missing.length) return { answer: { kind: "abstain", reason: `not in schema: ${missing.join(", ")}` }, query: q };
  const rows = w.kb.solve(q.patterns);
  if (q.form === "ASK") return { answer: { kind: "bool", value: rows.length > 0 }, query: q };
  const values = [...new Set(rows.map((r) => r.binding.get(q.variable)).filter((v): v is string => !!v))].sort();
  if (q.form === "COUNT") return { answer: { kind: "count", value: values.length }, query: q };
  return { answer: { kind: "set", values }, query: q };
}

/** The triples behind an answer, for the proof panel and the diagram highlight. */
export function support(text: string, w: World): string[] {
  const q = parseQuery(text);
  if (!("form" in q) || checkSchema(q, w).length) return [];
  const keys = new Set<string>();
  for (const r of w.kb.solve(q.patterns)) for (const k of r.premises) keys.add(k);
  return [...keys];
}

export function answerKey(a: Answer): string {
  switch (a.kind) {
    case "set":
      return a.values.length ? a.values.join(", ") : "(none)";
    case "bool":
      return a.value ? "yes" : "no";
    case "count":
      return String(a.value);
    case "abstain":
      return "not modeled";
    case "none":
      return "no answer";
  }
}

/** Whether `got` is the right answer. A list is accepted for a count question if it has the right size. */
export function isCorrect(gold: Answer, got: Answer): boolean {
  if (gold.kind === "abstain") return got.kind === "abstain";
  if (gold.kind === "count" && got.kind === "set") return got.values.length === gold.value;
  if (gold.kind === "set" && gold.values.length === 0 && got.kind === "count") return got.value === 0;
  return answerKey(gold) === answerKey(got) && gold.kind === got.kind;
}
