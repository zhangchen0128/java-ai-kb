---
domain: 08-模型接入与推理
title: Local Inference and Ollama
status: draft
level: intermediate
sources:
  - level: L1
    url: https://github.com/ollama/ollama
    description: Ollama 官方仓库和文档
  - level: L1
    url: https://docs.vllm.ai/
    description: vLLM 官方文档
  - level: L1
    url: https://github.com/NVIDIA/TensorRT-LLM
    description: TensorRT-LLM 官方仓库
  - level: L1
    url: https://huggingface.co/docs/text-generation-inference/
    description: HuggingFace TGI 官方文档
relations:
  prerequisite:
    - 08-OpenAI兼容协议详解
  related:
    - 08-云模型API与SDK使用
    - 08-模型能力矩阵与路由策略
    - 09-SpringAI2深度解析
tags:
  - ollama
  - vllm
  - tensorrt-llm
  - tgi
  - local-inference
  - quantization
  - gguf
created: 2026-07-17
updated: 2026-07-28
content_type: production
---

# Local Inference and Ollama

## 概述

本地推理（Local Inference）是 LLM 开发生命周期中不可或缺的一环。Ollama 是本地开发和测试的首选工具，而 vLLM/TensorRT-LLM/HuggingFace TGI 是生产推理服务的主流选择。本条目从 Ollama 的 Modelfile 到生产推理服务的选型决策树，全面覆盖。

> 技术雷达：Ollama — Adopt（本地开发）；vLLM — Adopt（生产推理首选）；Docker Model Runner — Trial；TensorRT-LLM — Trial（NVIDIA GPU优化）；TGI — Trial

## Ollama 深入

Ollama 是目前最流行的本地 LLM 运行工具。它用 Go 编写，内置模型管理和推理优化。

### Modelfile 语法

Modelfile 类似于 Dockerfile，定义了一个模型的行为。

```
# Modelfile 示例：创建一个Java编码助手

# 基础模型
FROM qwen2.5:7b

# 温度参数 (0-2)：控制输出的随机性
PARAMETER temperature 0.3

# Top-p 采样 (0-1)：累积概率阈值
PARAMETER top_p 0.9

# Top-k 采样：限制为 top-k 个 token
PARAMETER top_k 40

# 上下文窗口大小
PARAMETER num_ctx 8192

# 重复惩罚 (1-2)：>1 时抑制重复
PARAMETER repeat_penalty 1.1

# 停止序列
PARAMETER stop "<|end|>"
PARAMETER stop "```"

# 系统提示词模板
TEMPLATE """
{{ if .System }}<|system|>
{{ .System }}<|end|>
{{ end }}
<|user|>
{{ .Prompt }}<|end|>
<|assistant|>
"""

# 系统角色定义
SYSTEM """
你是一个资深的Java工程师AI助手，精通：
- Java 25 LTS 新特性
- Spring Boot 4.x
- Spring AI 2.x
- 并发编程 (Virtual Threads)
- JVM 性能优化

回答风格：
- 直接给出可运行的代码
- 代码使用 JDK 25 语法
- 给出最佳实践建议
"""
```

**完整 Modelfile 参数清单：**

| 指令 | 说明 | 示例值 |
|------|------|--------|
| FROM | 基础模型 | llama3.1:8b, qwen2.5:7b |
| PARAMETER | 推理参数 | temperature, top_p, top_k, num_ctx, seed |
| TEMPLATE | 对话模板（Go template 语法） | 对话格式 |
| SYSTEM | 系统提示词 | 角色定义 |
| ADAPTER | LoRA 适配器路径 | ./lora-adapter.bin |
| LICENSE | 许可证声明 | MIT |
| MESSAGE | 对话历史 | user/assistant 消息 |

### 模型管理

```bash
# 拉取模型
ollama pull llama3.1:8b          # 8B 参数，适合本地开发
ollama pull qwen2.5:7b           # 7B，中文最佳
ollama pull qwen2.5:14b          # 14B，更强大（需要更多内存）
ollama pull codellama:7b         # 代码专用

