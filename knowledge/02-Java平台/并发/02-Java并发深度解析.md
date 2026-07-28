---
domain: 02-Java平台
title: Java 并发深度解析——JMM、锁、AQS、ConcurrentHashMap、原子类与高级同步器
status: draft
level: advanced
sources:
  - level: L0
    url: https://docs.oracle.com/javase/specs/jls/se25/html/jls-17.html
    description: "JLS Chapter 17: Threads and Locks — Java 内存模型规范"
  - level: L2
    url: https://github.com/openjdk/jdk/tree/master/src/java.base/share/classes/java/util/concurrent
    description: OpenJDK java.util.concurrent 源码
  - level: L3
    url: https://jcip.net/
    description: Brian Goetz, Java Concurrency in Practice — 并发编程必读经典
  - level: L4
    url: https://shipilev.net/blog/2014/jmm-pragmatics/
    description: Aleksey Shipilev, JMM Pragmatics — JMM深入解读与翻译
  - level: L4
    url: https://tech.meituan.com/2018/11/15/java-lock.html
    description: 美团技术博客，synchronized 锁升级源码详解
  - level: L4
    url: https://www.cs.rochester.edu/~scott/papers/1991_TOCS_synch.pdf
    description: Mellor-Crummey & Scott, Algorithms for Scalable Synchronization on Shared-Memory Multiprocessors — CLH/MCS 锁原始论文
relations:
  prerequisite:
    - 01-数据结构与算法
  related:
    - 02-现代Java25深度解析
    - 02-JVM内部机制与调优
tags:
  - concurrency
  - JMM
  - synchronized
  - volatile
  - AQS
  - ConcurrentHashMap
  - CAS
  - CompletableFuture
  - ForkJoinPool
  - StampedLock
  - VirtualThreads
created: 2026-07-17
updated: 2026-07-28
content_type: practice
---

# Java 并发深度解析

## 概述

本文系统讲解 Java 并发编程的核心机制，从 JMM（Java Memory Model）内存模型入手，逐层深入 synchronized 锁升级、volatile 内存屏障、AQS 框架源码、ConcurrentHashMap 演进、原子类 CAS 原理、CompletableFuture 异步编排、ForkJoinPool 工作窃取，以及 StampedLock 读写策略。本文以 JDK 25 LTS 为基准，代码示例使用 `var` 和 Virtual Threads 等现代特性。

内容覆盖面试高频考点和日常开发中的真实并发问题，适合有 Java 基础、需要深挖并发底层实现的工程师。

---

## 一、JMM——Java Memory Model

### 1.1 为什么需要内存模型

在没有 JMM 的时代，同一个 Java 程序在不同 CPU 架构（x86、ARM、POWER）上可能表现出截然不同的并发行为。原因是各 CPU 的缓存一致性协议不同，编译器也有权对指令重排。JMM 定义了 **共享变量在多线程环境下的可见性、有序性和原子性** 规则，让 Java 程序员编写 "Write Once, Run Anywhere" 的并发代码成为可能。

JMM 的核心是两个概念：
- **主内存（Main Memory）**：所有线程共享的变量存储区域。
- **工作内存（Working Memory）**：每个线程私有的变量副本（对应 CPU 缓存/寄存器的抽象）。

线程对变量的所有操作（读/写）都必须在工作内存中进行，不能直接读写主内存。线程间变量值的传递必须通过主内存中转。

```
Thread-A 工作内存          Thread-B 工作内存
     |                         |
     |  1.write                |  3.read
     v                         v
  ===============================
        主内存 (x = 1)
  ===============================
     ^
     |  2.sync to main memory
     |
  Thread-A write x = 1
```

JMM 的关键抽象是 **happens-before 偏序关系**，它定义了操作之间的内存可见性。JMM 为程序员提供一个跨平台的并发语义约定；具体性能由 JVM 在不同硬件上生成对应的内存屏障（memory barrier）来保证。

### 1.2 happens-before 规则详解

happens-before 是 JMM 的灵魂。如果操作 A happens-before 操作 B，则 A 的结果对 B 可见，且 A 的执行顺序在 B 之前（虽然实际 CPU 可能重排，但对程序员来说"看起来"是顺序的）。每条规则都必须熟练掌握。

**规则 1：程序次序规则（Program Order Rule）**

同一线程内，按照控制流顺序，前面的操作 happens-before 后面的操作。

```java
int x = 1;   // (A)
int y = 2;   // (B)
// (A) happens-before (B)，B 一定能看到 x=1
// 注意：这是单线程保证。多线程间，程序次序规则不跨线程
```

**规则 2：管程锁定规则（Monitor Lock Rule）**

对一个锁的 unlock 操作 happens-before 后续对同一个锁的 lock 操作。

```java
// Thread-A                          // Thread-B
synchronized (lock) {                synchronized (lock) {
    sharedVar = 42;  // (A)              int r = sharedVar;  // (C)
    // unlock (B)                        // lock (D)
}                                    }
// (B) happens-before (D)，因此 r == 42
```

**规则 3：volatile 变量规则（Volatile Variable Rule）**

对一个 volatile 变量的写操作 happens-before 后续对该 volatile 变量的读操作。

```java
volatile boolean flag = false;
// Thread-A: flag = true;                 // (A) volatile 写
// Thread-B: while (!flag) {}             // (B) volatile 读
// (A) happens-before (B) — 一旦 Thread-B 读到 true，Thread-A 写之前的所有操作对 B 可见
```

**规则 4：线程启动规则（Thread Start Rule）**

在某个线程上调用 `start()` 方法 happens-before 该线程内部的任何操作。

```java
var sharedData = new Object();
sharedData.value = 100;  // (A) 主线程写
var t = Thread.startVirtualThread(() -> {
    System.out.println(sharedData.value);  // (B) 子线程读
});
// (A) happens-before (B) —— start() 调用前的所有写对新线程可见
```

**规则 5：线程终止规则（Thread Termination Rule）**

一个线程内的所有操作 happens-before 其他线程检测到该线程已终止（包括 `join()` 成功返回、`Thread.isAlive()` 返回 false）。

```java
var counter = new AtomicInteger(0);
var t = Thread.startVirtualThread(() -> {
    counter.set(42);  // (A)
});
t.join();  // (B) 检测到终止
// (A) happens-before (B) —— join() 返回后，主线程必定能看到 counter=42
```

**规则 6：线程中断规则（Interruption Rule）**

对线程 T 调用 `interrupt()` 方法 happens-before 被中断线程检测到中断事件（`InterruptedException` 被抛出、`isInterrupted()` 或 `Thread.interrupted()` 被调用）。

```java
var t = Thread.startVirtualThread(() -> {
    while (!Thread.currentThread().isInterrupted()) {  // (B) 检测中断
        // busy work
    }
    // sharedState = ... (A) happens-before (B)
});
// main thread sets up shared state before interrupting
t.interrupt();  // (C)
// (C) happens-before (B) —— interrupt() 调用之前的写对被中断线程可见
```

**规则 7：对象终结规则（Finalizer Rule）**

对象的构造函数执行结束 happens-before 该对象的 `finalize()` 方法开始（此规则在 JDK 9 中随 finalize 的废弃而不再重要，但概念仍在）。

**规则 8：传递性（Transitivity）**

如果 A happens-before B，且 B happens-before C，则 A happens-before C。传递性是实现跨线程可见性推导的关键——它是 volatile 能充当"可见性桥梁"的理论基础。

**传递性的经典应用——volatile 充当可见性桥梁：**

```java
class SafePublish {
    private int data;                      // 普通变量
    private volatile boolean ready = false; // volatile 标志

    // Thread-A: writer
    void writer() {
        data = 42;        // (1) 普通写
        ready = true;     // (2) volatile 写
    }

    // Thread-B: reader
    void reader() {
        if (ready) {      // (3) volatile 读
            System.out.println(data);  // (4) 普通读 —— 保证是 42
        }
    }
}
// 推导链：
// (1) happens-before (2)   [程序次序规则：同一线程]
// (2) happens-before (3)   [volatile 变量规则：写→读]
// (3) happens-before (4)   [程序次序规则：同一线程]
// 由传递性：(1) happens-before (4)，因此 (4) 保证读到 data=42
```

### 1.3 final 字段的初始化安全

JMM 为 `final` 字段提供特殊的初始化安全保证：**一个对象的构造函数中对 final 字段的写入，与将该对象的引用赋值给另一个变量之间，存在 happens-before 关系**。

具体而言，JMM 要求在构造函数结束前插入一个 **StoreStore 屏障**，确保 final 字段写入在对象引用发布之前完成。

```java
class FinalFieldGuarantee {
    final int x;
    int y;          // 普通字段，没有初始化安全保证
    static FinalFieldGuarantee instance;

    FinalFieldGuarantee() {
        x = 3;      // final 字段写入 —— 保证对其他线程可见
        y = 4;      // 普通字段写入 —— 可能看不到
        // StoreStore 屏障在此处（构造函数返回前）插入
    }

    static void writer() {
        instance = new FinalFieldGuarantee();
    }

    static void reader() {
        var f = instance;
        if (f != null) {
            int i = f.x;  // 保证读到 3（final 初始化安全）
            int j = f.y;  // 可能读到 0！没有初始化安全保证
        }
    }
}
```

**final 安全需要满足的额外条件**：

1. 构造函数中不能显式或隐式地让 `this` 引用逸出（如传入其他线程、放入静态集合、启动线程）。
2. 构造函数中对 final 字段的写入完成前，不能读 final 字段（通常自然满足）。
3. JDK 25 引入的 Flexible Constructor Bodies（JEP 482, Preview）允许在 `super()` 之前执行代码，但 final 字段仍必须在构造器正常返回前完成写入。

