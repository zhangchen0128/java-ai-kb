---
domain: "03-Java应用平台"
title: "任务调度Quartz与XXL-JOB"
status: "draft"
level: "intermediate"
sources:
  - level: "L1"
    url: "https://docs.spring.io/spring-boot/reference/io/quartz.html"
    description: "Spring Boot Quartz Scheduler Reference"
  - level: "L1"
    url: "https://www.quartz-scheduler.org/documentation/"
    description: "Quartz Scheduler Official Documentation"
  - level: "L1"
    url: "https://www.xuxueli.com/xxl-job/"
    description: "XXL-JOB Official Documentation — 分布式任务调度平台"
  - level: "L2"
    url: "https://github.com/xuxueli/xxl-job"
    description: "XXL-JOB source code"
relations:
  prerequisite: ["03-SpringBoot4深度解析", "03-Spring核心IoC-AOP-事务"]
  related: ["03-Maven多模块工程实践", "05-分布式一致性与事务方案"]
tags: ["quartz", "xxl-job", "cron", "job-scheduling", "distributed-scheduling", "cluster", "ai-embedding"]
created: "2026-07-20"
updated: "2026-07-20"
---

# 任务调度：Quartz 与 XXL-JOB

## 概述

任务调度是后端系统的基本能力，从简单的定时清理日志，到复杂的 AI 知识库 Embedding 批量更新，都离不开可靠的调度执行。Java 生态中，Quartz 是经典的单体/小集群调度框架，而 XXL-JOB 提供了带管理界面的分布式调度平台。

本文覆盖 Quartz 的核心概念（Job/Trigger/Scheduler）、Spring Boot 集成、Cron 表达式详解、XXL-JOB 的调度中心与执行器架构、高级特性（分片广播、GLUE 模式），以及 AI 场景中的典型调度需求。

---

## 一、Quartz 核心

### 1.1 核心概念

| 概念 | 说明 |
|------|------|
| **Job** | 需要执行的任务逻辑（实现 `Job` 接口） |
| **JobDetail** | Job 的定义（名称、分组、描述、JobDataMap） |
| **Trigger** | 触发器，定义 Job 何时执行 |
| **CronTrigger** | 基于 Cron 表达式的触发器 |
| **SimpleTrigger** | 基于简单时间间隔的触发器（每隔 N 秒/分钟） |
| **Scheduler** | 调度器，管理 JobDetail 和 Trigger |
| **JobDataMap** | 向 Job 传递参数 |
| **JobStore** | 持久化 Job 和 Trigger 的状态（内存/RAM 或数据库/JDBC） |

### 1.2 Spring Boot 集成 Quartz

```java
// 1. 定义 Job
@DisallowConcurrentExecution // 禁止并发执行（同一 Job 的多个实例不能同时运行）
@PersistJobDataAfterExecution // 执行后持久化 JobDataMap 的修改
public class AiEmbeddingRefreshJob implements Job {

    @Override
    public void execute(JobExecutionContext context) throws JobExecutionException {
        var jobDataMap = context.getMergedJobDataMap();
        var kbId = jobDataMap.getLong("knowledgeBaseId");

        // 通过 Spring 容器获取 Bean
        var springContext = (ApplicationContext) context.getScheduler().getContext()
            .get("applicationContext");
        var embeddingService = springContext.getBean(EmbeddingService.class);

        var count = embeddingService.refreshEmbeddings(kbId);
        System.out.printf("[EmbeddingRefresh] KB %d refreshed %d embeddings%n",
            kbId, count);
    }
}

// 2. 配置 Quartz
@Configuration
public class QuartzConfig {

    @Bean
    public JobDetail embeddingRefreshJobDetail() {
        return JobBuilder.newJob(AiEmbeddingRefreshJob.class)
            .withIdentity("embeddingRefreshJob", "ai-jobs")
            .withDescription("Refresh embeddings for knowledge bases")
            .storeDurably() // 即使没有 Trigger 也保留 JobDetail
            .build();
    }

    @Bean
    public Trigger embeddingRefreshTrigger() {
        return TriggerBuilder.newTrigger()
            .forJob(embeddingRefreshJobDetail())
            .withIdentity("embeddingRefreshTrigger", "ai-triggers")
            .withDescription("Daily at 2:00 AM refresh")
            .withSchedule(CronScheduleBuilder.cronSchedule("0 0 2 * * ?"))
            .build();
    }
}
```

