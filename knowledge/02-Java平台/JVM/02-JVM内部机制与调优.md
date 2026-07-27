---
domain: "02-Java平台"
title: "JVM 内部原理与调优"
status: "verified"
level: "advanced"
sources:
  - level: "L0"
    url: "https://docs.oracle.com/javase/specs/jvms/se25/html/index.html"
    description: "The Java Virtual Machine Specification, Java SE 25 Edition"
  - level: "L0"
    url: "https://openjdk.org/jeps/0"
    description: "OpenJDK JEP Index — all JEPs related to GC, JIT, and runtime"
  - level: "L1"
    url: "https://wiki.openjdk.org/display/zgc"
    description: "OpenJDK Wiki: ZGC"
  - level: "L1"
    url: "https://wiki.openjdk.org/display/shenandoah"
    description: "OpenJDK Wiki: Shenandoah"
  - level: "L1"
    url: "https://docs.oracle.com/en/java/javase/25/gctuning/"
    description: "HotSpot Virtual Machine Garbage Collection Tuning Guide"
  - level: "L3"
    url: "https://www.oreilly.com/library/view/optimizing-java/9781492039259/"
    description: "Optimizing Java — Benjamin J. Evans, James Gough, Chris Newland"
  - level: "L3"
    url: "https://www.oreilly.com/library/view/java-performance-2nd/9781492056102/"
    description: "Java Performance, 2nd Edition — Scott Oaks"
  - level: "L2"
    url: "https://github.com/openjdk/jdk"
    description: "OpenJDK source code (HotSpot)"
relations:
  prerequisite: ["01-数据结构与算法"]
  related: ["02-Java并发深度解析", "02-Java性能诊断全指南"]
tags: ["jvm", "gc", "jit", "graalvm", "zgc", "g1", "shenandoah", "class-loading", "performance", "tuning", "jfr", "jmc"]
created: "2026-07-17"
updated: "2026-07-17"
---

# JVM 内部原理与调优

## 概述

本文深入剖析 HotSpot JVM 的内部架构与核心子系统，涵盖类加载机制、运行时数据区、垃圾收集器（G1、ZGC、Shenandoah）、JIT 编译（C1/C2/Graal）以及 GraalVM 原生镜像。重点放在 JDK 25 LTS 中的最新发展，包括 ZGC 的分代模式、Shenandoah 的分代支持和 JEP 483（提前类加载与链接）。

目标读者是需要在生产环境中诊断 JVM 性能问题、配置 GC 策略、解读 GC 日志并编写 GC 友好代码的 Java 后端工程师。

---

## 一、JVM 架构全景

HotSpot JVM 由三大子系统构成，它们协同工作完成"加载字节码—管理内存—执行指令"的完整生命周期：

```
源文件(.java) → javac → 字节码(.class) → ClassLoader → 运行时数据区 → 执行引擎
                                              ↑                                ↓
                                        方法区/元空间                      解释器 + JIT
                                              ↑                                ↓
                                           堆(Heap) ← ← ← ← ← ←  GC  ← ← ←  对象分配
```

### 1.1 ClassLoader 子系统

负责加载、链接（验证、准备、解析）和初始化类。详见第二章。

### 1.2 Runtime Data Areas（运行时数据区）

JVM 规范定义了六块内存区域，其中方法区和堆是所有线程共享的，其他为线程私有：

| 区域 | 线程共享 | 存储内容 | 异常 |
|------|---------|---------|------|
| Method Area (Metaspace) | 是 | 类元数据、运行时常量池、静态字段、方法字节码 | OutOfMemoryError: Metaspace |
| Heap | 是 | 所有对象实例和数组 | OutOfMemoryError: Java heap space |
| Java Virtual Machine Stack | 否 | 栈帧（局部变量表、操作数栈、动态链接、返回地址）| StackOverflowError |
| Native Method Stack | 否 | 本地方法（JNI）调用栈 | StackOverflowError |
| PC Register | 否 | 当前正在执行的字节码指令地址 | — |
| Direct Memory | 否(共享) | NIO DirectByteBuffer 使用的堆外内存 | OutOfMemoryError: Direct buffer memory |

**重要变化 (JDK 25)：** JDK 24 移除了自 JDK 1.0 以来一直存在的 32-bit x86 端口 (JEP 479) 。这意味着所有现代 JVM 部署均为 64-bit，CompressedOops 默认启用（堆小于 32GB 时），对象头大小也相应统一。

### 1.3 Execution Engine（执行引擎）

执行引擎包含解释器、JIT 编译器、GC 和 JVM Tool Interface (JVMTI)：

1. **解释器 (Interpreter)：** 逐条将字节码翻译为机器码执行，启动快但运行慢。
2. **JIT 编译器 (C1/C2/Graal)：** 将热点代码编译为高质量机器码，启动慢但运行极快。
3. **GC：** 自动回收不再使用的对象，详见第四章。
4. **JVMTI：** 调试器、profiler 等工具的后门接口。

从 JDK 25 视角，执行引擎的核心演进方向是 **AOT 编译 (Leyden)** 和 **Barrier-less GC**。

---

## 二、类加载机制

### 2.1 双亲委派模型 (Parent Delegation Model)

类加载器以树形结构组织，加载请求沿父加载器向上委派：

```
Bootstrap ClassLoader (加载 <JAVA_HOME>/lib, rt.jar 中的类)
    ↑
Platform ClassLoader (加载 <JAVA_HOME>/lib/ext 或 --module-path)
    ↑
Application ClassLoader (加载 -classpath 中的类)
    ↑
Custom ClassLoader (用户自定义)
    ↑
Thread Context ClassLoader (打破双亲委派的 SPI 机制)
```

**加载流程：** 当 Application ClassLoader 收到加载请求时，它首先检查缓存是否已加载，然后委托给 Platform ClassLoader，Platform 再委托给 Bootstrap。只有父加载器找不到目标类时，子加载器才会尝试自行加载。

这个模型的核心价值是 **Java 核心类库不会被用户自定义的同名类替代**（安全沙箱）。

### 2.2 类加载的三个阶段

```
加载(Loading) → 链接(Linking) → 初始化(Initialization)
                    ├── 验证(Verification)
                    ├── 准备(Preparation)
                    └── 解析(Resolution)
```

**加载：** 通过类的全限定名获取二进制字节流，将字节流转换为方法区中的运行时数据结构，在堆中生成 `java.lang.Class` 对象。

**验证：** 文件格式验证、元数据验证、字节码验证、符号引用验证。这是 JVM 安全模型的第一道防线。JDK 7+ 使用 StackMapTable 进行类型检查验证，较旧式的类型推导更高效。

**准备：** 为类变量（static）分配内存并设置默认零值。注意这里不执行赋值语句。

**解析：** 将常量池中的符号引用替换为直接引用。

**初始化：** 执行类构造器 `<clinit>()` 方法。这是类加载的最后一步，JVM 保证多线程环境下 `<clinit>()` 只会执行一次。

### 2.3 JPMS (Java Platform Module System) 对类加载的影响

JDK 9 引入的 JPMS 改变了类加载的底层模型：

