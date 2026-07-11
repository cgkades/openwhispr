const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../src/helpers/localReasoningOptions.js");

test("cleanup (no systemPrompt override) pins temperature to 0", async () => {
  const { buildLocalReasoningOptions } = await load();
  const options = buildLocalReasoningOptions({ disableThinking: true }, "cleanup prompt");
  assert.equal(options.temperature, 0);
  assert.equal(options.systemPrompt, "cleanup prompt");
  assert.equal(options.disableThinking, true);
});

test("cleanup respects an explicit temperature, including 0", async () => {
  const { buildLocalReasoningOptions } = await load();
  assert.equal(buildLocalReasoningOptions({ temperature: 0.4 }, "p").temperature, 0.4);
  assert.equal(buildLocalReasoningOptions({ temperature: 0 }, "p").temperature, 0);
});

test("agent path (config.systemPrompt set) does not inject a temperature", async () => {
  const { buildLocalReasoningOptions } = await load();
  const config = { systemPrompt: "agent prompt", disableThinking: false };
  const options = buildLocalReasoningOptions(config, "agent prompt");
  assert.equal("temperature" in options, false);
  assert.equal(options.systemPrompt, "agent prompt");
  assert.equal(options.disableThinking, false);
});