**this 逸出的经典反例**：

```java
// 错误示例：this 在构造器中逸出，final 安全被破坏
class ThisEscape {
    final int x;
    
    ThisEscape(ExecutorService executor) {
        executor.execute(() -> System.out.println(x));  // this 逸出！
        x = 42;  // final 写入在逸出之后，其他线程可能看到 x=0
    }
}
```

### 1.4 JMM 在不同硬件上的实现

Java 编译器会根据目标 CPU 架构插入不同的内存屏障：

```
操作               x86 (TSO)              ARM (Weak)
─────────────────────────────────────────────────────
volatile 写        StoreStore + StoreLoad   StoreStore; DMB; StoreLoad
volatile 读        近乎无开销（屏障是 no-op）       DMB; LoadLoad; LoadStore
synchronized 获取  同 volatile 读             同 ARM volatile 读
synchronized 释放  同 volatile 写             同 ARM volatile 写
```

x86 是强内存模型（TSO，Total Store Order），大部分情况下 StoreLoad 以外的屏障都是 no-op。ARM/POWER 是弱内存模型，需要显式插入 DMB（Data Memory Barrier）指令。JMM 的关键价值在于屏蔽这些差异。

---

## 二、synchronized——锁升级全过程

### 2.1 对象头（Object Header）与 Mark Word 详解

每个 Java 对象在堆中的内存布局为：

```
+------------------+-------------------+---------------------+
|   Object Header  |   Instance Data   |   Padding (对齐填充) |
+------------------+-------------------+---------------------+
| Mark Word | Klass|  fields...        | 8字节倍数对齐        |
| 8 bytes   | 4/8B |                   |                     |
+------------------+-------------------+---------------------+
```

**Mark Word 包含的信息**：锁状态标志、GC 分代年龄、identity hash code、偏向线程 ID、锁记录指针、重量级锁指针。64 位 JVM 下 Mark Word 在不同锁状态下的精确布局（简化）：

```
状态         | 位 [63..3]                                                          | 位 [2..0]
────────────────────────────────────────────────────────────────────────────────────────────
无锁         | unused:25 | identity_hashcode:31 | unused:1 | age:4 | biased_lock:1 | 001
偏向锁       | thread:54 | epoch:2 | unused:1 | age:4 | biased_lock:1              | 001
轻量级锁     | ptr_to_lock_record:62                                              |  00
重量级锁     | ptr_to_monitor:62                                                  |  10
GC 标记      | CMS 使用:62                                                        |  11
```

最低 3 位（biased_lock + lock_bits）决定锁状态：
- `001` — 无锁或偏向锁（由 biased_lock 位进一步区分：0=无锁，1=偏向锁）
- `00` — 轻量级锁
- `10` — 重量级锁
- `11` — GC 标记

**关键设计点**：
- 无锁状态存储 `identity_hashcode`（首次调用 `System.identityHashCode()` 时计算并存入）。一旦 identity hash code 被存入，就无法再偏向——因为偏向锁的 Mark Word 中 thread:54 会覆盖 hash code 的存储位。
- 轻量级锁将 Mark Word 备份到线程栈上的 `Lock Record` 中，Mark Word 中只存储指向 Lock Record 的指针。
- 重量级锁指向 JVM C++ 层的 `ObjectMonitor` 结构体，该结构体包含 `_owner`（持有线程）、`_EntryList`（竞争队列）、`_WaitSet`（wait 等待集合）。

### 2.2 锁升级路径详解（含 JVM 源码级分析）

JDK 15 开始**默认禁用偏向锁**（JEP 374），因为现代应用多为线程池模式，对象生命周期短、线程竞争模式不规则，偏向锁的撤销（需在全局安全点 SafePoint 暂停原持有线程）开销经常超过收益。以下展示完整升级路径（假定显式开启偏向锁 `-XX:+UseBiasedLocking`）：

```
无锁 (001, biased_lock=0)
  |
  | 第一个线程通过 CAS 将 ThreadID 写入 Mark Word
  v
偏向锁 (001, biased_lock=1, ThreadID=T1)       ← 无竞争，最快
  |
  | T2 尝试获取同一对象的锁 → JVM 检测到偏向线程不是当前线程
  | → 进入全局 SafePoint，检查 T1 是否还存活且持有该锁
  v
  ├── T1 已死或不持有 → 撤销偏向，恢复为无锁，T2 重试 CAS
  │
  └── T1 仍存活且持有 → 升级为轻量级锁
        |
        v
轻量级锁 (00)                                   ← T1 和 T2 自旋 CAS
  |  每个线程在自己的栈上创建 Lock Record
  |  CAS 尝试将 Mark Word 指向自己的 Lock Record
  |
  | 自旋失败达到阈值（JVM 自适应：通常 10+ 次或 CPU 核数/2 次）
  v
重量级锁 (10)                                   ← 操作系统 mutex
  |  未获取锁的线程进入 ObjectMonitor._EntryList
  |  被 park() 阻塞，等待持有者释放后 unpark()
```

**锁升级过程中的关键 JVM 操作（概念级）**：

1. **偏向锁获取**（`ObjectSynchronizer::fast_enter`）：CAS 将 ThreadID 写入 Mark Word，成功则直接进入同步块。
2. **偏向锁撤销**（`ObjectSynchronizer::revoke_and_rebias`）：必须在 SafePoint 执行，遍历持有线程的栈帧检查锁记录。
3. **轻量级锁膨胀**（`ObjectSynchronizer::inflate`）：创建 `ObjectMonitor` 结构体，将对象头的 Mark Word 替换为指向 ObjectMonitor 的指针（lock_bits = 10）。

**代码示例——不同竞争强度的锁行为观察：**

```java
// JDK 25: VirtualThread 环境下的锁行为演示
class LockUpgradeDemo {
    private final Object lock = new Object();
    private int counter = 0;

    // 场景 1：无竞争——轻量级锁或不加锁（锁消除）
    void singleThread() {
        synchronized (lock) {
            counter++;  // JIT 可能将此 synchronized 完全消除（锁消除）
        }
    }

    // 场景 2：低竞争——轻量级锁 + 自旋
    void lowContention() {
        synchronized (lock) {
            counter++;
            // 短暂的临界区，自旋等待即可，不会膨胀
        }
    }

    // 场景 3：高竞争——膨胀为重量级锁
    void highContention() {
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            for (int i = 0; i < 100_000; i++) {
                executor.submit(() -> {
                    synchronized (lock) {
                        counter++;  // 高并发下快速膨胀
                    }
                });
            }
        }
    }
}
// 使用 JFR 观察锁行为：
// java -XX:StartFlightRecording:filename=lock.jfr ...
// JFR 事件：jdk.JavaMonitorEnter, jdk.JavaMonitorWait
// 查看 jdk.MonitorInflation 事件数量，判断锁膨胀是否频繁
```

### 2.3 锁消除（Lock Elision）与锁粗化（Lock Coarsening）

JIT 编译器（C2 编译器）对 synchronized 有两项关键优化：

**锁消除**：基于逃逸分析（Escape Analysis），如果 JIT 确定一个同步对象不会被任何其他线程访问（不逃逸），则完全移除同步块。

```java
// 优化前：StringBuffer.append() 内部有 synchronized
String concat() {
    var sb = new StringBuffer();  // sb 不逃逸——局部变量
    sb.append("Hello");
    sb.append(" ");
    sb.append("World");
    return sb.toString();
}
// JIT 优化后：所有 synchronized 被消除，等效于 StringBuilder（非线程安全）
// 在 JDK 25 中，建议直接使用 StringBuilder
```

**锁粗化**：当 JIT 检测到连续的加锁/解锁操作，且中间没有其他线程可能获取该锁时，将多个锁块合并为一个。

```java
// 优化前：循环内每次迭代都获取/释放锁
for (int i = 0; i < 1000; i++) {
    synchronized (lock) {
        total += data[i];
    }
}
// JIT 粗化后，等效于：
synchronized (lock) {
    for (int i = 0; i < 1000; i++) {
        total += data[i];
    }
}
// 减少了 999 次锁获取/释放操作
```

**验证锁消除/粗化是否生效**：
- 使用 `-XX:+PrintEscapeAnalysis`（debug 版本 JVM）
- 使用 `-XX:+PrintEliminateLocks` 查看锁消除日志
- 通过 JMH 性能基准对比来间接验证

### 2.4 synchronized 在 Virtual Thread 中的行为

JDK 25 中 Virtual Thread 的 synchronized 块有特殊处理：**当一个 Virtual Thread 在 `synchronized` 内部被阻塞，JVM 会尝试将阻塞转移到平台线程层面（unmount），但如果阻塞发生在 `synchronized` 块内且需要等待另一个 synchronized 的锁，该 Virtual Thread 会 pin 住平台线程，导致平台线程也无法释放。**

```java
// 此模式在 Virtual Thread 中可能导致 pinned thread
// 解决方案：使用 ReentrantLock 替代 synchronized
var lock = new ReentrantLock();
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    executor.submit(() -> {
        lock.lock();
        try {
            // 临界区内的 IO 操作可能导致 pinning
            Thread.sleep(1000);  // sleep 在 synchronized 内会 pin
        } finally {
            lock.unlock();
        }
    });
}
// ReentrantLock 使用 LockSupport.park() 而非 synchronized 的 monitorenter
// park() 可以正确 unmount Virtual Thread
```

---

## 三、volatile——内存屏障与实现

### 3.1 可见性与有序性，但非原子性

`volatile` 提供两项保证：
1. **可见性**：一个线程对 volatile 变量的写入，会立即刷新到主内存；其他线程读取时总能读到最新值。
2. **有序性**：禁止 JIT 编译器和 CPU 对 volatile 变量相关的操作进行指令重排。

