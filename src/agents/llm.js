// LLM access for the agent loop. Any OpenAI-compatible chat endpoint works; the provider is picked
// from env (names only, values never logged):
//   NEARAI_API_KEY      -> NEAR AI Cloud  https://cloud-api.near.ai/v1   (default model anthropic/claude-sonnet-5)
//   AI_GATEWAY_API_KEY  -> Vercel AI Gateway https://ai-gateway.vercel.sh/v1
//   OPENAI_API_KEY      -> OpenAI          https://api.openai.com/v1
// Override with SAFU_LLM_BASE_URL / SAFU_LLM_MODEL / SAFU_LLM_KEY_ENV.
//
// Deterministic fallback: mode "replay" answers from a recorded transcript (no network). In "llm" mode a
// provider error falls back to the recorded answer for the same turn when one exists, and says so.

const PROVIDERS = [
  { env: 'NEARAI_API_KEY', name: 'NEAR AI Cloud', baseUrl: 'https://cloud-api.near.ai/v1', model: 'anthropic/claude-sonnet-5' },
  { env: 'AI_GATEWAY_API_KEY', name: 'Vercel AI Gateway', baseUrl: 'https://ai-gateway.vercel.sh/v1', model: 'anthropic/claude-sonnet-4.5' },
  { env: 'OPENAI_API_KEY', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1' },
];

export function providerFromEnv(env = process.env) {
  const forced = env.SAFU_LLM_KEY_ENV && PROVIDERS.find((x) => x.env === env.SAFU_LLM_KEY_ENV);
  const pv = forced || PROVIDERS.find((x) => env[x.env]);
  if (!pv && !env.SAFU_LLM_BASE_URL) return null;
  const keyEnv = pv?.env || env.SAFU_LLM_KEY_ENV;
  return { name: pv?.name || 'custom', keyEnv, baseUrl: env.SAFU_LLM_BASE_URL || pv.baseUrl, model: env.SAFU_LLM_MODEL || pv?.model, key: keyEnv ? env[keyEnv] : undefined };
}

export async function chatCompletion({ baseUrl, key, model, messages, maxTokens = 2000, temperature = 0.4, fetchImpl = fetch, timeoutMs = 180000 }) {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${body.slice(0, 300)}`);
    const j = JSON.parse(body);
    const text = j.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw new Error(`LLM returned no text (finish_reason ${j.choices?.[0]?.finish_reason}, ${j.usage?.completion_tokens} completion tokens)`);
    return { text, usage: j.usage || null, model: j.model || model };
  } finally { clearTimeout(timer); }
}

// Pull the first JSON object out of a model reply (```json fences or bare).
export function extractJSON(text) {
  const fence = String(text).match(/```(?:json)?\s*([\s\S]*?)```/i);
  const src = fence ? fence[1] : String(text);
  const start = src.indexOf('{');
  if (start < 0) throw new Error('no JSON object in reply');
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === '{') depth++; else if (c === '}' && --depth === 0) return JSON.parse(src.slice(start, i + 1));
  }
  throw new Error('unterminated JSON object in reply');
}

// One "brain" shared by the scammer and builder agents. Every call is recorded with its key
// (round:role:n) so a run can be replayed deterministically later.
export function createBrain({ mode = 'llm', provider = providerFromEnv(), recorded = [], chat = chatCompletion, log = () => {} } = {}) {
  const byKey = new Map(recorded.map((c) => [c.key, c]));
  const calls = [];
  if (mode === 'llm' && !provider && !recorded.length) throw new Error('No LLM provider: set NEARAI_API_KEY, AI_GATEWAY_API_KEY or OPENAI_API_KEY (or use --agent replay)');
  return {
    mode, provider: provider ? { name: provider.name, model: provider.model, baseUrl: provider.baseUrl, keyEnv: provider.keyEnv } : null, calls,
    async ask(key, messages, { maxTokens, temperature } = {}) {
      const t0 = Date.now();
      let text, usage = null, source = mode, model = provider?.model || null, error = null;
      if (mode === 'replay') {
        const rec = byKey.get(key);
        if (!rec) throw new Error(`replay: no recorded answer for ${key}`);
        text = rec.response; model = rec.model; source = 'replay';
      } else {
        try { ({ text, usage, model } = await chat({ ...provider, messages, maxTokens, temperature })); source = 'llm'; }
        catch (e) {
          error = e.message; const rec = byKey.get(key);
          if (!rec) throw e;
          log(`LLM provider error (${e.message.slice(0, 120)}); falling back to the recorded answer for ${key}`);
          text = rec.response; model = rec.model; source = 'fallback';
        }
      }
      const call = { key, source, model, messages, response: text, usage, error, ms: Date.now() - t0, at: new Date().toISOString() };
      calls.push(call);
      return { text, json: () => extractJSON(text), call };
    },
  };
}
