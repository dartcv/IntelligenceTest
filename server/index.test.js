import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

process.env.NODE_ENV = 'test';
const { default: app } = await import('./index.js');

test('POST /api/test completes the request to preview response chain', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers.authorization, 'Bearer private-key');
    if (options.method === 'GET') return { ok: true, json: async () => ({ data: [{ id: 'model-a' }, { id: 'model-b' }] }) };
    assert.equal(JSON.parse(options.body).reasoning_effort, 'low');
    return { ok: true, json: async () => ({ choices: [{ message: { content: '```html\n<!doctype html><html><body><div class="pelican">Pelican</div></body></html>\n```' } }] }) };
  };
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise((resolve) => server.once('listening', resolve));
    const body = JSON.stringify({ protocol: 'openai', baseUrl: 'https://custom.example/v1', model: 'gpt-4o', apiKey: 'private-key', effort: 'low' });
    const response = await new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: '/api/test', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
      });
      req.on('error', reject);
      req.end(body);
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.html, '<!doctype html><html><body><div class="pelican">Pelican</div></body></html>');
    assert.equal(response.body.baseUrl, 'https://custom.example/v1');
    assert.equal(response.body.apiKey, undefined);
    const modelsBody = JSON.stringify({ protocol: 'openai', baseUrl: 'https://custom.example/v1', apiKey: 'private-key' });
    const modelResponse = await new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: '/api/models', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(modelsBody) } }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
      });
      req.on('error', reject);
      req.end(modelsBody);
    });
    assert.equal(modelResponse.status, 200);
    assert.deepEqual(modelResponse.body.models, ['model-a', 'model-b']);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
  }
});
