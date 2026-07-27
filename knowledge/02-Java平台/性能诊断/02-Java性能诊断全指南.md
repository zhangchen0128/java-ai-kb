---
domain: "02-Java平台"
title: "Java 性能诊断全指南"
status: "verified"
level: "advanced"
sources:
  - level: "L1"
    url: "https://docs.oracle.com/en/java/javase/25/troubleshoot/toc.htm"
    description: "Oracle JDK 25 Troubleshooting Guide — JFR、GC Tuning、Thread Dump 分析的官方文档"
  - level: "L1"
    url: "https://docs.oracle.com/en/java/javase/25/jfapi/jfr-api.html"
    description: "Oracle JFR API Programming Guide — JFR 事件编程接口官方文档"
  - level: "L1"
    url: "https://wiki.openjdk.org/display/jmc/Main"
    description: "OpenJDK JDK Mission Control (JMC) Wiki — JFR 可视化分析工具官方文档"
  - level: "L2"
    url: "https://github.com/async-profiler/async-profiler"
    description: "async-profiler 官方 GitHub 仓库 — 低开销 CPU/Allocation/Lock 采样分析器源码与文档"
  - level: "L1"
    url: "https://github.com/openjdk/jmh"
    description: "OpenJDK JMH 官方仓库 — Java 微基准测试框架源码与示例"
  - level: "L2"
    url: "https://github.com/alibaba/arthas"
    description: "Arthas 官方 GitHub 仓库 — 阿里巴巴开源 Java 在线诊断工具源码与文档"
  - level: "L1"
    url: "https://docs.oracle.com/en/java/javase/25/vm/java-virtual-machine-technology.html"
    description: "Oracle JVM Technology Guide — GC 实现、JIT 编译器、统一日志格式"
relations:
  prerequisite: ["01-数据结构与算法"]
  related: ["02-JVM内部机制与调优", "02-JVM内部机制与调优", "02-JVM内部机制与调优"]
tags: ["jfr", "async-profiler", "jmh", "arthas", "heap-dump", "gc-log", "thread-dump", "performance", "diagnosis", "profiling"]
created: "2026-07-17"
updated: "2026-07-17"
---

# Java 性能诊断全指南

## 概述

性能诊断是 Java 工程师的核心能力之一。本指南覆盖 JDK 25 生态下 8 大诊断工具与技术：JFR 飞行记录器、async-profiler 采样分析器、JMH 微基准测试、Arthas 在线诊断、Heap Dump 内存分析、GC 日志解读、Thread Dump 线程分析，以及常见性能问题模式与诊断流程。

本文将每种技术都落实到具体的命令行操作、配置片段和可运行的 Java 诊断代码上，形成可操作的现场诊断手册。

---

## 1. JFR（JDK Flight Recorder）

### 1.1 架构概述

JFR 是内置于 HotSpot JVM 的低开销事件记录框架，核心由两部分构成：

- **事件引擎（Event Engine）**：JVM 内部各处埋点，当特定条件触发时生成事件。事件类型超过 150 种，涵盖 Allocation、IO、Socket、GC、Lock、CPU、Method Profiling、Exception 等。
- **环形缓冲区（Ring Buffer）**：事件首先写入线程本地缓冲区（Thread Local Buffer），满后 flush 到全局环形缓冲区。当磁盘记录开启时，环形缓冲区异步写入 `.jfr` 文件。默认开销低于 1%。

JFR 有两种使用模式：
1. **持续记录（Continuous Recording）**：始终运行，保留最近一段时间的"黑匣子"数据
2. **分析记录（Profiling Recording）**：按需启动，收集详细事件数据用于深度分析

### 1.2 配置方法

**启动时启用 JFR（JVM 参数）**

```bash
# 启动时开启 JFR，输出到指定文件
java -XX:StartFlightRecording=filename=app.jfr,dumponexit=true,settings=profile ...

# 详细配置
java \
  -XX:StartFlightRecording= \
    name=myrecording,\
    filename=/tmp/app.jfr,\
    dumponexit=true,\
    maxsize=256m,\
    maxage=1h,\
    settings=profile,\
    delay=10s,\
    disk=true \
  -jar app.jar
```

**运行时动态控制（jcmd）**

```bash
# 启动一个新的 recording
jcmd <pid> JFR.start name=diagnosis settings=profile duration=120s filename=/tmp/diag.jfr

# 列出当前所有 recording
jcmd <pid> JFR.check

# 停止指定 recording
jcmd <pid> JFR.stop name=diagnosis

# 转储当前 recording 数据（不停止）
jcmd <pid> JFR.dump name=diagnosis filename=/tmp/dump.jfr

# 查看所有可用事件模板
jcmd <pid> JFR.list
```

### 1.3 关键事件类型