# 列出本地模型
ollama list
# NAME            ID              SIZE      MODIFIED
# llama3.1:8b    abc123def456    4.7 GB    2 days ago
# qwen2.5:7b     xyz789ghi012    4.4 GB    5 days ago

# 查看模型详情
ollama show llama3.1:8b
# 输出：Modelfile、参数、量化方式、层数等

# 删除模型
ollama rm llama3.1:8b

# 复制模型（创建别名/变体）
ollama cp llama3.1:8b my-llama:latest

# 创建自定义模型（从 Modelfile）
ollama create java-assistant -f Modelfile

# 运行模型
ollama run java-assistant
```

### REST API

Ollama 默认在 `http://localhost:11434` 上启动 HTTP 服务。

**Generate API（单轮生成）：**

```bash
# 非流式
curl http://localhost:11434/api/generate -d '{
  "model": "llama3.1:8b",
  "prompt": "Why is the sky blue?",
  "stream": false
}'

# 流式
curl http://localhost:11434/api/generate -d '{
  "model": "llama3.1:8b",
  "prompt": "Write a haiku about programming",
  "stream": true
}'
```

**Chat API（多轮对话）：**

```bash
curl http://localhost:11434/api/chat -d '{
  "model": "llama3.1:8b",
  "messages": [
    {"role": "system", "content": "You are a Java expert."},
    {"role": "user", "content": "What are Virtual Threads?"}
  ],
  "stream": false
}'
```

**Embeddings API：**

```bash
curl http://localhost:11434/api/embeddings -d '{
  "model": "nomic-embed-text",
  "prompt": "The quick brown fox jumps over the lazy dog"
}'
```

### OpenAI 兼容端点

Ollama 提供了 OpenAI 兼容的端点：

```bash
# Chat Completions (兼容 OpenAI)
curl http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama3.1:8b",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ],
    "temperature": 0.7,
    "stream": false
  }'

# Embeddings (兼容 OpenAI)
curl http://localhost:11434/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{
    "model": "nomic-embed-text",
    "input": "Your text to embed"
  }'

# 列出模型 (兼容 OpenAI)
curl http://localhost:11434/v1/models
```

### 并发控制

```bash
# 环境变量控制
OLLAMA_NUM_PARALLEL=4    # 最大并行请求数（默认1）
OLLAMA_MAX_LOADED=2      # 最大同时加载的模型数
OLLAMA_KEEP_ALIVE=5m     # 模型在内存中的保持时间
OLLAMA_HOST=0.0.0.0      # 绑定地址
OLLAMA_PORT=11434        # 端口

# 启动示例
OLLAMA_NUM_PARALLEL=4 OLLAMA_HOST=0.0.0.0 ollama serve
```

### GPU 加速

```bash
# Ollama 支持的 GPU 后端：
# - CUDA (NVIDIA)：自动检测
# - ROCm (AMD)：需安装 ROCm 驱动
# - Metal (Apple Silicon)：macOS 自动使用

# 检查 GPU 使用
ollama ps
# NAME            ID              SIZE      PROCESSOR    UNTIL
# llama3.1:8b    abc123          5.8 GB    100% GPU     4 minutes from now
```

### 量化格式

Ollama 使用 GGUF 格式存储量化模型。不同量化级别是存储大小、推理速度和质量的三角权衡。