**三层内置类加载器在 JPMS 中变为：**
- Bootstrap ClassLoader 仍然存在，但 JDK 模块不再位于单个 `rt.jar` 中，而是拆分到 `jmods/` 目录下的多个 `.jmod` 文件中。
- Platform ClassLoader 取代了 Extension ClassLoader，加载 `<JAVA_HOME>/jmods` 中未被 Bootstrap 加载的模块。
- Application ClassLoader 加载 `--module-path` 和 `--class-path` 中的模块。

**关键变化：**
1. **模块描述符 (module-info.java)：** 定义了模块间的 `requires`、`exports`、`opens` 关系。
2. **强封装：** 未 `exports` 的包无法通过反射访问（除非使用 `--add-opens` 标志）。
3. **可靠配置：** JVM 启动时检查模块依赖图，避免运行时的 `NoClassDefFoundError`。

### 2.4 自定义 ClassLoader (JDK 25 风格)

```java
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * A custom ClassLoader that loads .class files from a specific directory.
 * JDK 25 style — uses var, records, and modern API.
 */
public class DirectoryClassLoader extends ClassLoader {

    private final Path classDir;

    public DirectoryClassLoader(Path classDir) {
        super(DirectoryClassLoader.class.getClassLoader());
        this.classDir = classDir;
    }

    @Override
    protected Class<?> findClass(String name) throws ClassNotFoundException {
        var fileName = name.replace('.', '/') + ".class";
        var classFile = classDir.resolve(fileName);

        try {
            var bytes = Files.readAllBytes(classFile);
            return defineClass(name, bytes, 0, bytes.length);
        } catch (IOException e) {
            throw new ClassNotFoundException("Failed to load: " + name, e);
        }
    }

    // Usage demonstration
    public static void main(String[] args) throws Exception {
        var loader = new DirectoryClassLoader(Path.of("/tmp/classes"));
        var clazz = loader.loadClass("com.example.MyDynamicClass");
        var instance = clazz.getDeclaredConstructor().newInstance();
        System.out.println("Loaded: " + instance.getClass().getName());
        System.out.println("Loader: " + instance.getClass().getClassLoader());
    }
}
```

### 2.5 运行时类加载的常见陷阱

**场景一：`NoClassDefFoundError` vs `ClassNotFoundException`**
- `ClassNotFoundException`：`Class.forName()` 等方法显式加载类时找不到。
- `NoClassDefFoundError`：编译时存在但运行时找不到（通常是依赖冲突导致）。

**场景二：同一个类被不同 ClassLoader 加载**
```java
// 两个不同的 ClassLoader 实例加载同一个 .class 文件
// 结果是 JVM 中的两个不同"类"，cast 会抛出 ClassCastException
// 这就是"命名空间隔离"——OSGi 和 Tomcat 利用这一机制隔离应用
```

**JPMS 模式下的安全反射访问：**
```java
// JDK 25 中，未 opens 的包无法通过反射访问
// setAccessible(true) 直接被拒绝，除非添加 JVM 参数
// --add-opens java.base/java.lang=ALL-UNNAMED
```

---

## 三、运行时数据区详解

### 3.1 Metaspace (元空间 — JDK 8+)

取代了 JDK 7 及之前的 Permanent Generation (PermGen)。Metaspace 使用 **本地内存 (Native Memory)** 而非堆内存。

**核心参数：**
```
-XX:MetaspaceSize=<N>         # 触发 Metaspace GC 的初始阈值（默认约 21MB）
-XX:MaxMetaspaceSize=<N>      # Metaspace 上限（默认无限制，即系统可用内存）
-XX:MinMetaspaceFreeRatio=<N> # GC 后最小空闲比例（默认 40）
-XX:MaxMetaspaceFreeRatio=<N> # GC 后最大空闲比例（默认 70）
```

**Metaspace GC 触发条件：**
1. Metaspace 使用量达到 `MetaspaceSize`。
2. `MetaspaceSize` 会根据 GC 后的空闲比例动态上下调整（但不超过 `MaxMetaspaceFreeRatio`）。

**与类加载的联动：** 类卸载 (Class Unloading) 会直接释放 Metaspace。如果应用大量动态生成类（如反射、动态代理、CGLIB、Lambda），需要关注类卸载是否正常。

**典型问题：**
```
OutOfMemoryError: Metaspace
→ 原因：大量动态类生成且从未卸载，或 MetaspaceSize 上限设置过低
→ 解决：增大 -XX:MaxMetaspaceSize，或排查类加载泄漏
```

### 3.2 Java Heap（堆）

堆是 GC 的主要工作区域。在 JDK 25 中，默认 GC 为 G1（自 JDK 9 起一直是默认），其堆布局与经典的年轻代/老年代有所不同。

**经典分代布局（Parallel GC / Serial GC）：**
```
+---------------------------+---------------------------------------------+
|  Young Generation         |  Old Generation                             |
|  +-------+------+------+  |                                             |
|  | Eden  | S0   | S1   |  |                                             |
|  +-------+------+------+  |                                             |
+---------------------------+---------------------------------------------+
```

**G1 区域化布局：**
```
+---+---+---+---+---+---+---+---+---+---+---+---+---+
| E | S | E | O | E | H | O | E | S | O | E | F | O |
+---+---+---+---+---+---+---+---+---+---+---+---+---+
  E=Eden  S=Survivor  O=Old  H=Humongous  F=Free
```

G1 将堆划分为大小相等的多个 Region（默认 2048 个，Region 大小在 1MB~32MB 之间自动计算），每个 Region 可以动态扮演 Eden、Survivor、Old 或 Humongous 角色。

**Humongous 对象：** 大小超过 Region 一半的对象被视为巨型对象，直接分配在老年代中连续的 Humongous Region 中。这是 G1 的一个潜在性能坑：如果对象大小接近 Region 大小的整数倍，会导致碎片化。

### 3.3 Java Virtual Machine Stack（虚拟机栈）

每个线程拥有独立的 VM Stack，每个方法调用创建一个 Stack Frame。

**Stack Frame 结构：**
```
+--------------------------+
| Local Variables Table    |  ← 存放方法参数和局部变量（包括 this）
+--------------------------+
| Operand Stack            |  ← 字节码指令的操作数临时存储
+--------------------------+
| Dynamic Link             |  ← 指向运行时常量池中该方法的符号引用
+--------------------------+
| Return Address / pc      |  ← 方法返回后继续执行的位置
+--------------------------+
```

**参数：**
```
-Xss<N>  # 每个线程的栈大小（JDK 25 默认 1024KB on Linux x64）
```

**与 Virtual Threads 的关系 (JEP 444)：** 虚拟线程的栈不固定分配在物理内存中，而是以 StackChunk 对象的形式存在于堆中。当虚拟线程阻塞时，其 StackChunk 被保存到堆中，载体线程可以切换执行其他虚拟线程。这使得你在应用中创建百万级虚拟线程成为可能。

### 3.4 Direct Memory（直接内存）

NIO 的 `ByteBuffer.allocateDirect()` 使用 `Unsafe.allocateMemory()` 分配的堆外内存（C Heap）。这片内存不受 GC 直接管理，由 `Cleaner` 机制在 `DirectByteBuffer` 对象被 GC 时自动释放。

