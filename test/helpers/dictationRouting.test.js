const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../../src/helpers/dictationRouting.js");

test("voice agent hotkey routes to the agent without a wake word", async () => {
  const { resolveDictationRouteKind } = await load();

  assert.equal(
    resolveDictationRouteKind({
      cleanupReachable: true,
      agentReachable: true,
      agentInvoked: false,
      voiceAgentRequested: true,
    }),
    "agent"
  );
});

test("voice agent hotkey never triggers cleanup", async () => {
  const { resolveDictationRouteKind } = await load();

  // Even with cleanup enabled and reachable, a voice agent recording with an
  // unreachable agent returns the raw transcript instead of falling back.
  assert.equal(
    resolveDictationRouteKind({
      cleanupReachable: true,
      agentReachable: false,
      agentInvoked: false,
      voiceAgentRequested: true,
    }),
    "skip"
  );
});

test("voice agent hotkey ignores the wake word state", async () => {
  const { resolveDictationRouteKind } = await load();

  assert.equal(
    resolveDictationRouteKind({
      cleanupReachable: false,
      agentReachable: true,
      agentInvoked: true,
      voiceAgentRequested: true,
    }),
    "agent"
  );
});

test("normal dictation with wake word routes to the agent", async () => {
  const { resolveDictationRouteKind } = await load();

  assert.equal(
    resolveDictationRouteKind({
      cleanupReachable: true,
      agentReachable: true,
      agentInvoked: true,
      voiceAgentRequested: false,
    }),
    "agent"
  );
});

test("normal dictation without wake word routes to cleanup", async () => {
  const { resolveDictationRouteKind } = await load();

  assert.equal(
    resolveDictationRouteKind({
      cleanupReachable: true,
      agentReachable: true,
      agentInvoked: false,
      voiceAgentRequested: false,
    }),
    "cleanup"
  );
});

test("wake word with unreachable agent falls back to cleanup", async () => {
  const { resolveDictationRouteKind } = await load();

  assert.equal(
    resolveDictationRouteKind({
      cleanupReachable: true,
      agentReachable: false,
      agentInvoked: true,
      voiceAgentRequested: false,
    }),
    "cleanup"
  );
});

test("skips reasoning when nothing is reachable", async () => {
  const { resolveDictationRouteKind } = await load();

  assert.equal(
    resolveDictationRouteKind({
      cleanupReachable: false,
      agentReachable: false,
      agentInvoked: false,
      voiceAgentRequested: false,
    }),
    "skip"
  );
});

test("agent is reachable in cloud mode without an explicit model", async () => {
  const { resolveDictationAgentReachability } = await load();

  assert.equal(
    resolveDictationAgentReachability({
      useDictationAgent: true,
      dictationAgentModel: "",
      isCloudAgent: true,
      isSelfHostedAgent: false,
    }),
    true
  );
});

test("agent is reachable in self-hosted mode without an explicit model", async () => {
  const { resolveDictationAgentReachability } = await load();

  assert.equal(
    resolveDictationAgentReachability({
      useDictationAgent: true,
      dictationAgentModel: "",
      isCloudAgent: false,
      isSelfHostedAgent: true,
    }),
    true
  );
});

test("agent is unreachable with an empty model on a model-required provider", async () => {
  const { resolveDictationAgentReachability } = await load();

  assert.equal(
    resolveDictationAgentReachability({
      useDictationAgent: true,
      dictationAgentModel: "   ",
      isCloudAgent: false,
      isSelfHostedAgent: false,
    }),
    false
  );
});

test("agent is reachable with an explicit model (BYOK/local/enterprise)", async () => {
  const { resolveDictationAgentReachability } = await load();

  assert.equal(
    resolveDictationAgentReachability({
      useDictationAgent: true,
      dictationAgentModel: "gpt-5.5",
      isCloudAgent: false,
      isSelfHostedAgent: false,
    }),
    true
  );
});

test("disabling the dictation agent overrides cloud reachability", async () => {
  const { resolveDictationAgentReachability } = await load();

  assert.equal(
    resolveDictationAgentReachability({
      useDictationAgent: false,
      dictationAgentModel: "",
      isCloudAgent: true,
      isSelfHostedAgent: true,
    }),
    false
  );
});

test("prewarm resolves the local cleanup model on normal dictations", async () => {
  const { resolveLocalReasoningPrewarmModel } = await load();

  assert.equal(
    resolveLocalReasoningPrewarmModel({
      useCleanupModel: true,
      cleanupMode: "local",
      cleanupModel: "llama-3.1-8b-instruct-q4_k_m",
      useDictationAgent: true,
      dictationAgentMode: "openwhispr",
      dictationAgentModel: "",
      voiceAgentRequested: false,
    }),
    "llama-3.1-8b-instruct-q4_k_m"
  );
});

test("prewarm falls back to a local dictation-agent model when cleanup is not local", async () => {
  const { resolveLocalReasoningPrewarmModel } = await load();

  assert.equal(
    resolveLocalReasoningPrewarmModel({
      useCleanupModel: true,
      cleanupMode: "openwhispr",
      cleanupModel: "",
      useDictationAgent: true,
      dictationAgentMode: "local",
      dictationAgentModel: "qwen3-8b",
      voiceAgentRequested: false,
    }),
    "qwen3-8b"
  );
});

test("voice-agent recordings prewarm only the agent model", async () => {
  const { resolveLocalReasoningPrewarmModel } = await load();

  assert.equal(
    resolveLocalReasoningPrewarmModel({
      useCleanupModel: true,
      cleanupMode: "local",
      cleanupModel: "llama-3.1-8b-instruct-q4_k_m",
      useDictationAgent: true,
      dictationAgentMode: "local",
      dictationAgentModel: "qwen3-8b",
      voiceAgentRequested: true,
    }),
    "qwen3-8b"
  );

  // Voice-agent route never falls back to cleanup, so neither does its prewarm.
  assert.equal(
    resolveLocalReasoningPrewarmModel({
      useCleanupModel: true,
      cleanupMode: "local",
      cleanupModel: "llama-3.1-8b-instruct-q4_k_m",
      useDictationAgent: true,
      dictationAgentMode: "openwhispr",
      dictationAgentModel: "",
      voiceAgentRequested: true,
    }),
    null
  );
});

test("prewarm skips disabled scopes and blank models", async () => {
  const { resolveLocalReasoningPrewarmModel } = await load();

  assert.equal(
    resolveLocalReasoningPrewarmModel({
      useCleanupModel: false,
      cleanupMode: "local",
      cleanupModel: "llama-3.1-8b-instruct-q4_k_m",
      useDictationAgent: false,
      dictationAgentMode: "local",
      dictationAgentModel: "qwen3-8b",
      voiceAgentRequested: false,
    }),
    null
  );

  assert.equal(
    resolveLocalReasoningPrewarmModel({
      useCleanupModel: true,
      cleanupMode: "local",
      cleanupModel: "   ",
      useDictationAgent: true,
      dictationAgentMode: "providers",
      dictationAgentModel: "claude-sonnet-5",
      voiceAgentRequested: false,
    }),
    null
  );
});
