// The page: one world, twelve questions, two ways to answer each, run several times.
import { render as peleRender, enableZoom, type Zoom } from "pele";
import { buildWorld, type World } from "./reason/world.ts";
import { answerKey, isCorrect, runQuery, support, type Answer } from "./reason/query.ts";
import { QUESTIONS, type Question, type Miss } from "./world/questions.ts";
import { Model, modelChoices, hasWebGPU } from "./llm/engine.ts";
import { PROSE_RULES, compiledSystem, parseProse, proseSystem } from "./llm/prompts.ts";
import { worldDiagram, type Highlight } from "./view/diagram.ts";

type Mode = "prose" | "compiled";
const MODES: Mode[] = ["prose", "compiled"];

interface Run {
  answer: Answer;
  correct: boolean;
  key: string;
  seconds: number;
  tokens: number;
  raw: string;
  query?: string;
  misses: string[];
}

interface Saved {
  model: string;
  temperature: number;
  results: Record<string, Record<Mode, Run[]>>;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const secs = (s: number) => (isNaN(s) ? "–" : s < 0.0001 ? "< 0.1 ms" : s < 0.01 ? `${(s * 1000).toFixed(2)} ms` : s < 1 ? `${Math.round(s * 1000)} ms` : `${s.toFixed(1)} s`);

let ttl = "";
let rulesText = "";
let world: World;
const gold = new Map<string, Answer>();
const goldSeconds = new Map<string, number>();
const missAnswers = new Map<string, { miss: Miss; answer: Answer }[]>();
let saved: Saved = { model: "", temperature: 0, results: {} };
let selected = "Q8";
let model: Model | null = null;
let running = false;
let stopping = false;
let zoom: Zoom | undefined;

const STORE = "ontocompute.results.v1";

async function init() {
  [ttl, rulesText] = await Promise.all(["./world/packages.ttl", "./world/rules.txt"].map((u) => fetch(u).then((r) => r.text())));
  world = buildWorld(ttl, rulesText);
  for (const q of QUESTIONS) {
    const t = performance.now();
    gold.set(q.id, runQuery(q.query, world).answer);
    goldSeconds.set(q.id, (performance.now() - t) / 1000);
    missAnswers.set(
      q.id,
      (q.misses ?? []).map((miss) => ({ miss, answer: runQuery(q.query, buildWorld(ttl, miss.rules ?? rulesText, { without: miss.without })).answer })),
    );
  }
  try {
    const s = JSON.parse(localStorage.getItem(STORE) ?? "null");
    if (s?.results) saved = s;
  } catch {
    /* private window or blocked storage: start empty */
  }
  renderRules();
  renderTable();
  renderSummary();
  select(selected);
  setupModelPicker();
  wire();
}

// ---------- rules card ----------

function renderRules() {
  const r = world.rules;
  const byId = (id: string) => r.find((x) => x.id === id);
  const code = [
    [byId("transitive dependsOn"), byId("directlyDependsOn ⊑ dependsOn")],
    [byId("chain exposedTo")],
    [byId("rule 3")],
  ];
  const kinds = ["OWL: owl:TransitiveProperty + rdfs:subPropertyOf", "OWL 2: owl:propertyChainAxiom", "Datalog / SWRL-style rule (a join)"];
  $("rules").innerHTML = PROSE_RULES.map(
    (en, i) => `<li>
      <p class="en">${esc(en)}</p>
      <div class="kind">${kinds[i]}</div>
      <pre class="code">${code[i]
        .filter(Boolean)
        .map((x) => esc(x!.from))
        .join("\n")}</pre>
    </li>`,
  ).join("");
  $("ttl").textContent = ttl;
  $("rules-src").textContent = rulesText;
}

// ---------- results table ----------

function letterMap(qid: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const mode of MODES) for (const r of saved.results[qid]?.[mode] ?? []) if (!m.has(r.key)) m.set(r.key, String.fromCharCode(65 + (m.size % 26)));
  return m;
}

