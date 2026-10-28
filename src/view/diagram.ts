// The world as a Mermaid flowchart for Pele: packages, their direct dependencies, and advisories.
// Inferred triples are drawn dashed and only when asked for: all of them, or just the ones a proof used.
import type { Triple } from "../reason/engine.ts";
import type { World } from "../reason/world.ts";

export interface Highlight {
  answer?: string[]; // names to mark as the answer
  focus?: string[]; // names the question mentions
  proof?: Set<string>; // triple keys to draw, stated or inferred
}

const id = (name: string) => "n_" + name.replace(/[^A-Za-z0-9]/g, "_");

export function worldDiagram(w: World, opt: { allInferred: boolean; direction: "LR" | "TB" }, hl: Highlight = {}): string {
  const has = (s: string, p: string, o: string) => w.kb.triples.has(`${s} ${p} ${o}`);
  const packages = [...w.schema.entities].filter((e) => has(e, "a", "Package"));
  const advisories = [...w.schema.entities].filter((e) => has(e, "a", "Advisory"));
  const value = (s: string, p: string) => w.facts.find((t) => t.s === s && t.p === p)?.o ?? "?";

  const lines = [`flowchart ${opt.direction}`];
  for (const p of packages) lines.push(`  ${id(p)}["${p}"]`);
  for (const a of advisories) lines.push(`  ${id(a)}{{"${a} · ${value(a, "severity")} · ${value(a, "status")}"}}`);

  const stated = w.facts.filter((t) => t.p === "directlyDependsOn" || t.p === "hasAdvisory");
  for (const t of stated) lines.push(`  ${id(t.s)} ${t.p === "hasAdvisory" ? "---" : "-->"} ${id(t.o)}`);

  const drawn = new Set(stated.map((t) => `${t.s} ${t.p} ${t.o}`));
  const extra: Triple[] = [];
  const pick = (t: Triple) => {
    if (t.p !== "dependsOn" && t.p !== "exposedTo") return;
    if (has(t.s, "directlyDependsOn", t.o) && t.p === "dependsOn") return; // already drawn as a direct edge
    const k = `${t.s} ${t.p} ${t.o}`;
    if (!drawn.has(k)) {
      drawn.add(k);
      extra.push(t);
    }
  };
  if (opt.allInferred) w.kb.inferred().forEach(pick);
  for (const k of hl.proof ?? []) {
    const t = w.kb.triples.get(k);
    if (t) pick(t);
  }
  for (const t of extra) lines.push(`  ${id(t.s)} -. ${t.p} .-> ${id(t.o)}`);

  const blocked = packages.filter((p) => has(p, "a", "ReleaseBlocked"));
  const showBlocked = opt.allInferred || [...(hl.proof ?? [])].some((k) => k.endsWith(" a ReleaseBlocked"));
  const classes: [string, string[]][] = [
    ["adv", advisories],
    ["critical", advisories.filter((a) => value(a, "severity") === "critical" && value(a, "status") === "open")],
    ["blocked", showBlocked ? blocked : []],
    ["focus", hl.focus ?? []],
    ["answer", hl.answer ?? []],
  ];
  for (const [cls, names] of classes) if (names.length) lines.push(`  class ${names.map(id).join(",")} ${cls}`);
  return lines.join("\n");
}
