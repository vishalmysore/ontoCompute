import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { render } from "pele";
import { buildWorld } from "../src/reason/world.ts";
import { worldDiagram } from "../src/view/diagram.ts";

const ttl = readFileSync(new URL("../public/world/packages.ttl", import.meta.url), "utf8");
const rules = readFileSync(new URL("../public/world/rules.txt", import.meta.url), "utf8");
const world = buildWorld(ttl, rules);

test("the world diagram renders with Pele, with and without inferred edges", () => {
  for (const allInferred of [false, true]) {
    const text = worldDiagram(world, { allInferred, direction: "LR" }, { answer: ["quill"], focus: ["otter-ui"], proof: world.kb.proofOf(["otter-ui dependsOn quill"]) });
    const { svg } = render(text);
    assert.match(svg, /<svg/);
    assert.match(svg, /harbor-cli/);
    assert.ok(text.includes("-. dependsOn .->"));
  }
});
