import test from 'node:test';
import assert from 'node:assert/strict';
import { callProvider, extractHtml, listModels, PROMPT, validateRequest } from './core.js';

test('extracts HTML without requiring SVG', () => {
  const html = '<!doctype html><html><body><div class="pelican"></div></body></html>';
  assert.equal(extractHtml(`\`\`\`html\n${html}\n\`\`\``), html);
  assert.equal(extractHtml('<div class="pelican"></div>'), '<div class="pelican"></div>');
  assert.throws(() => extractHtml('only a description'), /HTML/);
});

test('validates protocol, base URL, model, and API key', () => {
  assert.deepEqual(validateRequest({ protocol: 'openai', baseUrl: 'http://127.0.0.1:8000/v1/', model: 'gpt-4o', apiKey: '  secret  ' }), { protocol: 'openai', baseUrl: 'http://127.0.0.1:8000/v1', model: 'gpt-4o', apiKey: 'secret', effort: 'default' });
  assert.throws(() => validateRequest({ protocol: 'unknown', baseUrl: 'https://example.com/v1', model: 'x', apiKey: 'a' }), /请求协议/);
  assert.throws(() => validateRequest({ protocol: 'openai', baseUrl: 'file:///tmp', model: 'x', apiKey: 'a' }), /Base URL/);
  assert.throws(() => validateRequest({ protocol: 'openai', baseUrl: 'https://example.com/v1', model: 'bad model?', apiKey: 'a' }), /模型 ID/);
  assert.throws(() => validateRequest({ protocol: 'openai', baseUrl: 'https://example.com/v1', model: 'good-model', apiKey: 'a', sessionId: 'bad session' }), /会话 ID/);
  assert.throws(() => validateRequest({ protocol: 'openai', baseUrl: 'https://example.com/v1', model: 'good-model', apiKey: 'a', effort: 'extreme' }), /思考程度/);
});

