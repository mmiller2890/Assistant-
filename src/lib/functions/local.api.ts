// Hosted Assistant API has been removed in this local-only fork.
// All requests go through user-configured providers (including Ollama).
export async function shouldUseLocalAPI(): Promise<boolean> {
  return false;
}