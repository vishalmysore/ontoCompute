// The questions, tagged by shape. Each has a hand-written query: running it on the reasoner gives the gold answer,
// so the gold answers are computed once, not typed in (tests/questions.test.ts pins them).
// `misses` are the usual ways to get it wrong: the same query on a world with one rule removed or loosened.
// A wrong answer that equals one of them says which rule, or which clause, was not applied.

export type Shape = "direct" | "chain" | "chain property" | "join" | "not modeled";

export interface Miss {
  label: string;
  without?: string[]; // rule ids to drop
  rules?: string; // replacement rules.txt
}

export interface Question {
  id: string;
  shape: Shape;
  text: string;
  query: string;
  misses?: Miss[];
}

const NO_TRANSITIVE: Miss = { label: "stopped at direct dependencies", without: ["transitive dependsOn"] };
const DROP_STATUS: Miss = { label: "dropped the clause “status is open”", rules: "IF ?p exposedTo ?a AND ?a severity critical THEN ?p a ReleaseBlocked" };
const DROP_SEVERITY: Miss = { label: "dropped the clause “severity is critical”", rules: "IF ?p exposedTo ?a AND ?a status open THEN ?p a ReleaseBlocked" };
const JOIN_MISSES = [DROP_STATUS, DROP_SEVERITY, NO_TRANSITIVE];

export const QUESTIONS: Question[] = [
  { id: "Q1", shape: "direct", text: "Which packages does harbor-core depend on directly?", query: "SELECT ?x WHERE harbor-core directlyDependsOn ?x" },
  { id: "Q2", shape: "chain", text: "Which packages does harbor-cli depend on, directly or indirectly?", query: "SELECT ?x WHERE harbor-cli dependsOn ?x", misses: [NO_TRANSITIVE] },
  { id: "Q3", shape: "chain", text: "Does otter-ui depend on quill, directly or indirectly?", query: "ASK WHERE otter-ui dependsOn quill", misses: [NO_TRANSITIVE] },
  { id: "Q4", shape: "chain", text: "Does ferrous-json depend on brindle, directly or indirectly?", query: "ASK WHERE ferrous-json dependsOn brindle" },
  { id: "Q5", shape: "chain", text: "Which packages depend on brindle, directly or indirectly?", query: "SELECT ?x WHERE ?x dependsOn brindle", misses: [NO_TRANSITIVE] },
  { id: "Q6", shape: "chain", text: "How many packages depend on tinyhash, directly or indirectly?", query: "COUNT ?x WHERE ?x dependsOn tinyhash", misses: [NO_TRANSITIVE] },
  { id: "Q7", shape: "chain property", text: "Which advisories is pallet exposed to?", query: "SELECT ?a WHERE pallet exposedTo ?a", misses: [NO_TRANSITIVE] },
  { id: "Q8", shape: "join", text: "Which packages are release-blocked?", query: "SELECT ?x WHERE ?x a ReleaseBlocked", misses: JOIN_MISSES },
  { id: "Q9", shape: "join", text: "Is otter-ui release-blocked?", query: "ASK WHERE otter-ui a ReleaseBlocked", misses: [DROP_STATUS, DROP_SEVERITY] },
  { id: "Q10", shape: "join", text: "Is kestrel release-blocked?", query: "ASK WHERE kestrel a ReleaseBlocked", misses: [NO_TRANSITIVE] },
  { id: "Q11", shape: "not modeled", text: "Who maintains quill?", query: "NOT_IN_SCHEMA maintainer" },
  { id: "Q12", shape: "not modeled", text: "When was ADV-105 published?", query: "NOT_IN_SCHEMA publishedDate" },
];