**监控：**
```bash
# JVM 原生监控
jcmd <pid> VM.native_memory summary

# 或用 JMX MBean
java.nio:type=BufferPool,name=direct
# 属性：Count, TotalCapacity, MemoryUsed
```

---

## 四、垃圾收集 (Garbage Collection)

### 4.1 GC 基础理论

#### 可达性分析 (Reachability Analysis)

JVM 使用可达性分析来判断对象是否存活，而非引用计数（无法处理循环引用）。

**GC Roots 包括：**
1. 虚拟机栈（栈帧中的本地变量表）中引用的对象
2. 方法区中类静态属性引用的对象（注意：JDK 8+ 静态字段在 Class 对象中）
3. 方法区中常量引用的对象（String Table 中的引用）
4. 本地方法栈中 JNI 引用的对象
5. JVM 内部的引用（如 Class 对象、ClassLoader、Thread 对象）
6. 所有被同步锁 (synchronized) 持有的对象
7. JVM 内部的 JMX Bean、JVMTI 回调等

**三色标记法：**
- **白色：** 未被访问（初始状态，GC 结束时白色对象被回收）
- **灰色：** 已访问但其引用字段尚未全部扫描
- **黑色：** 已访问且所有引用已扫描

#### 分代假说 (Generational Hypothesis)

大多数对象"朝生夕死"（Weak Generational Hypothesis），少数对象存活很长时间（Strong Generational Hypothesis）。基于此，分代 GC 将堆分为年轻代和老年代，对不同代采用不同的收集算法。

- **年轻代：** Minor GC / Young GC，频繁、快速（Stop-The-World 通常在毫秒级）
- **老年代：** Major GC / Full GC，低频但代价高（可能秒级甚至分钟级 STW）

### 4.2 G1 GC (Garbage-First)

G1 自 JDK 9 起成为默认 GC，其设计目标是：在提供高吞吐量的同时，将 GC 暂停时间控制在用户指定的目标内。

#### 核心概念

**Region (区域)：** G1 将堆划分为大小相等的 Region（大小由 `-XX:G1HeapRegionSize` 控制，或自动计算）。Region 数量为 2048~4095，大小在 1MB~32MB 之间。

**RSet (Remembered Set)：** 每个 Region 维护一个 RSet，记录了其他 Region 中指向本 Region 内对象的引用。RSet 避免了 Minor GC 时扫描整个老年代。RSet 是 G1 的内存开销主要来源（通常占堆的 1%~5%）。

**SATB (Snapshot-At-The-Beginning)：** G1 的并发标记算法。在并发标记开始前拍一个"快照"（通过写前屏障记录 SATB 队列），标记过程中新创建的对象默认存活。这保证了并发标记的正确性，代价是一些浮动垃圾。

**CSet (Collection Set)：** 一次 GC 中将被回收的 Region 集合。Young GC 的 CSet 包含所有 Eden 和 Survivor Region；Mixed GC 还包含候选的老年代 Region。

#### GC 周期

```
Young-only Phase:     [Young GC] → [Young GC] → ... → [Concurrent Start (Young GC)]
Space Reclamation:    [Remark (STW)] → [Cleanup (STW)] → [Mixed GC] → ... → [Mixed GC]
                                                              ↑
                                  直到老年代回收足够空间或达到 Mixed GC 次数上限
Space Reclamation 结束后 → 回到 Young-only Phase
```

**各阶段详解：**

1. **Young GC (Evacuation Pause)：** STW，将 Eden 中的存活对象复制到 Survivor Region，必要时将 Survivor 中达到晋升阈值的对象移到老年代。

2. **Concurrent Start (Initial Mark, Young GC)：** STW，标记 GC Roots 直接可达的对象。同时触发并发标记周期的开始。

3. **Concurrent Marking：** 并发阶段，从 GC Roots 出发遍历对象图。使用 SATB 保证正确性。

4. **Remark：** STW，处理 SATB 队列中剩余的引用变更，完成标记。

5. **Cleanup：** STW，统计每个 Region 的存活对象比例，排序候选的老年代 Region。同时回收完全空闲的 Region。

6. **Mixed GC：** STW，除了回收所有年轻代 Region，还回收部分高收益的老年代 Region。Mixed GC 的次数由 `-XX:G1MixedGCCountTarget` 控制（默认 8）。

#### 关键调优参数

```
-XX:+UseG1GC                          # 显式启用 G1（JDK 25 默认，无需显式指定）
-XX:MaxGCPauseMillis=<N>              # 期望的最大暂停时间（默认 200ms）。软目标，非保证。
-XX:G1HeapRegionSize=<N>              # Region 大小（如 4M, 8M）
-XX:G1NewSizePercent=<N>              # 年轻代最小占比（默认 5）
-XX:G1MaxNewSizePercent=<N>           # 年轻代最大占比（默认 60）
-XX:InitiatingHeapOccupancyPercent=<N> # 触发并发标记周期的堆占用阈值（默认 45）
-XX:G1MixedGCLiveThresholdPercent=<N> # Mixed GC 候选 Region 中存活对象上限（默认 85）
-XX:G1MixedGCCountTarget=<N>          # 每次 Mixed GC 周期的回收次数（默认 8）
-XX:G1ReservePercent=<N>              # 保留空间（默认 10），防止晋升失败时的 to-space overflow
-XX:+G1UseAdaptiveIHOP                # 自适应调整 IHOP（默认开启）
-XX:G1HeapWastePercent=<N>            # 可容忍的浪费堆空间（默认 5）
```

#### 调优策略

**"不要过度调优，设定暂停目标就够了"** 是 G1 设计的核心哲学。通常只需要：

```bash
# 最基本的 G1 配置
java -Xms4g -Xmx4g -XX:MaxGCPauseMillis=100 -jar app.jar
```

**进阶调优：**
- 如果晋升失败（to-space exhausted / Full GC 出现）：增大 `-XX:G1ReservePercent` 或增大堆。
- 如果 Humongous 对象分配导致频繁的并发标记周期：增大 `-XX:G1HeapRegionSize`，降低 Humongous 对象的占比。
- 如果 Mixed GC 效果不好（回收空间太少）：降低 `-XX:G1MixedGCLiveThresholdPercent`。
- 如果并发标记周期太频繁：增大 `-XX:InitiatingHeapOccupancyPercent`。

### 4.3 ZGC (Z Garbage Collector)

ZGC 是 JDK 25 中最先进的 GC，设计目标是将暂停时间控制在 **亚毫秒级**（<1ms），且暂停时间不随堆大小或存活对象数量增长。

#### 核心原理：Colored Pointers（染色指针）

ZGC 在 64-bit 指针中嵌入元数据（而非在对象头中），利用 x86_64 架构只使用 48 位虚拟地址的事实，将高 16 位用作元数据：

```
+--+---+---+---+---+
|42|18 | 4 | 4 |   |    42-bit: 对象地址（支持 4TB 地址空间）
+--+---+---+---+---+
    ↑   ↑   ↑
    │   │   └── Marked0/Marked1 (交替使用，1-bit)
    │   └── Remapped (1-bit, 是否已重映射)
    └── Finalizable (1-bit, 只能通过 finalizer 访问)
```

