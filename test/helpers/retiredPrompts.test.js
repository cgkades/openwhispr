const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const load = () => import("../../src/config/retiredPrompts.js");

const LOCALES_DIR = path.join(__dirname, "..", "..", "src", "locales");

// Trimmed excerpt of the retired two-mode unified prompt (shipped as the en
// fullPrompt before the voice-agent compression, and persisted into
// customPrompt.cleanup by the customUnifiedPrompt migration).
const RETIRED_TWO_MODE_PROMPT = `You are "OpenWhispr", an AI integrated into a speech-to-text dictation app. You operate in two modes.

---
MODE 1: CLEANUP (default)
---
Process transcribed speech into clean, polished text. This is your default.

---
MODE 2: AGENT
---
Activated ONLY when the user directly addresses you by name with a command.

---
OUTPUT RULES (both modes)
---
7. For direct questions, output just the answer`;

// Trimmed excerpt of the original UNIFIED_SYSTEM_PROMPT (pre prompt-architecture
// overhaul).
const RETIRED_ORIGINAL_UNIFIED_PROMPT = `You are an AI assistant named "{{agentName}}", integrated into a speech-to-text dictation application.

CORE RESPONSIBILITY:
Your job is ALWAYS to clean up transcribed speech. This is your default behavior.`;

test("flags the retired two-mode unified prompt", async () => {
  const { isRetiredDefaultPrompt } = await load();
  assert.equal(isRetiredDefaultPrompt(RETIRED_TWO_MODE_PROMPT), true);
});

test("flags the original unified system prompt", async () => {
  const { isRetiredDefaultPrompt } = await load();
  assert.equal(isRetiredDefaultPrompt(RETIRED_ORIGINAL_UNIFIED_PROMPT), true);
});

test("flags retired prompts even after agent-name substitution", async () => {
  const { isRetiredDefaultPrompt } = await load();
  const substituted = RETIRED_ORIGINAL_UNIFIED_PROMPT.replace(/\{\{agentName\}\}/g, "Nova");
  assert.equal(isRetiredDefaultPrompt(substituted), true);
});

test("never flags any current shipped default prompt in any locale", async () => {
  const { isRetiredDefaultPrompt } = await load();

  const locales = fs
    .readdirSync(LOCALES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  assert.ok(locales.length >= 9, `expected locale dirs, found ${locales.length}`);

  for (const locale of locales) {
    const bundlePath = path.join(LOCALES_DIR, locale, "prompts.json");
    if (!fs.existsSync(bundlePath)) continue;
    const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
    for (const [key, value] of Object.entries(bundle)) {
      assert.equal(
        isRetiredDefaultPrompt(value),
        false,
        `current default ${locale}/${key} must not match a retired-prompt fingerprint`
      );
    }
  }
});

test("does not flag user-authored prompts or empty values", async () => {
  const { isRetiredDefaultPrompt } = await load();
  assert.equal(
    isRetiredDefaultPrompt("Always format my dictations as bullet points and fix grammar."),
    false
  );
  assert.equal(isRetiredDefaultPrompt(""), false);
  assert.equal(isRetiredDefaultPrompt(null), false);
  assert.equal(isRetiredDefaultPrompt(undefined), false);
});