| 事件类别 | 典型事件 | 诊断场景 |
|----------|----------|----------|
| Allocation | `jdk.ObjectAllocationInNewTLAB`, `jdk.ObjectAllocationOutsideTLAB` | 高频对象分配、TLAB 调优 |
| IO | `jdk.FileRead`, `jdk.FileWrite`, `jdk.SocketRead`, `jdk.SocketWrite` | IO 瓶颈、网络延迟 |
| GC | `jdk.GarbageCollection`, `jdk.GCPhaseParallel`, `jdk.G1HeapRegionInformation` | GC 暂停、收集效率 |
| Lock | `jdk.JavaMonitorEnter`, `jdk.ThreadPark` | 锁竞争、线程阻塞 |
| CPU | `jdk.CPULoad`, `jdk.ThreadAllocationStatistics` | CPU 使用模式 |
| Exception | `jdk.JavaExceptionThrow`, `jdk.JavaErrorThrow` | 异常风暴诊断 |

### 1.4 JMC 可视化分析

JDK Mission Control（JMC）是 JFR 的官方可视化分析工具。可通过以下方式安装：

```bash
# macOS
brew install --cask jdk-mission-control

# Linux (tar.gz)
wget https://github.com/openjdk/jmc/releases/latest/download/jmc.tar.gz
```

在 JMC 中打开 `.jfr` 文件后，核心分析面板包括：

- **Automated Analysis Results**：自动分析报告，列出潜在问题（如频繁 GC、锁竞争）
- **Code > Hot Methods**：按采样次数排序的热点方法
- **Memory > Allocations**：按类统计对象分配量
- **Threads > Latencies**：线程等待延迟分布
- **IO > Socket/File Activity**：IO 操作耗时与吞吐量

### 1.5 JFR API 编程

JDK 25 提供了 `jdk.jfr` 模块的 API，支持自定义事件：

```java
import jdk.jfr.*;

@Name("com.example.OrderProcessing")
@Label("Order Processing Event")
@Category({"Business", "Order"})
@StackTrace(false)
public class OrderProcessingEvent extends Event {
    @Label("Order ID")
    private String orderId;

    @Label("Processing Time")
    @Timespan(Timespan.MILLISECONDS)
    private long duration;

    @Label("Success")
    private boolean success;

    public static void record(String orderId, long durationMs, boolean success) {
        var event = new OrderProcessingEvent();
        event.orderId = orderId;
        event.duration = durationMs;
        event.success = success;
        event.commit();
    }
}

// 使用示例
void processOrder(String orderId) {
    var start = System.currentTimeMillis();
    try {
        // 业务逻辑
        OrderProcessingEvent.record(orderId,
            System.currentTimeMillis() - start, true);
    } catch (Exception e) {
        OrderProcessingEvent.record(orderId,
            System.currentTimeMillis() - start, false);
        throw e;
    }
}
```

**编程式控制 Recording：**

```java
import jdk.jfr.Recording;
import jdk.jfr.Configuration;
import java.nio.file.Path;

void programmaticRecording() throws Exception {
    // 加载预定义配置
    var config = Configuration.getConfiguration("profile");

    // 创建 recording
    try (var recording = new Recording(config)) {
        recording.setName("api-recording");
        recording.setDestination(Path.of("/tmp/api-recording.jfr"));
        recording.setMaxSize(128 * 1024 * 1024L); // 128 MB
        recording.setMaxAge(java.time.Duration.ofMinutes(30));
        recording.start();

        // 业务代码运行...

        // 也可以启用自定义事件，触发后将自动被采集
        Thread.sleep(60_000);

        recording.stop();
    }
    // try-with-resources 自动关闭 recording
}
```

---

## 2. async-profiler

### 2.1 四种采样模式

async-profiler 是目前 Java 生态中开销最低的采样分析器，基于 `perf_events`（Linux）实现，支持四种模式：

| 模式 | 命令参数 | 采样原理 | 典型场景 |
|------|----------|----------|----------|
| CPU | `-e cpu` | 采样 CPU 周期 + 内核线程调度事件 | CPU 热点定位 |
| Allocation | `-e alloc` | 通过 JVM TI 拦截 TLAB 分配 | 内存分配热点 |
| Lock | `-e lock` | 采样 Java Monitor 进入事件 | 锁竞争分析 |
| Wall-clock | `-e wall` | 按固定频率采样所有线程（无论是否在 CPU 上） | 线程阻塞、IO 等待 |

### 2.2 命令行操作