**染色指针的关键优势：**
1. 元数据与指针一起移动，不需要在对象中存储，减少内存开销。
2. 一个指针携带所有 GC 状态，使得并发操作更简单。
3. Load Barrier（读屏障）在解引用指针时检查颜色，根据需要执行重映射。

**Load Barrier 伪代码：**
```c
// ZGC Load Barrier 的简化逻辑
oop ZBarrier::load_barrier(oop* p) {
    oop o = *p;
    uintptr_t colored_ptr = (uintptr_t)o;

    if (is_marked_through(colored_ptr)) {
        // 已经标记完成，直接返回
        return o;
    }

    if (!is_good_color(colored_ptr)) {
        // 指针颜色不对：需要修复（重映射或标记）
        oop good = fix_colored_pointer(colored_ptr);
        // CAS 更新指针，如果失败说明其他线程已经修复
        atomic_cas(p, o, good);
        return good;
    }

    return o;
}
```

#### Multi-Mapping（多映射）

由于染色指针使用了虚拟地址的高位，操作系统可能不识别这些"有色"地址。ZGC 使用 Multi-Mapping 技术：将同一块物理内存映射到多个虚拟地址范围（每种颜色一个），这样即使指针带有颜色标记，CPU 也能正确访问内存。

在 JDK 21+，ZGC 在支持的平台上使用了更高效的方案，减少了 Multi-Mapping 带来的 TLB 压力。

#### ZGC 的阶段

```
[STW: Mark Start] → [Concurrent: Mark] → [STW: Mark End]
        ↓
   （分代 ZGC 中可能有多次 Young GC 边运行边进行并发标记）
        ↓
[Concurrent: Prepare Relocate] → [STW: Relocate Start] → [Concurrent: Relocate]
```

- **Mark Start (STW)：** 标记 GC Roots，不到 0.1ms。
- **Concurrent Mark：** 并发遍历对象图并染色。绝大部分工作在此阶段。
- **Mark End (STW)：** 处理并发标记期间遗留的变更。
- **Prepare Relocate (Concurrent)：** 确定哪些 Region 中的哪些 Page 需要压缩。
- **Relocate Start (STW)：** 选择 GC Roots 的转发地址，不到 0.1ms。
- **Concurrent Relocate：** 并发移动对象并更新引用。应用线程通过 Load Barrier 自动转发到新位置。

#### 分代 ZGC (Generational ZGC — JEP 439, 默认自 JDK 21)

JDK 21 引入了分代 ZGC，将堆分为年轻代和老年代，显著减少内存占用和 CPU 开销：

```
-XX:+UseZGC -XX:+ZGenerational   # JDK 21+ 显式启用分代 ZGC（默认开启）
```

分代 ZGC 维持了亚毫秒暂停的目标，同时：
- **内存占用减少约 10%~20%**（年轻代对象被更积极地回收，无需在内存中保留）
- **吞吐量提升约 10%~15%**（Minor GC 频率降低）
- **CPU 开销降低**（并发标记的工作量减少）

**JDK 25 中 ZGC 的变化：**
- 支持 `-XX:SoftMaxHeapSize`：允许堆弹性伸缩。
- 改进的 Large Page 支持（`-XX:+UseLargePages`）。
- 更好的 NUMA 感知。

#### ZGC 参数

```
-XX:+UseZGC                          # 启用 ZGC
-XX:+ZGenerational                   # 启用分代 ZGC（JDK 21+ 默认）
-XX:ZAllocationSpikeTolerance=<N>    # 分配峰值容忍度（默认 2.0）
-XX:ZCollectionInterval=<N>          # 最大 GC 间隔（秒，默认 0=无限制）
-XX:ZYoungCompactionThreshold        # 年轻代压缩阈值
```

### 4.4 Shenandoah GC

Shenandoah 是 Red Hat 主导开发的低延迟 GC，与 ZGC 的设计目标类似但实现机制不同。它是 OpenJDK 的一部分（非 Oracle JDK），但在 Adoptium 等发行版中可用。

#### Brooks Pointer（Brooks 转发指针）

Shenandoah 在 **对象头**（而非指针中）存储转发指针：

```
+-------------+------------------+
| Brooks Ptr  | Object Data ...  |
+-------------+------------------+
      ↓
  指向对象的当前版本（移动后指向新位置）
```

**对比 ZGC 的染色指针：**
- Shenandoah 的 Brooks Pointer 在对象头中，每次对象访问都要额外解引用一次，有微小的吞吐量损失。
- ZGC 的染色指针在指针本身中，不需要修改对象布局，但依赖 Multi-Mapping。
- 两种方案都能实现并发压缩，只是工程权衡不同。

#### 并发压缩 (Concurrent Compaction)

Shenandoah 的并发压缩过程：

```
[STW: Init Mark] → [Concurrent: Marking] → [STW: Final Mark]
        ↓
[Concurrent: Evacuation] ← 并发移动对象
        ↓
[STW: Init Update Refs] → [Concurrent: Update References]
        ↓
[STW: Final Update Refs] → [Concurrent: Cleanup]
```

**并发 Evacuation 机制：**
1. GC 线程将对象从碎片 Region 复制到目标 Region。
2. 使用 CAS 更新 Brooks Pointer，指向新位置。
3. 如果 CAS 成功：GC 线程完成了此次迁移。
4. 如果 CAS 失败：另一个 GC 线程（或应用线程通过 Read Barrier）已经完成了迁移。
5. 任何线程读取对象时，Brooks Pointer 自动转发到当前版本。

#### Shenandoah 参数

```
-XX:+UseShenandoahGC
-XX:ShenandoahGCHeuristics=<mode>     # adaptive|static|compact|aggressive（默认 adaptive）
-XX:ShenandoahMinFreeThreshold=<N>    # 最小空闲阈值（默认 10%）
-XX:ShenandoahAllocationStallThreshold=<N>  # 分配失速阈值
-XX:ShenandoahPacingMaxDelay=<N>      # 最大延迟
```

**JDK 25 中的分代 Shenandoah：** 实验性特性，通过 `-XX:+ShenandoahGenerational` 启用。分代模式避免了不必要的并发标记扫描，降低了 CPU 开销。

### 4.5 GC 选型决策树

```
                    你的应用需要什么？
                    /                \
          低延迟（<10ms 暂停）      高吞吐量（批处理）
             /        \                  |
       堆 < 16TB    堆 > 16TB        Parallel GC
         /              \           （最简配，吞吐优先）
    ZGC (首选)    Shenandoah
    JDK 21+ 分代    （无堆大小限制）
    （亚毫秒延迟）
         |
   大多数在线服务的最佳选择
   
   如果不能引入 ZGC/Shenandoah：
   → G1 (默认，暂停目标 10-200ms)
      适用于 4GB~64GB 堆、中等延迟要求
```

**决策表：**

