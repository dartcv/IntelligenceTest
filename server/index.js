import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { callProvider, listModels, PROMPT, PROTOCOLS, validateConnection, validateRequest } from './core.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '12kb' }));
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.get('/api/config', (_req, res) => {
  res.json({ prompt: PROMPT, protocols: Object.entries(PROTOCOLS).map(([id, { label, hint, baseUrl }]) => ({ id, label, hint, baseUrl })) });
});

app.post('/api/models', async (req, res) => {
  let input;
  try { input = validateConnection(req.body); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const models = await listModels(input, fetch, controller.signal);
    res.json({ models });
  } catch (error) {
    const originalMessage = error.name === 'AbortError' ? '读取模型列表超时。' : error.message;
    const message = input.apiKey ? originalMessage.replaceAll(input.apiKey, '[API Key 已隐藏]') : originalMessage;
    res.status(502).json({ error: message });
  } finally {
    clearTimeout(timeout);
  }
});

app.post('/api/test', async (req, res) => {
  let input;
  try { input = validateRequest(req.body); }
  catch (error) { return res.status(400).json({ error: error.message }); }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
  try {
    const result = await callProvider(input, fetch, controller.signal);
    res.json({ protocol: input.protocol, baseUrl: input.baseUrl, model: input.model, prompt: PROMPT, ...result });
  } catch (error) {
    const originalMessage = error.name === 'AbortError' ? '模型响应超时，请重试。' : error.message;
    const message = input.apiKey ? originalMessage.replaceAll(input.apiKey, '[API Key 已隐藏]') : originalMessage;
    res.status(error.message?.startsWith('模型未返回') ? 422 : 502).json({ error: message });
  } finally {
    clearTimeout(timeout);
  }
});

app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在。' }));

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
app.use(express.static(dist));
app.get('/{*path}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));

if (process.env.NODE_ENV !== 'test') {
  const port = Number(process.env.PORT) || 3001;
  app.listen(port, '127.0.0.1', () => console.log(`Intelligence Test running at http://127.0.0.1:${port}`));
}

export default app;