```bash
# 下载并构建（需要 Linux + perf_events）
git clone https://github.com/async-profiler/async-profiler.git
cd async-profiler && make

# CPU 采样 30 秒，生成火焰图
./profiler.sh -d 30 -f /tmp/cpu-flamegraph.html <pid>

# Allocation 采样，指定分配阈值（默认每 512KB 采样一次）
./profiler.sh -e alloc -d 60 -f /tmp/alloc-flamegraph.html <pid>

# Lock 采样
./profiler.sh -e lock -d 30 -f /tmp/lock-flamegraph.html <pid>

# Wall-clock 采样（发现线程阻塞、IO 等待）
./profiler.sh -e wall -t -d 60 -f /tmp/wall-flamegraph.html <pid>

# 生成 JFR 兼容输出（可在 JMC 中打开）
./profiler.sh -e cpu,alloc,lock -d 120 -o jfr -f /tmp/profile.jfr <pid>

# 使用 --cstack 采样 native 调用栈（fp 或 lbr 模式）
./profiler.sh -e cpu --cstack lbr -d 30 -f /tmp/cpu-native.html <pid>
```

### 2.3 火焰图解读

火焰图（Flame Graph）是 async-profiler 的核心输出。关键读图规则：

- **宽度**：横轴宽度代表该调用栈在样本中的占比，越宽 = 热点越严重
- **高度**：纵轴表示调用深度，自底向上是调用者到被调用者
- **颜色**：默认暖色系，绿色表示 Java 方法，橙色表示内核代码，红色表示 JVM 原生代码
- **悬停**：鼠标悬停在色块上可见完整方法签名和样本数

**典型问题识别：**
- 栈顶出现大量绿色且宽度集中的平顶 → 该方法自身（非子调用）是 CPU 热点
- 大量红色/橙色 → JVM 内部开销（GC、JIT 编译、锁），非应用代码问题
- 大量 `pthread_cond_wait` / `__GI___poll` → 线程阻塞在锁或 IO 上

### 2.4 pmap 集成

```bash
# 查看 Java 进程的内存映射
pmap -x <pid> | head -20

# 结合 async-profiler 分析 Native Memory 分配
./profiler.sh -e cpu -d 30 -f /tmp/cpu.html <pid>
# 如果火焰图中出现大量 malloc / mmap 调用栈，再使用 pmap 分析
```

---

## 3. JMH（Java Microbenchmark Harness）

### 3.1 微基准测试陷阱

JMH 解决的核心问题是 JVM 的 JIT 优化在微基准测试场景下极易产生误导性结果。常见陷阱：

1. **死代码消除（Dead Code Elimination）**：JIT 发现计算结果从未使用，直接消除计算
2. **常量折叠（Constant Folding）**：如果输入是常量，JIT 在编译期就计算出结果
3. **Loop Unrolling / Vectorization**：微小的循环体被 JIT 激进优化，与实际使用场景不符
4. **OSR（On-Stack Replacement）**：长时间运行的循环触发编译替换，但编译产物与标准调用路径不同
5. **Profile Pollution**：多个 benchmark 共享同一个 JVM 进程时，JIT 使用前一个 benchmark 的 profile 数据编译后一个

### 3.2 注解与模式

```java
import org.openjdk.jmh.annotations.*;
import org.openjdk.jmh.infra.Blackhole;
import java.util.concurrent.TimeUnit;

@BenchmarkMode(Mode.Throughput)        // 吞吐量模式
@OutputTimeUnit(TimeUnit.MILLISECONDS) // 输出时间单位
@State(Scope.Benchmark)               // 状态作用域
@Warmup(iterations = 3, time = 1, timeUnit = TimeUnit.SECONDS)
@Measurement(iterations = 5, time = 2, timeUnit = TimeUnit.SECONDS)
@Fork(1)                              // fork 独立 JVM 进程数
public class StringConcatBenchmark {

    @Param({"10", "100", "1000"})
    private int length;

    private String prefix;
    private String suffix;

    @Setup(Level.Trial)  // 每次 Trial（整个 benchmark 运行）前执行
    public void setup() {
        prefix = "a".repeat(length);
        suffix = "b".repeat(length);
    }

    @Benchmark
    public String stringBuilder() {
        return new StringBuilder()
            .append(prefix)
            .append("-")
            .append(suffix)
            .toString();
    }

    @Benchmark
    public String stringConcat() {
        return prefix + "-" + suffix;
    }

    @Benchmark
    public String stringTemplate() {
        return STR."\{prefix}-\{suffix}";
    }
}
```

### 3.3 四种测量模式

| 模式 | `@BenchmarkMode` | 含义 |
|------|------------------|------|
| Throughput | `Mode.Throughput` | 单位时间内操作次数（ops/ms） |
| Average Time | `Mode.AverageTime` | 每次操作的平均耗时 |
| Sample Time | `Mode.SampleTime` | 采样每次操作的耗时分布（含 p50/p99） |
| Single Shot | `Mode.SingleShotTime` | 单次执行耗时（冷启动场景） |

### 3.4 Blackhole 用法

Blackhole 是 JMH 的核心机制，用于防止死代码消除：

