# Intelligence Test

一个用 React 构建的“鹈鹕骑自行车”测试页面。用户选择请求协议、填写 Base URL、模型 ID 与 API Key，Node 后端要求模型生成独立 HTML 页面，并在隔离的页面中预览。

## 启动

要求 Node.js 20.19+ 或 22.12+。

```bash
npm install
npm run dev
```

打开 `http://127.0.0.1:5173`。Vite 将 `/api` 转发到本地 Node 服务（端口 3001）。

生产构建与本地服务：

```bash
npm run build
npm start
```

然后打开 `http://127.0.0.1:3001`。可使用 `PORT` 环境变量调整端口。

## 使用

1. 选择请求协议：OpenAI 兼容、Anthropic Messages 或 Gemini generateContent。
2. 输入 API 根地址 **Base URL**。服务会按协议自动附加 `/chat/completions`、`/messages` 或 `/models/{模型 ID}:generateContent`。例如 OpenAI 是 `https://api.openai.com/v1`，DeepSeek 的 OpenAI 兼容接口可填其相应 API 根地址。
3. 在“模型”下拉框选择模型。点击“获取列表”可从当前 Base URL 的 `/models` 接口读取可用模型；若接口不提供列表，选择“手动填写模型 ID…”。默认值仅供起步。
4. 选择思考程度，默认不发送额外思考参数；低、中、高会按协议转换为相应参数。模型或兼容接口不支持时，改回默认。
5. 填入自己的 API Key，点击“运行测试”。无鉴权的本地接口可留空。
6. 在结果区切换 HTML 预览和原始输出，或下载带预览限制的 `.html` 文件。

固定提示词：`Create a complete, self-contained HTML document that visually depicts a pelican riding a bicycle. Use HTML and CSS; inline SVG is optional. Do not use JavaScript, external assets, or image URLs. Return only the HTML document.` SVG 可以内嵌，但不再是必需项。因此本项目当前是 HTML 版本的鹈鹕测试，结果与要求纯 SVG 的测试不能直接按同一标准比较。

思考程度映射：OpenAI 兼容接口使用 `reasoning_effort`；Anthropic Claude 4.5 使用 `thinking.budget_tokens`，新版本使用自适应思考与 `output_config.effort`；Gemini 2.5 使用 `thinkingBudget`，Gemini 3 使用 `thinkingLevel`。不同供应商和模型支持程度不同，默认选项最兼容。参考 [OpenAI 推理指南](https://developers.openai.com/api/docs/guides/reasoning)、[Anthropic 扩展思考](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)、[Gemini 思考指南](https://ai.google.dev/gemini-api/docs/generate-content/thinking)。

API Key 仅存在于当前页面内存与本次后端请求中；服务端不持久化密钥，也不记录请求体。**密钥会被转发到用户填写的 Base URL**，请确认地址可信。自定义 URL 允许连接本地 HTTP 服务；如果公开部署此项目，需要为后端增加访问控制、目标地址限制、HTTPS 和速率限制。模型生成内容在禁止脚本和网络连接的 sandbox iframe 中预览；下载的 HTML 同样加入内容安全策略，分享或在其他应用打开前仍应自行检查。

模型列表读取支持 OpenAI 兼容和 Anthropic 的 `data[].id`，以及 Gemini 的 `models[].name`。部分兼容接口可能未实现 `/models`；此时可手动填写。

### OpenCode Go

使用 OpenCode Go 订阅密钥时，选择 **OpenAI 兼容**，将 Base URL 填为 `https://opencode.ai/zen/go/v1`，然后点击“获取列表”，选择官方标为 `/chat/completions` 的模型，例如 `glm-5.3-flash`。API Key 字段只粘贴密钥本身，不加 `Bearer `。`https://opencode.ai/zen/v1` 是 Zen 按量计费地址，不能代替 Go 地址。

项目会为 OpenCode Go 请求发送自身客户端标识和页面内稳定的 `x-opencode-session`。OpenCode Go 官方说明它主要面向编码代理流量，并有每 5 小时、每周及每月的用量限制；本项目并非其官方验证客户端，因此无法保证所有测试请求都会被接受。详见 [OpenCode Go 文档](https://opencode.ai/docs/go/)。

## 开发

```bash
npm test
npm run build
```

页面样式参考 [`DESIGN.md`](DESIGN.md)，项目进度见 [`docs/PROGRESS.md`](docs/PROGRESS.md)。

## 许可证

Copyright 2026 dartcv。本项目使用 [Apache License 2.0](LICENSE)。