| 场景 | 推荐 GC | 原因 |
|------|--------|------|
| REST API 在线服务，堆 < 64GB，暂停 < 50ms 可接受 | G1 | 默认，成熟稳定 |
| 延迟敏感服务，需要 < 10ms 暂停 | ZGC (分代) | 亚毫秒 STW |
| 超大规模堆 (TB 级) 需要低延迟 | ZGC 或 Shenandoah | 暂停不随堆大小增长 |
| 离线批处理，追求最大吞吐量 | Parallel GC | 无并发开销 |
| 极低内存 (< 1GB) 小应用 | Serial GC | 单线程，无额外开销 |

### 4.6 GC 日志解读 (Unified Logging: `-Xlog`)

JDK 9 引入了统一日志框架，取代了碎片化的 GC 日志参数。

#### 基础 GC 日志

```bash
# 输出 GC 基本信息到 stdout
java -Xlog:gc:stdout -jar app.jar

# 输出 GC 详细信息到文件（带时间戳、级别、标签）
java -Xlog:gc*,gc+heap=info,gc+age=trace:file=gc.log:time,level,tags:filecount=10,filesize=100M -jar app.jar
```

#### G1 GC 日志示例与解读

```
[2026-07-17T10:30:15.123+0800][info][gc,start] GC(42) Pause Young (Normal) (G1 Evacuation Pause)
[2026-07-17T10:30:15.135+0800][info][gc,heap] GC(42) Eden: 2048M(2048M)->0M(1536M) Survivors: 256M->384M Heap: 8192M(16384M)->6144M(16384M)
[2026-07-17T10:30:15.136+0800][info][gc] GC(42) Pause Young (Normal) (G1 Evacuation Pause) 8192M->6144M 12.345ms
[2026-07-17T10:30:15.136+0800][info][gc,cpu] GC(42) User=0.18s Sys=0.02s Real=0.01s
```

**解读：**
- `GC(42)`：第 42 次 GC。
- `Pause Young (Normal)`：正常的 Young GC，类型为 G1 Evacuation Pause。
- `Eden: 2048M(2048M)->0M(1536M)`：Eden 从 2048MB（满分）变为 0MB，下次可用 1536MB。
- `Survivors: 256M->384M`：Survivor 从 256MB 增长到 384MB（存活对象晋升）。
- `Heap: 8192M(16384M)->6144M(16384M)`：堆总占用从 8GB 降到 6GB。
- `12.345ms`：STW 暂停时间。
- `User=0.18s Sys=0.02s Real=0.01s`：CPU 时间。User+Sys 是多核并行的结果，Real 是墙上时钟。

#### G1 Mixed GC 日志

```
[2026-07-17T10:35:00.456+0800][info][gc,start] GC(58) Pause Mixed (G1 Evacuation Pause)
[2026-07-17T10:35:00.478+0800][info][gc] GC(58) Pause Mixed (G1 Evacuation Pause) 15360M->11264M 22.123ms
[2026-07-17T10:35:00.478+0800][info][gc,heap] GC(58) Eden: 2048M(2048M)->0M(2048M) Old: 13312M->9216M
```

**解读：** 一次 Mixed GC 回收了约 4GB 老年代空间，耗时 22ms。

#### G1 并发标记周期日志

```
[2026-07-17T10:34:00.000+0800][info][gc] GC(50) Concurrent Cycle
[2026-07-17T10:34:00.001+0800][info][gc,marking] GC(50) Concurrent Clear Claimed Marks
[2026-07-17T10:34:00.002+0800][info][gc,start] GC(51) Pause Young (Concurrent Start) (G1 Humongous Allocation)
[2026-07-17T10:34:00.003+0800][info][gc] GC(51) Pause Young (Concurrent Start) (G1 Humongous Allocation) 5500M->5300M 1.234ms
[2026-07-17T10:34:00.150+0800][info][gc,marking] GC(51) Concurrent Mark From Roots
[2026-07-17T10:34:01.200+0800][info][gc,marking] GC(51) Concurrent Mark From Roots 1050.123ms
[2026-07-17T10:34:01.202+0800][info][gc] GC(52) Pause Remark 5300M->5280M 0.456ms
[2026-07-17T10:34:01.203+0800][info][gc] GC(53) Pause Cleanup 5280M->5250M 0.234ms
[2026-07-17T10:34:01.204+0800][info][gc,marking] GC(53) Concurrent Cleanup for Next Mark
```

**解读：**
- 并发标记周期由 Humongous Allocation 触发（IHOP 阈值也可能触发）。
- `Concurrent Mark From Roots` 耗时约 1.05 秒，但这个阶段是与应用并发执行的，不产生 STW。
- `Pause Remark` 和 `Pause Cleanup` 是仅有的两个额外 STW 暂停（合计不到 1ms）。

#### ZGC 日志示例

```
[2026-07-17T10:30:15.123+0800][info][gc] GC(10) Garbage Collection (Young)
[2026-07-17T10:30:15.123+0800][info][gc,start] GC(10) Pause Mark Start (Young) 0.020ms
[2026-07-17T10:30:15.456+0800][info][gc] GC(10) Concurrent Mark (Young) 332.123ms
[2026-07-17T10:30:15.457+0800][info][gc] GC(10) Pause Mark End (Young) 0.015ms
[2026-07-17T10:30:15.789+0800][info][gc] GC(10) Concurrent Process Non-Strong References 331.456ms
[2026-07-17T10:30:16.234+0800][info][gc] GC(10) Concurrent Relocate 444.789ms
[2026-07-17T10:30:16.234+0800][info][gc,heap] GC(10) Heap: 4096M(16384M)->2048M(16384M)
```

**解读：** ZGC 的两次 STW 暂停 (`Mark Start` 和 `Mark End`) 合计约 0.035ms，远低于 1ms 目标。

### 4.7 常见 GC 问题诊断

#### 问题 1：Full GC 频繁 (Parallel GC)

```
[Full GC (Ergonomics) 8192M->4096M(8192M), 2.345s]
```

**原因：** 老年代空间不足。
**排查：** `-Xlog:gc+heap=debug` 查看每次 Young GC 的晋升量。
**解决：** 增大堆、增大年轻代（`-XX:NewRatio`）、减少对象生命周期。

#### 问题 2：G1 Humongous Allocation 触发并发标记

```
[Pause Young (Concurrent Start) (G1 Humongous Allocation)]
```

**原因：** 频繁分配超大对象（> Region Size / 2）。
**排查：**
```bash
# 打印 Humongous 分配
-Xlog:gc+alloc=debug
```
**解决：** 增大 Region 大小（`-XX:G1HeapRegionSize=16M`），或改造代码避免超大对象（如大数组、大 ByteBuffer）。

#### 问题 3：G1 To-space Overflow / Evacuation Failure

```
[GC pause (G1 Evacuation Pause) (to-space exhausted), 0.1234567 secs]
```

**原因：** 晋升时目标空间不足。
**解决：** 增大 `-XX:G1ReservePercent`，或增大堆，或减少存活对象。

#### 问题 4：ZGC Allocation Stall

```
[Allocation Stall (ZGC)]
```

**原因：** 分配速度快于 GC 回收速度。
**解决：** 增大堆（`-Xmx`），或降低分配尖峰容忍度参数。

---

## 五、JIT 编译 (Just-In-Time Compilation)

### 5.1 C1 与 C2 编译器

HotSpot 包含两个 JIT 编译器：