但 `volatile` **不保证原子性**。复合操作（如 `i++`）即使在 volatile 变量上，仍然不是原子的。

```java
class VolatileLimits {
    volatile int count = 0;

    void increment() {
        count++;  // 危险！等价于：int tmp = count; tmp = tmp + 1; count = tmp;
                  // 这三步之间可能被其他线程打断
    }

    // 正确做法：使用 synchronized 或 AtomicInteger
    void safeIncrement() {
        synchronized (this) {
            count++;
        }
    }
}
```

**volatile 的经典正确用法——DCL（Double-Checked Locking）单例**：

```java
class Singleton {
    // volatile 是关键：防止 new Singleton() 的重排序
    // new 过程：分配内存 → 调用构造函数初始化 → 赋值引用给 instance
    // 如果不加 volatile，步骤2和3可能重排，导致其他线程读到未初始化完成的对象
    private static volatile Singleton instance;

    static Singleton getInstance() {
        if (instance == null) {                   // (1) 第一次检查，无锁
            synchronized (Singleton.class) {
                if (instance == null) {           // (2) 第二次检查，加锁
                    instance = new Singleton();   // (3) volatile 阻止此处的重排序
                }
            }
        }
        return instance;
    }
}
```

### 3.2 四种内存屏障（Memory Barrier/Fence）

JMM 定义了四种屏障指令。在不同 CPU 架构上，JVM 会生成相应的硬件指令：

| 屏障类型 | 语义 | x86 实现 | ARM 实现 |
|----------|------|----------|----------|
| **LoadLoad** | Load1; LoadLoad; Load2 — 确保 Load1 的数据加载先于 Load2 | no-op（TSO 天然保证） | DMB ISH（Data Memory Barrier） |
| **StoreStore** | Store1; StoreStore; Store2 — 确保 Store1 的数据刷新先于 Store2 | 通常 no-op | DMB ST |
| **LoadStore** | Load1; LoadStore; Store2 — 确保 Load1 的数据加载先于 Store2 | 通常 no-op | DMB ISH |
| **StoreLoad** | Store1; StoreLoad; Load2 — 确保 Store1 对所有 CPU 可见后才执行 Load2 | **mfence** 或 locked 指令 | DMB ISH（最重的屏障，flush store buffer） |

**StoreLoad 是最重的屏障**：它要求将当前 CPU 的 store buffer 全部刷入缓存一致性域，通常需要几十到上百个 CPU 周期。这意味着 volatile 写的开销远大于 volatile 读。

**volatile 变量的屏障插入策略（JIT 编译时）**：

```
volatile 写之前：                      volatile 读之后：
    ... 普通写 ...                       ... 普通读 ...
    StoreStoreBarrier                    LoadLoadBarrier
    volatile 写                          volatile 读
    StoreLoadBarrier                     LoadStoreBarrier
    ... 普通读写 ...                      ... 普通读写 ...
```

### 3.3 VarHandle——JDK 9+ 的精细内存顺序控制

`VarHandle` 是 `Unsafe` 的类型安全替代品，也是 `AtomicInteger`、`ConcurrentHashMap` 等类的底层实现基础。JDK 25 中它支持更细粒度的内存顺序：

```java
import java.lang.invoke.MethodHandles;
import java.lang.invoke.VarHandle;

class VarHandleDemo {
    private int plainValue;       // 普通变量，无内存顺序保证
    private int releaseValue;     // 配合 setRelease/getAcquire 使用
    private int volatileValue;    // 等同于 volatile

    private static final VarHandle PLAIN, RELEASE, VOLATILE;

    static {
        try {
            var lookup = MethodHandles.lookup();
            PLAIN = lookup.findVarHandle(VarHandleDemo.class, "plainValue", int.class);
            RELEASE = lookup.findVarHandle(VarHandleDemo.class, "releaseValue", int.class);
            VOLATILE = lookup.findVarHandle(VarHandleDemo.class, "volatileValue", int.class);
        } catch (ReflectiveOperationException e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    // acquire-release 模式：比 volatile 更轻量
    // 写入线程在写入后插入 Release 屏障（StoreStore + LoadStore）
    void publishRelease(int value) {
        PLAIN.set(this, value);              // 普通写入（无屏障）
        RELEASE.setRelease(this, 1);         // Release 写入：保证 PLAIN 写入对其他线程可见
    }

    // 读取线程用 acquire 读取来同步
    int consumeRelease() {
        if ((int) RELEASE.getAcquire(this) == 1) {  // Acquire 读取
            return (int) PLAIN.get(this);           // 能读到 publishRelease 中的值
        }
        return -1;
    }

    // 完全 volatile 语义
    void volatileWrite(int v) { VOLATILE.setVolatile(this, v); }
    int volatileRead() { return (int) VOLATILE.getVolatile(this); }

    // CAS 操作
    boolean weakCas(int expected, int newVal) {
        return VOLATILE.compareAndSet(this, expected, newVal);
    }
}
```

**内存顺序对比表**：

| 访问模式 | 语义 | 开销（相对值） |
|----------|------|----------------|
| `get() / set()` | 无顺序保证，等同于普通变量 | 0 |
| `getOpaque() / setOpaque()` | 保证原子性但不保证顺序（仅自身可见，无屏障） | 极小 |
| `getAcquire() / setRelease()` | acquire-release 语义，适合生产者-消费者 | 中等 |
| `getVolatile() / setVolatile()` | 完全 volatile 语义，全屏障 | 较高 |

---

## 四、AQS 框架——AbstractQueuedSynchronizer 源码级分析

AQS 是整个 `java.util.concurrent.locks` 包的基石。`ReentrantLock`、`Semaphore`、`CountDownLatch`、`ReentrantReadWriteLock`、`ThreadPoolExecutor.Worker` 都在内部组合 AQS。

### 4.1 核心架构：state + CLH 变体队列

AQS 的两个核心数据结构：

**（1）volatile int state**：同步状态，通过 CAS 原子更新。
- `ReentrantLock`：state = 0（无锁）/ state > 0（加锁，值为重入次数）
- `Semaphore`：state = 剩余许可数量
- `CountDownLatch`：state = 还需 countDown 的次数

**（2）CLH 变体队列**：FIFO 双向链表。原始 CLH 锁是自旋锁，每个线程在前驱节点的标志位上自旋。AQS 将其改造为阻塞队列：节点中的线程不自旋，而是 park（`LockSupport.park()`）/unpark。

```
                        Node 内部结构
                        ┌──────────────────────────────────┐
                        │ waitStatus: int                  │
                        │   CANCELLED=1, SIGNAL=-1,        │
                        │   CONDITION=-2, PROPAGATE=-3     │
                        │ thread: Thread                   │
                        │ prev: Node  (前驱)               │
                        │ next: Node  (后继)               │
                        │ nextWaiter: Node (条件队列)      │
                        └──────────────────────────────────┘

        Head (dummy/哨兵)                       Tail
             |                                    |
             v                                    v
  +-----------+prev  +-----------+prev  +-----------+prev  +-----------+
  | waitStatus| <--- | waitStatus| <--- | waitStatus| <--- | waitStatus|
  |  (SIGNAL) |      |  (SIGNAL) |      |   (0)     |      |   (0)     |
  |  thread   | ---> |  thread   | ---> |  thread   | ---> |  thread   |
  |  (null)   | next |  (T1)     | next |  (T2)     | next |  (T3)     |
  +-----------+      +-----------+      +-----------+      +-----------+
    持有锁的引用        等待锁              等待锁              等待锁
    (已释放/哨兵)      (前驱是head)        (前驱是T1)          (前驱是T2)
```

**waitStatus 状态转换**：
- 0：初始状态
- `SIGNAL(-1)`：后继线程已 park，前驱释放锁时需要 unpark 后继
- `CANCELLED(1)`：节点取消等待（超时或中断）
- `CONDITION(-2)`：节点在 Condition 等待队列上
- `PROPAGATE(-3)`：共享模式下释放需要传播到下一个节点

### 4.2 独占模式源码级分析——acquire/release

**acquire 流程**（简化但保留核心逻辑的源码）：

```java
public final void acquire(int arg) {
    // ① 快速路径：tryAcquire（子类实现，通常是 CAS 抢 state）
    if (!tryAcquire(arg) &&
        // ② tryAcquire 失败 → 入队 + 自旋/阻塞
        acquireQueued(addWaiter(Node.EXCLUSIVE), arg))
        // ③ 如果在等待过程中被中断，补偿中断
        selfInterrupt();
}

// addWaiter：创建节点并入队
private Node addWaiter(Node mode) {
    var node = new Node(Thread.currentThread(), mode);  // mode = EXCLUSIVE or SHARED
    var pred = tail;
    if (pred != null) {             // 快速路径：队列已存在
        node.prev = pred;
        if (compareAndSetTail(pred, node)) {  // CAS 入队
            pred.next = node;       // 成功！但 pred.next 不是 CAS 的（允许失败）
            return node;            // 因为 pred 可能并发被取消，next 只是 "提示"
        }
    }
    enq(node);                      // 慢速路径：循环 CAS 或初始化队列
    return node;
}

private Node enq(final Node node) {
    for (;;) {
        var t = tail;
        if (t == null) {            // 队列为空，初始化
            if (compareAndSetHead(new Node()))  // CAS 设置 dummy head
                tail = head;
        } else {
            node.prev = t;
            if (compareAndSetTail(t, node)) {  // CAS 入队
                t.next = node;      // 同 addWaiter，next 是提示性的
                return t;
            }
        }
    }
}

// acquireQueued：入队后的自旋 + 阻塞循环
final boolean acquireQueued(final Node node, int arg) {
    boolean interrupted = false;
    try {
        for (;;) {
            final Node p = node.predecessor();
            // 如果前驱是 head，说明轮到我了（或即将轮到我），尝试获取
            if (p == head && tryAcquire(arg)) {
                setHead(node);      // 成为新的 dummy head
                p.next = null;      // 帮助 GC 回收旧 head
                return interrupted;
            }
            // shouldParkAfterFailedAcquire: 检查是否应该 park
            // 若是则设置前驱 waitStatus = SIGNAL
            // parkAndCheckInterrupt: LockSupport.park(this) 阻塞当前线程
            if (shouldParkAfterFailedAcquire(p, node) &&
                parkAndCheckInterrupt())
                interrupted = true;  // 记录中断，但继续循环（不退出！）
        }
    } catch (Throwable t) {
        cancelAcquire(node);       // 只有 tryAcquire 抛异常才走到这里
        if (interrupted) selfInterrupt();
        throw t;
    }
}
```

