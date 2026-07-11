// Options for the local (llama.cpp) reasoning bridge. Cleanup is a
// deterministic transform, so it must run at temperature 0 like the cloud
// cleanup path (ReasoningService pins 0 when no systemPrompt override is
// present). Without this the bridge defaults to 0.7 — hot enough that small
// quantized models drift into answering the transcript instead of cleaning it.
export function buildLocalReasoningOptions(config, systemPrompt) {
  const isCleanup = !config.systemPrompt;
  const options = { ...config, systemPrompt };
  if (isCleanup) {
    options.temperature = config.temperature ?? 0;
  }
  return options;
}