| 特性 | C1 (Client Compiler) | C2 (Server Compiler) |
|------|---------------------|----------------------|
| 编译速度 | 快（低延迟） | 慢（需要更多分析） |
| 代码质量 | 中等优化 | 最激进优化 |
| 适用场景 | GUI 应用、快速启动 | 长时间运行的服务器 |
| 优化技术 | 内联、简单寄存器分配 | 内联、逃逸分析、标量替换、循环展开、向量化 |

### 5.2 分层编译 (Tiered Compilation, 默认开启)

JDK 8+ 默认开启分层编译，结合 C1 和 C2 的优势：

| 层级 | 编译器 | 描述 |
|------|--------|------|
| 0 | 解释器 | 代码首次执行 |
| 1 | C1 (无 profiling) | 简单方法快速编译 |
| 2 | C1 (有限 profiling) | 收集调用次数和分支统计 |
| 3 | C1 (完全 profiling) | 收集完整性能数据 |
| 4 | C2 | 基于 profiling 数据的最激进优化 |

**编译触发阈值 (由计数器驱动)：**
- 方法调用计数器：方法入口处递增，超过 `-XX:CompileThreshold` (默认 10000 for C1, 15000 for C2)。
- 回边计数器：循环迭代次数。超过 `-XX:OnStackReplacePercentage` 触发 OSR (On-Stack Replacement)。

### 5.3 关键优化技术

#### 方法内联 (Method Inlining)

JIT 最重要的优化。将方法调用替换为方法体，消除调用开销，并解锁后续优化。

```java
// 原始代码
int sum(int a, int b) { return a + b; }
int result = sum(x, y);

// 内联后（等价于）
int result = x + y;
```

**内联限制：**
- `-XX:MaxInlineSize=<N>`：内联方法的最大字节码大小（默认 35）。
- `-XX:FreqInlineSize=<N>`：频繁调用的方法的内联大小上限（默认 325）。
- `-XX:MaxInlineLevel=<N>`：最大内联深度（默认 9）。

**开发者如何辅助 JIT 内联：** 保持方法简短（< 35 字节码），避免过深的调用栈，对热点路径使用 `@ForceInline` 注解。

#### 逃逸分析 (Escape Analysis)

分析对象的作用域：如果一个对象不会逃逸出当前方法或当前线程，就可以进行栈上分配或标量替换。

```java
// 示例：对象不会逃逸 → 栈上分配，无 GC 压力
public long sum(int n) {
    var accumulator = new Accumulator();  // 不会逃逸
    for (int i = 0; i < n; i++) {
        accumulator.add(i);
    }
    return accumulator.getValue();
}
```

**逃逸分析的三种优化结果：**
1. **栈上分配 (Stack Allocation)：** 对象直接分配在栈上，随栈帧弹出而销毁，完全不经过 GC。
2. **标量替换 (Scalar Replacement)：** 将对象拆解为字段分别分配。
3. **锁消除 (Lock Elimination)：** 如果对象不会逃逸出线程，其上的同步锁可以被安全移除。

**如何验证逃逸分析是否生效：**
```bash
# 开启逃逸分析日志（JDK 25）
-XX:+UnlockDiagnosticVMOptions -XX:+PrintEscapeAnalysis
```

#### 标量替换 (Scalar Replacement)

```java
// 原始代码
record Point(int x, int y) {}
Point p = new Point(42, 7);
int result = p.x() + p.y();

// 标量替换后（JIT 内部表示）
int x = 42;
int y = 7;
int result = x + y;  // Point 对象根本不会在堆上分配
```

#### 反射优化 (Reflection Inflation)

JDK 18+ 对反射进行了重大优化：

1. **MethodHandle 桥接：** 反射调用在预热后自动转换为 MethodHandle 调用。
2. **LambdaForm 编译：** MethodHandle 的实现形式 LambdaForm 可以被 JIT 编译和内联。
3. **JDK 25 进一步优化：** 减少 `Reflection.getCallerClass()` 的 native 调用开销，使其接近普通方法调用的性能。

```java
// JDK 25 基准测试：反射调用开销
// 在预热后，反射调用接近直接调用的性能（开销 < 20%）
import java.lang.reflect.Method;

class ReflectionBench {
    private static final Method METHOD;

    static {
        try {
            METHOD = ReflectionBench.class.getDeclaredMethod("targetMethod");
        } catch (NoSuchMethodException e) {
            throw new RuntimeException(e);
        }
    }

    public void targetMethod() {
        // no-op
    }

    // 直接调用
    public void directCall() {
        targetMethod();
    }

    // 反射调用（预热后可被 JIT 优化）
    public void reflectiveCall() throws Exception {
        METHOD.invoke(this);
    }
}
```

### 5.4 编译器控制与诊断

```bash
# 输出编译日志
-Xlog:compilation*=info:file=compile.log

# 查看当前 JIT 编译的方法列表
-XX:+PrintCompilation
# 输出格式：  时间戳  编译ID  属性  方法名  大小
# 例如：    1234  567  %  3  com.example.MyClass::hotMethod @ 12 (80 bytes)

# 禁止特定方法被编译（排除问题方法）
-XX:CompileCommand=exclude,com/example/MyClass,badMethod

# 强制内联特定方法
-XX:CompileCommand=inline,com/example/MyUtils,fastMethod

# 查看内联日志
-XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining
```

---

## 六、GraalVM

### 6.1 GraalVM 概览

GraalVM 是 Oracle 开发的高性能多语言运行时，在 JDK 25 中，Graal JIT 编译器可作为 C2 的替代品，而 Native Image 支持将 Java 应用编译为独立的本机可执行文件。

### 6.2 Graal JIT 编译器

作为 HotSpot C2 的替代品：

```bash
# 使用 Graal 作为顶层 JIT 编译器
-XX:+UseGraalJIT
```

**Graal JIT 的优势：**
- 更激进的内联和部分逃逸分析（Partial Escape Analysis）。
- 对 Stream API 有更好的优化。
- 更好的向量化支持（与 Project Panama Vector API 配合）。

### 6.3 Native Image (AOT 编译)

**核心概念：** Native Image 在构建时对应用进行静态分析，确定所有可达的类、方法和字段，然后编译为独立的可执行文件。

```bash
# 构建 Native Image
native-image -jar app.jar --no-fallback -o app

# 直接运行（毫秒级启动）
./app
```

**Native Image 的约束：**
- 不支持动态类加载（`Class.forName()` 调用需在配置中注册）。
- 反射、JNI、动态代理、资源访问需在 `reflect-config.json`、`jni-config.json` 等配置文件中声明。
- 不支持 `finalize()`。
- 部分 JDK 特性不可用（如 JMX 的部分功能、Attach API）。
- 不支持 C2 的运行时反优化 (deoptimization)，但 Graal 编译器在编译时进行了充分优化。

**Native Image 构建流程：**
```
源代码(.java) → javac → 字节码(.class) → Native Image Builder
                                              ├── 静态分析(Points-to Analysis)
                                              ├── 初始化堆快照(Heap Snapshotting)
                                              ├── 提前编译(AOT Compilation)
                                              └── 链接为可执行文件
```

