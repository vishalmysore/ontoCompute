// The two ways the model is asked.
// Prose mode: the facts and the rules go into the prompt as text, and the model has to apply the rules itself.
// Compiled mode: the model only turns the question into a query; the reasoner applies the rules.
import type { World } from "../reason/world.ts";
import type { Answer } from "../reason/query.ts";

/** The three rules, written out in English the way a prose-instruction ontology states them. */
export const PROSE_RULES = [
  "Dependencies are transitive: if A depends on B and B depends on C, then A depends on C. A direct dependency is also a dependency.",
  "A package is exposed to an advisory if it depends, directly or indirectly, on a package that has that advisory.",
  "A package is release-blocked if it is exposed to an advisory whose severity is critical and whose status is open.",
];

export function proseSystem(w: World): string {
  const facts = factLines(w);
  return `You answer questions about a software package ecosystem. Use only the facts and rules below.

Facts:
${facts.join("\n")}

Rules:
${PROSE_RULES.map((r, i) => `${i + 1}. ${r}`).join("\n")}

Work it out briefly, then finish with exactly one line:
ANSWER: <answer>
For a list, give the names separated by commas. For a yes/no question, write yes or no. For "how many", write a number.
If the facts and rules do not contain the information, write: ANSWER: not modeled`;
}

/** The facts as short lines, grouped by subject, the way they would sit in a prompt or a document. */
function factLines(w: World): string[] {
  const bySubject = new Map<string, Map<string, string[]>>();
  for (const t of w.facts) {
    if (t.p === "a") continue;
    const m = bySubject.get(t.s) ?? bySubject.set(t.s, new Map()).get(t.s)!;
    (m.get(t.p) ?? m.set(t.p, []).get(t.p)!).push(t.o);
  }
  const words: Record<string, string> = { directlyDependsOn: "directly depends on", hasAdvisory: "has advisory", severity: "severity", status: "status" };
  const out: string[] = [];
  for (const [s, props] of bySubject) for (const [p, os] of props) out.push(`${s} ${words[p] ?? p} ${os.join(", ")}`);
  const leaves = [...w.schema.entities].filter((e) => w.facts.some((t) => t.s === e && t.o === "Package") && !w.facts.some((t) => t.s === e && t.p === "directlyDependsOn"));
  out.push(`${leaves.join(", ")} depend on nothing.`);
  return out;
}

export function compiledSystem(w: World): string {
  const packages = [...w.schema.entities].filter((e) => w.facts.some((t) => t.s === e && t.o === "Package"));
  const advisories = [...w.schema.entities].filter((e) => w.facts.some((t) => t.s === e && t.o === "Advisory"));
  return `You translate a question about a software package ecosystem into one query. Do not answer it; write only the query, on one line.

Query forms:
SELECT ?x WHERE <pattern> . <pattern>
ASK WHERE <pattern>
COUNT ?x WHERE <pattern>
A pattern is: subject property object. Use ?x, ?a for unknowns.
"Which …" and "What …" questions use SELECT. "Is …" and "Does …" questions use ASK. "How many …" questions use COUNT.

Properties:
directlyDependsOn (package → package, direct only)
dependsOn (package → package, direct or indirect)
hasAdvisory (package → advisory)
exposedTo (package → advisory on anything it depends on)
severity (advisory → critical, high or low)
status (advisory → open or patched)
Classes, used as "?x a Class": Package, Advisory, ReleaseBlocked
Packages: ${packages.join(", ")}
Advisories: ${advisories.join(", ")}
If the question needs a property or class that is not listed, write: NOT_IN_SCHEMA <what is missing>

Examples:
Q: Which packages does pallet depend on directly?
SELECT ?x WHERE pallet directlyDependsOn ?x
Q: Does kestrel depend on brindle, directly or indirectly?
ASK WHERE kestrel dependsOn brindle
Q: Which advisories are critical?
SELECT ?a WHERE ?a severity critical
Q: How many advisories are open?
COUNT ?a WHERE ?a status open
Q: Which high-severity advisories is otter-ui exposed to?
SELECT ?a WHERE otter-ui exposedTo ?a . ?a severity high
Q: Is pallet release-blocked?
ASK WHERE pallet a ReleaseBlocked
Q: How many downloads does skein have?
NOT_IN_SCHEMA downloads`;
}

const ABSTAIN = /not modell?ed|not (in|available|given|provided|specified|stated|mentioned|known)|no information|unknown|cannot (be )?determine|can't determine|insufficient/i;

/** Read a prose-mode reply. `expects` is the kind of answer the question asks for (list, yes/no, number). */
export function parseProse(reply: string, expects: Answer["kind"], names: string[]): Answer {
  const lines = reply.trim().split(/\r?\n/).filter((l) => l.trim());
  const tagged = [...lines].reverse().find((l) => /ANSWER\s*:/i.test(l));
  const line = (tagged ?? lines.at(-1) ?? "").replace(/^.*?ANSWER\s*:\s*/i, "").replace(/[*_`]/g, "").trim();
  if (!line) return { kind: "none", reason: "empty reply" };
  if (ABSTAIN.test(line)) return { kind: "abstain", reason: line };
  if (expects === "bool") {
    if (/^\s*yes\b/i.test(line)) return { kind: "bool", value: true };
    if (/^\s*no\b/i.test(line)) return { kind: "bool", value: false };
    return { kind: "none", reason: `no yes/no in "${line.slice(0, 60)}"` };
  }
  if (expects === "count") {
    const n = line.match(/\b\d+\b/);
    if (n) return { kind: "count", value: Number(n[0]) };
  }
  if (/^\s*(none|nothing|no packages?|no advisories)\b/i.test(line)) return { kind: "set", values: [] };
  // Longest names first so "harbor-cli" is not also read as part of something shorter.
  const found = new Set<string>();
  let rest = line.toLowerCase();
  for (const n of [...names].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`(^|[^a-z0-9-])${n.toLowerCase().replace(/[-]/g, "\\-")}(?![a-z0-9-])`, "g");
    if (re.test(rest)) {
      found.add(n);
      rest = rest.replace(re, "$1 ");
    }
  }
  if (!found.size) return { kind: "none", reason: `no names in "${line.slice(0, 60)}"` };
  if (expects === "count") return { kind: "count", value: found.size };
  return { kind: "set", values: [...found].sort() };
}