**release 流程**：

```java
public final boolean release(int arg) {
    if (tryRelease(arg)) {          // ① 子类释放 state
        var h = head;
        if (h != null && h.waitStatus != 0)
            unparkSuccessor(h);     // ② 唤醒后继节点
        return true;
    }
    return false;
}

private void unparkSuccessor(Node node) {
    int ws = node.waitStatus;
    if (ws < 0)                     // 清除 SIGNAL
        node.compareAndSetWaitStatus(ws, 0);

    var s = node.next;
    if (s == null || s.waitStatus > 0) {  // 后继被取消，从 tail 向前找有效节点
        s = null;
        for (var p = tail; p != node && p != null; p = p.prev)
            if (p.waitStatus <= 0)
                s = p;
    }
    if (s != null)
        LockSupport.unpark(s.thread);     // 唤醒等待线程
}
```

### 4.3 共享模式——acquireShared/releaseShared

共享模式允许多个线程同时获取同步状态。`Semaphore`、`CountDownLatch` 使用共享模式。

**关键区别**：当线程释放共享锁时，需要**传播（propagate）**唤醒——如果还有剩余资源，继续唤醒下一个等待者。

```java
public final void acquireShared(int arg) {
    if (tryAcquireShared(arg) < 0)   // 返回负值表示获取失败（资源不足）
        doAcquireShared(arg);        // 入队等待
}

private void doAcquireShared(int arg) {
    final Node node = addWaiter(Node.SHARED);
    boolean interrupted = false;
    try {
        for (;;) {
            final Node p = node.predecessor();
            if (p == head) {
                int r = tryAcquireShared(arg);  // 返回剩余资源数
                if (r >= 0) {
                    setHeadAndPropagate(node, r);  // 设置新 head 并传播唤醒
                    p.next = null;                 // help GC
                    return;
                }
            }
            if (shouldParkAfterFailedAcquire(p, node) && parkAndCheckInterrupt())
                interrupted = true;
        }
    } catch (Throwable t) {
        cancelAcquire(node);
        throw t;
    } finally {
        if (interrupted) selfInterrupt();
    }
}

// releaseShared 在 Semaphore.release() 中的体现
public final boolean releaseShared(int arg) {
    if (tryReleaseShared(arg)) {     // CAS 增加许可数
        doReleaseShared();           // 唤醒等待的线程并传播
        return true;
    }
    return false;
}
```

**setHeadAndPropagate 的传播逻辑**（核心）：

```java
private void setHeadAndPropagate(Node node, int propagate) {
    var h = head;
    setHead(node);                   // 将自己设为新 head
    // propagate > 0：还有剩余资源 → 继续传播
    // 或旧 head.waitStatus < 0：前驱已发信号
    if (propagate > 0 || h == null || h.waitStatus < 0 ||
        (h = head) == null || h.waitStatus < 0) {
        var s = node.next;
        if (s == null || s.isShared())
            doReleaseShared();       // 释放后续共享节点
    }
}
```

### 4.4 ReentrantLock：公平锁 vs 非公平锁（源码对比）

**非公平锁（NonfairSync）**——默认模式，吞吐量更高：

```java
final boolean nonfairTryAcquire(int acquires) {
    final var current = Thread.currentThread();
    int c = getState();
    if (c == 0) {
        // 不检查等待队列！直接 CAS 抢锁（插队）
        if (compareAndSetState(0, acquires)) {
            setExclusiveOwnerThread(current);
            return true;
        }
    }
    else if (current == getExclusiveOwnerThread()) { // 重入检查
        int nextc = c + acquires;
        if (nextc < 0) throw new Error("Maximum lock count exceeded");
        setState(nextc);
        return true;
    }
    return false;
}
```

**公平锁（FairSync）**——严格 FIFO：

```java
protected final boolean tryAcquire(int acquires) {
    final var current = Thread.currentThread();
    int c = getState();
    if (c == 0) {
        // 关键！先调用 hasQueuedPredecessors() 检查是否有排队的前辈
        if (!hasQueuedPredecessors() &&        // ← 这里不同！
            compareAndSetState(0, acquires)) {
            setExclusiveOwnerThread(current);
            return true;
        }
    }
    else if (current == getExclusiveOwnerThread()) {
        int nextc = c + acquires;
        if (nextc < 0) throw new Error("Maximum lock count exceeded");
        setState(nextc);
        return true;
    }
    return false;
}

// hasQueuedPredecessors: 高并发下的精妙实现
public final boolean hasQueuedPredecessors() {
    var t = tail;
    var h = head;
    Node s;
    // h != t → 队列非空
    // (s = h.next) == null → head 的 next 还没设置（并发 addWaiter 中的间隙）
    // s.thread != Thread.currentThread() → 第一个等待者不是当前线程
    return h != t &&
        ((s = h.next) == null || s.thread != Thread.currentThread());
}
```

**公平 vs 非公平的选择**：
- **非公平锁**：吞吐量高（减少线程切换），但可能造成某些线程饥饿。
- **公平锁**：严格 FIFO，无饥饿，但上下文切换开销大。

### 4.5 Condition——条件队列

AQS 的 `ConditionObject` 实现了 `Condition` 接口，提供类似 `Object.wait()/notify()` 但更强大的等待/通知机制。

**Condition 的核心是两个队列的协作**：

```
AQS 同步队列 (sync queue):               Condition 等待队列:
Head → Node(T1) → Node(T2) → Tail      firstWaiter → Node(T3) → Node(T4)
  ↑ 持有锁或等待锁                                 ↑ 在 condition 上等待
```

当调用 `condition.await()`：
1. 当前线程从同步队列出队（释放锁）
2. 当前线程节点加入 Condition 等待队列
3. `LockSupport.park()` 阻塞，等待 signal

当调用 `condition.signal()`：
1. 从 Condition 等待队列头部取出一个节点
2. 将该节点从 Condition 队列移到 AQS 同步队列尾部
3. 该线程重新参与锁竞争

```java
// Condition 实现有界阻塞队列（ArrayBlockingQueue 的核心逻辑）
class BoundedBuffer<T> {
    private final T[] items;
    private int putIndex, takeIndex, count;
    private final Lock lock = new ReentrantLock();
    private final Condition notFull = lock.newCondition();
    private final Condition notEmpty = lock.newCondition();

    BoundedBuffer(int capacity) {
        items = (T[]) new Object[capacity];
    }

    void put(T item) throws InterruptedException {
        lock.lock();
        try {
            while (count == items.length)   // 队列满，等待 "not full"
                notFull.await();
            items[putIndex] = item;
            if (++putIndex == items.length) putIndex = 0;
            count++;
            notEmpty.signal();              // 通知等待 "not empty" 的消费者
        } finally {
            lock.unlock();
        }
    }

    T take() throws InterruptedException {
        lock.lock();
        try {
            while (count == 0)              // 队列空，等待 "not empty"
                notEmpty.await();
            var item = items[takeIndex];
            if (++takeIndex == items.length) takeIndex = 0;
            count--;
            notFull.signal();               // 通知等待 "not full" 的生产者
            return item;
        } finally {
            lock.unlock();
        }
    }
}
```

### 4.6 CountDownLatch、Semaphore、CyclicBarrier 深度对比

| 工具 | AQS 模式 | state 含义 | 可重用 | 使用场景 |
|------|----------|------------|--------|----------|
| **CountDownLatch** | 共享模式 | 还需 countDown 的次数 | 否，一次性 | 等待 N 个任务完成 |
| **Semaphore** | 共享模式 | 剩余许可数 | 是（acquire/release） | 限流、资源池 |
| **CyclicBarrier** | 不基于 AQS（内部 ReentrantLock+Condition） | 等待线程数 | 是，可循环 | 多线程步调一致 |

**CountDownLatch 源码要点**：

```java
// tryAcquireShared: state == 0 时成功（唤醒所有等待者），否则失败（继续等待）
protected int tryAcquireShared(int acquires) {
    return (getState() == 0) ? 1 : -1;
}

// tryReleaseShared: CAS 递减 state，state 为 0 时返回 true 进行传播
protected boolean tryReleaseShared(int releases) {
    for (;;) {
        int c = getState();
        if (c == 0) return false;  // 已经是 0，不能再次 countDown
        int nextc = c - 1;
        if (compareAndSetState(c, nextc))
            return nextc == 0;     // 最后一次 countDown 时触发唤醒
    }
}
```

**Semaphore 源码要点**：

```java
// 非公平获取：直接 CAS 抢许可
final int nonfairTryAcquireShared(int acquires) {
    for (;;) {
        int available = getState();
        int remaining = available - acquires;
        if (remaining < 0 || compareAndSetState(available, remaining))
            return remaining;  // < 0 表示获取失败
    }
}
```

**CyclicBarrier 核心逻辑**：