function cell(q: Question, mode: Mode, letters: Map<string, string>, live: boolean): string {
  const runs = saved.results[q.id]?.[mode] ?? [];
  const dots = runs.map((r) => `<span class="dot ${r.correct ? "ok" : "bad"}" title="${esc(r.key)}">${letters.get(r.key)}</span>`).join("") + (live ? `<span class="dot live"></span>` : "");
  if (!runs.length && !live) return `<td class="cell"><span class="muted small">not run</span></td>`;
  const right = runs.filter((r) => r.correct).length;
  const distinct = new Set(runs.map((r) => r.key)).size;
  const steady = runs.length > 1 ? (distinct === 1 ? `<span class="steady">same every time</span>` : `<span class="varies">${distinct} answers</span>`) : "";
  const meta = runs.length ? `${right}/${runs.length} right · ${steady ? steady + " · " : ""}${secs(median(runs.map((r) => r.seconds)))}` : "";
  return `<td class="cell"><div class="dots">${dots}</div><div class="meta">${meta}</div></td>`;
}

function row(q: Question, live: Mode | null = null): string {
  const letters = letterMap(q.id);
  const g = gold.get(q.id)!;
  const shapeCls = q.shape === "join" ? "join" : q.shape === "not modeled" ? "not" : "";
  return `<tr data-q="${q.id}" class="${q.id === selected ? "sel" : ""}">
    <td class="q"><span class="shape ${shapeCls}">${q.shape}</span>${esc(q.text)}<small>${q.id}</small></td>
    <td class="gold">${esc(answerKey(g))}</td>
    ${cell(q, "prose", letters, live === "prose")}
    ${cell(q, "compiled", letters, live === "compiled")}
    <td class="cell"><div class="dots"><span class="dot ok">✓</span></div><div class="meta">always right · ${secs(goldSeconds.get(q.id)!)}</div></td>
  </tr>`;
}

function renderTable() {
  $("grid").querySelector("tbody")!.innerHTML = QUESTIONS.map((q) => row(q)).join("");
}

function renderRow(q: Question, live: Mode | null = null) {
  const tr = $("grid").querySelector(`tr[data-q="${q.id}"]`);
  if (tr) tr.outerHTML = row(q, live);
}

function renderSummary() {
  const shapes = [...new Set(QUESTIONS.map((q) => q.shape))];
  const card = (mode: Mode | "reasoner") => {
    const title = { prose: "Prose", compiled: "Compiled", reasoner: "Reasoner only" }[mode];
    if (mode === "reasoner") {
      const inferred = world.kb.inferred().length;
      return `<div class="sum"><h2>${title}</h2><div class="big">100%</div>
        <div class="stats"><span>Same answer every time</span><b>${QUESTIONS.length}/${QUESTIONS.length}</b>
        <span>Inferred triples</span><b>${inferred} in ${world.kb.rounds} rounds</b>
        <span>Time to infer them</span><b>${secs(world.kb.ms / 1000)}</b></div>
        <div class="shapes">No model: hand-written queries. The upper bound for compiled mode.</div></div>`;
    }
    const all = QUESTIONS.flatMap((q) => (saved.results[q.id]?.[mode] ?? []).map((r) => ({ q, r })));
    if (!all.length) return `<div class="sum"><h2>${title}</h2><div class="big muted">–</div><p class="muted small">Load a model and run the questions.</p></div>`;
    const asked = QUESTIONS.filter((q) => saved.results[q.id]?.[mode]?.length);
    const steady = asked.filter((q) => new Set(saved.results[q.id][mode].map((r) => r.key)).size === 1).length;
    const always = asked.filter((q) => saved.results[q.id][mode].every((r) => r.correct)).length;
    const acc = all.filter((x) => x.r.correct).length / all.length;
    const byShape = shapes
      .map((s) => {
        const xs = all.filter((x) => x.q.shape === s);
        return xs.length ? `${s} ${Math.round((100 * xs.filter((x) => x.r.correct).length) / xs.length)}%` : "";
      })
      .filter(Boolean)
      .join(" · ");
    return `<div class="sum"><h2>${title}</h2><div class="big">${Math.round(acc * 100)}%</div>
      <div class="stats"><span>Runs</span><b>${all.length}</b>
      <span>Right every time</span><b>${always}/${asked.length}</b>
      <span>Same answer every time</span><b>${steady}/${asked.length}</b>
      <span>Median time</span><b>${secs(median(all.map((x) => x.r.seconds)))}</b></div>
      <div class="shapes">${byShape}</div></div>`;
  };
  $("summary").innerHTML = card("prose") + card("compiled") + card("reasoner");
  const n = Object.values(saved.results).reduce((a, r) => a + MODES.reduce((b, m) => b + (r[m]?.length ?? 0), 0), 0);
  ($("dl-json") as HTMLButtonElement).disabled = !n;
  $("hud").textContent = n ? `${saved.model} · temperature ${saved.temperature}` : "";
}