**性能对比：**

| 维度 | HotSpot JIT | Native Image |
|------|-------------|-------------|
| 启动时间 | 秒级 | 毫秒级 (< 50ms) |
| 预热时间 | 需要（分钟级） | 无需预热 |
| 峰值吞吐量 | 最优（经过充分 JIT） | 略低（约 85~95%） |
| 内存占用 | 较大（JIT 编译器 + profiling 数据）| 较小（无 JIT 基础设施）|
| 适用场景 | 长时间运行的服务 | Serverless、微服务、CLI 工具 |

**JDK 25 + Spring Boot 4.x Native 示例：**
```bash
# Spring Boot 4.x 通过 Spring AOT 引擎生成 GraalVM 配置
mvn -Pnative spring-boot:build-image
# 或本地构建
mvn -Pnative native:compile
```

### 6.4 Polyglot 互操作

GraalVM 的 Truffle 框架允许在同一个运行时中执行多种语言（JavaScript、Python、Ruby、R、Wasm）。

```java
// Java 中嵌入 JavaScript (GraalVM Polyglot, JDK 25)
import org.graalvm.polyglot.*;

void runJavaScript() {
    try (var context = Context.create()) {
        var result = context.eval("js",
            """
            function fibonacci(n) {
                if (n <= 1) return n;
                return fibonacci(n - 1) + fibonacci(n - 2);
            }
            fibonacci(10)
            """);
        System.out.println("Fibonacci(10) = " + result.asInt()); // 55
    }
}
```

---

## 七、JMH 基准测试：GC 性能对比

JMH (Java Microbenchmark Harness) 是 JDK 内置的基准测试框架（JDK 9+ 位于 `jdk.jmh` 模块）。

### 7.1 写一个 GC 压测基准

```java
import org.openjdk.jmh.annotations.*;
import org.openjdk.jmh.runner.Runner;
import org.openjdk.jmh.runner.options.OptionsBuilder;

import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;

/*
 * JMH GC 压测基准
 * 模拟每秒分配大量中等生命周期对象
 *
 * 运行方式（分别用不同 GC）：
 * java -XX:+UseG1GC -jar benchmarks.jar
 * java -XX:+UseZGC -jar benchmarks.jar
 * java -XX:+UseParallelGC -jar benchmarks.jar
 */
@BenchmarkMode(Mode.Throughput)
@OutputTimeUnit(TimeUnit.SECONDS)
@State(Scope.Benchmark)
@Warmup(iterations = 5, time = 1)
@Measurement(iterations = 5, time = 2)
@Fork(1)
public class GCPressureBenchmark {

    @Param({"1024", "4096", "16384"})
    int allocationSize;

    @Param({"100", "1000"})
    int lifetime;

    // 模拟缓存：持有对象一定的"生命周期"
    private Object[] cache;
    private int index;

    @Setup(Level.Iteration)
    public void setup() {
        cache = new Object[lifetime];
        index = 0;
    }

    @Benchmark
    public void allocateAndRelease() {
        // 分配一个中等大小的 byte 数组
        var data = new byte[allocationSize];

        // 填充随机数据（防止 Dead Code Elimination）
        ThreadLocalRandom.current().nextBytes(data);

        // 模拟业务处理
        var hash = computeHash(data);

        // 放入缓存：模拟固定生命周期的对象
        var old = cache[index];
        cache[index] = data;
        index = (index + 1) % lifetime;

        // 消费 hash 防止 DCE
        Blackhole.consumeCPU(hash);
    }

    private int computeHash(byte[] data) {
        var h = 0;
        for (var b : data) {
            h = 31 * h + b;
        }
        return h;
    }

    public static void main(String[] args) throws Exception {
        var options = new OptionsBuilder()
                .include(GCPressureBenchmark.class.getSimpleName())
                .build();
        new Runner(options).run();
    }
}
```

### 7.2 运行与对比

```bash
# 分别用不同 GC 运行同一基准
java -XX:+UseG1GC -XX:MaxGCPauseMillis=50 -jar target/benchmarks.jar \
    -p allocationSize=4096 -p lifetime=1000

java -XX:+UseZGC -XX:+ZGenerational -jar target/benchmarks.jar \
    -p allocationSize=4096 -p lifetime=1000

java -XX:+UseParallelGC -jar target/benchmarks.jar \
    -p allocationSize=4096 -p lifetime=1000

# 预期结果（定性）：
# Parallel GC  → 最高吞吐量，但暂停时间最长
# G1 GC        → 中等吞吐量，暂停时间可控
# ZGC          → 吞吐量接近 G1，暂停时间极低 (<1ms)
```

---

## 八、JFR 与 JMC 诊断实战

JDK Flight Recorder (JFR) 和 JDK Mission Control (JMC) 是 JVM 内置的低开销性能分析工具。

### 8.1 JFR 录制

```bash
# 启动时录制（60 秒，输出到 recording.jfr）
java -XX:StartFlightRecording=duration=60s,filename=recording.jfr -jar app.jar

# 运行时动态启动录制
jcmd <pid> JFR.start duration=60s filename=recording.jfr

# 查看 JFR 事件列表
jcmd <pid> JFR.check
```

### 8.2 程序中控制 JFR

```java
import jdk.jfr.*;

import java.nio.file.Path;

/**
 * Programmatic JFR recording — JDK 25 style.
 */
public class JFRDemo {

    public static void main(String[] args) throws Exception {
        // 创建录制配置
        var config = new Recording();
        config.setName("HeapAnalysis");

        // 启用特定事件
        config.enable("jdk.GarbageCollection");
        config.enable("jdk.GCPhaseParallel");       // GC 各阶段详情
        config.enable("jdk.ObjectAllocationInNewTLAB");
        config.enable("jdk.ObjectAllocationOutsideTLAB");
        config.enable("jdk.ThreadAllocationStatistics");
        config.enable("jdk.HeapSummary");
        config.enable("jdk.MetaspaceSummary");

        config.start();

        // 模拟业务负载：分配大量对象
        runLoad();

        config.stop();

        // 保存到文件
        config.dump(Path.of("heap-profile.jfr"));
        config.close();

        System.out.println("JFR recording saved to heap-profile.jfr");
    }

    // 自定义 JFR 事件
    @Name("com.example.AllocationEvent")
    @Label("Allocation Event")
    @Description("Tracks large allocations for diagnostics")
    static class AllocationEvent extends Event {
        @Label("Allocation Size")
        long size;

        @Label("Allocation Type")
        String type;
    }

    static void runLoad() {
        // 分配大量不同大小的对象，制造 GC 压力
        for (var i = 0; i < 100_000; i++) {
            var size = 1024 + (i % 100) * 1024; // 1KB ~ 100KB
            var obj = new byte[size];

            // 发送自定义事件
            var event = new AllocationEvent();
            event.size = size;
            event.type = "byte[]";
            event.commit();
        }
    }
}
```

### 8.3 JMC 分析要点

用 JMC 打开 `.jfr` 文件后，重点关注：

1. **GC 标签页：**
   - `Longest Pause`：最长 GC 暂停时间。
   - `GC Pauses 分布`：暂停时间的直方图。
   - `Allocation by Class`：哪些类分配最频繁。