```java
@Benchmark
public void withoutBlackhole() {
    // 危险：JIT 会发现 result 未被使用，可能消除整个计算
    var result = computeExpensiveValue();
}

@Benchmark
public void withBlackhole(Blackhole bh) {
    // 安全：Blackhole 消费结果，JIT 无法消除
    bh.consume(computeExpensiveValue());
}

@Benchmark
public void returningValue() {
    // 也是安全的：返回值被 JMH 框架消费
    return computeExpensiveValue();
}

private int computeExpensiveValue() {
    int sum = 0;
    for (int i = 0; i < 1_000_000; i++) {
        sum += i;
    }
    return sum;
}
```

**运行命令行：**

```bash
mvn clean package
java -jar target/benchmarks.jar -f 1 -wi 3 -i 5 -prof gc
```

常用 profiler 选项：`-prof gc`（GC 统计）、`-prof stack`（采样调用栈）、`-prof perf`（perf 计数器）。

---

## 4. Arthas 在线诊断

> 技术雷达：Trial — 非生产环境首选在线诊断工具

### 4.1 核心命令速查

Arthas 是 Alibaba 开源的 Java 在线诊断工具，通过 attach 到目标 JVM 进程，无需重启即可执行诊断命令。

```bash
# 安装与启动
curl -O https://arthas.aliyun.com/arthas-boot.jar
java -jar arthas-boot.jar

# 启动后选择目标 Java 进程，进入 Arthas 控制台
```

| 命令 | 功能 | 示例 |
|------|------|------|
| `watch` | 观察方法入参、返回值、异常 | `watch com.example.Service process '{params, returnObj, throwExp}' -x 3` |
| `trace` | 追踪方法调用链及耗时 | `trace com.example.Service process '#cost > 100' -n 5` |
| `stack` | 输出方法被调用的调用栈 | `stack com.example.Service process` |
| `thread` | 线程分析（CPU 排行、死锁检测） | `thread -n 3`（CPU Top 3）、`thread -b`（检查死锁） |
| `vmtool` | 强制 GC、查看内存 | `vmtool --action forceGc` |
| `logger` | 动态修改日志级别 | `logger --name com.example --level DEBUG` |
| `dashboard` | 实时面板（线程/内存/GC） | `dashboard -i 2000` |
| `jad` | 反编译线上代码 | `jad com.example.Service process` |
| `redefine` | 热替换 class | `redefine /tmp/FixedService.class` |
| `ognl` | 执行 OGNL 表达式 | `ognl '@com.example.Config@VALUE'` |

### 4.2 在线诊断实战

**场景 1：定位慢调用**

```bash
# 追踪耗时超过 100ms 的调用，最多记录 5 次
trace com.example.OrderService createOrder '#cost > 100' -n 5

# 输出示例：
# `---ts=2026-07-17 14:30:22;thread=http-nio-8080-exec-3;cost=234ms;
#   `---[204ms] com.example.OrderService:createOrder()
#       +---[98%] com.example.InventoryService:checkStock()  # 200ms 瓶颈在这里！
#       +---[1%] com.example.PaymentService:charge()
#       `---[1%] com.example.NotificationService:send()
```

**场景 2：动态修改日志级别（无需重启）**

```bash
# 临时开启 DEBUG 日志诊断问题
logger --name com.example.order --level DEBUG

# 诊断完成后恢复
logger --name com.example.order --level INFO
```

**场景 3：使用 OGNL 获取运行时状态**

```bash
# 获取 Spring 容器中的 Bean 属性
ognl '@org.springframework.beans.factory.BeanFactory@getBean("hikariCp")'

# 获取连接池状态
ognl '#pool=@com.zaxxer.hikari.HikariDataSource@getBean("dataSource"),
      #pool.getHikariPoolMXBean().getActiveConnections()'

# 获取系统属性
ognl '@java.lang.System@getProperty("java.version")'
```

### 4.3 热替换注意事项

```bash
# 编译修正后的类
javac -cp app.jar FixedService.java

# 使用 Arthas 热替换
redefine /tmp/FixedService.class

# ⚠️ 限制：
# - 不能修改类结构（添加/删除字段、方法签名变更）
# - 不能修改父类
# - 新增的类无法 redefine
# - 仅限紧急修复，正式修复应走发布流程
```

---

## 5. Heap Dump 分析

### 5.1 生成 Heap Dump

```bash
# 方法 1：jmap（JDK 自带）
jmap -dump:live,format=b,file=/tmp/heap.hprof <pid>

# 方法 2：jcmd（推荐）
jcmd <pid> GC.heap_dump /tmp/heap.hprof

# 方法 3：JVM 参数 - OOM 时自动 dump
-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/tmp/oom.hprof