test('uses the HTML prompt and reasoning effort in OpenAI compatible requests', async () => {
  let request;
  const fetchMock = async (url, options) => {
    request = { url, ...options };
    return { ok: true, json: async () => ({ choices: [{ message: { content: '<html><body><div>pelican</div></body></html>' } }] }) };
  };
  const result = await callProvider({ protocol: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', apiKey: 'test-key', effort: 'medium' }, fetchMock);
  assert.equal(request.url, 'https://api.deepseek.com/v1/chat/completions');
  assert.equal(request.headers.authorization, 'Bearer test-key');
  assert.equal(JSON.parse(request.body).messages[0].content, PROMPT);
  assert.equal(JSON.parse(request.body).reasoning_effort, 'medium');
  assert.match(PROMPT, /HTML/);
  assert.equal(result.html, '<html><body><div>pelican</div></body></html>');
});

test('uses protocol-specific authentication and response shapes', async () => {
  const calls = [];
  const fetchMock = async (url, options) => {
    calls.push({ url, ...options });
    return { ok: true, json: async () => calls.length === 1
      ? { content: [{ type: 'text', text: '<svg></svg>' }] }
      : { candidates: [{ content: { parts: [{ text: '<svg></svg>' }] } }] } };
  };
  await callProvider({ protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5', apiKey: 'anthropic-key' }, fetchMock);
  await callProvider({ protocol: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-pro', apiKey: 'gemini-key' }, fetchMock);
  assert.equal(calls[0].headers['x-api-key'], 'anthropic-key');
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(calls[1].headers['x-goog-api-key'], 'gemini-key');
  assert.match(calls[1].url, /gemini-2\.5-pro:generateContent$/);
  assert.equal(JSON.parse(calls[0].body).thinking, undefined);
  assert.equal(JSON.parse(calls[1].body).generationConfig.thinkingConfig, undefined);
});

test('maps reasoning effort for Anthropic and Gemini model generations', async () => {
  const calls = [];
  const fetchMock = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return { ok: true, json: async () => calls.length < 3
      ? { content: [{ type: 'text', text: '<div>pelican</div>' }] }
      : { candidates: [{ content: { parts: [{ text: '<div>pelican</div>' }] } }] } };
  };
  await callProvider({ protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5', apiKey: 'x', effort: 'high' }, fetchMock);
  await callProvider({ protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-6', apiKey: 'x', effort: 'low' }, fetchMock);
  await callProvider({ protocol: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.5-pro', apiKey: 'x', effort: 'medium' }, fetchMock);
  await callProvider({ protocol: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-3-pro', apiKey: 'x', effort: 'high' }, fetchMock);
  assert.deepEqual(calls[0].thinking, { type: 'enabled', budget_tokens: 4096 });
  assert.deepEqual(calls[1].thinking, { type: 'adaptive' });
  assert.deepEqual(calls[1].output_config, { effort: 'low' });
  assert.deepEqual(calls[2].generationConfig.thinkingConfig, { thinkingBudget: 2048 });
  assert.deepEqual(calls[3].generationConfig.thinkingConfig, { thinkingLevel: 'high' });
});

test('omits authorization for an unauthenticated local compatible endpoint', async () => {
  const fetchMock = async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:11434/v1/chat/completions');
    assert.equal(options.headers.authorization, undefined);
    return { ok: true, json: async () => ({ choices: [{ message: { content: '<svg></svg>' } }] }) };
  };
  await callProvider({ protocol: 'openai', baseUrl: 'http://127.0.0.1:11434/v1', model: 'local-model', apiKey: '' }, fetchMock);
});

test('lists OpenAI-compatible models from the custom Base URL', async () => {
  const fetchMock = async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:11434/v1/models');
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.authorization, undefined);
    return { ok: true, json: async () => ({ data: [{ id: 'local-a' }, { id: 'local-b' }, { id: 'local-a' }] }) };
  };
  const models = await listModels({ protocol: 'openai', baseUrl: 'http://127.0.0.1:11434/v1', apiKey: '' }, fetchMock);
  assert.deepEqual(models, ['local-a', 'local-b']);
});

test('lists Anthropic and Gemini model response formats', async () => {
  const fetchMock = async (url, options) => {
    if (url.includes('anthropic')) {
      assert.equal(options.headers['x-api-key'], 'secret');
      return { ok: true, json: async () => ({ data: [{ id: 'claude-model' }] }) };
    }
    assert.match(url, /\/models\?pageSize=1000$/);
    assert.equal(options.headers['x-goog-api-key'], 'secret');
    return { ok: true, json: async () => ({ models: [
      { name: 'models/gemini-text', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/embed-only', supportedGenerationMethods: ['embedContent'] },
    ] }) };
  };
  assert.deepEqual(await listModels({ protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'secret' }, fetchMock), ['claude-model']);
  assert.deepEqual(await listModels({ protocol: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiKey: 'secret' }, fetchMock), ['gemini-text']);
});

test('OpenCode Go receives its own client and stable session headers', async () => {
  const input = { protocol: 'openai', baseUrl: 'https://opencode.ai/zen/go/v1', model: 'glm-5.3-flash', apiKey: 'go-key', sessionId: 'session-123' };
  const fetchMock = async (url, options) => {
    assert.equal(options.headers['user-agent'], 'intelligence-test/1.0');
    assert.equal(options.headers['x-opencode-session'], 'session-123');
    assert.equal(options.headers.authorization, 'Bearer go-key');
    return options.method === 'GET'
      ? { ok: true, json: async () => ({ data: [{ id: 'glm-5.3-flash' }] }) }
      : { ok: true, json: async () => ({ choices: [{ message: { content: '<svg></svg>' } }] }) };
  };
  assert.deepEqual(await listModels(input, fetchMock), ['glm-5.3-flash']);
  assert.equal((await callProvider(input, fetchMock)).html, '<svg></svg>');
});

test('Zen quota errors point Go subscribers to the Go Base URL', async () => {
  const fetchMock = async () => ({ ok: false, status: 402, json: async () => ({ error: { message: 'Insufficient balance' } }) });
  await assert.rejects(
    listModels({ protocol: 'openai', baseUrl: 'https://opencode.ai/zen/v1', apiKey: 'key' }, fetchMock),
    /https:\/\/opencode\.ai\/zen\/go\/v1/,
  );
});