2. **Memory 标签页：**
   - Heap 使用量随时间的变化趋势。
   - GC 后存活对象大小。
   - 晋升 (Promotion) 量。

3. **Threads 标签页：**
   - CPU 热点线程。
   - 阻塞/等待时间占比。

4. **Code 标签页：**
   - 编译队列长度（过大说明 C2 跟不上）。
   - 内联失败的方法。

---

## 九、常用 JVM 参数速查

### 9.1 内存参数

```
-Xms<size>              # 初始堆大小（建议 = -Xmx 避免堆扩缩）
-Xmx<size>              # 最大堆大小
-Xss<size>              # 线程栈大小（默认 1024KB on Linux x64）
-XX:MetaspaceSize=<size> # Metaspace 初始大小
-XX:MaxMetaspaceSize=<size> # Metaspace 上限
-XX:MaxDirectMemorySize=<size> # 直接内存上限（默认 = Xmx）
-XX:SoftMaxHeapSize=<size> # 软上限（ZGC 支持，JDK 25）
```

### 9.2 GC 参数

```
# G1
-XX:+UseG1GC -XX:MaxGCPauseMillis=100

# ZGC
-XX:+UseZGC -XX:+ZGenerational

# Shenandoah
-XX:+UseShenandoahGC -XX:ShenandoahGCHeuristics=adaptive

# Parallel GC (高吞吐)
-XX:+UseParallelGC -XX:ParallelGCThreads=<N>

# Serial GC (小堆/单核)
-XX:+UseSerialGC

# GC 日志
-XX:StartFlightRecording=filename=gc.jfr
-Xlog:gc*,gc+ref=info,gc+heap=info,gc+age=trace:file=gc.log:time,uptime,level,tags:filecount=10,filesize=100M
```

### 9.3 编译器参数

```
-XX:TieredStopAtLevel=0     # 纯解释模式
-XX:TieredStopAtLevel=1     # 仅 C1
-XX:-TieredCompilation      # 禁用分层编译（仅 C2）
-XX:+UseGraalJIT            # 使用 Graal 替代 C2 (JDK 25)
-XX:+PrintCompilation       # 打印编译日志
-XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining  # 打印内联决策
```

### 9.4 诊断参数

```
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/path/to/dumps
-XX:+ExitOnOutOfMemoryError
-XX:ErrorFile=/path/to/hs_err_pid%p.log
-XX:NativeMemoryTracking=summary   # 启用 NMT
jcmd <pid> VM.native_memory summary # 查看 NMT 报告
```

---

## 十、GC 友好编程实践

### 10.1 对象生命周期管理

```java
// 不好：对象引用意外逃逸，延长生命周期
public class BadPattern {
    private static final List<byte[]> CACHE = new ArrayList<>();

    public void process(byte[] data) {
        CACHE.add(data);          // 静态集合持有引用 → 永不 GC
        processInternal(data);
        // 忘记从 CACHE 中移除
    }
}

// 好：明确的生命周期 + 及时清理
public class GoodPattern {
    private final List<byte[]> cache = new ArrayList<>(); // 实例级别

    public void process(byte[] data) {
        cache.add(data);
        try {
            processInternal(data);
        } finally {
            cache.remove(data);   // 明确清理
        }
    }
}
```

### 10.2 减少装箱/拆箱

```java
// 不好：每次迭代产生 Integer 对象
List<Integer> numbers = new ArrayList<>();
for (int i = 0; i < 1_000_000; i++) {
    numbers.add(i); // 自动装箱 → new Integer(i)
}

// 好：使用基本类型或专门化的集合
// JDK 25 的 Valhalla 预览：值类型直接内联存储
// 在此之前：使用 int[] 或第三方基本类型集合
int[] numbers = new int[1_000_000];
for (int i = 0; i < numbers.length; i++) {
    numbers[i] = i;
}
```

### 10.3 避免 Humongous 对象

```java
// 不好：10MB 数组在 G1 中可能是 Humongous 对象
var bigArray = new byte[10 * 1024 * 1024];

// 好：拆分为多个小对象或使用 DirectByteBuffer
var chunks = new byte[10][1024 * 1024]; // 10 个 1MB 数组
// 或
var buffer = ByteBuffer.allocateDirect(10 * 1024 * 1024);
```

### 10.4 StringBuilder / String 优化

```java
// 不好：循环中字符串拼接产生大量中间 String 对象
String result = "";
for (int i = 0; i < 10000; i++) {
    result += "item" + i;  // 每次迭代创建多个对象
}

// 好：使用 StringBuilder 预分配
var sb = new StringBuilder(10000 * 10);
for (int i = 0; i < 10000; i++) {
    sb.append("item").append(i);
}
var result = sb.toString();
```

---

## 十一、常见问题

### Q1: Xms 和 Xmx 应该设置一样大吗？

建议在生产环境中将 `-Xms` 和 `-Xmx` 设为相同值，避免运行时堆扩缩带来的性能抖动。但对于运行在容器中的微服务（堆较小，如 512MB），堆扩缩的开销可以接受，可以设置不同值以节约资源。

### Q2: G1 的 MaxGCPauseMillis 设多大合适？

取决于应用需求。对于大多数 HTTP 在线服务，100~200ms 是合理的起点。对于延迟敏感的服务（如交易系统），可以尝试 50ms。注意：设得太低（如 10ms）可能导致 G1 无法达成目标，引发 Full GC，反而更糟。

### Q3: 什么时候该切换到 ZGC？

- 你的应用当前 GC 暂停超过 100ms，且调优 G1 后仍不满足需求。
- 堆在 16GB~4TB 之间，且延迟要求严格（< 10ms）。
- 你愿意接受增加约 5%~15% 的 CPU 开销换取亚毫秒级暂停。
- JDK 21+ 的分代 ZGC 已经足够成熟，可以用于生产。

### Q4: Native Image 适合我的应用吗？

适用条件：
- 应用启动时间是关键指标（Serverless、CLI 工具）。
- 不大量使用动态类加载、反射（或可以提供完整的 GraalVM 配置文件）。
- 可接受略低于 HotSpot JIT 的峰值吞吐量。
- Spring Boot 4.x 的 AOT 支持已简化了配置文件生成。

不适用：
- 重度依赖反射框架（如 Hibernate 的部分动态功能）。
- 运行时动态编译和加载代码。
- 需要 JMX 或 Attach API 的完整支持。

### Q5: 如何判断是否需要增加堆内存？

查看 GC 日志中的 `GC overhead` 指标。如果 GC 占用 CPU 超过 10%（对于 G1），或 GC 频率超过每秒一次 Full GC，考虑增大堆。JFR 的 GC 标签页可以直观展示 GC 开销占比。

---

## 相关条目

- [[02-Java并发深度解析]] — Java 内存模型与并发（happens-before、volatile、Virtual Threads）
- [[02-Java性能诊断全指南]] — 性能诊断工具链（JFR、async-profiler、Arthas、JMH 深入）
- [[02-现代Java25深度解析]] — JDK 25 新特性详解
- [[01-数据结构与算法]] — 数据结构基础（前置知识）
