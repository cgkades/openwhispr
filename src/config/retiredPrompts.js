// Fingerprints of retired default prompts. Old releases persisted the
// then-default "unified" prompt into localStorage (customUnifiedPrompt, later
// migrated into customPrompt.cleanup / customPrompt.dictationAgent), so users
// from that era still run a frozen copy of an old default as a "custom"
// prompt. That copy shadows every prompt hardening shipped since — most
// damaging on the cleanup path, where the retired two-mode prompt's
// "For direct questions, output just the answer" rule makes small local
// models answer dictated questions instead of transcribing them.
//
// Each marker is a phrase unique to a retired default and absent from every
// current locale bundle (the retired texts were English-only), so a match
// means the stored prompt is an old shipped default, not user-authored text.
const RETIRED_DEFAULT_PROMPT_MARKERS = [
  // Two-mode unified prompt (en fullPrompt until the voice-agent compression)
  "You operate in two modes",
  "MODE 1: CLEANUP",
  "MODE 2: AGENT",
  "OUTPUT RULES (both modes)",
  // Original UNIFIED_SYSTEM_PROMPT (pre prompt-architecture overhaul)
  "Your job is ALWAYS to clean up transcribed speech",
  "CRITICAL: NOT EVERY MENTION OF YOUR NAME IS AN INSTRUCTION",
];

export function isRetiredDefaultPrompt(text) {
  if (!text || typeof text !== "string") return false;
  return RETIRED_DEFAULT_PROMPT_MARKERS.some((marker) => text.includes(marker));
}

export { RETIRED_DEFAULT_PROMPT_MARKERS };
