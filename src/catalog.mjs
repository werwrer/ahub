// A curated catalog of well-known OpenAI-compatible providers. Selecting one in the menu
// or via `ahub provider add <name>` registers it with its default base URL and response
// format — the user only needs to supply the API key. Custom endpoints remain fully
// supported (`ahub provider add <name> <baseUrl>`).

export const PROVIDER_CATALOG = {
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com", kind: "openai" },
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", kind: "openai" },
  anthropic: { label: "Anthropic (OpenAI-compatible endpoint)", baseUrl: "https://api.anthropic.com/v1", kind: "openai" },
  moonshot: { label: "Moonshot AI (Kimi)", baseUrl: "https://api.moonshot.cn/v1", kind: "openai" },
  zhipu: { label: "Zhipu AI (GLM)", baseUrl: "https://open.bigmodel.cn/api/paas/v4", kind: "openai" },
  qwen: { label: "Alibaba Qwen (DashScope)", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", kind: "openai" },
  siliconflow: { label: "SiliconFlow", baseUrl: "https://api.siliconflow.cn/v1", kind: "openai" },
  groq: { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", kind: "openai" },
  mistral: { label: "Mistral AI", baseUrl: "https://api.mistral.ai/v1", kind: "openai" },
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", kind: "openai" },
  xai: { label: "xAI (Grok)", baseUrl: "https://api.x.ai/v1", kind: "openai" },
  together: { label: "Together AI", baseUrl: "https://api.together.xyz/v1", kind: "openai" },
  fireworks: { label: "Fireworks AI", baseUrl: "https://api.fireworks.ai/inference/v1", kind: "openai" },
  novita: { label: "Novita AI", baseUrl: "https://api.novita.ai/v3/openai", kind: "openai" },
  ollama: { label: "Ollama (local)", baseUrl: "http://localhost:11434/v1", kind: "openai" },
};

export function catalogEntry(name) {
  return PROVIDER_CATALOG[name];
}

export function catalogChoices(registered = new Set()) {
  return Object.entries(PROVIDER_CATALOG)
    .filter(([name]) => !registered.has(name))
    .map(([name, conf]) => ({ name: `${conf.label} · ${conf.baseUrl}`, value: name }));
}