// ---------- detail panel and diagram ----------

function mentioned(text: string): string[] {
  return [...world.schema.entities].filter((e) => new RegExp(`(^|[^A-Za-z0-9-])${e.replace(/-/g, "\\-")}(?![A-Za-z0-9-])`, "i").test(text));
}

function select(qid: string) {
  selected = qid;
  const q = QUESTIONS.find((x) => x.id === qid)!;
  $("grid").querySelectorAll("tr[data-q]").forEach((tr) => tr.classList.toggle("sel", (tr as HTMLElement).dataset.q === qid));
  renderDetail(q);
  const g = gold.get(q.id)!;
  const keys = support(q.query, world);
  draw({ answer: g.kind === "set" ? g.values : [], focus: mentioned(q.text), proof: world.kb.proofOf(keys) });
}

function renderDetail(q: Question) {
  const g = gold.get(q.id)!;
  const keys = support(q.query, world);
  const proof = keys.flatMap((k) => world.kb.explain(k)).slice(0, 60);
  const misses = missAnswers.get(q.id) ?? [];
  const runList = (mode: Mode) => {
    const runs = saved.results[q.id]?.[mode] ?? [];
    if (!runs.length) return `<p class="muted small">No ${mode} runs yet.</p>`;
    return `<ul class="runs">${runs
      .map(
        (r, i) => `<li>${r.correct ? "✓" : "✗"} <b>${esc(r.key)}</b> <span class="muted">· ${secs(r.seconds)}</span>
        ${r.misses.length ? `<div class="why">Looks like it ${esc(r.misses.join(", or "))}.</div>` : ""}
        ${r.query ? `<div><code>${esc(r.query)}</code></div>` : ""}
        <details><summary class="muted small">Run ${i + 1}: model reply</summary><pre>${esc(r.raw)}</pre></details></li>`,
      )
      .join("")}</ul>`;
  };
  $("detail").innerHTML = `
    <h2>${q.id} · ${q.shape}</h2>
    <h3>${esc(q.text)}</h3>
    <div><span class="muted small">Right answer</span><br /><b>${esc(answerKey(g))}</b>${g.kind === "abstain" ? ` <span class="muted small">(${esc(g.reason)})</span>` : ""}</div>
    <div><span class="muted small">Hand-written query</span><pre>${esc(q.query)}</pre></div>
    ${proof.length ? `<div><span class="muted small">Why, step by step (from the reasoner)</span><pre>${esc(proof.join("\n"))}</pre></div>` : ""}
    ${misses.length ? `<div><span class="muted small">What a rule applied halfway gives</span><ul class="misses">${misses.map((m) => `<li>${esc(m.miss.label)}: <b>${esc(answerKey(m.answer))}</b></li>`).join("")}</ul></div>` : ""}
    <div><h2>Prose runs</h2>${runList("prose")}</div>
    <div><h2>Compiled runs</h2>${runList("compiled")}</div>`;
}

