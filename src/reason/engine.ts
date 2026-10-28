// A small forward-chaining reasoner. Every rule, whether it came from an OWL axiom or from rules.txt,
// is the same thing here: a list of triple patterns that, when they all match, add one triple.
// It runs to a fixpoint and remembers the first way it derived each triple, so any answer can show its proof.

export type Term = string; // "?x" is a variable, anything else a local name
export interface Pattern {
  s: Term;
  p: Term;
  o: Term;
}
export interface Triple {
  s: string;
  p: string;
  o: string;
}
export interface Rule {
  id: string; // "transitive dependsOn", "chain exposedTo", "rule 3", …
  from: string; // the axiom or line it was compiled from, shown on the page
  body: Pattern[];
  head: Pattern;
}
export interface Derivation {
  rule: Rule;
  premises: string[]; // triple keys
}

export const key = (t: Triple) => `${t.s} ${t.p} ${t.o}`;
export const isVar = (t: Term) => t.startsWith("?");

type Binding = Map<string, string>;

export class KB {
  readonly triples = new Map<string, Triple>();
  /** null for asserted triples, the rule and premises for inferred ones. */
  readonly why = new Map<string, Derivation | null>();
  private byP = new Map<string, Triple[]>();
  rounds = 0;
  ms = 0;

  readonly rules: Rule[];

  constructor(asserted: Triple[], rules: Rule[]) {
    this.rules = rules;
    for (const t of asserted) this.add(t, null);
    const t0 = performance.now();
    this.saturate();
    this.ms = performance.now() - t0;
  }

  private add(t: Triple, d: Derivation | null): boolean {
    const k = key(t);
    if (this.triples.has(k)) return false;
    this.triples.set(k, t);
    this.why.set(k, d);
    (this.byP.get(t.p) ?? this.byP.set(t.p, []).get(t.p)!).push(t);
    return true;
  }

  /** Apply every rule until a whole round adds nothing. Naive, but the worlds here have a few hundred triples. */
  private saturate() {
    for (let changed = true; changed; ) {
      changed = false;
      this.rounds++;
      for (const rule of this.rules) {
        for (const { binding, premises } of this.solve(rule.body)) {
          const t = { s: subst(rule.head.s, binding), p: subst(rule.head.p, binding), o: subst(rule.head.o, binding) };
          if (this.add(t, { rule, premises })) changed = true;
        }
      }
    }
  }

  /** Every way the patterns can all match, left to right. */
  solve(body: Pattern[]): { binding: Binding; premises: string[] }[] {
    let partial: { binding: Binding; premises: string[] }[] = [{ binding: new Map(), premises: [] }];
    for (const pat of body) {
      const next: typeof partial = [];
      for (const { binding, premises } of partial) {
        const p = subst(pat.p, binding);
        const candidates = isVar(p) ? [...this.triples.values()] : (this.byP.get(p) ?? []);
        for (const t of candidates) {
          const b = unify(pat, t, binding);
          if (b) next.push({ binding: b, premises: [...premises, key(t)] });
        }
      }
      partial = next;
      if (!partial.length) break;
    }
    return partial;
  }

  inferred(): Triple[] {
    return [...this.triples.entries()].filter(([k]) => this.why.get(k)).map(([, t]) => t);
  }

  /** Every triple used anywhere in the proofs of `keys`, the keys included. */
  proofOf(keys: string[]): Set<string> {
    const out = new Set<string>();
    const walk = (k: string) => {
      if (out.has(k)) return;
      out.add(k);
      for (const p of this.why.get(k)?.premises ?? []) walk(p);
    };
    keys.forEach(walk);
    return out;
  }

  /** The proof of a triple as indented lines, asserted facts at the leaves. */
  explain(k: string, depth = 0, seen = new Set<string>()): string[] {
    const pad = "  ".repeat(depth);
    const d = this.why.get(k);
    if (d === undefined) return [`${pad}${k}  (not known)`];
    if (d === null) return [`${pad}${k}  (stated)`];
    if (seen.has(k)) return [`${pad}${k}  (see above)`];
    seen.add(k);
    return [`${pad}${k}  ← ${d.rule.id}`, ...d.premises.flatMap((p) => this.explain(p, depth + 1, seen))];
  }
}

function subst(t: Term, b: Binding): string {
  return isVar(t) ? (b.get(t) ?? t) : t;
}

function unify(pat: Pattern, t: Triple, b: Binding): Binding | null {
  let out: Binding | null = null;
  for (const [term, value] of [
    [pat.s, t.s],
    [pat.p, t.p],
    [pat.o, t.o],
  ] as const) {
    if (!isVar(term)) {
      if (term !== value) return null;
      continue;
    }
    const bound = (out ?? b).get(term);
    if (bound === undefined) (out ??= new Map(b)).set(term, value);
    else if (bound !== value) return null;
  }
  return out ?? b;
}