```
常见量化格式对比：

格式        bits/weight  模型大小(7B)  质量损失   速度    推荐场景
Q2_K       2             2.8 GB       中        极快    资源极度受限
Q3_K_M     3             3.8 GB       中低      很快    低资源设备
Q4_0       4             4.3 GB       低        快      标准推荐
Q4_K_M     4             4.7 GB       很低      快      最佳性价比 ★
Q5_K_M     5             5.5 GB       极低      中等    高精度需求
Q8_0       8             7.7 GB       可忽略     慢      需要接近全精度
F16        16            15 GB        无        慢      研究/精调

Q4_K_M 是本地开发的"甜点"：
  - 质量接近全精度（PPL 增加 < 0.5）
  - 大小适中（7B 模型约 4.7GB）
  - 速度足够（在 M2/M3 Mac 上可达 20-30 tokens/s）
```

**量化技术差异：**

```
Q4_0: 简单的 4-bit 整数量化
  - 每个权重 4 bits
  - 每 32 个权重共享一个 scale

Q4_K_M: K-Quants 4-bit 量化（改进版）
  - 使用重要性矩阵指导量化
  - 对重要权重（Attention 层的 K/Q/V）使用更高精度
  - SuperBlock 结构优化
  - 实际效果显著优于 Q4_0

Q5_K_M: K-Quants 5-bit
  - Attention 权重 5-bit，FFN 权重 4-bit
  - 质量接近 Q8_0，大小接近 Q4_K_M
```

### Java 集成

**方式一：使用 Spring AI Ollama Starter（推荐）**

```xml
<dependency>
    <groupId>org.springframework.ai</groupId>
    <artifactId>spring-ai-starter-model-ollama</artifactId>
</dependency>
```

```yaml
# application.yml
spring:
  ai:
    ollama:
      base-url: http://localhost:11434
      chat:
        enabled: true
        options:
          model: llama3.1:8b
          temperature: 0.7
      embedding:
        enabled: true
        options:
          model: nomic-embed-text
```

```java
@SpringBootApplication
public class OllamaDemoApplication {

    public static void main(String[] args) {
        SpringApplication.run(OllamaDemoApplication.class, args);
    }

    @Bean
    CommandLineRunner demo(ChatClient.Builder chatClientBuilder) {
        return args -> {
            var chatClient = chatClientBuilder.build();

            System.out.println(chatClient.prompt()
                .user("用一句话解释什么是Virtual Threads")
                .call()
                .content());
        };
    }
}
```

**方式二：手动 HTTP 调用**

```java
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import com.fasterxml.jackson.databind.ObjectMapper;

public class OllamaHttpClient {

    private final HttpClient httpClient = HttpClient.newHttpClient();
    private final ObjectMapper mapper = new ObjectMapper();
    private final String baseUrl;

    public OllamaHttpClient(String baseUrl) {
        this.baseUrl = baseUrl;
    }

    /**
     * 生成文本（非流式）
     */
    public String generate(String model, String prompt, float temperature) {
        try {
            var body = mapper.writeValueAsString(Map.of(
                "model", model,
                "prompt", prompt,
                "temperature", temperature,
                "stream", false
            ));

            var request = HttpRequest.newBuilder()
                .uri(URI.create(baseUrl + "/api/generate"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();

            var response = httpClient.send(request,
                HttpResponse.BodyHandlers.ofString());
            var node = mapper.readTree(response.body());

            return node.get("response").asText();
        } catch (Exception e) {
            throw new RuntimeException("Ollama调用失败", e);
        }
    }

    /**
     * 流式对话（使用 SSE）
     */
    public void streamChat(String model, List<Map<String, String>> messages,
            java.util.function.Consumer<String> onToken) {
        try {
            var body = mapper.writeValueAsString(Map.of(
                "model", model,
                "messages", messages,
                "stream", true
            ));

            var request = HttpRequest.newBuilder()
                .uri(URI.create(baseUrl + "/api/chat"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();

            httpClient.send(request, HttpResponse.BodyHandlers.ofLines())
                .body()
                .forEach(line -> {
                    try {
                        var node = mapper.readTree(line);
                        var content = node.path("message")
                            .path("content").asText();
                        if (!content.isEmpty()) {
                            onToken.accept(content);
                        }
                    } catch (Exception ignored) {}
                });
        } catch (Exception e) {
            throw new RuntimeException("流式对话失败", e);
        }
    }

    /**
     * 获取 Embedding
     */
    public float[] getEmbedding(String model, String text) {
        try {
            var body = mapper.writeValueAsString(Map.of(
                "model", model,
                "prompt", text
            ));

            var request = HttpRequest.newBuilder()
                .uri(URI.create(baseUrl + "/api/embeddings"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();

            var response = httpClient.send(request,
                HttpResponse.BodyHandlers.ofString());
            var node = mapper.readTree(response.body());

            var embeddingNode = node.get("embedding");
            var embedding = new float[embeddingNode.size()];
            for (int i = 0; i < embedding.length; i++) {
                embedding[i] = (float) embeddingNode.get(i).asDouble();
            }
            return embedding;
        } catch (Exception e) {
            throw new RuntimeException("Embedding生成失败", e);
        }
    }

    /**
     * 列出所有本地模型
     */
    public List<String> listModels() {
        try {
            var request = HttpRequest.newBuilder()
                .uri(URI.create(baseUrl + "/api/tags"))
                .GET()
                .build();

            var response = httpClient.send(request,
                HttpResponse.BodyHandlers.ofString());
            var node = mapper.readTree(response.body());

            var models = new ArrayList<String>();
            node.get("models").forEach(m ->
                models.add(m.get("name").asText()));
            return models;
        } catch (Exception e) {
            throw new RuntimeException("获取模型列表失败", e);
        }
    }
}
```

