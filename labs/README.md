# Java AI 知识库 — 可运行实验代码

80篇知识笔记对应的 Maven 多模块实验项目。

## 模块与知识库映射

| 模块 | 知识域 | 关键文章 |
|------|--------|----------|
| `lab-java25-concurrency` | 02-Java平台 | [现代Java25深度解析](../knowledge/02-Java平台/语言特性/02-现代Java25深度解析.md)、[Java并发深度解析](../knowledge/02-Java平台/并发/02-Java并发深度解析.md) |
| `lab-spring-ai-chat` | 09-Java AI框架 | [SpringAI2深度解析](../knowledge/09-Java%20AI框架/09-SpringAI2深度解析.md) |
| `lab-spring-ai-tools` | 09/12 | [ToolCalling完整剖析](../knowledge/12-Agent工程/核心能力/12-ToolCalling完整剖析.md) |
| `lab-mcp-server` | 13-AI协议 | [MCP协议与JavaSDK](../knowledge/13-AI协议/13-MCP协议与JavaSDK.md) |
| `lab-a2a-agent` | 13-AI协议 | [A2A协议与Agent互操作](../knowledge/13-AI协议/13-A2A协议与Agent互操作.md) |
| `lab-rag-pipeline` | 11-检索与RAG | [完整RAG流水线实现](../knowledge/11-检索与RAG/RAG实现/11-完整RAG流水线实现.md) |
| `lab-ai-security` | 15-AI安全与治理 | [AI安全全面防护体系](../knowledge/15-AI安全与治理/15-AI安全全面防护体系.md) |
| `lab-ai-observability` | 14-AI平台与LLMOps | [AI评估与可观测性](../knowledge/14-AI平台与LLMOps/14-AI评估与可观测性.md) |

## 运行

```bash
# 全部模块编译+测试
mvn test

# 单个模块
mvn test -pl lab-java25-concurrency

# 跳过需要外部服务的测试
mvn test -DexcludeGroups=external
```

## 版本锁定

- JDK 25 LTS
- Spring Boot 4.0.0
- Spring AI 2.0.0
- JUnit 5.11.4
- Testcontainers 1.20.4

## 规则

- ✅ 无外部密钥即可运行的单元测试
- ✅ 默认不进入 CI 的需要外部服务的测试（`@Disabled`）
- ✅ 固定版本号，不使用 BOM 范围版本
- ✅ 文章中的代码与 lab 示例一一对应