### 1.3 Cron 表达式详解

```
 ┌────── 秒 (0-59)
 │ ┌────── 分 (0-59)
 │ │ ┌────── 时 (0-23)
 │ │ │ ┌────── 日 (1-31)
 │ │ │ │ ┌────── 月 (1-12 或 JAN-DEC)
 │ │ │ │ │ ┌────── 周 (0-6 或 SUN-SAT, 0=周日)
 │ │ │ │ │ │ ┌────── 年 (可选，1970-2099)
 │ │ │ │ │ │ │
 * * * * * * *
```

**常用表达式：**

| 表达式 | 含义 |
|--------|------|
| `0 0 2 * * ?` | 每天凌晨 2:00 |
| `0 0/5 * * * ?` | 每 5 分钟 |
| `0 0 9-18 * * MON-FRI` | 工作日 9:00-18:00 每小时 |
| `0 30 10 1 * ?` | 每月 1 号 10:30 |
| `0 0 0 1 1 ?` | 每年 1 月 1 日凌晨 |

### 1.4 JobStore：RAM vs JDBC

| 特性 | RAMJobStore | JDBCJobStore |
|------|-------------|--------------|
| 持久化 | 否（重启丢失） | 是（数据库持久化） |
| 集群支持 | 否 | 是（多节点共享数据库） |
| 性能 | 高 | 中 |
| 适用场景 | 开发/测试、可丢失的轻量任务 | 生产环境、需要持久化的关键任务 |

```yaml
# JDBC JobStore 配置
spring:
  quartz:
    job-store-type: jdbc # 默认 memory
    jdbc:
      initialize-schema: always # 自动初始化 Quartz 表
    properties:
      org.quartz.jobStore.isClustered: true
      org.quartz.jobStore.clusterCheckinInterval: 20000 # 集群心跳间隔
      org.quartz.scheduler.instanceId: AUTO # 自动生成实例 ID
```

**Quartz 集群原理：** 多个 Quartz 实例共享同一个数据库（Quartz 自带 11 张表），通过数据库行锁实现任务互斥执行——同一时刻只有一个节点执行某个 Trigger。

### 1.5 Spring 简化注解

Spring Boot 提供了更简洁的调度方式：

```java
@Component
public class SimpleScheduledTasks {

    @Scheduled(fixedRate = 60000) // 每 60 秒执行一次（从上一次开始计时）
    public void refreshCache() {
        System.out.println("Cache refreshed at " + LocalDateTime.now());
    }

    @Scheduled(fixedDelay = 30000) // 上一次执行结束后 30 秒再执行
    public void cleanTmpFiles() {
        System.out.println("Tmp files cleaned");
    }

    @Scheduled(cron = "0 0 3 * * ?") // 每天凌晨 3 点
    public void dailyReport() {
        System.out.println("Daily report generated");
    }
}

// 启用
@SpringBootApplication
@EnableScheduling // 开启 @Scheduled 支持
public class Application { /* ... */ }
```

**@Scheduled 的局限：** 单机执行、不支持集群互斥、无管理界面、不可动态修改任务。适用于简单场景，复杂需求应升级到 Quartz 或 XXL-JOB。

---

## 二、XXL-JOB

### 2.1 架构概览