## Docker Model Runner

Docker 也进入了本地模型推理领域，提供 Docker Model Runner。

```bash
# 拉取模型
docker model pull ai/llama3.1:8b

# 列出模型
docker model list

# 推理（使用 OpenAI 兼容端点）
docker model run ai/llama3.1:8b

# 启动 HTTP 服务
docker model serve ai/llama3.1:8b --port 8080
# 然后访问 http://localhost:8080/v1/chat/completions
```

**Docker Model Runner vs Ollama：**

```
┌────────────────────┬───────────────────┬─────────────────────────┐
│ 特性                │ Docker Model Runner│ Ollama                  │
├────────────────────┼───────────────────┼─────────────────────────┤
│ 容器生态集成        │ ★★★★★ 原生         │ ★★★                    │
│ 模型库              │ Docker Hub 模型     │ Ollama 模型库(丰富)    │
│ Docker Compose 集成 │ ★★★★★              │ ★★★ (需手动配置)       │
│ Modelfile 支持      │ 通过Dockerfile      │ ★★★★★ 原生Modelfile    │
│ GPU 支持            │ ★★★★               │ ★★★★★(自动检测)        │
│ 量化支持            │ 有限               │ ★★★★★                  │
│ 社区成熟度          │ 较新 (2024+)       │ ★★★★★ 非常成熟         │
└────────────────────┴───────────────────┴─────────────────────────┘
```

> 当前建议：Ollama 作为本地开发主栈，Docker Model Runner 保持关注。

## 推理服务对比

### vLLM

vLLM 是当前生产推理服务的首选。核心创新是 PagedAttention。

**架构特点：**

```
vLLM 架构亮点：

1. PagedAttention
   - 将 KV Cache 分页管理（类似 OS 虚拟内存）
   - 零内存碎片
   - 支持 KV Cache 共享（beam search / parallel sampling）

2. Continuous Batching
   - 请求动态插入和移除
   - GPU 利用率 80%+ (vs 20-40% static batching)

3. 前缀缓存 (Prefix Caching)
   - 相同 system prompt 的 KV Cache 自动复用
   - 对 RAG 场景（相同 system prompt + 不同文档）加速显著

4. 多GPU张量并行
   - 大模型跨 GPU 自动切分
   - 支持流水线并行

5. OpenAI 兼容 API
   - 直接作为 OpenAI 替代品
```

