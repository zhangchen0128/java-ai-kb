# Java AI 知识库 — 可运行实验代码

86 篇知识条目的 Maven 多模块实验项目。默认测试使用确定性模型、进程内
协议端点、STDIO 子进程和内存数据，不要求 API Key、数据库或公网。

## 模块与知识库映射

| 模块 | 知识域 | 关键文章 |
|------|--------|----------|
| `lab-java25-concurrency` | 02/05 | [现代Java25深度解析](../knowledge/02-Java平台/语言特性/02-现代Java25深度解析.md)、[Java并发深度解析](../knowledge/02-Java平台/并发/02-Java并发深度解析.md)、[熔断限流与弹性设计](../knowledge/05-分布式架构/弹性设计/05-熔断限流与弹性设计.md)、[缓存策略与多级缓存架构](../knowledge/05-分布式架构/事务与一致性/05-缓存策略与多级缓存架构.md) |
| `lab-spring-ai-chat` | 08/09 | [云模型API与SDK使用](../knowledge/08-模型接入与推理/模型API/08-云模型API与SDK使用.md)、[SpringAI2深度解析](../knowledge/09-Java%20AI框架/09-SpringAI2深度解析.md) |
| `lab-spring-ai-tools` | 09/12 | [ToolCalling完整剖析](../knowledge/12-Agent工程/核心能力/12-ToolCalling完整剖析.md) |
| `lab-mcp-server` | 13-AI协议 | [MCP协议与JavaSDK](../knowledge/13-AI协议/13-MCP协议与JavaSDK.md) |
| `lab-a2a-agent` | 13-AI协议 | [A2A协议与Agent互操作](../knowledge/13-AI协议/13-A2A协议与Agent互操作.md) |
| `lab-rag-pipeline` | 11-检索与RAG | [完整RAG流水线实现](../knowledge/11-检索与RAG/RAG实现/11-完整RAG流水线实现.md) |
| `lab-ai-security` | 15-AI安全与治理 | [AI安全全面防护体系](../knowledge/15-AI安全与治理/15-AI安全全面防护体系.md) |
| `lab-ai-observability` | 14-AI平台与LLMOps | [AI评估与可观测性](../knowledge/14-AI平台与LLMOps/14-AI评估与可观测性.md) |

## 运行

```bash
# 从仓库根目录执行全部模块
mvn -B -f labs/pom.xml test

# 单个模块
mvn -B -f labs/pom.xml test -pl lab-java25-concurrency

# 显式启用需要密钥或外部服务的集成场景（不进入普通 CI）
mvn -B -f labs/pom.xml -Pexternal verify
```

## 版本锁定

- JDK 25 GA
- Spring Boot 4.0.7
- Spring AI 2.0.0
- A2A Java SDK 1.1.0.Final
- MCP 规范 2025-11-25

在 JDK 25 上，`jdk25` profile 自动启用 `--enable-preview`，并编译
`lab-java25-concurrency/src/{main,test}/java25` 中的 Structured
Concurrency 测试。JDK 21 只作为贡献者运行其余确定性测试的兼容回退，
正式 CI 使用 JDK 25。

## 规则

- ✅ 无外部密钥即可运行的单元测试
- ✅ 外部集成只由 `external` profile 显式开启，普通 CI 不访问真实模型
- ✅ Spring AI 依赖由 `spring-ai-bom` 2.0.0 管理
- ✅ 固定补丁版本，不使用动态版本或 Snapshot
- ✅ verified 文章通过 `verification.evidence` 关联核心生产源码与测试
- ✅ 核心代码块可用唯一 `code-id` 精确关联源码符号与测试方法
- ✅ MCP 模块把 deprecated API 编译警告视为失败
- ℹ️ 当前证据粒度为 `article-core`，不宣称每个 Markdown 代码块都已逐块执行