let lastHighlight: Highlight = {};
function draw(hl: Highlight = lastHighlight) {
  lastHighlight = hl;
  const text = worldDiagram(world, { allInferred: ($("all-inferred") as HTMLInputElement).checked, direction: ($("direction") as HTMLSelectElement).value as "LR" | "TB" }, hl);
  const stage = $("stage");
  try {
    stage.innerHTML = peleRender(text, { fontFamily: getComputedStyle(stage).getPropertyValue("--pele-font").trim() || undefined }).svg;
    if (!zoom) zoom = enableZoom(stage, { always: true, maxScale: 6 });
    else zoom.refresh();
  } catch (e) {
    stage.textContent = `Diagram error: ${(e as Error).message}`;
  }
}

// ---------- running the model ----------

function setupModelPicker() {
  const sel = $("model") as HTMLSelectElement;
  const { ids, preferred } = modelChoices();
  sel.innerHTML = ids.map((id) => `<option ${id === preferred ? "selected" : ""}>${id}</option>`).join("");
  if (!hasWebGPU()) {
    $("gpu-note").innerHTML = `<span class="error">This browser has no WebGPU, so the model columns cannot run here.</span> The reasoner column, the proofs and the diagram still work. Try a recent Chrome or Edge.`;
    for (const id of ["run-all", "run-one", "own-run"]) ($(id) as HTMLButtonElement).disabled = true;
  }
}

async function ensureModel(): Promise<Model> {
  const id = ($("model") as HTMLSelectElement).value;
  if (model?.id === id) return model;
  if (model) await model.unload();
  model = null;
  const bar = $("progress-bar");
  (bar.parentElement as HTMLElement).hidden = false;
  model = await Model.load(id, (text, f) => {
    bar.style.width = `${Math.round(f * 100)}%`;
    status(text);
  });
  (bar.parentElement as HTMLElement).hidden = true;
  return model;
}

const status = (t: string) => ($("llm-status").textContent = t);
const temperature = () => Number(($("temp") as HTMLSelectElement).value);
const live = (t: string) => {
  const raw = $("raw");
  raw.textContent = t;
  raw.scrollTop = raw.scrollHeight;
};

function expects(g: Answer): Answer["kind"] {
  return g.kind === "abstain" || g.kind === "none" ? "set" : g.kind;
}

/** Names the parser may read as an answer: every package and advisory, minus the ones the question itself names. */
function answerNames(text: string): string[] {
  const named = new Set(mentioned(text));
  return [...world.schema.entities].filter((e) => !named.has(e) && (world.kb.triples.has(`${e} a Package`) || world.kb.triples.has(`${e} a Advisory`)));
}

async function ask(m: Model, mode: Mode, text: string, expected: Answer["kind"]): Promise<Omit<Run, "correct" | "misses">> {
  if (mode === "prose") {
    const r = await m.ask(proseSystem(world), text, { temperature: temperature(), maxTokens: 450 }, live);
    const answer = parseProse(r.text, expected, answerNames(text));
    return { answer, key: answerKey(answer), seconds: r.seconds, tokens: r.tokens, raw: r.text };
  }
  const r = await m.ask(compiledSystem(world), text, { temperature: temperature(), maxTokens: 80 }, live);
  const t = performance.now();
  const { answer, query } = runQuery(r.text, world);
  return { answer, key: answerKey(answer), seconds: r.seconds + (performance.now() - t) / 1000, tokens: r.tokens, raw: r.text, query: query?.text };
}

