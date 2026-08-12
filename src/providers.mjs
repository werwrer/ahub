export async function validateDeepSeekCredential(apiKey, options = {}) {
  if (!apiKey?.trim()) return { ok: false, reason: "empty" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10000);
  try {
    const response = await (options.fetch ?? fetch)(`${options.baseUrl ?? "https://api.deepseek.com"}/models`, {
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