# 方法 4：程序化触发
import com.sun.management.HotSpotDiagnosticMXBean;
import java.lang.management.ManagementFactory;
import javax.management.MBeanServer;

void programmaticHeapDump(String filePath, boolean live) throws Exception {
    MBeanServer server = ManagementFactory.getPlatformMBeanServer();
    var mxBean = ManagementFactory.newPlatformMXBeanProxy(
        server, "com.sun.management:type=HotSpotDiagnostic",
        HotSpotDiagnosticMXBean.class);
    mxBean.dumpHeap(filePath, live);
}
```

### 5.2 MAT（Memory Analyzer Tool）分析

MAT 是 Eclipse 出品的 Heap Dump 分析工具。核心分析入口：

```bash
# 命令行模式分析（适合大文件 / 服务器环境）
./ParseHeapDump.sh /tmp/heap.hprof org.eclipse.mat.api:suspects
./ParseHeapDump.sh /tmp/heap.hprof org.eclipse.mat.api:overview
./ParseHeapDump.sh /tmp/heap.hprof org.eclipse.mat.api:top_components
```

**三大核心报告：**

1. **Leak Suspects（泄漏疑点报告）**：自动识别可疑的内存泄漏对象，给出累积大小和 GC Root 路径
2. **Dominator Tree（支配树）**：以对象为节点，展示"如果回收该对象，可以释放多少内存"。根节点往下看，支配者占比越高的对象越可能是泄漏源
3. **Histogram（类直方图）**：按类统计实例数和 Shallow/Retained Heap。关注排序后 Retained Heap 最大的类别

**关键概念：**
- **Shallow Heap**：对象自身占用的内存
- **Retained Heap**：对象自身 + 只能通过它访问的所有对象的内存总和（即回收该对象可释放的总内存）
- **GC Root**：不被 GC 回收的根引用（线程栈、静态字段、JNI 引用、系统类等）

### 5.3 OQL（Object Query Language）查询

MAT 内置 OQL 支持类 SQL 的对象查询：

```sql
-- 查找所有占用超过 1MB 的 byte[]
SELECT s.@objectId, s.@retainedHeapSize FROM byte[] s
WHERE s.@retainedHeapSize > 1048576

-- 查找特定类的所有实例及其字段
SELECT toString(o.orderId), o.@retainedHeapSize
FROM com.example.Order o WHERE o.status = "PENDING"

-- 查找 HashMap 及其内部数组大小
SELECT m.size, m.table.@length
FROM java.util.HashMap m WHERE m.size > 1000

-- 查找所有未被关闭的 InputStream
SELECT s FROM java.io.FileInputStream s
```

### 5.4 常见内存泄漏模式与 Heap Dump 特征

| 泄漏模式 | Heap Dump 特征 | 排查线索 |
|----------|---------------|---------|
| 集合类无限增长 | `ArrayList` / `HashMap` 的 retained heap 极大，持续增长不释放 | 检查 put/remove 是否成对、是否有清理线程 |
| ThreadLocal 未清理 | 线程池 + ThreadLocal 的 Entry 仍在，但 value 已被 WeakReference | 确认 `finally { threadLocal.remove() }` |
| 类加载器泄漏 | 大量自定义 ClassLoader 未被 GC | 检查动态代理、热部署导致的加载器泄漏 |
| 缓存无界 | `ConcurrentHashMap` 或 Guava Cache 持续增长不下滑 | 检查缓存淘汰策略、maxSize 配置 |
| 监听器未解注册 | 大量 Listener/Observer 持有外部大对象引用 | 检查注册/解注册是否成对 |

---

## 6. GC 日志

### 6.1 统一日志格式（-Xlog）

JDK 9+ 引入统一日志框架，GC 日志通过 `-Xlog` 配置：

```bash
# 基础 GC 日志（输出到控制台）
java -Xlog:gc*=info ...

# 详细 GC 日志（含时间戳、级别、标签）
java -Xlog:gc*=info:stdout:time,level,tags ...

# 输出到文件（带轮转）
java -Xlog:gc*=info:file=/var/log/app/gc.log:time,level,tags:filecount=10,filesize=100M ...

# 仅收集 GC 暂停信息（定位延迟问题）
java -Xlog:gc+phases=debug:file=/tmp/gc-phases.log ...

