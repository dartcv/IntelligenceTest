import { useEffect, useMemo, useRef, useState } from 'react';

const fallback = {
  prompt: 'Create a complete, self-contained HTML document that visually depicts a pelican riding a bicycle. Use HTML and CSS; inline SVG is optional. Do not use JavaScript, external assets, or image URLs. Return only the HTML document.',
  protocols: [
    { id: 'openai', label: 'OpenAI 兼容', hint: 'gpt-4o', baseUrl: 'https://api.openai.com/v1' },
    { id: 'anthropic', label: 'Anthropic Messages', hint: 'claude-sonnet-4-5', baseUrl: 'https://api.anthropic.com/v1' },
    { id: 'gemini', label: 'Gemini generateContent', hint: 'gemini-2.5-pro', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
  ],
};

function makePreview(markup) {
  const protection = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; connect-src 'none'"><meta name="viewport" content="width=device-width,initial-scale=1">`;
  if (/<head\b[^>]*>/i.test(markup)) return markup.replace(/<head\b[^>]*>/i, (head) => `${head}${protection}`);
  if (/<html\b[^>]*>/i.test(markup)) return markup.replace(/<html\b[^>]*>/i, (html) => `${html}<head>${protection}</head>`);
  return `<!doctype html><html><head><meta charset="utf-8">${protection}</head><body>${markup}</body></html>`;
}

export default function App() {
  const [config, setConfig] = useState(fallback);
  const [protocol, setProtocol] = useState('openai');
  const [baseUrl, setBaseUrl] = useState(fallback.protocols[0].baseUrl);
  const [model, setModel] = useState(fallback.protocols[0].hint);
  const [models, setModels] = useState([]);
  const [modelMode, setModelMode] = useState('select');
  const [modelLoading, setModelLoading] = useState(false);
  const [modelError, setModelError] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [effort, setEffort] = useState('default');
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [view, setView] = useState('preview');
  const [elapsed, setElapsed] = useState(0);
  const startTime = useRef(0);
  const sessionId = useRef(globalThis.crypto?.randomUUID?.() ?? `session-${Date.now()}`);
  const modelRequestId = useRef(0);
  const resultRef = useRef(null);

  useEffect(() => {
    fetch('/api/config').then((response) => response.ok ? response.json() : Promise.reject()).then(setConfig).catch(() => {});
  }, []);

  useEffect(() => {
    if (status !== 'loading') return;
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startTime.current) / 1000)), 500);
    return () => clearInterval(timer);
  }, [status]);

  const preview = useMemo(() => result ? makePreview(result.html) : '', [result]);

  function chooseProtocol(id) {
    const choice = config.protocols.find((item) => item.id === id);
    setProtocol(id);
    setBaseUrl(choice?.baseUrl ?? '');
    setModel(choice?.hint ?? '');
    setModels([]);
    setModelMode('select');
    setModelLoading(false);
    setModelError('');
    modelRequestId.current += 1;
    setError('');
  }

  function changeConnection(setter, value) {
    setter(value);
    setModels([]);
    setModelError('');
    setModelLoading(false);
    modelRequestId.current += 1;
  }

  async function loadModels() {
    const requestId = ++modelRequestId.current;
    setModelLoading(true);
    setModelError('');
    try {
      const response = await fetch('/api/models', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ protocol, baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), sessionId: sessionId.current }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '无法读取模型列表。');
      if (requestId !== modelRequestId.current) return;
      if (!Array.isArray(data.models) || !data.models.length) throw new Error('接口未返回可用模型，请手动填写模型 ID。');
      setModels(data.models);
      const goCompatibleDefault = protocol === 'openai'
        && baseUrl.trim().replace(/\/+$/, '') === 'https://opencode.ai/zen/go/v1'
        && data.models.includes('glm-5.3-flash');
      setModel(data.models.includes(model) ? model : goCompatibleDefault ? 'glm-5.3-flash' : data.models[0]);
      setModelMode('select');
    } catch (caught) {
      if (requestId === modelRequestId.current) setModelError(caught.message || '无法读取模型列表，请手动填写。');
    } finally {
      if (requestId === modelRequestId.current) setModelLoading(false);
    }
  }

  const modelChoices = models.length ? models : [model || config.protocols.find((item) => item.id === protocol)?.hint].filter(Boolean);

  async function runTest(event) {
    event.preventDefault();
    setStatus('loading');
    setError('');
    setResult(null);
    setElapsed(0);
    startTime.current = Date.now();
    try {
      const response = await fetch('/api/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ protocol, baseUrl: baseUrl.trim(), model: model.trim(), apiKey: apiKey.trim(), effort, sessionId: sessionId.current }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '请求失败，请稍后再试。');
      setResult({ ...data, seconds: Math.max(1, Math.round((Date.now() - startTime.current) / 1000)) });
      setView('preview');
      setStatus('success');
      if (window.innerWidth < 800) requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth' }));
    } catch (caught) {
      setError(caught.message || '请求失败，请稍后再试。');
      setStatus('error');
    }
  }

  function download() {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([preview], { type: 'text/html;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `pelican-${result.protocol}-${result.model.replace(/[^a-z0-9.-]/gi, '-')}.html`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <>
    <header className="topbar"><div className="topbar-inner"><span className="brand">Intelligence Test</span></div></header>
    <main className="workspace">
      <div className="intro">
        <h1>鹈鹕测试</h1>
        <p>让模型生成骑自行车的鹈鹕 HTML 页面。</p>
      </div>
      <div className="work-grid">
        <form className="settings" onSubmit={runTest}>
          <h2>设置</h2>
          <div className="field">
            <label htmlFor="protocol">请求协议</label>
            <select id="protocol" value={protocol} onChange={(event) => chooseProtocol(event.target.value)}>
              {config.protocols.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="base-url">Base URL</label>
            <input id="base-url" type="url" value={baseUrl} onChange={(event) => changeConnection(setBaseUrl, event.target.value)} placeholder="https://api.example.com/v1" spellCheck="false" required />
            <small>填写 API 根地址，不含接口路径。</small>
          </div>
          <div className="field">
            <div className="field-heading"><label htmlFor="model">模型</label><button type="button" onClick={loadModels} disabled={modelLoading}>{modelLoading ? '读取中…' : '获取列表'}</button></div>
            {modelMode === 'select'
              ? <select id="model" value={model} onChange={(event) => {
                  if (event.target.value === '__custom__') { setModelMode('custom'); setModel(''); }
                  else setModel(event.target.value);
                }}>
                  {modelChoices.map((id) => <option key={id} value={id}>{id}</option>)}
                  <option value="__custom__">手动填写模型 ID…</option>
                </select>
              : <div className="manual-model"><input id="model" value={model} onChange={(event) => setModel(event.target.value)} placeholder="输入模型 ID" autoComplete="off" spellCheck="false" required /><button type="button" onClick={() => { setModel(modelChoices[0] || ''); setModelMode('select'); }}>返回选择</button></div>}
            {modelError && <small className="model-error" role="status">{modelError}</small>}
          </div>
          <div className="field">
            <label htmlFor="effort">思考程度</label>
            <select id="effort" value={effort} onChange={(event) => setEffort(event.target.value)}>
              <option value="default">默认</option>
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
            </select>
            <small>若模型不支持此参数，请选择默认。</small>
          </div>
          <div className="field">
            <label htmlFor="api-key">API Key <span className="optional">可选</span></label>
            <div className="key-input">
              <input id="api-key" type={showKey ? 'text' : 'password'} value={apiKey} onChange={(event) => changeConnection(setApiKey, event.target.value)} placeholder="本地无鉴权服务可留空" autoComplete="off" spellCheck="false" />
              <button type="button" onClick={() => setShowKey(!showKey)} aria-label={showKey ? '隐藏 API Key' : '显示 API Key'}>{showKey ? '隐藏' : '显示'}</button>
            </div>
          </div>
          <div className="prompt"><span>固定提示词</span><code>{config.prompt}</code></div>
          <button className="primary-button" type="submit" disabled={status === 'loading'}>{status === 'loading' ? `生成中 · ${elapsed}s` : '运行测试'}</button>
          {error && <p className="error" role="alert">{error}</p>}
          <p className="privacy">密钥仅用于本次请求，将发送至填写的 Base URL。</p>
        </form>
        <section className="output" ref={resultRef} aria-labelledby="output-title">
          <div className="output-head">
            <h2 id="output-title">结果</h2>
            {result && <div className="output-actions">
              <div className="tabs" role="tablist" aria-label="结果视图">
                <button type="button" role="tab" aria-selected={view === 'preview'} onClick={() => setView('preview')}>预览</button>
                <button type="button" role="tab" aria-selected={view === 'source'} onClick={() => setView('source')}>源码</button>
              </div>
              <button type="button" className="download" onClick={download}>下载 HTML</button>
            </div>}
          </div>
          <div className="output-body">
            {!result && <div className="empty">{status === 'loading' ? `正在生成作品 · ${elapsed}s` : '运行测试后，作品将在这里显示。'}</div>}
            {result && (view === 'preview'
              ? <iframe className="artwork-preview" title="鹈鹕 HTML 预览" sandbox="" referrerPolicy="no-referrer" srcDoc={preview} />
              : <pre className="source-view"><code>{result.raw}</code></pre>)}
          </div>
          {result && <div className="output-meta">{result.model} · {result.seconds}s</div>}
        </section>
      </div>
    </main>
  </>;
}
