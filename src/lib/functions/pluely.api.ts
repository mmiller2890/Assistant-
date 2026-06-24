// Hosted Pluely API has been removed in this local-only fork.
// All requests go through user-configured providers (including Ollama).
export async function shouldUsePluelyAPI(): Promise<boolean> {
  return false;
}