import { randomUUID } from 'node:crypto';

export const PROMPT = 'Create a complete, self-contained HTML document that visually depicts a pelican riding a bicycle. Use HTML and CSS; inline SVG is optional. Do not use JavaScript, external assets, or image URLs. Return only the HTML document.';

const EFFORTS = new Set(['default', 'low', 'medium', 'high']);

export const PROTOCOLS = {
  openai: { label: 'OpenAI 兼容', hint: 'gpt-4o', baseUrl: 'https://api.openai.com/v1' },
  anthropic: { label: 'Anthropic Messages', hint: 'claude-sonnet-4-5', baseUrl: 'https://api.anthropic.com/v1' },
  gemini: { label: 'Gemini generateContent', hint: 'gemini-2.5-pro', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
};

export function validateConnection(body) {
  if (!body || typeof body !== 'object') throw new Error('请求格式无效。');
  const { protocol, baseUrl, apiKey, sessionId } = body;
  if (!Object.hasOwn(PROTOCOLS, protocol)) throw new Error('请选择受支持的请求协议。');
  if (typeof baseUrl !== 'string' || baseUrl.length > 2048) throw new Error('请输入有效的 Base URL。');
  let parsed;
  try { parsed = new URL(baseUrl); } catch { throw new Error('请输入有效的 Base URL。'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Base URL 仅支持不含账号、查询参数或片段的 HTTP(S) 地址。');
  }
  if (typeof apiKey !== 'string' || apiKey.length > 4096) throw new Error('请输入有效的 API Key。');
  if (sessionId !== undefined && (typeof sessionId !== 'string' || !/^[\w-]{1,128}$/.test(sessionId))) throw new Error('会话 ID 无效。');
  return { protocol, baseUrl: parsed.href.replace(/\/+$/, ''), apiKey: apiKey.trim(), ...(sessionId ? { sessionId } : {}) };
}

function isOpenCodeGo(baseUrl) {
  const url = new URL(baseUrl);
  return url.hostname === 'opencode.ai' && url.pathname.replace(/\/+$/, '') === '/zen/go/v1';
}

function addGoHeaders(headers, input) {
  if (!isOpenCodeGo(input.baseUrl)) return;
  headers['user-agent'] = 'intelligence-test/1.0';
  headers['x-opencode-session'] = input.sessionId || randomUUID();
}

function providerError(payload, status, baseUrl) {
  const message = String(payload?.error?.message || payload?.message || `接口返回 HTTP ${status}`).slice(0, 300);
  const url = new URL(baseUrl);
  if (url.hostname === 'opencode.ai' && url.pathname.replace(/\/+$/, '') === '/zen/v1' && /quota|credit|balance|insufficient|额度|余额|402/i.test(message + status)) {
    return `${message}。如使用 OpenCode Go 订阅，请将 Base URL 改为 https://opencode.ai/zen/go/v1`;
  }
  return message;
}

export function validateRequest(body) {
  const connection = validateConnection(body);
  const { model, effort = 'default' } = body;
  if (typeof model !== 'string' || !/^[\w./:+-]{1,160}$/.test(model)) throw new Error('请输入有效的模型 ID。');
  if (!EFFORTS.has(effort)) throw new Error('请选择有效的思考程度。');
  return { ...connection, model, effort };
}

export async function listModels(input, fetchImpl = fetch, signal) {
  const headers = { 'content-type': 'application/json' };
  if (input.apiKey) {
    if (input.protocol === 'anthropic') headers['x-api-key'] = input.apiKey;
    else if (input.protocol === 'gemini') headers['x-goog-api-key'] = input.apiKey;
    else headers.authorization = `Bearer ${input.apiKey}`;
  }
  if (input.protocol === 'anthropic') headers['anthropic-version'] = '2023-06-01';
  addGoHeaders(headers, input);
  const url = `${input.baseUrl}/models${input.protocol === 'gemini' ? '?pageSize=1000' : ''}`;
  const response = await fetchImpl(url, { method: 'GET', headers, signal, redirect: 'error' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(providerError(payload, response.status, input.baseUrl));
  const entries = input.protocol === 'gemini' ? payload?.models : payload?.data;
  if (!Array.isArray(entries)) throw new Error('该接口没有返回可识别的模型列表。');
  const models = [...new Set(entries
    .filter((entry) => input.protocol !== 'gemini' || !Array.isArray(entry?.supportedGenerationMethods) || entry.supportedGenerationMethods.includes('generateContent'))
    .map((entry) => input.protocol === 'gemini' ? entry?.name?.replace(/^models\//, '') : entry?.id)
    .filter((id) => typeof id === 'string' && /^[\w./:+-]{1,160}$/.test(id)))].slice(0, 500);
  return models;
}

export function extractHtml(raw) {
  if (typeof raw !== 'string') throw new Error('模型没有返回文本内容。');
  const fenced = raw.match(/```(?:html)?\s*\n([\s\S]*?)\n```/i);
  const cleaned = (fenced ? fenced[1] : raw).trim();
  const start = cleaned.search(/<!doctype\s+html\b|<html\b|<(?:body|main|section|article|div|svg|style)\b/i);
  if (start < 0) throw new Error('模型未返回可预览的 HTML。请尝试其他模型或重试。');
  const markup = cleaned.slice(start).replace(/```\s*$/, '').trim();
  if (markup.length > 1_000_000) throw new Error('HTML 内容超过 1 MB，无法预览。');
  return markup;
}

export async function callProvider(input, fetchImpl = fetch, signal) {
  let url;
  let headers;
  let body;
  if (input.protocol === 'anthropic') {
    url = `${input.baseUrl}/messages`;
    headers = { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' };
    if (input.apiKey) headers['x-api-key'] = input.apiKey;
    body = { model: input.model, max_tokens: 12000, messages: [{ role: 'user', content: PROMPT }] };
    if (input.effort && input.effort !== 'default') {
      if (/^claude-(?:sonnet|opus|haiku)-4-5(?:$|-)/.test(input.model)) {
        body.thinking = { type: 'enabled', budget_tokens: { low: 1024, medium: 2048, high: 4096 }[input.effort] };
      } else {
        body.thinking = { type: 'adaptive' };
        body.output_config = { effort: input.effort };
      }
    }
  } else if (input.protocol === 'gemini') {
    url = `${input.baseUrl}/models/${encodeURIComponent(input.model)}:generateContent`;
    headers = { 'content-type': 'application/json' };
    if (input.apiKey) headers['x-goog-api-key'] = input.apiKey;
    body = { contents: [{ parts: [{ text: PROMPT }] }], generationConfig: { maxOutputTokens: 12000 } };
    if (input.effort && input.effort !== 'default') {
      body.generationConfig.thinkingConfig = input.model.startsWith('gemini-2.5-')
        ? { thinkingBudget: { low: 1024, medium: 2048, high: 4096 }[input.effort] }
        : { thinkingLevel: input.effort };
    }
  } else {
    url = `${input.baseUrl}/chat/completions`;
    headers = { 'content-type': 'application/json' };
    if (input.apiKey) headers.authorization = `Bearer ${input.apiKey}`;
    body = { model: input.model, messages: [{ role: 'user', content: PROMPT }], max_tokens: 12000 };
    if (input.effort && input.effort !== 'default') body.reasoning_effort = input.effort;
  }

  addGoHeaders(headers, input);

  const response = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), signal, redirect: 'error' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(providerError(payload, response.status, input.baseUrl));
  }
  const content = input.protocol === 'anthropic'
    ? payload?.content?.filter((part) => part.type === 'text').map((part) => part.text).join('\n')
    : input.protocol === 'gemini'
      ? payload?.candidates?.[0]?.content?.parts?.filter((part) => typeof part.text === 'string').map((part) => part.text).join('\n')
      : payload?.choices?.[0]?.message?.content;
  const raw = typeof content === 'string' ? content : Array.isArray(content) ? content.filter((part) => part.type === 'text').map((part) => part.text).join('\n') : '';
  return { raw, html: extractHtml(raw), usage: payload?.usage ?? null };
}