```
┌──────────────────────────────────────────────────────┐
│                   XXL-JOB 架构                        │
├──────────────────────────────────────────────────────┤
│                                                        │
│  ┌──────────────┐         ┌─────────────────┐        │
│  │  调度中心      │ ◄────► │   执行器集群      │        │
│  │  (Admin)      │  HTTP   │   (Executor)     │        │
│  │               │         │                  │        │
│  │  任务管理      │         │  ┌───────────┐  │        │
│  │  调度策略      │         │  │ 应用1      │  │        │
│  │  日志报表      │         │  │ (内置执行)  │  │        │
│  │  告警通知      │         │  ├───────────┤  │        │
│  └──────────────┘         │  │ 应用2      │  │        │
│                            │  │ (内置执行)  │  │        │
│                            │  └───────────┘  │        │
│                            └─────────────────┘        │
│                                                        │
│  ┌──────────────┐         ┌─────────────────┐        │
│  │   数据库       │         │   应用服务集群    │        │
│  │  (MySQL)     │         │   (Spring Boot)  │        │
│  └──────────────┘         └─────────────────┘        │
└──────────────────────────────────────────────────────┘
```

### 2.2 Spring Boot 执行器配置

```xml
<!-- pom.xml -->
<dependency>
    <groupId>com.xuxueli</groupId>
    <artifactId>xxl-job-core</artifactId>
    <version>2.4.2</version>
</dependency>
```

```java
// 执行器配置
@Configuration
public class XxlJobConfig {

    @Value("${xxl.job.admin.addresses}")
    private String adminAddresses;

    @Value("${xxl.job.executor.appname}")
    private String appName;

    @Value("${xxl.job.executor.port}")
    private int port;

    @Bean
    public XxlJobSpringExecutor xxlJobExecutor() {
        var executor = new XxlJobSpringExecutor();
        executor.setAdminAddresses(adminAddresses);
        executor.setAppname(appName);
        executor.setPort(port);
        executor.setAccessToken("default_token");
        executor.setLogPath("/data/applogs/xxl-job/jobhandler");
        executor.setLogRetentionDays(30);
        return executor;
    }
}
```

```yaml
# application.yml
xxl:
  job:
    admin:
      addresses: http://xxl-job-admin:8080/xxl-job-admin
    executor:
      appname: ai-knowledge-executor
      port: 9999
```

### 2.3 定义 Job Handler

```java
@Component
public class AiKnowledgeJobs {

    @Autowired
    private EmbeddingService embeddingService;

    @Autowired
    private KnowledgeCleanupService cleanupService;

    // BEAN 模式：JobHandler 名称 = @XxlJob 注解的 value
    @XxlJob("embeddingBatchRefreshHandler")
    public void embeddingBatchRefresh() {
        var param = XxlJobHelper.getJobParam(); // 获取调度中心配置的任务参数
        var kbId = Long.parseLong(param);

        XxlJobHelper.log("Starting embedding refresh for KB: {}", kbId);
        var result = embeddingService.refreshEmbeddings(kbId);

        XxlJobHelper.handleSuccess("Refreshed " + result + " embeddings");
    }

    // 分片广播：每个分片处理不同的数据
    @XxlJob("knowledgeCleanupHandler")
    public void knowledgeCleanup() {
        var shardIndex = XxlJobHelper.getShardIndex(); // 当前分片序号
        var shardTotal = XxlJobHelper.getShardTotal(); // 总分片数

        XxlJobHelper.log("Shard {}/{} started", shardIndex, shardTotal);

        // 按分片处理不同的知识库
        var kbIds = knowledgeBaseRepository.findAllIds();
        var myKbIds = kbIds.stream()
            .filter(id -> id % shardTotal == shardIndex)
            .toList();

        for (var kbId : myKbIds) {
            cleanupService.cleanExpiredDocuments(kbId);
        }

        XxlJobHelper.handleSuccess("Shard " + shardIndex + " completed");
    }

    // GLUE 模式（在线编辑，热部署）：继承 IJobHandler
    // GLUE(Java) 模式允许在调度中心 Web 界面编辑代码并热部署
}
```

### 2.4 任务路由策略