```java
// await 简化实现
private int dowait(boolean timed, long nanos) {
    final var lock = this.lock;
    lock.lock();
    try {
        int index = --count;          // 递减计数
        if (index == 0) {             // 最后一个到达的线程
            final var command = barrierCommand;
            if (command != null) command.run();  // 执行回调
            nextGeneration();         // 重置 barrier，唤醒所有等待线程
            return 0;
        }
        // 不是最后一个 → 等待
        for (;;) {
            trip.await();             // trip = lock.newCondition()
            // 被唤醒后返回（由最后一个到达的线程调用 nextGeneration 时 signalAll）
        }
    } finally {
        lock.unlock();
    }
}
```

**实战示例——三个工具的综合使用**：

```java
// JDK 25 风格：并行数据预处理流水线
void parallelDataPipeline() throws Exception {
    var readyLatch = new CountDownLatch(3);   // 等待所有数据源就绪
    var semaphore = new Semaphore(5);          // 限流：最多 5 并发处理
    var barrier = new CyclicBarrier(3, () -> System.out.println("阶段完成"));

    try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
        for (int i = 0; i < 3; i++) {
            final int dsId = i;
            executor.submit(() -> {
                initDataSource(dsId);
                readyLatch.countDown();       // 数据源就绪
            });
        }

        readyLatch.await();  // 等待所有数据源就绪
        System.out.println("All data sources ready");

        for (int batch = 0; batch < 10; batch++) {
            for (int i = 0; i < 3; i++) {
                executor.submit(() -> {
                    try {
                        semaphore.acquire();
                        processBatch(batch);
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                    } finally {
                        semaphore.release();
                    }
                });
            }
            barrier.await();  // 等 3 个处理完成当前批次
        }
    }
}
```

---

## 五、ConcurrentHashMap——源码演进与实现分析

### 5.1 JDK 7：Segment 分段锁

JDK 7 的 `ConcurrentHashMap` 架构：

```
CHM (JDK 7)
├── segments: Segment<K,V>[]
│   ├── Segment[0] extends ReentrantLock
│   │   └── table: HashEntry<K,V>[]
│   │       ├── HashEntry → HashEntry → ...
│   │       └── HashEntry → ...
│   ├── Segment[1] ...
│   └── Segment[15] ...
```

- **并发度 = segments.length**（默认 16，构造时可指定）
- 定位逻辑：`hash(key) 的高位` 决定 Segment 索引，`hash(key) 的低位` 决定 Segment 内部 HashEntry 索引。
- 每个 Segment 独立加锁，不同 Segment 可并发操作。
- **问题**：Segments 数量固定（`concurrencyLevel`），不可动态扩容。单个 Segment 内哈希碰撞严重时，锁粒度仍然粗。定位到同一个 Segment 的所有操作都得排队。

### 5.2 JDK 8+：CAS + synchronized + 红黑树

JDK 8 完全重构了 CHM，取消了 Segment，改为对 **每个 bin（Node 数组槽位）的头节点** 加锁：

```
CHM (JDK 8+)
├── table: Node<K,V>[]
│   ├── Node[0]  → Node → Node → TreeNode (binCount >= 8 转为红黑树)
│   ├── Node[1]  → Node → ...
│   ├── Node[2]  → null (空 bin)
│   ├── ...
│   ├── Node[i]  → (链表 or TreeBin or ForwardingNode)
│   └── Node[N-1]
```

**关键设计**：
- **CAS 插入空 bin**：如果目标 bin 是 `null`，直接用 CAS 插入，无锁。
- **synchronized 锁头节点**：如果目标 bin 非空，用 `synchronized` 锁住 bin 的头节点，在 bin 内部插入。
- **红黑树**：bin 中节点数 >= 8 且 table.length >= 64 时，链表转为红黑树（`TreeBin` 封装红黑树根节点）；节点数 <= 6 时退化为链表。
- **get 操作完全无锁**：因为 `Node.val` 和 `table` 引用都是 `volatile` 的。

### 5.3 put 方法——完整源码级流程

```
put(K key, V value)
  │
  ├─ 1. hash = spread(key.hashCode())      // HASH_BITS = 0x7fffffff
  │     // spread = (h ^ (h >>> 16)) & HASH_BITS
  │     // 高位扰动 + 保证非负（负数有特殊含义：MOVED=-1, TREEBIN=-2, RESERVED=-3）
  │
  ├─ 2. for (Node<K,V>[] tab = table;;) {   // 无限循环 + CAS 重试
  │     │
  │     ├─ 2a. tab == null
  │     │     → initTable()                  // CAS 初始化 table（sizeCtl 作互斥信号）
  │     │       // while ((tab = table) == null) {
  │     │       //   if ((sc = sizeCtl) < 0) Thread.yield();  // 其他线程在初始化
  │     │       //   else if (U.compareAndSetInt(this, SIZECTL, sc, -1)) {
  │     │       //     // 获得初始化权，创建数组
  │     │       //     table = tab = new Node[n];
  │     │       //     sc = n - (n >>> 2);  // 0.75n
  │     │       //     sizeCtl = sc;         // 设为下次扩容阈值
  │     │       //   }
  │     │       // }
  │     │
  │     ├─ 2b. tab[i = (n-1) & hash] == null
  │     │     → casTabAt(tab, i, null, new Node<>(hash, key, value))
  │     │       // CAS 成功 → break（无锁快速路径！）
  │     │       // CAS 失败 → 继续循环
  │     │
  │     ├─ 2c. tab[i].hash == MOVED (-1)
  │     │     → helpTransfer(tab, f)         // 当前 bin 是 ForwardingNode，帮忙扩容
  │     │
  │     └─ 2d. else → synchronized (f = tab[i]) {  // 锁住桶头节点
  │              if (tabAt(tab, i) == f) {   // double check
  │                  if (fh >= 0) {          // 链表
  │                      binCount = 1;
  │                      for (Node e = f;; ++binCount) {
  │                          // 遍历链表：key 相同则替换，否则插入尾部
  │                          if (e.hash == hash && key.equals(e.key)) {
  │                              oldVal = e.val;
  │                              e.val = value;  // 只替换值，不改变链表结构
  │                              break;
  │                          }
  │                          Node pred = e;
  │                          if ((e = e.next) == null) {
  │                              pred.next = new Node(hash, key, value);
  │                              break;
  │                          }
  │                      }
  │                  } else if (f instanceof TreeBin) {  // 红黑树
  │                      binCount = 2;
  │                      // TreeBin.putTreeVal → 红黑树插入/替换
  │                  }
  │              }
  │              if (binCount >= TREEIFY_THRESHOLD)  // >= 8
  │                  treeifyBin(tab, i);             // 链表→红黑树
  │          }
  │     }
  │
  └─ 3. addCount(1L, binCount)              // 更新 size，检查是否需要扩容
        // 内部：CAS 更新 baseCount 或 CounterCell 数组
        // 如果 size >= sizeCtl(扩容阈值)，调用 transfer()
```

### 5.4 get 方法——无锁读取的实现基础

```java
public V get(Object key) {
    Node<K,V>[] tab; Node<K,V> e, p; int n, eh; K ek;
    int h = spread(key.hashCode());              // 计算 hash
    if ((tab = table) != null && (n = tab.length) > 0 &&
        (e = tabAt(tab, (n - 1) & h)) != null) {  // tabAt = U.getObjectVolatile(保证可见性)
        if ((eh = e.hash) == h) {
            if ((ek = e.key) == key || (ek != null && key.equals(ek)))
                return e.val;                    // 头节点命中——O(1)
        }
        else if (eh < 0)                         // hash < 0: TreeBin 或 ForwardingNode
            return (p = e.find(h, key)) != null ? p.val : null;  // TreeBin.find 内部无锁
        while ((e = e.next) != null) {           // 链表遍历
            if (e.hash == h &&
                ((ek = e.key) == key || (ek != null && key.equals(ek))))
                return e.val;
        }
    }
    return null;
}
```

**get 无锁的三个保证**：
1. `table` 是 `volatile` ——写线程修改 `table`（扩容后切换引用）对读线程立即可见。
2. `Node.val` 是 `volatile` ——写线程的 `e.val = value` 对读线程立即可见。
3. `Node.next` 是 `volatile` ——链表遍历过程中不会被破坏。

### 5.5 扩容机制——transfer 与 sizeCtl 状态机

`sizeCtl` 是一个多义字段：

```
sizeCtl 值                        含义
───────────────────────────────────────────────────
 0                                初始值（使用默认容量）
-1                               正在初始化 table
-(1 + nThreads)                  nThreads 个线程正在协助扩容（仅低16位存储线程数）
>0 (初始化后 / 扩容完成)          下次扩容的阈值 = 0.75 * table.length
```

**扩容的并发控制**：

```java
// addCount 中的关键逻辑（简化）
private final void addCount(long x, int check) {
    // ... CAS 更新 CounterCell 或 baseCount ...

    // 检查是否需要扩容
    int sc;
    while (s >= (sc = sizeCtl) && (tab = table) != null && tab.length < MAXIMUM_CAPACITY) {
        int n = tab.length, rs = resizeStamp(n);   // 生成扩容戳（保证唯一性）
        if (sc < 0) {                              // 有线程在扩容
            // 检查扩容是否结束或是否需要帮忙
            if ((sc >>> RESIZE_STAMP_SHIFT) != rs || sc == rs + 1 ||
                sc == rs + MAX_RESIZERS || (nt = nextTable) == null ||
                transferIndex <= 0)
                break;
            if (U.compareAndSetInt(this, SIZECTL, sc, sc + 1))  // 线程数+1
                transfer(tab, nt);                  // 加入扩容
        }
        // 第一个发起扩容的线程
        else if (U.compareAndSetInt(this, SIZECTL, sc,
                 (rs << RESIZE_STAMP_SHIFT) + 2))   // 低16位=2（1+第一个线程）
            transfer(tab, null);                    // 开始扩容
    }
}
```

