// Whether the dictation agent can actually run. Mirrors ReasoningService.processText,
// which accepts an empty model only for the cloud ("openwhispr") and self-hosted ("lan")
// providers; every other mode (BYOK, local, enterprise) requires an explicit model.
export function resolveDictationAgentReachability({
  useDictationAgent,
  dictationAgentModel,
  isCloudAgent,
  isSelfHostedAgent,
}) {
  if (!useDictationAgent) return false;
  if (isCloudAgent || isSelfHostedAgent) return true;
  return (dictationAgentModel?.trim()?.length ?? 0) > 0;
}

// Which local GGUF model (if any) the finished dictation will need, so the
// llama-server cold start (spawn + system-prompt eval, several seconds) can
// overlap the recording instead of stacking onto it after the user stops
// speaking. Mirrors resolveDictationRouteKind: a voice-agent recording always
// takes the agent path; otherwise cleanup is the default route.
export function resolveLocalReasoningPrewarmModel({
  useCleanupModel,
  cleanupMode,
  cleanupModel,
  useDictationAgent,
  dictationAgentMode,
  dictationAgentModel,
  voiceAgentRequested,
}) {
  const cleanupLocalModel =
    useCleanupModel && cleanupMode === "local" ? cleanupModel?.trim() || "" : "";
  const agentLocalModel =
    useDictationAgent && dictationAgentMode === "local" ? dictationAgentModel?.trim() || "" : "";
  if (voiceAgentRequested) return agentLocalModel || null;
  return cleanupLocalModel || agentLocalModel || null;
}

// Decides which reasoning path ("agent" | "cleanup" | "skip") a finished
// dictation takes. A recording started via the voice agent hotkey always takes
// the agent path — no wake word needed — and never falls back to cleanup.
export function resolveDictationRouteKind({
  cleanupReachable,
  agentReachable,
  agentInvoked,
  voiceAgentRequested,
}) {
  if (voiceAgentRequested) {
    return agentReachable ? "agent" : "skip";
  }
  if (agentReachable && agentInvoked) {
    return "agent";
  }
  if (cleanupReachable) {
    return "cleanup";
  }
  return "skip";
}