**启动和 Java 调用：**

```bash
# 启动 vLLM (带 OpenAI 兼容 API)
vllm serve meta-llama/Llama-3.1-8B-Instruct \
  --host 0.0.0.0 \
  --port 8000 \
  --max-model-len 8192 \
  --gpu-memory-utilization 0.9 \
  --tensor-parallel-size 1
```

```java
/**
 * 调用 vLLM 的 OpenAI 兼容端点
 * 因为协议兼容，可以直接使用 OpenAI SDK
 */
public class VllmClient {

    public static String vllmChat(String prompt) {
        // vLLM 默认在 localhost:8000 提供 OpenAI 兼容 API
        var client = OpenAiOkHttpClient.builder()
            .baseUrl("http://localhost:8000/v1")  // 指向 vLLM
            .apiKey("not-needed")  // vLLM 本地不需要
            .build();

        var params = ChatCompletionCreateParams.builder()
            .model("meta-llama/Llama-3.1-8B-Instruct")
            .messages(List.of(
                ChatCompletionMessageParam.ofUser(prompt)
            ))
            .maxTokens(500)
            .temperature(0.7d)
            .build();

        var response = client.chat().completions().create(params);
        return response.choices().get(0).message().content().orElse("");
    }
}
```

### TensorRT-LLM

NVIDIA 的优化推理引擎，对 NVIDIA GPU 进行了深度优化。

```
TensorRT-LLM 工作流：

模型 (HuggingFace)  →  构建 (build)  →  TensorRT Engine  →  部署 (serve)
                                  ↓
                          图优化 + 算子融合
                          + FP8/INT4 量化
                          + 内核自动调优


关键优化：
  - 图优化：算子融合（LayerNorm + Attention + GeLU）
  - FlashAttention：高效 attention 计算
  - 量化：FP8 (H100+) / INT4 (weight-only)
  - In-flight Batching：类似 Continuous Batching
  - 多GPU: Tensor Parallelism + Pipeline Parallelism
```

**量化对比：**

| 引擎 | 量化方式 | 精度损失 | 加速比 | GPU 要求 |
|------|----------|----------|--------|----------|
| TensorRT-LLM FP16 | 无 | 0 | 1.5x | 任何 NVIDIA |
| TensorRT-LLM FP8 | 浮点8位 | 极低 | 2.5x | H100/Ada |
| TensorRT-LLM INT4 | 4位整数(weight only) | 低 | 4x | 任何 NVIDIA |
| vLLM FP16 | 无 | 0 | 1x (基准) | 任何 NVIDIA |
| vLLM AWQ | 4位 | 低 | 3x | 任何 NVIDIA |
| Ollama Q4_K_M | 4位 GGUF | 低 | N/A | CPU/GPU 皆可 |

### HuggingFace TGI (Text Generation Inference)

HuggingFace 的官方推理服务，适合 HuggingFace 生态。

```
TGI 特点：
  - 原生支持 HuggingFace 模型（一键部署）
  - 内置 Flash Attention / Paged Attention
  - 支持量化（bitsandbytes / GPT-Q / AWQ / EETQ）
  - Watermark 支持（检测 AI 生成文本）
  - Safetensors 权重加载
  - 与 HuggingFace Hub 无缝集成
```

```bash
# Docker 启动 TGI
docker run --gpus all -p 8080:80 \
  -e HF_TOKEN=$HF_TOKEN \
  ghcr.io/huggingface/text-generation-inference:latest \
  --model-id meta-llama/Llama-3.1-8B-Instruct \
  --max-total-tokens 4096
```

### 推理服务选择决策树