**transfer 方法的核心流程**：

```
transfer(tab, nextTab)
  │
  ├─ 1. 如果 nextTab == null，初始化新数组（大小为旧数组的 2 倍）
  │
  ├─ 2. 多线程并发迁移：
  │     │  transferIndex = n（旧数组长度，从后往前分配迁移区间）
  │     │  每个线程通过 CAS 获取一段迁移任务：
  │     │    stride = min(NCPU > 1 ? (n >>> 3) / NCPU : n, MIN_TRANSFER_STRIDE=16)
  │     │    bound = transferIndex - stride
  │     │    CAS 更新 transferIndex = bound
  │     │    → 该线程负责迁移 [bound, transferIndex) 区间的 bin
  │     │
  │     └─ 对于区间内的每个 bin i：
  │          ├─ tab[i] == null → casTabAt(tab, i, null, ForwardingNode) // 标记已迁移
  │          ├─ tab[i] 是 ForwardingNode → 跳过
  │          └─ else → synchronized (tab[i]) { // 锁住桶
  │                    │ 将链表拆分为两个子链表（根据 hash & n 的最高位）
  │                    │ 低位链表 → newTab[i]
  │                    │ 高位链表 → newTab[i + n]
  │                    │ 设置 ForwardingNode(tab[i])
  │                  }
  │
  └─ 3. 所有线程迁移完成后，最后一个线程：
         table = nextTab
         sizeCtl = 1.5 * n  (下一次扩容阈值)
```

**为什么能做无锁的并发迁移**：每个线程锁住独立的 bin 进行迁移，不同 bin 之间无竞争。`ForwardingNode` 充当"已迁移"的哨兵——后续 `put` 看到它会自动 `helpTransfer`。

---

## 六、原子类——CAS 原理与进化路线

### 6.1 CAS 的 CPU 指令级实现

CAS（Compare-And-Swap）是一条 CPU 原子指令：
- **x86**：`lock cmpxchg`（带 lock 前缀的 compare-and-exchange 指令）
- **ARM**：`LDREX` / `STREX`（Load-Linked / Store-Conditional 指令对）
- **RISC-V**：`lr.w` / `sc.w`

Java 通过 JNI 调用 `Unsafe.compareAndSwapInt()`，最终调用对应的 CPU 指令：

```java
// sun.misc.Unsafe 的三个核心 CAS 方法
public final native boolean compareAndSwapInt(Object o, long offset, int expected, int x);
public final native boolean compareAndSwapLong(Object o, long offset, long expected, long x);
public final native boolean compareAndSwapObject(Object o, long offset, Object expected, Object x);
```

**JDK 9+ 有了 VarHandle 后，原子类的底层实现从 Unsafe 迁移到 VarHandle**：

```java
// AtomicInteger (JDK 9+) 的 CAS 实现
public class AtomicInteger extends Number implements java.io.Serializable {
    private static final VarHandle VALUE;

    static {
        try {
            VALUE = MethodHandles.lookup()
                .findVarHandle(AtomicInteger.class, "value", int.class);
        } catch (ReflectiveOperationException e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    private volatile int value;

    public final boolean compareAndSet(int expectedValue, int newValue) {
        return VALUE.compareAndSet(this, expectedValue, newValue);
    }
    // compareAndSet 在支持 compareAndExchange 的平台上
    // 直接生成一条 CPU CAS 指令，无需额外屏障
}
```

### 6.2 ABA 问题与解决方案

**ABA 问题的本质**：CAS 只比较值是否改变，不关心中间是否变过。如果某个变量从 A 变为 B 再变回 A，CAS 仍然认为它没有变化。

```
初始值 = A
  Thread-1:  读取 A → 准备 CAS(A → D) → 被挂起
  Thread-2:  CAS(A → B) 成功
  Thread-2:  CAS(B → A) 成功  (值回到 A，但语义已不同)
  Thread-1:  恢复 → CAS(A → D) 成功！
  → Thread-1 不知道中间发生过变化
```

**ABA 的典型危害场景**：无锁栈的 pop 操作。

```
栈状态：A → B → C

Thread-1: 准备 pop (期望 head=A, newHead=B) → 被挂起
Thread-2: pop A, pop B → 栈只剩 C
Thread-2: push A → 栈: A → C
Thread-1: 恢复 → CAS(head, A, B) 成功！
  结果栈 = B → C，但 B 已经被 pop 过了！
```

**解决方案——AtomicStampedReference（版本号）**：

```java
// 使用 stamp（版本号）解决 ABA
var ref = new AtomicStampedReference<String>("A", 0);

// Thread-1: 读取当前值和版本
int[] stampHolder = new int[1];
String current = ref.get(stampHolder);     // current="A", stamp=0
int stamp = stampHolder[0];

// ... 中间可能被 Thread-2 修改 ...

// Thread-1: CAS 带着版本号
boolean ok = ref.compareAndSet(current, "C", stamp, stamp + 1);
// 如果 Thread-2 做过 A→B→A (stamp: 0→1→2)，则 stamp 0 不匹配 → CAS 失败

// 另一个方案：AtomicMarkableReference（布尔标记，适合"是否用过"场景）
var markableRef = new AtomicMarkableReference<>("data", false);
markableRef.compareAndSet("data", "updated", false, true);
```

### 6.3 LongAdder ——热点分离与伪共享消除

`LongAdder` 解决了 `AtomicLong` 在高并发下的 **缓存行竞争（cache line contention）** 问题。

**AtomicLong 为什么在高并发下慢**：

```
所有线程 CAS 同一个 volatile long 变量
→ 缓存一致性协议（MESI）要求每次写都使其他 CPU 核心的 cache line 失效
→ 每个线程在 CAS 之间都必须重新从主存/其他缓存加载
→ N 个线程同时 CAS，每次只有 1 个成功，N-1 个失败自旋
```

**LongAdder 的设计——Cell 分散写入**：

```
LongAdder 内部结构：
    base: volatile long           ← 低竞争时直接 CAS base
    cells: Cell[]                 ← 高竞争时分散写入
    cellsBusy: volatile int       ← 0=未锁，1=正在操作 cells

Cell 结构（@Contended 填充避免伪共享）：
    @jdk.internal.vm.annotation.Contended
    static final class Cell {
        volatile long value;
        // @Contended 会在 value 前后加 padding 到独立 cache line
        // 确保不同 Cell 的 value 不在同一 cache line 上
    }
```

**LongAdder.add() 的核心流程**：

```java
public void add(long x) {
    Cell[] cs; long b, v; int m; Cell c;
    if ((cs = cells) != null || !casBase(b = base, b + x)) {  // 快速路径：CAS base
        boolean uncontended = true;
        // 慢速路径：尝试 CAS Cell
        if (cs == null || (m = cs.length - 1) < 0 ||
            (c = cs[getProbe() & m]) == null ||
            !(uncontended = c.cas(v = c.value, v + x)))
            longAccumulate(x, null, uncontended);  // Cell 初始化/扩容/重试
    }
}

// longAccumulate: 与 CHM 的 addCount 类似
// 使用 ThreadLocalRandom.getProbe() 获取线程的探针值（伪随机）
// 探针值决定线程写入哪个 Cell
// 竞争严重时自动扩容 Cell 数组
```

**性能对比示意**（10 线程，各执行 100 万次 increment）：

```
AtomicLong:  ~3500ms   (所有线程争抢同一 cache line)
LongAdder:   ~150ms    (几乎零竞争，各写各的 Cell)
```

**选型建议**：
- **统计计数类**（如 QPS 计数器、请求总数）→ `LongAdder` / `DoubleAdder`
- **需要精确 CAS 控制**（如自定义同步器、无锁数据结构）→ `AtomicLong` / `AtomicReference`
- **需要 get-and-update**（如唯一 ID 生成器）→ `AtomicLong`
- **JDK 25 新增**：`LongAccumulator` / `DoubleAccumulator` 支持自定义聚合函数

```java
// LongAccumulator: 求最大值
var maxAccumulator = new LongAccumulator(Long::max, Long.MIN_VALUE);
// 多线程并发 accumulate
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (int i = 0; i < 1000; i++) {
        executor.submit(() -> maxAccumulator.accumulate(ThreadLocalRandom.current().nextLong()));
    }
}
long maxValue = maxAccumulator.get();  // 所有线程写入的最大值
```

---

## 七、CompletableFuture——声明式异步编排

### 7.1 运行模型

`CompletableFuture<T>` 实现了 `Future<T>` 和 `CompletionStage<T>`。它的核心是一个 **依赖图（DAG）**：每个 CF 维护一个 `Completion` 栈（后进先出），当 CF 完成时，会触发栈中的回调执行。

```
CompletableFuture 的内部 DAG:

CF-A (supplyAsync - 获取用户)
  |
  ├─→ thenApply (转换) → CF-B
  |                        |
  ├─→ thenCompose (展平) → CF-C
  |
  └─→ CF-D (thenCombine)  ← 等待 CF-A 和另一个 CF-X 都完成
```

### 7.2 核心组合操作符详解