# 收集 G1 具体决策信息
java -Xlog:gc+heap+region=debug,gc+ergo+cset=trace:file=/tmp/g1-detail.log ...
```

### 6.2 日志解读要点

```
[2026-07-17T14:30:22.123+0800][info][gc,start     ] GC(42) Pause Young (Normal) (G1 Evacuation Pause)
[2026-07-17T14:30:22.125+0800][info][gc,heap        ] GC(42) Eden regions: 128->0(256)
[2026-07-17T14:30:22.125+0800][info][gc,heap        ] GC(42) Survivor regions: 16->16(32)
[2026-07-17T14:30:22.125+0800][info][gc,heap        ] GC(42) Old regions: 512->514
[2026-07-17T14:30:22.125+0800][info][gc,heap        ] GC(42) Humongous regions: 0->0
[2026-07-17T14:30:22.125+0800][info][gc             ] GC(42) Pause Young (Normal) (G1 Evacuation Pause) 128M->64M(1024M) 2.321ms
```

关键指标：
- **128M->64M(1024M)**：GC 前堆占用 128M → GC 后堆占用 64M（总堆 1024M）
- **2.321ms**：本次 GC 暂停时间
- **Eden/Survivor/Old regions**：各代 Region 数量变化
- **Humongous regions**：大对象 Region 数（分配超过 Region 大小 50% 的对象）

### 6.3 GCViewer / gceasy 分析

```bash
# GCViewer：开源 Java GUI 工具
wget https://github.com/chewiebug/GCViewer/wiki/Changelog
java -jar gcviewer-1.36.jar gc.log gc-summary.csv

# gceasy：在线分析（https://gceasy.io），上传日志即可自动生成报告
# 输出指标：吞吐量、平均暂停、最大暂停、内存分配速率、Object Promotion 速率
```

**关键告警信号：**
- GC 频率 > 1次/分钟且吞吐量 < 95% → 堆过小或内存泄漏
- Full GC 增长趋势 → 老年代持续增长，内存泄漏信号
- 单次 GC 暂停 > 100ms → 对延迟敏感应用不可接受
- Humongous allocation 频繁 → G1 大对象分配碎片化
- 分配速率持续高涨 → 短命对象分配过多

---

## 7. Thread Dump 分析

### 7.1 获取 Thread Dump

```bash
# 方法 1：jstack（JDK 自带）
jstack -l <pid> > /tmp/threads.txt

# 方法 2：jcmd（推荐）
jcmd <pid> Thread.print -l > /tmp/threads.txt

# 方法 3：kill -3 信号（输出到标准输出，需 redirect）
kill -3 <pid>  # 输出在进程的 stdout

# 方法 4：连续多次 dump（发现线程状态变化）
for i in 1 2 3; do
  jcmd <pid> Thread.print -l > /tmp/threads_$(date +%s).txt
  sleep 3
done

# 方法 5：JMX 程序化获取
ThreadMXBean.dumpAllThreads()
```

### 7.2 Thread Dump 内容结构

```
"http-nio-8080-exec-5" #42 daemon prio=5 os_prio=0 cpu=1234.56ms \
  elapsed=3600.00s tid=0x00007f8a3c001000 nid=0x1a2f \
  waiting on condition [0x00007f8a2c001000]
   java.lang.Thread.State: WAITING (parking)
        at sun.misc.Unsafe.park(Native Method)
        at java.util.concurrent.locks.LockSupport.park(LockSupport.java:341)
        at java.util.concurrent.locks.AbstractQueuedSynchronizer$ConditionNode.block(AbstractQueuedSynchronizer.java:506)
        at java.util.concurrent.locks.AbstractQueuedSynchronizer$ConditionObject.await(AbstractQueuedSynchronizer.java:1728)
        at java.util.concurrent.LinkedBlockingQueue.take(LinkedBlockingQueue.java:435)
        at org.apache.tomcat.util.threads.TaskQueue.take(TaskQueue.java:108)
        ...
```

关键信息解读：

| 字段 | 含义 |
|------|------|
| `http-nio-8080-exec-5` | 线程名 |
| `#42` | 线程编号 |
| `daemon` | 是否是守护线程 |
| `nid=0x1a2f` | 原生线程 ID（对应 OS 线程） |
| `cpu=1234.56ms` | 线程累计 CPU 时间 |
| `WAITING (parking)` | 线程状态 + 等待原因 |

### 7.3 死锁检测

```bash
# jstack 自动检测死锁（输出末尾）
jstack -l <pid>
# 输出末尾会列出找到的死锁（Found one Java-level deadlock:）

# 编程式死锁检测
import java.lang.management.ManagementFactory;

void detectDeadlock() {
    var threadMXBean = ManagementFactory.getThreadMXBean();
    long[] deadlockedThreads = threadMXBean.findDeadlockedThreads();
    if (deadlockedThreads != null) {
        var threadInfo = threadMXBean.getThreadInfo(deadlockedThreads, true, true);
        for (var info : threadInfo) {
            System.out.println(STR."Deadlocked thread: \{info.getThreadName()}");
            for (var frame : info.getStackTrace()) {
                System.out.println(STR."    at \{frame}");
            }
        }
    }
}
```

### 7.4 线程池耗尽诊断

线程池耗尽的典型 Thread Dump 特征：
- 大量线程处于 `WAITING (parking)`，等待队列中获取任务
- 调用方的线程处于 `WAITING` 等待线程池返回结果
- 少数线程正在执行长时间任务（cpu 时间很高）

