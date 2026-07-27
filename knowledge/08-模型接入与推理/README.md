# 08 — 模型接入与推理

> 云模型API、本地模型、模型能力、流式响应、模型路由、推理服务。

## 子域

| 子域 | 条目 |
|------|------|
| [模型API](模型API/) | OpenAI兼容协议详解、云厂商SDK(OpenAI/Anthropic/Bedrock/Gemini/Azure) |
| [推理部署](推理部署/) | Ollama本地推理、vLLM/TensorRT-LLM/TGI生产推理、模型能力矩阵与路由策略 |

## 架构原则

业务代码通过 Port 接口层抽象，不直接依赖厂商 API/SDK：

```
业务层 → ChatModelPort(接口) → Spring AI适配器 / 厂商SDK适配器 → 模型
```