```java
// ====== 1. thenApply: T → U（同步/异步转换）======
CompletableFuture
    .supplyAsync(() -> fetchUserId(name))        // CF<String>
    .thenApply(id -> "user:" + id);              // CF<String> 同步转换

// ====== 2. thenCompose: T → CF<U>（展平，类似 flatMap）======
CompletableFuture
    .supplyAsync(() -> fetchUserId(name))         // CF<String>
    .thenCompose(id -> fetchUserProfile(id));     // CF<Profile>
// 如果使用 thenApply 会得到 CF<CF<Profile>>，而 thenCompose 展平为 CF<Profile>

// ====== 3. thenCombine: (CF<T>, CF<U>) → CF<V>（合并两个独立结果）======
var priceFuture = CompletableFuture.supplyAsync(() -> fetchPrice("AAPL"));
var newsFuture = CompletableFuture.supplyAsync(() -> fetchNews("AAPL"));
priceFuture.thenCombine(newsFuture, (price, news) ->
    new StockSummary(price, news));               // CF<StockSummary>

// ====== 4. thenAccept: 消费结果，不返回======
userFuture.thenAccept(user -> System.out.println("Got user: " + user));

// ====== 5. thenRun: 不关心结果，只执行后续动作======
allDone.thenRun(() -> System.out.println("All tasks completed"));
```

### 7.3 异常处理——exceptionally vs handle vs whenComplete

```java
CompletableFuture
    .supplyAsync(() -> {
        if (Math.random() > 0.5)
            throw new RuntimeException("Fetch failed");
        return "data";
    })
    // 方案 A: exceptionally —— 仅处理异常，正常结果原封不动传递
    .exceptionally(ex -> {
        log.error("Failed: {}", ex.getMessage());
        return "FALLBACK";                       // 异常恢复为默认值
    })
    // 方案 B: handle —— 正常和异常都处理，两者都能转换结果
    .handle((result, ex) -> {
        if (ex != null)
            return "Error: " + ex.getMessage();  // 异常分支
        return "Success: " + result;             // 正常分支
    })
    // 方案 C: whenComplete —— 观察结果+异常，但不改变结果
    .whenComplete((result, ex) -> {              // 类似 finally
        if (ex != null) log.error("Failed", ex);
        else log.info("Completed: {}", result);
    });
```

**异常传播规则**：
- 链式调用中，如果某个阶段抛出异常且没有 `exceptionally/handle` 处理，异常会沿着 DAG 传播到 `join()/get()` 调用处。
- `exceptionally` 是 **恢复点**——它之后的下游阶段看到的是恢复后的值。
- `handle` 是 **转换点**——无论之前成败，它都会执行并产出一个新结果。

### 7.4 并发控制——allOf / anyOf

```java
// allOf: 等待所有任务完成（注意：allOf 返回 CF<Void>，不包含结果）
record Dashboard(User user, List<Order> orders, int points) {}

var userF = CompletableFuture.supplyAsync(() -> fetchUser(userId));
var ordersF = CompletableFuture.supplyAsync(() -> fetchOrders(userId));
var pointsF = CompletableFuture.supplyAsync(() -> fetchPoints(userId));

// JDK 25 风格：使用 allOf + thenApply 提取结果
var dashboard = CompletableFuture
    .allOf(userF, ordersF, pointsF)
    .thenApply(_ -> {
        // allOf 返回后，所有子 CF 一定完成了——join() 不会阻塞
        return new Dashboard(userF.join(), ordersF.join(), pointsF.join());
    })
    .join();  // 等待整体完成

// anyOf: 只要有一个完成就继续（竞速）
var fastest = CompletableFuture
    .anyOf(
        CompletableFuture.supplyAsync(() -> callService("cdm-hy-1")),
        CompletableFuture.supplyAsync(() -> callService("cdm-hy-2")),
        CompletableFuture.supplyAsync(() -> callService("cdm-hy-3"))
    )
    .thenApply(result -> (String) result)
    .join();
```

### 7.5 超时控制——orTimeout / completeOnTimeout（JDK 9+）

```java
var result = CompletableFuture
    .supplyAsync(() -> slowServiceCall())
    .orTimeout(3, TimeUnit.SECONDS)              // 超时抛 TimeoutException
    // .completeOnTimeout("FALLBACK", 3, TimeUnit.SECONDS)  // 超时返回默认值
    .exceptionally(ex -> {
        if (ex instanceof TimeoutException)
            return "TIMEOUT_FALLBACK";
        return "ERROR_FALLBACK";
    })
    .join();
```

### 7.6 自定义线程池与 Virtual Threads

```java
// JDK 25 最佳实践：使用 VirtualThreadPerTaskExecutor
// Virtual Thread 几乎是无限的，IO 密集场景无需配置线程池大小
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    var futures = IntStream.range(0, 500)
        .mapToObj(i -> CompletableFuture.supplyAsync(() -> {
            // IO 密集型操作——Virtual Thread 非常合适
            return callExternalApi(i);
        }, executor))
        .toList();

    // 等待所有完成
    CompletableFuture.allOf(futures.toArray(CompletableFuture[]::new)).join();
}

// 对于 CPU 密集型任务，仍应使用固定大小的平台线程池
try (var executor = Executors.newFixedThreadPool(
        Runtime.getRuntime().availableProcessors())) {
    // CPU 密集型计算
}
```

### 7.7 与 Structured Concurrency 的选择

JDK 25 的 Structured Concurrency（JEP 480, Preview）提供了一种结构化的并发范式：

```java
// StructuredTaskScope: 父任务显式管理子任务生命周期
try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
    var userTask = scope.fork(() -> fetchUser(userId));
    var ordersTask = scope.fork(() -> fetchOrders(userId));
    var pointsTask = scope.fork(() -> fetchPoints(userId));

    scope.join();              // 等待所有子任务完成
    scope.throwIfFailed();     // 任一子任务失败则抛出异常

    return new Dashboard(
        userTask.get(),        // 已确认完成，get() 不阻塞
        ordersTask.get(),
        pointsTask.get()
    );
}
// scope 关闭时自动取消未完成的子任务
```

**选择指南**：

| 场景 | 推荐工具 |
|------|----------|
| 异步事件驱动的链式编排 | `CompletableFuture` |
| 请求处理中的多数据源并行加载（需要自动取消） | `StructuredTaskScope` |
| 批量数据处理中的分治并行 | `ForkJoinPool` + `RecursiveTask` |
| 大量 IO 并发（不关心顺序和生命周期） | `Executors.newVirtualThreadPerTaskExecutor()` |

---

## 八、ForkJoinPool——工作窃取算法

### 8.1 工作窃取的设计动机

传统的 `ThreadPoolExecutor` 使用共享的 `BlockingQueue`，所有线程从同一个队列取任务——高并发下队列成为瓶颈。ForkJoinPool 采用 **工作窃取（Work-Stealing）** 算法解决这个问题：

每个工作线程维护一个 **双端队列（deque）**：
- 线程自己从头部取任务（LIFO，利用缓存热度）→ `push` / `pop`
- 空闲线程从其他线程的尾部偷任务（FIFO，偷到的一般是大的分治任务）→ `poll`

```
Worker-0 deque (head→tail):        Worker-1 deque:
  push/pop (LIFO, 自己)              push/pop (LIFO, 自己)
  ┌──────┬──────┬──────┬──────┐      ┌──────┬──────┐
  │ T1   │ T2   │ T3   │ T4   │      │ T5   │ T6   │
  └──────┴──────┴──────┴──────┘      └──────┴──────┘
    ↑               ↑                  ↑       ↑
    pop (自己)      poll (被偷)        pop     poll

Worker-2 (空闲，尝试从其他 Worker 偷任务):
  → scan Worker-0: 从尾部 poll T4
  → scan Worker-1: 从尾部 poll T6
```

### 8.2 ForkJoinPool 内部结构（简化）

```
ForkJoinPool
├── workQueues: WorkQueue[]          ← 所有工作队列
│   ├── WorkQueue[0..N-1]           ← N=并行度
│   │   ├── array: ForkJoinTask<?>[]  ← 环形数组（初始 8192，动态扩容）
│   │   ├── top: 头部指针
│   │   ├── base: 尾部指针
│   │   └── owner: Thread
│   └── ...
├── ctl: volatile long                ← 控制字段（状态 + 线程数）
├── stealCount: volatile long         ← 总偷取次数（用于监控）
└── common: static ForkJoinPool       ← 全局 commonPool
```

### 8.3 RecursiveTask 实战——分治归并排序

```java
class MergeSortTask extends RecursiveTask<int[]> {
    private static final int THRESHOLD = 1000;
    private final int[] array, temp;
    private final int lo, hi;

    MergeSortTask(int[] array, int[] temp, int lo, int hi) {
        this.array = array;
        this.temp = temp;
        this.lo = lo;
        this.hi = hi;
    }

    @Override
    protected int[] compute() {
        if (hi - lo <= THRESHOLD) {
            Arrays.sort(array, lo, hi);         // 小数组直接排序
            return array;
        }
        int mid = (lo + hi) >>> 1;
        var left = new MergeSortTask(array, temp, lo, mid);
        var right = new MergeSortTask(array, temp, mid, hi);
        left.fork();                             // 异步执行左半
        right.compute();                         // 同步执行右半
        left.join();                             // 等待左半
        merge(array, temp, lo, mid, hi);         // 合并两个已排序的一半
        return array;
    }

    private void merge(int[] a, int[] t, int lo, int mid, int hi) {
        System.arraycopy(a, lo, t, lo, hi - lo);
        int i = lo, j = mid, k = lo;
        while (i < mid && j < hi)
            a[k++] = (t[i] <= t[j]) ? t[i++] : t[j++];
        while (i < mid) a[k++] = t[i++];
        while (j < hi) a[k++] = t[j++];
    }
}

// 使用
var pool = new ForkJoinPool();  // 并行度 = availableProcessors
var array = ThreadLocalRandom.current().ints(10_000_000).toArray();
var result = pool.invoke(new MergeSortTask(array, new int[array.length], 0, array.length));
```

### 8.4 与 Parallel Stream 的关系

