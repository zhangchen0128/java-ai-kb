---
domain: 15-AI安全与治理
title: Agent 与 MCP 安全实战
status: verified
verification:
  reviewed_at: "2026-07-28"
  version_anchor: "JDK 25 / Spring Boot 4.x / Spring AI 2.x"
  code_status: tested
  lab: lab-ai-security
  evidence:
    scope: article-core
    source_files:
      - labs/lab-ai-security/src/main/java/com/javaai/kb/labs/ai-security/InputSanitizer.java
    test_files:
      - labs/lab-ai-security/src/test/java/com/javaai/kb/labs/ai-security/InputSanitizerTest.java
level: advanced
content_type: practice
sources:
  - level: L0
    url: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
    description: MCP 2025-11-25 authorization specification
  - level: L0
    url: https://a2a-protocol.org/latest/specification/
    description: A2A 1.0 security requirements and protocol specification
  - level: L0
    url: https://genai.owasp.org/llm-top-10/
    description: OWASP GenAI Top 10 2025
relations:
  prerequisite:
    - 13-AI协议全景
    - 15-AI安全全面防护体系
  related:
    - 13-MCP协议与JavaSDK
    - 13-A2A协议与Agent互操作
    - 15-威胁建模与红队测试
tags:
  - agent-security
  - mcp-security
  - authorization
  - least-privilege
created: 2026-07-27
updated: 2026-07-27
---

# Agent 与 MCP 安全实战

## 信任边界

把模型输出视为不可信输入。即使模型由企业托管，也不能让它直接获得数据库、文件系统或外部 API 的泛化权限。

```text
User → Host → Model
          ↓ proposed tool call (untrusted)
       Policy Enforcement Point
          ↓ validated and authorized call
       MCP Server / Business API
```

策略执行点必须由确定性代码控制，并在工具执行之前完成：

1. 校验工具名在当前主体的允许列表中。
2. 使用 JSON Schema 校验参数类型、长度、枚举和必填字段。
3. 从可信身份上下文注入租户，不接受模型提供的租户 ID。
4. 写操作、高价值操作和不可逆操作要求显式确认。
5. 对文件路径、URL、SQL 和命令参数执行额外的域规则。

## MCP 授权检查表

- Client 不转发收到的任意 Token 给下游 Server。
- Server 对每个请求校验 Token 的 audience 与 scope。
- 动态客户端注册不是默认信任机制。
- 本地 STDIO Server 也要限制启动命令、环境变量和可见目录。
- 工具列表可按主体过滤，不能只在调用阶段拒绝。
- 工具结果重新进入模型上下文前执行输出校验。

## Agent 高风险动作

以下动作应默认进入人工确认或双人审批：

- 发送外部消息、付款、签署或提交正式材料。
- 修改生产配置、权限、身份或审计策略。
- 删除、覆盖、批量迁移数据。
- 依据模型结论直接作出核保、理赔或反欺诈最终决定。

## 测试场景

安全测试至少覆盖：

- Prompt 中要求忽略策略并调用未授权工具。
- 参数通过 Unicode、编码、路径穿越或间接引用绕过校验。
- MCP 工具返回包含新指令的恶意内容。
- 多租户检索中请求另一个租户的数据。
- 工具超时、部分成功和重试导致重复副作用。

对应的确定性实现和拒绝路径见 `labs/lab-ai-security`。