async function runQuestions(qs: Question[]) {
  const modes = MODES.filter((m) => ($(`m-${m}`) as HTMLInputElement).checked);
  if (!modes.length) return status("Tick at least one mode.");
  const n = Number(($("runs") as HTMLSelectElement).value);
  setRunning(true);
  try {
    const m = await ensureModel();
    if (saved.model !== m.id || saved.temperature !== temperature()) {
      // Results from another model or temperature are not comparable: start a fresh table.
      saved = { model: m.id, temperature: temperature(), results: {} };
      renderTable();
    }
    const total = qs.length * n * modes.length;
    let done = 0;
    for (const q of qs) {
      for (let i = 0; i < n && !stopping; i++) {
        for (const mode of modes) {
          if (stopping) break;
          status(`${q.id}, ${mode} mode, run ${i + 1} of ${n} (${done}/${total})`);
          renderRow(q, mode);
          const g = gold.get(q.id)!;
          const r = await ask(m, mode, q.text, expects(g));
          if (stopping && r.key === "no answer") break; // interrupted mid-reply: not a real run
          const correct = isCorrect(g, r.answer);
          const misses = correct ? [] : (missAnswers.get(q.id) ?? []).filter((x) => isCorrect(x.answer, r.answer)).map((x) => x.miss.label);
          const res = (saved.results[q.id] ??= { prose: [], compiled: [] });
          res[mode].push({ ...r, correct, misses });
          done++;
          renderRow(q);
          renderSummary();
          if (q.id === selected) renderDetail(q);
          persist();
        }
      }
      if (stopping) break;
    }
    status(stopping ? "Stopped." : `Done: ${done} runs.`);
  } catch (e) {
    status(`Error: ${(e as Error).message}`);
    console.error(e);
  } finally {
    setRunning(false);
    renderTable();
  }
}

async function askOwn() {
  const text = ($("own") as HTMLInputElement).value.trim();
  if (!text) return;
  const out = $("own-out");
  setRunning(true);
  try {
    const m = await ensureModel();
    out.innerHTML = "";
    for (const mode of MODES) {
      status(`Your question, ${mode} mode…`);
      const r = await ask(m, mode, text, /^(is|does|do|are|can|has)\b/i.test(text) ? "bool" : /how many/i.test(text) ? "count" : "set");
      out.insertAdjacentHTML(
        "beforeend",
        `<div><b>${mode === "prose" ? "Prose" : "Compiled"}:</b> ${esc(r.key)} <span class="muted">· ${secs(r.seconds)}</span>${r.query ? `<br /><code>${esc(r.query)}</code>` : ""}</div>`,
      );
      if (mode === "compiled" && r.query) draw({ answer: r.answer.kind === "set" ? r.answer.values : [], focus: mentioned(text), proof: world.kb.proofOf(support(r.raw, world)) });
    }
    status("");
  } catch (e) {
    status(`Error: ${(e as Error).message}`);
  } finally {
    setRunning(false);
  }
}

function setRunning(on: boolean) {
  running = on;
  stopping = false;
  for (const id of ["run-all", "run-one", "own-run", "clear"]) ($(id) as HTMLButtonElement).disabled = on;
  ($("stop") as HTMLButtonElement).disabled = !on;
}

function persist() {
  try {
    localStorage.setItem(STORE, JSON.stringify(saved));
  } catch {
    /* storage full or blocked: results stay on the page */
  }
}

function wire() {
  $("grid").addEventListener("click", (e) => {
    const tr = (e.target as HTMLElement).closest("tr[data-q]") as HTMLElement | null;
    if (tr) select(tr.dataset.q!);
  });
  $("run-all").onclick = () => void runQuestions(QUESTIONS);
  $("run-one").onclick = () => void runQuestions(QUESTIONS.filter((q) => q.id === selected));
  $("own-run").onclick = () => void askOwn();
  $("own").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !running) void askOwn();
  });
  $("stop").onclick = () => {
    stopping = true;
    model?.interrupt();
  };
  $("clear").onclick = () => {
    saved = { model: "", temperature: 0, results: {} };
    persist();
    renderTable();
    renderSummary();
    select(selected);
  };
  $("dl-json").onclick = () => {
    const rows = QUESTIONS.map((q) => ({ id: q.id, shape: q.shape, question: q.text, gold: answerKey(gold.get(q.id)!), ...saved.results[q.id] }));
    const blob = new Blob([JSON.stringify({ model: saved.model, temperature: saved.temperature, questions: rows }, null, 2)], { type: "application/json" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "ontocompute-results.json" });
    a.click();
    URL.revokeObjectURL(a.href);
  };
  $("all-inferred").onchange = () => draw();
  $("direction").onchange = () => draw();
}

void init();