诊断脚本：

```bash
#!/bin/bash
# 统计线程状态分布
jstack <pid> | grep "java.lang.Thread.State:" | sort | uniq -c | sort -nr

# 输出示例：
#  120 java.lang.Thread.State: WAITING (parking)
#   45 java.lang.Thread.State: RUNNABLE
#   12 java.lang.Thread.State: TIMED_WAITING (sleeping)
#    5 java.lang.Thread.State: BLOCKED  ← 注意：BLOCKED 通常信号不好
#    3 java.lang.Thread.State: TIMED_WAITING (parking)
```

---

## 8. 常见性能问题模式与诊断流程

### 8.1 CPU 飙升

**现象：** `top` 显示 Java 进程 CPU 占用 > 80%（单核），或请求延迟突然增长。

**诊断流程：**

```bash
# Step 1：确认是哪个进程
top -H  # 找到 CPU 最高的 Java 进程 PID

# Step 2：定位热点线程
top -H -p <pid>  # 找到 CPU 最高的线程 TID
printf "0x%x\n" <tid>  # 十进制转十六进制

# Step 3：查 Thread Dump 中对应线程在做什么
jstack <pid> | grep -A 20 <hex_tid>

# Step 4：或用 async-profiler 生成火焰图直接看
./profiler.sh -e cpu -d 30 -f /tmp/cpu-spike.html <pid>

# Step 5：或用 Arthas
thread -n 5  # 显示 CPU 最高的 5 个线程
```

**常见原因与解决方案：**

| 原因 | 诊断特征 | 修复方向 |
|------|----------|---------|
| 死循环 | 火焰图中一个方法名持续占满栈顶 | 检查循环退出条件 |
| 正则回溯（Catastrophic Backtracking） | `java.util.regex.Pattern$BmpCharProperty.match()` 在栈顶大量出现 | 重写正则为非回溯形式；预编译 Pattern |
| 频繁 GC | `top` 中 CPU 高 + GC 日志显示每秒多次 GC | 增大堆、减少对象分配 |
| JIT 编译 | 启动后短暂 CPU 高，之后回归正常 | 正常现象，留意是否持续 |
| JSON 序列化 | `jackson` / `ObjectMapper` 在热点路径 | 使用 `afterburner` / `blackbird` 模块；缓存序列化器 |

### 8.2 内存泄漏

**现象：** 堆使用量持续增长，Full GC 后仍不下降，最终 OOM。

**诊断流程：**

```bash
# Step 1：观察 GC 日志趋势
jcmd <pid> GC.heap_info  # 查看当前堆使用

# Step 2：间隔 dump 两次 heap，对比增长
jcmd <pid> GC.heap_dump /tmp/heap1.hprof
sleep 600  # 等待 10 分钟
jcmd <pid> GC.heap_dump /tmp/heap2.hprof

# Step 3：MAT 中两次 dump 对比
# 菜单：Compare Basket → 比较两次 dump 的 Histogram
# 关注 Retained Heap 增长最多的类

# Step 4：Leak Suspects → 查看 GC Root 路径
# 确认是什么 GC Root 持有泄漏对象的引用链
```

**代码示例 — ThreadLocal 泄漏：**

```java
// 泄漏代码（线程池中 ThreadLocal 未清理）
public class LeakyThreadPool {
    private static final ThreadLocal<byte[]> buffer =
        ThreadLocal.withInitial(() -> new byte[1024 * 1024]); // 1MB 每线程

    void process() throws Exception {
        try (var executor = Executors.newFixedThreadPool(10)) {
            for (int i = 0; i < 1000; i++) {
                executor.submit(() -> {
                    var buf = buffer.get(); // 复用 1MB buffer
                    // 业务逻辑...
                    // 缺失：buffer.remove() ← 导致每个线程的 1MB 永不释放
                });
            }
        }
    }
}

// 修复方法
executor.submit(() -> {
    try {
        var buf = buffer.get();
        // 业务逻辑...
    } finally {
        buffer.remove(); // 关键：必须清理
    }
});
```

### 8.3 死锁

**现象：** 请求超时，部分线程永久阻塞，需 kill -9 才能停止。

**诊断流程：**

```bash
# Step 1：jstack 自动检测
jstack -l <pid> | grep -A 50 "Found one Java-level deadlock"

# Step 2：Arthas
thread -b  # 查找死锁

# Step 3：JFR 分析锁事件
jcmd <pid> JFR.start name=lockcheck settings=profile duration=60s filename=/tmp/locks.jfr
# 在 JMC 中查看 "Threads > Lock Instances" 面板
```

**死锁代码示例：**