`parallel()` 流底层使用 **ForkJoinPool.commonPool()**，默认并行度为 `Runtime.availableProcessors() - 1`。

```java
// 这两个操作使用相同的 commonPool
list.parallelStream().map(this::cpuHeavyOperation).toList();

// care: 如果 commonPool 被阻塞任务耗光，整个 JVM 的并行流都会停滞
// 解决方案：自定义 ForkJoinPool
ForkJoinPool customPool = new ForkJoinPool(8);
try {
    customPool.submit(() ->
        list.parallelStream().map(this::cpuHeavyOperation).toList()
    ).get();
} finally {
    customPool.shutdown();
}
```

**JDK 25 替代方案**——用 Virtual Threads 替代 commonPool 的 IO 阻塞场景：

```java
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    var futures = items.stream()
        .map(item -> executor.submit(() -> processItem(item)))
        .toList();
    var results = futures.stream().map(f -> {
        try { return f.get(); }
        catch (Exception e) { throw new RuntimeException(e); }
    }).toList();
}
```

---

## 九、StampedLock——乐观读及其比较

### 9.1 三种锁模式

`StampedLock` 是 JDK 8 引入的读写锁增强版，支持三种模式：

| 模式 | 获取方法 | 释放方法 | 特性 |
|------|----------|----------|------|
| **写锁（Write）** | `writeLock()` | `unlockWrite(stamp)` | 独占，阻塞所有读写 |
| **悲观读（Read）** | `readLock()` | `unlockRead(stamp)` | 共享，阻塞写 |
| **乐观读（Optimistic）** | `tryOptimisticRead()` | 无需释放 | **完全不阻塞**，通过 validate 验证 |

关键概念：`stamp` 是每次锁操作返回的 **票据（long 类型）**，释放锁时必须传入对应 stamp。StampedLock **不可重入**。

### 9.2 乐观读模式——无锁读的核心

```java
class StampedPoint {
    private double x, y;
    private final StampedLock lock = new StampedLock();

    // 乐观读：适用于读多写少的极致优化
    double distanceFromOrigin() {
        // 步骤 1：获取乐观读 stamp（不阻塞任何线程）
        long stamp = lock.tryOptimisticRead();

        // 步骤 2：无锁读取（可能读到不一致的值）
        double currentX = x;
        double currentY = y;

        // 步骤 3：验证——在读取期间是否有写操作发生？
        // validate 检查 stamp 是否仍然有效
        // 如果期间有写锁获取，stamp 失效，返回 false
        if (!lock.validate(stamp)) {
            // 乐观读失败→降级为悲观读
            stamp = lock.readLock();
            try {
                currentX = x;
                currentY = y;
            } finally {
                lock.unlockRead(stamp);
            }
        }

        return Math.sqrt(currentX * currentX + currentY * currentY);
    }

    // 写操作（移动点）
    void move(double deltaX, double deltaY) {
        long stamp = lock.writeLock();
        try {
            x += deltaX;
            y += deltaY;
        } finally {
            lock.unlockWrite(stamp);
        }
    }

    // 乐观读+写（条件写入）：先乐观检查，必要时升级为写锁
    void moveIfAtOrigin(double deltaX, double deltaY) {
        long stamp = lock.readLock();  // 先用悲观读
        try {
            while (x == 0.0 && y == 0.0) {
                long ws = lock.tryConvertToWriteLock(stamp);  // 尝试升级
                if (ws != 0L) {
                    stamp = ws;  // 升级成功，现在持有写锁
                    x = deltaX;
                    y = deltaY;
                    return;
                } else {
                    lock.unlockRead(stamp);       // 升级失败，释放读锁
                    stamp = lock.writeLock();     // 显式获取写锁
                }
            }
        } finally {
            lock.unlock(stamp);  // 通用释放（根据 stamp 判断释放读还是写锁）
        }
    }
}
```

### 9.3 StampedLock vs ReentrantReadWriteLock

| 特性 | ReentrantReadWriteLock | StampedLock |
|------|------------------------|-------------|
| 可重入 | 支持（内部计数器） | 不支持 |
| 锁升级（读→写） | 不允许（会导致死锁） | 支持 `tryConvertToWriteLock()` |
| 锁降级（写→读） | 支持 | 支持 `tryConvertToReadLock()` |
| 乐观读 | 不支持 | 支持——核心优势 |
| Condition | 支持 `newCondition()` | 不支持 |
| 公平性 | 支持公平/非公平 | 非公平（无公平模式选项） |
| 适用场景 | 读和写都不可忽略 | 读多写少（读的占比 > 90%） |

### 9.4 StampedLock 的注意事项

1. **不可重入**：同一个线程在持有 StampedLock 时再次调用 `writeLock()` 会导致死锁。
2. **没有 Condition**：无法像 ReentrantLock 那样做 `await/signal`。
3. **需要保存和传递 stamp**：每个锁操作返回的 stamp 必须正确用于释放。
4. **异步模式的 asReadWriteLock()**：`StampedLock.asReadWriteLock()` 可以将 StampedLock 包装成一个 `ReadWriteLock`，适配现有接口。

---

## 实战总结：并发工具决策树

```
场景评估
│
├─ 需要线程间协调（等待/通知）？
│   ├─ 一次性等待多个任务完成 → CountDownLatch
│   ├─ 可重用的多线程同步点 → CyclicBarrier（或 Phaser）
│   └─ 生产者-消费者队列 → BlockingQueue + Condition
│
├─ 互斥（Mutual Exclusion）
│   ├─ 简单、临界区短 → synchronized（JIT 优化最充分）
│   ├─ 需要 tryLock / 公平锁 / 多个 Condition → ReentrantLock
│   └─ Virtual Thread 环境下 → 优先 ReentrantLock（避免 pinning）
│
├─ 读写分离
│   ├─ 读多写少、极致性能、不需可重入 → StampedLock（乐观读模式）
│   ├─ 读写都频繁、需要可重入 → ReentrantReadWriteLock
│   └─ 超高并发、数据结构是 Map → ConcurrentHashMap
│
├─ 计数/统计（高并发累加）
│   ├─ 只需最终 sum → LongAdder / DoubleAdder
│   ├─ 需要即时精确 get → AtomicLong / AtomicInteger
│   └─ 需要自定义聚合函数 → LongAccumulator / DoubleAccumulator
│
├─ 并发限制
│   ├─ 限制并发数 → Semaphore
│   └─ 循环屏障 → CyclicBarrier
│
├─ 异步编排
│   ├─ 声明式链式组合，事件驱动 → CompletableFuture
│   │   ├─ 异常恢复 → exceptionally / handle
│   │   ├─ 并发等待全部 → allOf
│   │   └─ 竞速任一 → anyOf
│   ├─ 需要严格生命周期+自动取消 → StructuredTaskScope（Structured Concurrency）
│   └─ CPU 密集型分治 → ForkJoinPool + RecursiveTask
│
└─ 海量 IO 并发
    └─ Executors.newVirtualThreadPerTaskExecutor()
```

---

## 常见问题

**Q1: synchronized 和 ReentrantLock 如何选择？**

优先使用 `synchronized`（JIT 有锁消除、锁粗化、锁降级等大量优化），只在需要以下特性时用 `ReentrantLock`：
- `tryLock()` 非阻塞尝试
- `lockInterruptibly()` 可中断获取
- 公平锁
- 多个 `Condition` 等待队列
- 在 Virtual Thread 环境中避免 pinning

**Q2: ConcurrentHashMap 在 JDK 8 后为什么比 Hashtable 快那么多？**

Hashtable 对所有操作加 `synchronized`（锁整个表）。ConcurrentHashMap：
- `get()` 完全无锁（`Node.val` 是 volatile）
- `put()` 只在目标 bin 有数据时锁头节点，空 bin 直接 CAS
- 扩容是多线程并发迁移的
- 统计计数用 `CounterCell` 分散热点，类似 `LongAdder`

**Q3: JDK 25 Virtual Thread 能否替代 ForkJoinPool？**

不能。ForkJoinPool 专注于 **CPU 密集型分治计算**（工作窃取算法），Virtual Threads 优化 **IO 密集型海量并发阻塞**。两者互补。

**Q4: CompletableFuture.join() 和 get() 的区别？**

- `get()` 抛出受检异常（`ExecutionException`、`InterruptedException`），需要 try-catch。
- `join()` 抛出非受检异常（`CompletionException`），适合声明式链式调用，本质是对 `get()` 的包装。

**Q5: 为什么 JDK 15 默认关闭偏向锁？**

偏向锁为"一个对象只有一个线程反复获取锁"的场景优化。现代应用大量使用线程池，对象生命周期短，锁竞争模式不规则，偏向锁的撤销代价（需在 SafePoint 暂停原持有线程检查）经常超过收益。

**Q6: LongAdder 的 sum() 为什么不保证强一致性？**

`LongAdder.sum()` 读取 `base` 和所有 `Cell` 时没有加锁，读取过程中其他线程可能正在写。这意味着 `sum()` 返回的可能是近似值——这正是它适合统计场景的原因（允许微小的不精确换取超高性能）。

---

## 相关条目

- [[02-现代Java25深度解析]] — Virtual Threads 深入解析，与本文 CompletableFuture/ForkJoinPool 互补
- [[02-JVM内部机制与调优]] — JVM GC 深入，理解 SafePoint 对锁撤销的影响
- [[01-数据结构与算法]] — 前置依赖：理解 CLH 队列、红黑树需要的数据结构基础
- [[05-幂等设计与分布式锁]] — 分布式锁，synchronized/ReentrantLock 的分布式版本
- [[02-Java性能诊断全指南]] — 性能诊断，如何使用 JFR 观察锁膨胀和线程调度