| 路由策略 | 说明 | 适用场景 |
|----------|------|----------|
| **FIRST** | 固定选择第一个执行器 | 指定节点执行 |
| **LAST** | 固定选择最后一个执行器 | 指定节点执行 |
| **ROUND** | 轮询 | 负载均衡 |
| **RANDOM** | 随机 | 负载均衡 |
| **CONSISTENT_HASH** | 一致性哈希 | 相同参数路由到相同节点 |
| **LEAST_FREQUENTLY_USED** | 最不经常使用 | 任务量不均匀场景 |
| **LEAST_RECENTLY_USED** | 最近最久未使用 | 负载均衡 |
| **FAILOVER** | 故障转移 | 高可用 |
| **BUSYOVER** | 忙碌转移（阻塞策略） | 避免任务堆积 |
| **SHARDING_BROADCAST** | 分片广播 | 集群并行处理大数据量 |

### 2.5 分片广播

分片广播是 XXL-JOB 最强大的特性之一。调度中心将任务广播到所有执行器节点，每个节点根据 `shardIndex` 和 `shardTotal` 处理自己那部分数据：

```
总分片数 = 3
┌──────────┐  ┌──────────┐  ┌──────────┐
│ 执行器 0  │  │ 执行器 1  │  │ 执行器 2  │
│ 处理 ID%3=0│  │ 处理 ID%3=1│  │ 处理 ID%3=2│
└──────────┘  └──────────┘  └──────────┘
```

### 2.6 失败重试与告警

```java
// 执行器端：XXL-JOB 框架自动处理失败重试
// 调度中心配置：失败重试次数、重试间隔
// 邮箱/DingTalk 告警：任务连续失败 N 次时自动发送通知

@XxlJob("criticalJobHandler")
public void criticalJob() {
    try {
        // 业务逻辑
        doSomething();
    } catch (Exception e) {
        // XXL-JOB 会捕获返回码并触发重试
        XxlJobHelper.handleFail("Job failed: " + e.getMessage());
        // 不要吞掉异常！让 XXL-JOB 感知到失败
    }
}
```

---

## 三、选型对比

| 维度 | Quartz | XXL-JOB | @Scheduled | K8s CronJob |
|------|--------|---------|------------|-------------|
| **管理界面** | 无（需自建） | 内置 Web 管理 | 无 | kubectl |
| **动态任务** | API 编程 | Web 界面操作 | 需重启应用 | 需重新 apply |
| **集群支持** | JDBC JobStore | 调度中心 + 执行器 | 不支持 | K8s 原生 |
| **分片并行** | 不原生支持 | 分片广播 | 不支持 | 不支持 |
| **在线编辑** | 不支持 | GLUE 模式 | 不支持 | 不支持 |
| **失败重试** | 需编码 | 内置 | 需编码 | 需编码 |
| **告警通知** | 需自建 | 内置邮箱/DingTalk | 需编码 | 需集成 |
| **持久化** | JDBC 方案 | MySQL | 无 | Etcd |
| **学习成本** | 中 | 中（需部署调度中心） | 低 | 中 |
| **适用场景** | 单体/小集群 | 中大型分布式系统 | 开发测试 | K8s 环境 |

**推荐策略：**
- 简单定时任务 → `@Scheduled`
- 需要持久化和集群 → Quartz（已有 Quartz 生态）或 XXL-JOB（推荐，功能更全）
- K8s 环境无状态任务 → K8s CronJob
- 分布式并行处理 → XXL-JOB 分片广播

---

## 四、AI 场景中的调度任务

### 4.1 Embedding 批量更新

```java
@Component
public class EmbeddingScheduledJobs {

    @Autowired
    private EmbeddingService embeddingService;

    @Autowired
    private VectorStore vectorStore;

    // 每日凌晨刷新所有知识库的 Embedding
    @XxlJob("dailyEmbeddingRefreshHandler")
    public void dailyEmbeddingRefresh() {
        var shardIndex = XxlJobHelper.getShardIndex();
        var shardTotal = XxlJobHelper.getShardTotal();
        var totalRefreshed = new AtomicInteger(0);

        // 使用 Virtual Threads 并行处理
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var kbIds = knowledgeBaseRepository.findActiveIds();

            for (var kbId : kbIds) {
                if (kbId % shardTotal == shardIndex) { // 分片
                    executor.submit(() -> {
                        var count = embeddingService.refreshEmbeddings(kbId);
                        totalRefreshed.addAndGet(count);
                        XxlJobHelper.log("KB {} refreshed: {}", kbId, count);
                    });
                }
            }
        }

        XxlJobHelper.handleSuccess("Total refreshed: " + totalRefreshed.get());
    }
}
```

