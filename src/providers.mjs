// Validate an API key against any OpenAI-compatible provider that exposes GET /models.
// `provider` may be a registry entry ({ baseUrl, label, kind }) or omitted in favour of options.baseUrl.
export async function validateProviderCredential(provider, apiKey, options = {}) {
  if (!apiKey?.trim()) return { ok: false, reason: "empty" };
  const baseUrl = (provider?.baseUrl ?? options.baseUrl ?? "").toString().replace(/\/$/u, "");
  if (!baseUrl) return { ok: false, reason: "no-base-url" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10000);
  try {
    const response = await (options.fetch ?? fetch)(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey.trim()}` },
      signal: controller.signal,
    });
    if (response.ok) return { ok: true };
    if (response.status === 401 || response.status === 403) return { ok: false, reason: "invalid-key", status: response.status };
    return { ok: false, reason: "service", status: response.status };
  } catch (error) {
    return { ok: false, reason: error.name === "AbortError" ? "timeout" : "network", error };
  } finally {
    clearTimeout(timer);
  }
}

// Backward-compatible wrapper for the original DeepSeek-only entry point.
export async function validateDeepSeekCredential(apiKey, options = {}) {
  return validateProviderCredential({ baseUrl: options.baseUrl ?? "https://api.deepseek.com" }, apiKey, options);
}