```java
import java.util.concurrent.locks.ReentrantLock;

void simulateDeadlock() throws InterruptedException {
    var lockA = new ReentrantLock();
    var lockB = new ReentrantLock();

    var t1 = Thread.ofPlatform().start(() -> {
        lockA.lock();
        try { Thread.sleep(100); lockB.lock(); lockB.unlock(); }
        catch (InterruptedException e) {}
        finally { lockA.unlock(); }
    });

    var t2 = Thread.ofPlatform().start(() -> {
        lockB.lock();
        try { Thread.sleep(100); lockA.lock(); lockA.unlock(); }
        catch (InterruptedException e) {}
        finally { lockB.unlock(); }
    });

    t1.join(); t2.join();
}
```

**预防措施：**
- 始终以相同顺序获取多个锁
- 使用 `tryLock(long timeout, TimeUnit unit)` 并处理超时
- 使用 `StampedLock` 替代 `ReentrantReadWriteLock`（JDK 25 推荐）
- 使用 `synchronized` 时保持锁粒度最小

### 8.4 线程池队列堆积

**现象：** 请求延迟不断增长，但 CPU 未打满。Thread Dump 显示大量线程 WAITING。

**诊断流程：**

```bash
# Step 1：获取线程数量
jcmd <pid> Thread.print | grep "^\"" | wc -l

# Step 2：获取线程池状态（Arthas）
ognl '@com.example.AsyncConfig@executor.getQueue().size()'
ognl '@com.example.AsyncConfig@executor.getActiveCount()'

# Step 3：如果使用 Spring Actuator
curl http://localhost:8080/actuator/metrics/executor.queued
```

**问题场景代码：**

```java
// 问题：无界队列 + 核心线程数不足
var executor = new ThreadPoolExecutor(
    4,                            // corePoolSize 太小
    16,                           // maxPoolSize
    60L, TimeUnit.SECONDS,
    new LinkedBlockingQueue<>()   // 无界队列！任务永远不会触发扩容到 maxPoolSize
);

// 修复：有界队列 + 明确的拒绝策略
var executor = new ThreadPoolExecutor(
    4, 16,
    60L, TimeUnit.SECONDS,
    new LinkedBlockingQueue<>(1000),  // 有界队列
    new ThreadPoolExecutor.CallerRunsPolicy()  // 拒绝策略：让调用者线程执行
);
```

### 8.5 慢 SQL（JVM 侧关联诊断）

虽然慢 SQL 根源在数据库，但 JVM 侧可以通过以下方式定位：

```bash
# Arthas trace 追踪 JDBC 调用
trace java.sql.Statement executeQuery '#cost > 500' -n 10

# 输出示例：
# `---[2345ms] java.sql.Statement:executeQuery()
#     +---[99%] com.mysql.cj.jdbc.StatementImpl:executeQuery() # ← SQL 耗时 2345ms
```

配合 JFR 的 Socket Read 事件也可以发现慢 SQL 请求：

```bash
jcmd <pid> JFR.start name=dbcheck settings=profile duration=120s filename=/tmp/db.jfr
# JMC → IO → Socket Read 面板 → 按 Duration 降序 → 定位长耗时的 DB Socket
```

---

## 性能诊断决策树

```
问题类型未知？
├── 先上 JFR（低开销，覆盖广）：jcmd <pid> JFR.start duration=120s
│   └── JMC 打开 → Automated Analysis → 确定方向
│
CPU 高？
├── async-profiler CPU 模式 → 火焰图 → 定位热点方法
│
GC 频繁 / 暂停长？
├── 启用 GC 日志：-Xlog:gc*=info:file=gc.log
│   └── GCViewer/gceasy → 吞吐量、暂停分布、分配速率
│       ├── 分配速率过高 → async-profiler alloc 模式
│       └── Full GC 不释放 → Heap Dump 分析泄漏
│
内存持续增长？
├── Heap Dump（间隔两次） → MAT 比较 Histogram → Leak Suspects
│
请求延迟长但 CPU 不高？
├── Wall-clock profiling → 找出线程阻塞在哪里
│   └── Thread Dump（多次） → 对比线程状态变化
│       ├── 大量 WAITING → 锁竞争 / IO 等待 / 线程池耗尽
│       └── 死锁 → jstack 自动检测
│
线上紧急排查（无 JFR / 无 profiler）？
└── Arthas：thread / trace / watch / stack / vmtool / logger
```

---

## 相关条目

- [[02-JVM内部机制与调优]] — JVM 内存模型与 GC 实现
- [[02-JVM内部机制与调优]] — G1 / ZGC / Shenandoah 深入对比
- [[02-JVM内部机制与调优]] — C1 / C2 / Graal JIT 编译器原理
- [[02-现代Java25深度解析]] — Virtual Threads 调度与诊断
- [[02-Java并发深度解析]] — 线程池配置与调优