### 4.2 知识库过期清理

```java
@Component
public class KnowledgeCleanupJobs {

    @Autowired
    private KnowledgeRepository knowledgeRepo;

    @Autowired
    private VectorStoreRepository vectorStoreRepo;

    // 每周日 4:00 清理已标记删除的知识条目及其向量
    @XxlJob("weeklyKnowledgeCleanupHandler")
    public void weeklyCleanup() {
        var threshold = LocalDateTime.now().minusDays(30);
        var expiredDocs = knowledgeRepo.findSoftDeletedBefore(threshold);

        for (var doc : expiredDocs) {
            // 1. 删除向量索引
            vectorStoreRepo.deleteByDocumentId(doc.getId());
            // 2. 物理删除文档记录
            knowledgeRepo.physicalDelete(doc.getId());
            XxlJobHelper.log("Permanently deleted: {}", doc.getId());
        }

        XxlJobHelper.handleSuccess("Cleaned up " + expiredDocs.size() + " documents");
    }
}
```

### 4.3 模型配额重置

```java
@Component
public class QuotaResetJobs {

    @Autowired
    private QuotaService quotaService;

    // 每月 1 号 0:00 重置所有用户/租户的 API 调用配额
    @XxlJob("monthlyQuotaResetHandler")
    public void monthlyQuotaReset() {
        var tenantIds = quotaService.getAllTenantIds();
        var resetCount = new AtomicInteger(0);

        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            for (var tenantId : tenantIds) {
                executor.submit(() -> {
                    quotaService.resetMonthlyQuota(tenantId);
                    resetCount.incrementAndGet();
                });
            }
        }

        XxlJobHelper.handleSuccess("Quota reset for " + resetCount.get() + " tenants");
    }
}
```

---

## 常见问题

**Q: Quartz 集群中，同一个 Job 会不会被多个节点同时执行？**
A: 不会。Quartz 通过数据库行锁确保同一个 Trigger 同一时刻只被一个节点获取并执行。但如果配置了多个相同 JobDetail 的 Trigger，可能导致并发执行——使用 `@DisallowConcurrentExecution` 防止。

**Q: XXL-JOB 调度中心和执行器之间网络中断了怎么办？**
A: 执行器会定期心跳注册到调度中心。调度中心发现执行器心跳超时后会将其标记为离线，不再向该执行器分发任务。恢复后自动重新上线。已在执行的任务不受影响。

**Q: Cron 表达式中的 ? 和 * 有什么区别？**
A: `*` 表示"每"，`?` 表示"不指定"（仅用于日和周字段）。日和周不能同时使用 `*`，必须有一个是 `?`。例如 `0 0 12 * * ?` 表示每天 12:00。

**Q: 定时任务的幂等性如何保证？**
A: 1) 使用分布式锁（Redis/数据库乐观锁）；2) 任务执行前检查状态（如已处理标志位）；3) 数据库唯一约束防止重复写入。XXL-JOB 的失败重试可能导致重复执行——必须做好幂等设计。

---

## 相关条目

- [[03-SpringBoot4深度解析]]：Spring Boot 自动配置
- [[03-Maven多模块工程实践]]：依赖模块化配置
- [[05-幂等设计与分布式锁]]：定时任务幂等性保障
- [[04-PostgreSQL与pgvector深度解析]]：Quartz JDBC JobStore 与 XXL-JOB 依赖的 MySQL
- [[14-模型网关与Prompt管理]]：模型配额管理