```
你部署推理服务的环境？
├── NVIDIA GPU
│   ├── H100 或 Ada 架构（支持 FP8）
│   │   └── TensorRT-LLM (最佳性能)
│   ├── 有 CUDA 环境
│   │   ├── 追求最佳 Token/s + 成熟度
│   │   │   └── vLLM ★ (当前最佳通用选择)
│   │   ├── HuggingFace 生态深度用户
│   │   │   └── TGI
│   │   └── 极致性能优化（NVIDIA 专门优化）
│   │       └── TensorRT-LLM
│   └── 需要快速原型/测试
│       └── Ollama
├── Apple Silicon (M系列)
│   └── Ollama (通过 Metal 加速，体验极佳)
├── AMD GPU
│   └── Ollama (ROCm 支持) / vLLM (ROCm 实验性支持)
└── CPU only
    └── Ollama (GGUF 量化，可接受的小模型推理)
```

```
你的需求场景？
├── 本地开发/测试
│   └── Ollama ★
│       - 一条命令启动
│       - 丰富的模型库
│       - 支持 Modelfile 自定义
│       - 自动 GPU 加速
│
├── 生产 API 服务（高吞吐）
│   └── vLLM ★
│       - Continuous Batching
│       - 高 GPU 利用率
│       - OpenAI 兼容 API
│       - 前缀缓存（RAG场景必备）
│
├── 生产 API 服务（极致性能/NVIDIA优化）
│   └── TensorRT-LLM
│       - FP8/INT4 量化
│       - 算子融合优化
│       - 2-4x 吞吐提升
│
├── HuggingFace 模型部署
│   └── TGI
│       - 原生支持
│       - 一键部署
│       - watermarking
│
└── 嵌入式/JVM内嵌
    └── DJL / ONNX Runtime / llama.cpp (JNI)
        - 仅适合小模型 (< 3B)
        - 详见 JVM内嵌推理条目
```

## 最佳实践

1. **开发环境 = Ollama，生产环境 = vLLM**：这是最成熟、最安全的组合。开发时用 Ollama 快速迭代，上线时用 vLLM 的性能和稳定性
2. **Ollama 使用 Q4_K_M 量化**：7B 模型约 4.7GB，在普通开发机（16GB+ RAM）上运行舒适
3. **启用 Ollama 的 OpenAI 兼容端点**：这意味着你的代码不用改一行就可以同时支持 Ollama（本地）和 OpenAI（云端），切换只需改 base URL
4. **vLLM 的前缀缓存对 RAG 特别有效**：相同的 system prompt + 不同的检索文档 → 前缀缓存命中 → 延迟降低 30-50%
5. **生产环境不要用 Ollama**：Ollama 缺少 Continuous Batching、前缀缓存、多GPU并行等生产必需特性
6. **监控推理服务的 GPU 利用率**：GPU 利用率 < 50% 可能是 batch size 太小或请求太少，考虑降低实例数

## 常见问题

**Q: 7B 模型够用吗？**

A: 对于特定任务（代码补全、简单问答、文本分类、信息提取），7B 模型配合好的 prompt 工程效果可以接近大型闭源模型。对于复杂推理（多步数学、深度代码分析），需要更大模型（14B+）或使用闭源 API。

**Q: Ollama 的内存占用怎么计算？**

A: 模型大小 + KV Cache 开销。以 Q4_K_M 量化的 7B 模型为例：模型约 4.7GB + KV Cache (num_ctx=8192) 约 2GB = 总计约 7GB。建议至少 16GB RAM。

**Q: vLLM 和 Ollama 可以共存吗？**

A: 完全可以，而且推荐。开发用 Ollama（快速迭代），预发布环境用 vLLM（性能验证），生产用 vLLM（正式服务）。

## 相关条目

- [[08-OpenAI兼容协议详解]] — OpenAI 兼容协议（Ollama 和 vLLM 都支持）
- [[08-云模型API与SDK使用]] — 云模型 API 对比
- [[08-模型能力矩阵与路由策略]] — 模型选择和路由
- [[09-SpringAI2深度解析]] — Spring AI 与 Ollama Starter 集成
