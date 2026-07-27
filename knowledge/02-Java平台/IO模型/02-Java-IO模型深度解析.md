---
domain: "02-Java平台"
title: "Java IO 模型深度解析 — BIO、NIO、epoll、零拷贝、Netty 与 AI 场景实战"
status: "verified"
level: "advanced"
sources:
  - level: "L0"
    url: "https://openjdk.org/projects/nio/"
    description: "OpenJDK NIO 官方文档与规范，涵盖 Buffer、Channel、Selector API 定义"
  - level: "L1"
    url: "https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/package-summary.html"
    description: "JDK 25 java.nio 包官方 JavaDoc"
  - level: "L1"
    url: "https://netty.io/wiki/user-guide-for-4.x.html"
    description: "Netty 官方用户指南（4.x），EventLoop、ChannelPipeline、ByteBuf 权威参考"
  - level: "L2"
    url: "https://github.com/netty/netty"
    description: "Netty 源码仓库，核心实现包括 EpollEventLoop、PooledByteBufAllocator"
  - level: "L3"
    url: "https://www.oreilly.com/library/view/java-nio/0596002882/"
    description: "《Java NIO》(O'Reilly)，Ronn Hitchens 著，NIO 原理权威书籍"
  - level: "L3"
    url: "https://www.oreilly.com/library/view/netty-in-action/9781617291470/"
    description: "《Netty in Action》，Norman Maurer 著，Netty 核心架构与实践"
  - level: "L4"
    url: "https://kafka.apache.org/documentation/#design_os"
    description: "Apache Kafka 设计文档，sendfile 零拷贝在 Kafka 中的实际应用"
  - level: "L4"
    url: "https://man7.org/linux/man-pages/man7/epoll.7.html"
    description: "Linux epoll(7) 手册，epoll 三种工作模式及 ET/LT 触发语义"
relations:
  prerequisite: ["01-操作系统基础"]
  related: ["02-现代Java25深度解析", "02-Java并发深度解析"]
tags: ["java-nio", "bio", "epoll", "zero-copy", "netty", "sse", "websocket", "io-models", "virtual-threads", "kafka"]
created: "2026-07-17"
updated: "2026-07-17"
---

# Java IO 模型深度解析 — BIO、NIO、epoll、零拷贝、Netty 与 AI 场景实战

## 概述

Java 的 IO 模型演进是理解高性能网络编程的基础。从 JDK 1.0 的阻塞式 BIO，到 JDK 1.4 引入的 NIO（New IO / Non-blocking IO），再到 JDK 7 的 NIO.2（异步 IO），以及 Netty 对 NIO 的工程化封装，Java IO 的发展脉络清晰地反映了操作系统底层 IO 模型（select/poll/epoll）的进化。在大模型时代，SSE 流式响应、大文件上传、WebSocket 实时通信等 AI 应用场景对 IO 模型提出了新的要求。本文将深入剖析这六个维度，并提供可直接运行的代码示例。

Java IO 的整体演进路线：

```
BIO (JDK 1.0) ──► NIO (JDK 1.4) ──► NIO.2 / AIO (JDK 7)
                      │
                      └──► Netty (社区主导的 NIO 工程化封装)
                                │
                                └──► AI 场景适配（SSE / WebSocket / Virtual Threads）
```

---

## 一、BIO（Blocking IO）— 一切的开端

### 1.1 核心抽象：InputStream / OutputStream

BIO 是 Java 最原始的 IO 模型，其核心是面向字节流的 `InputStream` 和 `OutputStream` 两个抽象类。所有操作都是**阻塞**的：当线程调用 `read()` 时，如果数据尚未到达，线程会被操作系统挂起，直到有数据可读为止。

```java
// JDK 25 风格 — BIO 文件读取示例
import java.io.*;

void bioFileRead() throws IOException {
    var file = new File("/tmp/test.txt");
    try (var fis = new FileInputStream(file);
         var bis = new BufferedInputStream(fis);
         var reader = new InputStreamReader(bis);
         var br = new BufferedReader(reader)) {

        String line;
        while ((line = br.readLine()) != null) {
            System.out.println(line);
        }
    }
}
```

### 1.2 字符流：Reader / Writer

Java 区分字节流和字符流。字节流（InputStream/OutputStream）处理原始字节，字符流（Reader/Writer）处理字符数据，内部进行编解码转换。

```
字节流                       字符流
InputStream    ──────────►   Reader      (输入)
OutputStream   ──────────►   Writer      (输出)

转换桥梁：InputStreamReader / OutputStreamWriter
```

```java
// 字符流 + 字符编码处理
void charStreamExample() throws IOException {
    var path = java.nio.file.Path.of("/tmp/test.txt");
    // 使用 Files 工具类，内部自动管理字符编码
    var content = java.nio.file.Files.readString(path);
    System.out.println(content);

    // 显式指定编码写入
    java.nio.file.Files.writeString(
        path, "你好，世界！", java.nio.file.StandardOpenOption.APPEND);
}
```

### 1.3 Decorator（装饰器）模式

Java IO 类库大量使用装饰器模式。核心组件 `FileInputStream` 提供基本功能，而 `BufferedInputStream`、`DataInputStream`、`ObjectInputStream` 等通过层层包装添加缓冲、数据类型解析、对象序列化等功能。

```java
// 装饰器模式示意
void decoratorPattern() throws IOException {
    // 核心组件：只提供逐字节读取
    var fileInput = new FileInputStream("/tmp/data.bin");

    // 装饰层1：添加缓冲
    var buffered = new BufferedInputStream(fileInput);

    // 装饰层2：添加原始数据类型读取能力
    var dataInput = new DataInputStream(buffered);

    // 现在可以读 int、double 等类型
    int value = dataInput.readInt();
    double price = dataInput.readDouble();
    dataInput.close();
}
```

这种设计的好处是**组合优于继承**：你可以按需组合不同的功能层（缓冲 + 数据解析 + 校验和 等），避免了类爆炸问题。

### 1.4 BIO 网络编程的困境

BIO 在网络编程中的经典模式是"一个连接一个线程"（Thread-per-Connection）：

```java
// BIO Socket 服务端 — 经典模式
void bioSocketServer() throws IOException {
    try (var serverSocket = new java.net.ServerSocket(8080)) {
        System.out.println("BIO Server listening on port 8080");
        while (true) {
            // accept() 阻塞，等待新连接
            var clientSocket = serverSocket.accept();
            // 每个连接创建一个新线程
            Thread.ofPlatform().start(() -> handleClient(clientSocket));
        }
    }
}

void handleClient(java.net.Socket socket) {
    try (socket;
         var in = new BufferedReader(
             new InputStreamReader(socket.getInputStream()));
         var out = new PrintWriter(socket.getOutputStream(), true)) {

        String line;
        while ((line = in.readLine()) != null) {
            out.println("Echo: " + line);
        }
    } catch (IOException e) {
        e.printStackTrace();
    }
}
```

**问题：** 当并发连接数上升到数千甚至数万时，线程数爆炸导致：
- **内存开销大**：每个线程约占用 1MB 栈空间（可通过 `-Xss` 调优但仍有限）
- **上下文切换成本高**：CPU 大量时间花在切换线程而非处理业务
- **C10K 问题**：无法高效处理 10000+ 并发连接

> **注意：** Virtual Threads（JEP 444）改善了线程的内存开销问题，但 BIO 的根本问题——I/O 操作的阻塞等待导致线程空转——依然存在。Virtual Threads 的价值体现在业务代码可以用同步风格写异步逻辑，但底层 IO 实现仍应使用 NIO。

---

## 二、NIO（Non-blocking IO）— 高并发的基石

JDK 1.4 引入的 NIO（`java.nio` 包）是 Java 高性能网络编程的转折点。其核心抽象是一个三位一体：

### 2.1 核心三角：Channel + Buffer + Selector

```
                 Selector（多路复用器）
                      │
         ┌────────────┼────────────┐
         │            │            │
    SocketChannel  SocketChannel  ServerSocketChannel
         │            │            │
      Buffer        Buffer        Buffer
```

**Channel（通道）：** 双向的数据传输通道，既可以读也可以写。与 BIO 的 Stream 不同，Channel 是双向的。主要实现：
- `FileChannel` — 文件 IO
- `SocketChannel` — TCP 客户端
- `ServerSocketChannel` — TCP 服务端
- `DatagramChannel` — UDP

**Buffer（缓冲区）：** 一块内存区域，用于在 Channel 和用户代码之间中转数据。所有数据都必须经过 Buffer：从 Channel 读到 Buffer，或从 Buffer 写到 Channel。

**Selector（选择器）：** NIO 实现非阻塞 IO 的关键。一个 Selector 线程可以监控多个 Channel 的 IO 事件（连接就绪、读就绪、写就绪），实现单线程管理成千上万个连接——这就是 IO 多路复用（IO Multiplexing）。

### 2.2 Buffer 三大核心属性：position / limit / capacity

Buffer 是理解 NIO 的核心。它的三个属性决定了对缓冲区的读写行为：

```
                     capacity（容量，不可变）
┌─────────────────────────────────────────────────────┐
│  已读/已写区域  │     可读/可写区域    │  不可访问   │
│  [0, position) │ [position, limit)   │ [limit, cap) │
└─────────────────────────────────────────────────────┘
                 ▲                      ▲
             position                 limit
```

| 属��� | 含义 | 写模式初始值 | 读模式初始值（flip 后） |
|------|------|-------------|----------------------|
| **capacity** | Buffer 的总容量，创建后不可变 | 分配时指定 | 不变 |
| **position** | 下一个要读/写的元素索引 | 0 | 0 |
| **limit** | 第一个不可读/写的元素索引 | capacity | 写模式时的 position（即已写入的数量） |

**关键操作：**

```java
void bufferOperations() {
    // 分配一个 10 字节的 HeapByteBuffer
    var buffer = java.nio.ByteBuffer.allocate(10);
    // 写模式：position=0, limit=10, capacity=10

    // 写入 5 个字节：'H','e','l','l','o'
    buffer.put((byte) 'H');
    buffer.put((byte) 'e');
    buffer.put((byte) 'l');
    buffer.put((byte) 'l');
    buffer.put((byte) 'o');
    // position=5, limit=10, capacity=10

    // flip()：切换到读模式
    buffer.flip();
    // position=0, limit=5, capacity=10

    // 读取数据
    while (buffer.hasRemaining()) {
        System.out.print((char) buffer.get());
    }
    // position=5, limit=5, capacity=10
    System.out.println();

    // rewind()：重新读取（position 归零，limit 不变）
    buffer.rewind();
    // position=0, limit=5, capacity=10

    // clear()：准备下一次写入（position=0, limit=capacity）
    // 注意：数据并未被清除，只是"逻辑清空"
    buffer.clear();
    // position=0, limit=10, capacity=10

    // compact()：将未读数据移到开头，准备写入
    // 适用于读了一半想写的场景
}
```

**Buffer 方法速查表：**

| 方法 | 作用 | position | limit |
|------|------|----------|-------|
| `allocate(n)` | 分配 Heap 缓冲区 | 0 | n |
| `allocateDirect(n)` | 分配 Direct 缓冲区 | 0 | n |
| `put(data)` | 写入数据 | 递增 | 不变 |
| `flip()` | 写 → 读 | 0 | 原 position |
| `get()` | 读取数据 | 递增 | 不变 |
| `rewind()` | 重读 | 0 | 不变 |
| `clear()` | 准备写（清空逻辑内容） | 0 | capacity |
| `compact()` | 压缩（保留未读数据） | remaining() | capacity |
| `mark()` / `reset()` | 标记/恢复位置 | — | — |
| `slice()` | 创建共享数据的子 Buffer | 0 | 子范围 |

### 2.3 Direct Memory vs Heap Memory

ByteBuffer 有两种内存分配方式，这是理解 NIO 性能的关键。

```java
void bufferMemoryComparison() {
    // Heap Buffer：数据在 JVM 堆中
    var heapBuffer = java.nio.ByteBuffer.allocate(1024);
    // heapBuffer.hasArray() == true
    // heapBuffer.array() 返回底层 byte[]

    // Direct Buffer：数据在堆外内存（OS 管理）
    var directBuffer = java.nio.ByteBuffer.allocateDirect(1024);
    // directBuffer.hasArray() == false (不一定，取决于实现)
    // 通过 Unsafe 或 native 方法分配
}
```

| 对比维度 | Heap Buffer | Direct Buffer |
|---------|-------------|---------------|
| **内存位置** | JVM 堆内 | 堆外（OS 管理） |
| **分配/回收成本** | 低（TLAB 分配） | 高（系统调用） |
| **IO 操作路径** | 堆内 → 临时 Direct Buffer → OS（多一次拷贝） | 直接 → OS |
| **GC 影响** | 受 GC 管理，可能被移动 | 不受 GC 移动，但有单独的内存清理机制 |
| **适用场景** | 业务数据处理 | 高频网络 IO、大文件传输 |

**Direct Buffer 的 IO 优势：** 当进行网络 IO 或文件 IO 时，操作系统只能操作堆外内存。如果使用 Heap Buffer，JVM 需要先将数据复制到一个临时的 Direct Buffer 中，再进行系统调用。使用 Direct Buffer 可以省去这次拷贝。这也是为什么 Netty 的 `ByteBuf` 默认优先使用 Direct Memory。

**Direct Buffer 的内存管理：** Direct Buffer 的内存不属于 JVM 堆，不会被普通 GC 回收。Java 通过 `Cleaner` 和虚引用（PhantomReference）机制在 DirectByteBuffer 对象被 GC 时释放堆外内存。但如果 Direct ByteBuffer 分配过快，可能触发显式的 `System.gc()` 调用。Netty 通过自己的内存池（`PooledByteBufAllocator`）来规避这个问题。

### 2.4 Scatter / Gather（分散读写）

Scatter（分散读）和 Gather（聚集写）允许单次 IO 操作读写多个 Buffer。

```java
void scatterGatherExample() throws IOException {
    // 模拟一个网络协议：header(8字节) + body(变长)
    var headerBuf = java.nio.ByteBuffer.allocate(8);
    var bodyBuf = java.nio.ByteBuffer.allocate(1024);

    // Scatter Read：将 Channel 的数据按顺序"分散"到多个 Buffer
    try (var channel = java.nio.channels.SocketChannel.open()) {
        var buffers = new java.nio.ByteBuffer[]{headerBuf, bodyBuf};
        // 先填满 headerBuf，再填 bodyBuf
        long bytesRead = channel.read(buffers);

        headerBuf.flip();
        int bodyLength = headerBuf.getInt();  // 读取 body 长度

        bodyBuf.flip();
        bodyBuf.limit(bodyLength);
        // 处理 body 数据...
    }

    // Gather Write：将多个 Buffer 的数据按顺序"聚集"写入 Channel
    // headerBuf 写完后自动写 bodyBuf
    // channel.write(new ByteBuffer[]{headerBuf, bodyBuf});
}
```

Scatter/Gather 在 Netty 中被广泛使用，例如 HTTP 协议的 Header + Body 分离读写。

---

## 三、epoll 与 Java NIO — 从操作系统到 JDK

### 3.1 IO 多路复用的三代演进：select → poll → epoll

Java 的 `Selector` 在 Linux 上底层依赖 `epoll`（JDK 1.6+ 默认），在 macOS/BSD 上使用 `kqueue`。理解 epoll 的演进有助于理解为什么 NIO 能高效处理数万连接。

```
select (1983)              poll (1997)              epoll (2002)
┌──────────────┐     ┌──────────────┐        ┌──────────────────┐
│ fd_set 位图   │     │ pollfd 数组   │        │ 红黑树 + 就绪链表  │
│ 最大 1024    │     │ 无限制        │        │ 无限制            │
│ O(n) 遍历    │     │ O(n) 遍历     │        │ O(1) 获取就绪事件  │
│ 每次传入全量  │     │ 每次传入全量   │        │ 增量式：只关注变化  │
└──────────────┘     └──────────────┘        └──────────────────┘
```

**epoll 的核心 API：**

| API | 功能 |
|-----|------|
| `epoll_create()` | 创建 epoll 实例，返回文件描述符 |
| `epoll_ctl(fd, OP, sockfd, event)` | 向 epoll 实例添加/修改/删除要监听的 socket fd |
| `epoll_wait(fd, events, maxevents, timeout)` | 等待事件发生，返回就绪事件列表 |

**epoll 为什么快？**

1. **事件驱动（Event-driven）**：epoll 不轮询所有 fd，而是通过内核回调机制，在数据到达时直接将 fd 放入就绪链表
2. **内存映射（mmap）**：内核和用户空间共享内存，减少了数据拷贝
3. **增量管理**：fd 只在连接建立/关闭时调用 `epoll_ctl`，不随每次 `epoll_wait` 重复传递

### 3.2 水平触发（Level-Triggered, LT）vs 边缘触发（Edge-Triggered, ET）

epoll 提供两种事件通知模式。Java 的 `Selector` **默认使用 LT 模式**。

| 对比维度 | LT（水平触发） | ET（边缘触发） |
|---------|--------------|--------------|
| **触发条件** | 只要缓冲区有数据，每次 epoll_wait 都通知 | 只在缓冲区状态变化时通知一次 |
| **通知次数** | 可能多次（缓冲区未读空） | 只通知一次 |
| **编程模型** | 简单，类似 select/poll | 复杂，必须用非阻塞 IO + 循环读到 EAGAIN |
| **线程模型** | 可以多线程处理同一 fd | 通常同一 fd 由一个线程处理 |
| **性能** | 略低（可能有重复通知） | 更高（无重复通知） |
| **Java 支持** | 默认模式 | 可通过 register 时传入额外参数启用 |

```java
// Java Selector 注册时的触发模式（默认 LT）
void selectorTriggerModes() throws IOException {
    var selector = java.nio.channels.Selector.open();
    var channel = java.nio.channels.SocketChannel.open();
    channel.configureBlocking(false);

    // 默认：水平触发（不需要额外参数）
    channel.register(selector, java.nio.channels.SelectionKey.OP_READ);

    // 边缘触发（需要通过内部实现类设置，不推荐）
    // Netty 的 EpollEventLoop 在 Linux 上使用 ET 模式
}
```

> **Netty 的选择：** Netty 的 `EpollEventLoop` 在 Linux 上**使用 ET 模式**以追求极致性能。通过在每个 Channel 的 `unsafe().read()` 中循环读取直到返回 0（数据已读空），Netty 实现了 ET 模式的高效处理。这也是 Netty 性能优于原生 JDK Selector 的原因之一。

### 3.3 Java Selector 的 epoll 空轮询 Bug

这是一个经典且影响深远的 JDK Bug（JDK-6403933）。在 Linux 平台，有时 `Selector.select()` 会在没有任何就绪 Channel 的情况下**被唤醒并返回 0**，导致 CPU 100% 空转。

**根因：** epoll 的 `epoll_wait` 在某些场景下会**虚假唤醒**（spurious wakeup），但 JDK 的 Selector 实现没有正确处理这种情况。具体触发条件包括：被中断的系统调用（如信号处理）、已关闭的 fd 仍被监听等。

**Netty 的应对策略：**

```java
// Netty 中 EpollEventLoop 的空轮询检测策略（简化示意）
public class EpollBugWorkaround {
    private static final int SELECTOR_AUTO_REBUILD_THRESHOLD = 512;
    private int selectCnt = 0;

    void select() throws IOException {
        // 执行 select 操作
        int selectedKeys = selector.select(timeoutMillis);

        if (selectedKeys == 0) {
            // select 返回 0，可能是空轮询
            long time = System.nanoTime() - startTime;
            if (time < timeoutMillis - SLEEP_MS) {
                // 远早于超时时间就醒了 → 很可能是空轮询 bug
                selectCnt++;
            }
        } else {
            selectCnt = 0;  // 正常返回，重置计数
        }

        // 如果空轮询次数超过阈值：重建 Selector
        if (selectCnt > SELECTOR_AUTO_REBUILD_THRESHOLD) {
            rebuildSelector();  // 创建新 Selector，将所有 Channel 重新注册
            selectCnt = 0;
        }
    }

    void rebuildSelector() {
        // 创建新的 Selector
        // 遍历旧 Selector 上所有注册的 Channel
        // 取消旧注册，重新注册到新 Selector
        // 关闭旧 Selector
    }
}
```

**JDK 层面的修复：** 从 JDK 11 开始，OpenJDK 社区逐步改进了 `EPollSelectorImpl` 的实现，通过更严格的轮询状态检查和更精细的 epoll_wait 超时处理来缓解此问题。但在高负载场景下，Netty 的防御性重建策略仍然是必要的。

---

## 四、零拷贝（Zero-Copy）— 让数据"飞"起来

零拷贝是高性能 IO 的核心优化技术。传统 IO 操作需要数据在用户态和内核态之间反复拷贝，而零拷贝技术旨在减少甚至消除这些不必要的拷贝。

### 4.1 传统 IO 的数据拷贝路径

以"将文件内容通过 Socket 发送"为例，传统方式经历 4 次拷贝和 4 次上下文切换：

```
传统 IO 数据路径（read + write）：
┌─────────┐    read()    ┌─────────┐    DMA     ┌──────────┐
│ 应用程序  │ ◄────────── │ 内核缓冲  │ ◄───────── │    磁盘    │
│ (用户态)  │ ──────────► │ (内核态)  │ ──────────► │ (硬件)    │
└─────────┘    write()   └─────────┘    DMA     └──────────┘
                             │
                         内核 Socket 缓冲
                             │
                          DMA ──► 网卡

上下文切换：用户态→内核态（read）→用户态→内核态（write）= 4 次
数据拷贝：磁盘→内核→用户→内核→Socket = 4 次
```

### 4.2 sendfile 系统调用

Linux 2.1 引入的 `sendfile()` 将两次系统调用合并为一次，数据路径变为：

```
sendfile 数据路径：
磁盘 ──DMA──► 内核缓冲 ──CPU拷贝──► Socket 缓冲 ──DMA──► 网卡

上下文切换：仅 1 次
数据拷贝：磁盘→内核→Socket = 3 次（其中 2 次 DMA，1 次 CPU）
```

如果网卡支持 **Scatter-Gather DMA**（Linux 2.4+），可以进一步减少到 2 次 DMA 拷贝：

```
sendfile + SG-DMA 数据路径：
磁盘 ──DMA──► 内核缓冲 ──► Socket 缓冲（仅传递文件描述符和长度）
                │
                └── DMA（通过 gather 操作直接从内核缓冲到网卡）

数据拷贝：仅 2 次 DMA，0 次 CPU 拷贝 — 真正的"零"拷贝
```

### 4.3 mmap（内存映射）

`mmap` 将文件映射到虚拟内存地址空间，让应用程序像访问内存一样访问文件：

```java
void mmapExample() throws IOException {
    try (var channel = java.nio.channels.FileChannel.open(
            java.nio.file.Path.of("/tmp/large_file.dat"),
            java.nio.file.StandardOpenOption.READ)) {

        // 将文件映射到虚拟内存（从偏移 0 开始，映射全部）
        var mappedBuffer = channel.map(
            java.nio.channels.FileChannel.MapMode.READ_ONLY,
            0, channel.size());

        // 像操作 ByteBuffer 一样操作文件内容
        // 修改会直接反映到文件（READ_WRITE 模式）
        byte[] data = new byte[1024];
        mappedBuffer.get(data);
    }
}
```

**mmap vs sendfile：**

| 对比 | mmap | sendfile (SG-DMA) |
|------|------|-------------------|
| CPU 拷贝 | 1 次（内核→用户映射，无需拷贝） | 0 次 |
| 用户态访问 | 可以，像操作内存 | 不可以，数据不经过用户空间 |
| 适用场景 | 需要修改文件内容 | 纯转发（文件→网络） |
| Java API | `FileChannel.map()` | `FileChannel.transferTo()` |

### 4.4 FileChannel.transferTo — Java 中的 sendfile

JDK 1.4 引入的 `transferTo/transferFrom` 是 Java 中使用 sendfile 的标准方式：

```java
void zeroCopyTransfer() throws IOException {
    try (var srcChannel = java.nio.channels.FileChannel.open(
            java.nio.file.Path.of("/tmp/large_file.dat"),
            java.nio.file.StandardOpenOption.READ);
         var destChannel = java.nio.channels.SocketChannel.open(
             new java.net.InetSocketAddress("localhost", 8080))) {

        long position = 0;
        long size = srcChannel.size();

        // transferTo 内部调用 sendfile() 系统调用（Linux）
        // 数据不经过用户空间，零 CPU 拷贝
        while (position < size) {
            position += srcChannel.transferTo(position, size - position, destChannel);
        }
    }
}

// 同样用于文件间拷贝（sendfile 也支持文件到文件，Linux 2.6.33+）
void fileToFileCopy() throws IOException {
    try (var src = java.nio.channels.FileChannel.open(
            java.nio.file.Path.of("/tmp/source.dat"),
            java.nio.file.StandardOpenOption.READ);
         var dest = java.nio.channels.FileChannel.open(
             java.nio.file.Path.of("/tmp/target.dat"),
             java.nio.file.StandardOpenOption.CREATE,
             java.nio.file.StandardOpenOption.WRITE)) {

        src.transferTo(0, src.size(), dest);
        // 或者 dest.transferFrom(src, 0, src.size());
    }
}
```

### 4.5 零拷贝在 Kafka 中的应用

Apache Kafka 是零拷贝技术的经典案例。Kafka 的消息传递路径是"生产者写入 → Broker 存储 → 消费者读取"，Broker 的核心职责是将磁盘上的消息分发给消费者。

```java
// Kafka 的 FileRecords.writeTo() 核心逻辑（简化示意）
// 实际实现在 kafka/server/src/main/java/org/apache/kafka/storage/internals/log/FileRecords.java
public class FileRecords {
    // ...
    public long writeTo(java.nio.channels.GatheringByteChannel destChannel,
                         long offset, int length) throws IOException {
        // 使用 FileChannel.transferTo() 直接发送文件到网络
        // 底层调用 sendfile()，实现零拷贝
        return channel.transferTo(offset, length, destChannel);
    }
}
```

**Kafka 零拷贝的价值：**
- **不经过用户态**：消息从磁盘页缓存直接发送到网卡，不经过 Broker 的 JVM 堆
- **降低 CPU 使用率**：省去了用户态/内核态切换和内存拷贝的 CPU 开销
- **提升吞吐量**：在 Kafka 的基准测试中，零拷贝使吞吐量提升 2-3 倍
- **减少内存占用**：不需要在 JVM 堆中缓存消息数据

**为什么 Kafka 能做到而传统方案做不到？**

传统消息队列（如 ActiveMQ）将消息从磁盘读到 JVM 堆中，处理（反序列化、路由）后再写入 Socket。Kafka 的设计哲学就是不处理消息内容，因此可以直接使用 sendfile 将磁盘数据原样转发。

```
传统 MQ：磁盘 → 内核缓冲 → JVM 堆（反序列化 → 业务逻辑 → 序列化）→ 内核 Socket 缓冲 → 网卡
Kafka：  磁盘 → 内核缓冲（sendfile + SG-DMA）─────────────────────→ 网卡
                     ↑
               0 次 CPU 拷贝，0 次用户态介入
```

---

## 五、Netty 核心架构 — 工业级 NIO 框架

Netty 是目前 Java 生态中事实标准的 NIO 网络框架。它将原生 NIO 的复杂性封装为清晰的抽象。几乎所有需要高性能网络通信的 Java 项目（Dubbo、gRPC-Java、RocketMQ、Elasticsearch、Spark）都基于 Netty。

### 5.1 EventLoop 模型

EventLoop 是 Netty 的核心线程模型。它将事件循环、IO 处理和任务执行统一在一个线程中。

```
                    ┌──────────────────────────┐
                    │       EventLoopGroup      │
                    │   (通常 = CPU 核心数)      │
                    └─────┬────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          │               │               │
   ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
   │ EventLoop 1 │ │ EventLoop 2 │ │ EventLoop N │
   │ ┌─────────┐ │ │ ┌─────────┐ │ │ ┌─────────┐ │
   │ │Selector │ │ │ │Selector │ │ │ │Selector │ │
   │ └─────────┘ │ │ └─────────┘ │ │ └─────────┘ │
   │ ┌─────────┐ │ │ ┌─────────┐ │ │ ┌─────────┐ │
   │ │TaskQueue│ │ │ │TaskQueue│ │ │ │TaskQueue│ │
   │ └─────────┘ │ │ └─────────┘ │ │ └─────────┘ │
   └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
          │               │               │
     Channel 1..N    Channel N+1..2N   Channel ...

 一个 Channel 的所有 IO 操作由同一个 EventLoop 处理（线程安全）
```

**关键设计原则：**
1. **一个 EventLoop 绑定一个 Selector + 一个 Thread**：避免 Channel 间的并发竞争
2. **一个 Channel 绑定一个 EventLoop**：该 Channel 的所有 IO 事件和 Handler 处理都在同一个线程中执行，天然线程安全
3. **多个 EventLoop 组成 EventLoopGroup**：提供并行处理能力，通常配置为 CPU 核心数 * 2

```java
// Netty EventLoop 的简化概念模型
public interface EventLoop extends java.util.concurrent.ScheduledExecutorService {
    // 注册 Channel 并返回 Future
    io.netty.channel.ChannelFuture register(io.netty.channel.Channel channel);

    // 在 EventLoop 线程中执行任务
    void execute(Runnable command);
}

// 核心循环（简化）
// while (!shutdown) {
//     selector.select();              // 等待 IO 事件
//     for (SelectionKey key : selectedKeys) {
//         channel.unsafe().read();     // 处理 IO 事件，触发 pipeline
//     }
//     runAllTasks();                   // 处理任务队列
// }
```

### 5.2 ChannelPipeline — 责任链模式

Netty 的 ChannelPipeline 是一个责任链（Chain of Responsibility），由一系列 ChannelHandler 组成，数据在管道中流动并被依次处理。

```
                    I/O Request (入站)
                    via Channel or ChannelHandlerContext
                         │
  ┌──────────────────────────────────────────────────────────────┐
  │                  ChannelPipeline                             │
  │                                                             │
  │  ┌───────────────────────────────────────────────────────┐  │
  │  │  [ Handler1 (inbound) ]  →  [ Handler2 (inbound) ]  → │  │ 入站
  │  │  (Decoder / Biz Logic)      (Biz Logic Handler)       │  │
  │  └───────────────────────────────────────────────────────┘  │
  │                            │                                │
  │                        TailContext                          │
  │                            │                                │
  │                        HeadContext                          │
  │                            │                                │
  │  ┌───────────────────────────────────────────────────────┐  │
  │  │  [ Handler3 (outbound) ] ← [ Handler4 (outbound) ] ←  │  │ 出站
  │  │  (Encoder)                  (Header Appender)         │  │
  │  └───────────────────────────────────────────────────────┘  │
  │                                                             │
  └─────────────────────────────────────────────────────────────┘
                         │
                    I/O Response (出站)
                    via Channel or ChannelHandlerContext
```

**ChannelHandler 类型：**

| 类型 | 接口 | 用途 |
|------|------|------|
| ChannelInboundHandler | `channelRead()`, `channelActive()`, `exceptionCaught()` | 处理入站数据（数据读取、业务逻辑） |
| ChannelOutboundHandler | `write()`, `flush()`, `close()` | 处理出站数据（编码、发送） |

**事件的传播方式：**
- 入站事件（Inbound）：从 Pipeline 头部（Head）向尾部（Tail）传播
- 出站事件（Outbound）：从 Pipeline 尾部（Tail）向头部（Head）传播

```java
// Handler 中的事件传播
public class MyInboundHandler extends io.netty.channel.ChannelInboundHandlerAdapter {
    @Override
    public void channelRead(io.netty.channel.ChannelHandlerContext ctx, Object msg) {
        // 处理消息...
        System.out.println("Received: " + msg);

        // 传递给下一个 Inbound Handler
        ctx.fireChannelRead(msg);
        // 或者 ctx.write() 触发 Outbound 链
    }
}
```

**ChannelHandlerContext** 是 Handler 与 Pipeline 之间的桥梁，提供了事件触发和 Pipeline 操作的能力。每个 Handler 被添加到 Pipeline 时会创建一个对应的 Context。

### 5.3 ByteBuf — Netty 的字节容器

Netty 的 `ByteBuf` 是对 JDK `ByteBuffer` 的增强替代，解决了原生 Buffer 的诸多痛点。

**ByteBuf 相对于 ByteBuffer 的优势：**

| 特性 | JDK ByteBuffer | Netty ByteBuf |
|------|---------------|---------------|
| 读写模式切换 | 需要 `flip()` 手动切换 | 独立的读索引（readerIndex）和写索引（writerIndex），无需切换 |
| 容量扩展 | 固定容量 | 支持动态扩容（最多到 maxCapacity） |
| 引用计数 | 无 | 支持引用计数（ReferenceCounted），利于内存池管理 |
| 缓冲区类型组合 | Heap / Direct | Pooled+Heap / Pooled+Direct / Unpooled+Heap / Unpooled+Direct |
| 零拷贝操作 | 无 | slice()、duplicate()、composite() 等组合操作 |
| 字节序 | 默认 Big-Endian | 支持动态切换 Little/Big-Endian |

**ByteBuf 的读写索引设计：**

```
         readerIndex         writerIndex           capacity
            │                    │                     │
┌───────────┼────────────────────┼─────────────────────┼────┐
│ 已读(废弃)  │   可读区域          │      可写区域         │    │
│  discard   │   readable bytes   │   writable bytes    │    │
└───────────┴────────────────────┴─────────────────────┴────┘
```

```java
void byteBufBasicOperations() {
    // 1. 分配 ByteBuf（默认 Pooled + Direct）
    var buf = io.netty.buffer.PooledByteBufAllocator.DEFAULT.buffer(256);
    // 或者：var buf = io.netty.buffer.Unpooled.buffer(256);

    // 2. 写入数据
    buf.writeInt(42);           // writerIndex += 4
    buf.writeLong(System.currentTimeMillis());  // writerIndex += 8
    buf.writeBytes("hello netty".getBytes());   // writerIndex += 11

    // 3. 读取数据（无需 flip！）
    int value = buf.readInt();  // readerIndex += 4
    long timestamp = buf.readLong();  // readerIndex += 8

    // 4. 查看可读数据（Mark 模式，不移动 readerIndex）
    buf.markReaderIndex();
    byte firstByte = buf.readByte();
    buf.resetReaderIndex();  // readerIndex 恢复

    // 5. 零拷贝 slice
    var slice = buf.slice(buf.readerIndex(), 5);  // 共享底层数据

    // 6. 引用计数管理
    buf.retain();   // 引用计数 +1
    buf.release();  // 引用计数 -1，归零后释放回内存池
}
```

**四种分配器组合：**

| 分配器 | 说明 | 使用场景 |
|--------|------|---------|
| `PooledByteBufAllocator.DEFAULT.buffer()` | 池化 + Direct | 默认，高频网络 IO（推荐） |
| `PooledByteBufAllocator.DEFAULT.heapBuffer()` | 池化 + Heap | 需要 `array()` 操作的场景 |
| `Unpooled.buffer()` | 非池化 + Heap | 短期使用、测试 |
| `Unpooled.directBuffer()` | 非池化 + Direct | 需要 Direct 但不值得池化的场景 |

**CompositeByteBuf — 零拷贝组合多个 ByteBuf：**

```java
void compositeBufferExample() {
    // 传统方式：需要复制数据到新缓冲区
    // byte[] merged = new byte[buf1.readableBytes() + buf2.readableBytes()];

    // Netty 方式：零拷贝组合
    var headerBuf = io.netty.buffer.Unpooled.wrappedBuffer("HTTP/1.1 200 OK\r\n".getBytes());
    var bodyBuf = io.netty.buffer.Unpooled.wrappedBuffer("{\"status\":\"ok\"}".getBytes());

    var composite = io.netty.buffer.PooledByteBufAllocator.DEFAULT.compositeBuffer();
    composite.addComponents(true, headerBuf, bodyBuf);
    // headerBuf 和 bodyBuf 的 refCnt 已转移给 composite
}
```

### 5.4 Codecs（编解码器）

Netty 的编解码器是 ChannelHandler 的特化：

- **Decoder（解码）**：`ByteToMessageDecoder` — 字节 → 消息对象（Inbound）
- **Encoder（编码）**：`MessageToByteEncoder` — 消息对象 → 字节（Outbound）
- **Codec（编解码器）**：`ByteToMessageCodec` / `MessageToMessageCodec` — 双向转换

```java
// 自定义帧解码器：基于长度前缀的协议
import io.netty.buffer.ByteBuf;
import io.netty.channel.ChannelHandlerContext;
import io.netty.handler.codec.ByteToMessageDecoder;
import java.util.List;

public class LengthFieldBasedFrameDecoder extends ByteToMessageDecoder {
    private static final int MAX_FRAME_LENGTH = 65536;
    private static final int LENGTH_FIELD_OFFSET = 0;
    private static final int LENGTH_FIELD_LENGTH = 4;

    @Override
    protected void decode(ChannelHandlerContext ctx, ByteBuf in, List<Object> out) {
        // 检查是否足够读取长度字段
        if (in.readableBytes() < LENGTH_FIELD_LENGTH) {
            return; // 等待更多数据
        }

        // 标记当前位置，以便后续回退
        in.markReaderIndex();

        // 读取帧长度
        int frameLength = in.readInt();

        // 长度合法性检查
        if (frameLength < 0 || frameLength > MAX_FRAME_LENGTH) {
            in.resetReaderIndex();
            throw new IllegalArgumentException("Invalid frame length: " + frameLength);
        }

        // 检查完整帧是否已到达
        if (in.readableBytes() < frameLength) {
            in.resetReaderIndex();  // 数据不完整，回退等待
            return;
        }

        // 提取完整帧数据
        var frameData = in.readBytes(frameLength);
        out.add(frameData);  // 传递给下一个 Handler
    }
}
```

**Netty 内置的编解码器：**

| 编解码器 | 用途 |
|---------|------|
| `HttpRequestDecoder` / `HttpResponseEncoder` | HTTP 协议的编解码 |
| `SslHandler` | TLS/SSL 加密解密 |
| `LengthFieldBasedFrameDecoder` | 基于长度字段的帧解码 |
| `DelimiterBasedFrameDecoder` | 基于分隔符的帧解码 |
| `FixedLengthFrameDecoder` | 固定长度帧解码 |
| `ProtobufDecoder` / `ProtobufEncoder` | Protocol Buffers 编解码 |
| `StringDecoder` / `StringEncoder` | 字符串编解码 |
| `ObjectDecoder` / `ObjectEncoder` | Java 序列化编解码（不推荐） |

### 5.5 TCP 粘包/拆包问题与解决方案

TCP 是流式协议，没有消息边界，会导致所谓的"粘包"和"拆包"：

```
发送端连续发送：  [MSG1][MSG2][MSG3]
                      │
                 TCP 流传输（无边界的字节流）
                      │
接收端可能收到：
  情景1（粘包）：[MSG1 MSG2  MSG3]
  情景2（拆包）：[MSG1 MS][G2 MSG3]
  情景3（混合）：[MSG1 MSG2][MSG3]
```

**四种经典解决方案：**

| 方案 | 原理 | Netty 实现 | 适用场景 |
|------|------|-----------|---------|
| **固定长度** | 每个消息固定字节数，不足填充 | `FixedLengthFrameDecoder` | 简单协议、指令型协议 |
| **分隔符** | 消息间用特殊分隔符分隔 | `DelimiterBasedFrameDecoder` | 文本协议、Redis 协议（`\r\n`） |
| **长度字段** | 在消息头中指定消息体长度 | `LengthFieldBasedFrameDecoder` | 大多数二进制协议 |
| **行分隔** | 按行分隔（`\r\n` 或 `\n`） | `LineBasedFrameDecoder` | Telnet、简单文本协议 |

**Netty HTTP Server 完整示例：**

```java
// 使用 Netty 构建一个完整的 HTTP 服务器
import io.netty.bootstrap.ServerBootstrap;
import io.netty.channel.*;
import io.netty.channel.nio.NioEventLoopGroup;
import io.netty.channel.socket.nio.NioServerSocketChannel;
import io.netty.handler.codec.http.*;
import io.netty.buffer.Unpooled;
import java.nio.charset.StandardCharsets;

public class NettyHttpServer {
    private final int port;

    public NettyHttpServer(int port) {
        this.port = port;
    }

    public void start() throws InterruptedException {
        var bossGroup = new NioEventLoopGroup(1);    // 接收连接
        var workerGroup = new NioEventLoopGroup();    // 处理 IO

        try {
            var bootstrap = new ServerBootstrap();
            bootstrap.group(bossGroup, workerGroup)
                .channel(NioServerSocketChannel.class)
                .childHandler(new ChannelInitializer<Channel>() {
                    @Override
                    protected void initChannel(Channel ch) {
                        var pipeline = ch.pipeline();
                        // HTTP 编解码器（解决粘包/拆包）
                        pipeline.addLast(new HttpServerCodec());
                        // HTTP 消息聚合器（将分块的 HTTP 消息聚合成完整消息）
                        pipeline.addLast(new HttpObjectAggregator(65536));
                        // 业务处理器
                        pipeline.addLast(new HttpServerHandler());
                    }
                })
                .option(ChannelOption.SO_BACKLOG, 128)
                .childOption(ChannelOption.SO_KEEPALIVE, true);

            var future = bootstrap.bind(port).sync();
            System.out.println("Netty HTTP Server started on port " + port);
            future.channel().closeFuture().sync();
        } finally {
            bossGroup.shutdownGracefully();
            workerGroup.shutdownGracefully();
        }
    }

    static class HttpServerHandler extends SimpleChannelInboundHandler<FullHttpRequest> {
        @Override
        protected void channelRead0(ChannelHandlerContext ctx, FullHttpRequest request) {
            var uri = request.uri();
            if ("/health".equals(uri)) {
                var responseContent = Unpooled.copiedBuffer(
                    "{\"status\":\"UP\"}", StandardCharsets.UTF_8);
                var response = new DefaultFullHttpResponse(
                    HttpVersion.HTTP_1_1, HttpResponseStatus.OK, responseContent);
                response.headers()
                    .set(HttpHeaderNames.CONTENT_TYPE, "application/json")
                    .set(HttpHeaderNames.CONTENT_LENGTH, responseContent.readableBytes());
                ctx.writeAndFlush(response).addListener(ChannelFutureListener.CLOSE);
            } else {
                var response = new DefaultFullHttpResponse(
                    HttpVersion.HTTP_1_1, HttpResponseStatus.NOT_FOUND);
                ctx.writeAndFlush(response).addListener(ChannelFutureListener.CLOSE);
            }
        }

        @Override
        public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
            cause.printStackTrace();
            ctx.close();
        }
    }

    public static void main(String[] args) throws Exception {
        new NettyHttpServer(8080).start();
    }
}
```

---

## 六、NIO 服务器实战

### 6.1 原生 NIO Echo 服务器

下面是一个完整可运行的 NIO Echo 服务器，展示了 Selector 的完整使用流程：

```java
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.ByteBuffer;
import java.nio.channels.*;
import java.util.Iterator;

public class NioEchoServer {
    private static final int PORT = 8080;
    private static final int BUFFER_SIZE = 1024;

    public void start() throws IOException {
        var selector = Selector.open();
        var serverChannel = ServerSocketChannel.open();
        serverChannel.configureBlocking(false);
        serverChannel.bind(new InetSocketAddress(PORT));
        serverChannel.register(selector, SelectionKey.OP_ACCEPT);
        System.out.println("NIO Echo Server started on port " + PORT);

        var buffer = ByteBuffer.allocate(BUFFER_SIZE);

        while (true) {
            // 阻塞等待就绪事件
            selector.select();

            Iterator<SelectionKey> keyIterator = selector.selectedKeys().iterator();
            while (keyIterator.hasNext()) {
                var key = keyIterator.next();
                keyIterator.remove();  // 必须手动移除，否则下次还会被处理

                try {
                    if (key.isAcceptable()) {
                        // 处理新连接
                        var server = (ServerSocketChannel) key.channel();
                        var client = server.accept();
                        client.configureBlocking(false);
                        client.register(selector, SelectionKey.OP_READ);
                        System.out.println("New client: " + client.getRemoteAddress());

                    } else if (key.isReadable()) {
                        // 处理读事件
                        var client = (SocketChannel) key.channel();
                        buffer.clear();
                        int bytesRead = client.read(buffer);

                        if (bytesRead == -1) {
                            // 客户端关闭连接
                            System.out.println("Client disconnected: " + client.getRemoteAddress());
                            key.cancel();
                            client.close();
                            continue;
                        }

                        buffer.flip();
                        byte[] data = new byte[buffer.remaining()];
                        buffer.get(data);
                        String message = new String(data);

                        // Echo 回去（注册写事件）
                        key.interestOps(SelectionKey.OP_WRITE);
                        key.attach(message);  // 附加数据

                    } else if (key.isWritable()) {
                        // 处理写事件
                        var client = (SocketChannel) key.channel();
                        String message = (String) key.attachment();

                        buffer.clear();
                        buffer.put(("Echo: " + message).getBytes());
                        buffer.flip();
                        client.write(buffer);

                        // 切回读模式
                        key.interestOps(SelectionKey.OP_READ);
                    }
                } catch (IOException e) {
                    // 连接异常，取消注册并关闭
                    key.cancel();
                    key.channel().close();
                }
            }
        }
    }

    public static void main(String[] args) throws IOException {
        new NioEchoServer().start();
    }
}
```

**关键要点：**
1. `keyIterator.remove()` 必须调用——Selector 不会自动从 `selectedKeys` 集合中移除已处理的 Key
2. `interestOps()` 用于动态切换感兴趣的事件类型（读写交替）
3. `key.attach()` 可以在 SelectionKey 上附加任意 Object，用于在事件间传递上下文
4. `read()` 返回 -1 表示对端关闭连接（EOF），必须调用 `key.cancel()` 和 `channel.close()`

---

## 七、IO 在 AI 应用中的实践

在大模型（LLM）应用开发中，IO 模型直接影响用户体验和系统吞吐。以下是三个核心场景。

### 7.1 SSE 流式响应处理

SSE（Server-Sent Events）是 LLM streaming 的标准协议。当用户发起一个 Chat Completion 请求时，服务端以 SSE 流式地返回每个 token，前端逐步渲染。

**SSE 协议格式：**

```
data: {"choices":[{"delta":{"content":"你"}}],"id":"chatcmpl-xxx"}

data: {"choices":[{"delta":{"content":"好"}}],"id":"chatcmpl-xxx"}

data: [DONE]

```

**服务端：使用 Virtual Threads + Spring MVC SSE**

```java
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import java.io.IOException;
import java.util.concurrent.Executors;

@RestController
@RequestMapping("/api/chat")
public class ChatStreamController {

    // 注意：SSE 请求必须在 Virtual Thread 上处理
    // 配置：spring.threads.virtual.enabled=true

    @GetMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter chatStream(@RequestParam String prompt) {
        var emitter = new SseEmitter(0L);  // 0 = 无超时

        // SseEmitter 内部使用阻塞 write，适合 Virtual Threads
        Thread.ofVirtual().start(() -> {
            try {
                // 模拟 LLM token 流式返回
                String[] tokens = {"你好", "！", "我是", "AI", "助手", "，", "很高兴", "为你", "服务", "。"};
                for (String token : tokens) {
                    // 每个 token 作为一个 SSE 事件发送
                    emitter.send(SseEmitter.event()
                        .data("{\"token\":\"" + token + "\"}")
                        .id(String.valueOf(System.currentTimeMillis())));
                    Thread.sleep(200); // 模拟生成延迟
                }
                emitter.complete();
            } catch (IOException | InterruptedException e) {
                emitter.completeWithError(e);
            }
        });

        return emitter;
    }
}
```

**客户端：使用 JDK HttpClient 消费 SSE 流**

```java
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.concurrent.Flow;
import java.util.concurrent.CompletableFuture;

public class SseStreamClient {

    public void consumeSseStream() throws Exception {
        var client = HttpClient.newHttpClient();
        var request = HttpRequest.newBuilder()
            .uri(URI.create("http://localhost:8080/api/chat/stream?prompt=hello"))
            .header("Accept", "text/event-stream")
            .GET()
            .build();

        // 使用 BodySubscribers 的 fromLineSubscriber 逐行解析 SSE
        var subscriber = new Flow.Subscriber<String>() {
            private Flow.Subscription subscription;

            @Override
            public void onSubscribe(Flow.Subscription subscription) {
                this.subscription = subscription;
                subscription.request(Long.MAX_VALUE); // 反压策略：无限制
            }

            @Override
            public void onNext(String line) {
                if (line.startsWith("data:")) {
                    String data = line.substring(5).trim();
                    if (!"[DONE]".equals(data)) {
                        System.out.println("Received: " + data);
                        // 实时渲染 token...
                    }
                }
            }

            @Override
            public void onError(Throwable throwable) {
                throwable.printStackTrace();
            }

            @Override
            public void onComplete() {
                System.out.println("SSE stream completed.");
            }
        };

        client.sendAsync(request, HttpResponse.BodyHandlers.fromLineSubscriber(subscriber))
            .thenAccept(response -> System.out.println("Response status: " + response.statusCode()))
            .join();
    }
}
```

**Virtual Threads 在 SSE 场景中的价值：**

在传统线程模型下，每个 SSE 连接会长时间占用一个平台线程（可能持续数十秒到数分钟）。如果有 10000 个并发 SSE 连接，传统的线程池模型会面临严重的资源问题。Virtual Threads 的轻量级特性（每个 VT 仅占用几百字节）使得用同步阻塞风格处理大量 SSE 连接成为可能。

```
传统线程模型（ThreadPool）： 10000 并发 SSE → 10000 平台线程 → ~10GB 栈内存
Virtual Threads：             10000 并发 SSE → 10000 虚拟线程  → ~几 MB 内存
```

### 7.2 大文件上传

AI 应用中常见的文件上传场景（如知识库文档上传）需要处理大文件。基本模式是：接收文件 → 流式写入磁盘/对象存储 → 异步处理。

```java
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import java.io.IOException;
import java.nio.channels.FileChannel;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;

@RestController
@RequestMapping("/api/files")
public class FileUploadController {

    private static final long MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
    private static final Path UPLOAD_DIR = Path.of("/tmp/uploads");

    @PostMapping("/upload")
    public String uploadFile(@RequestParam("file") MultipartFile file) throws IOException {
        if (file.getSize() > MAX_FILE_SIZE) {
            throw new IllegalArgumentException("File too large: " + file.getSize());
        }

        // 获取原始文件的 InputStream（封装了临时文件或内存缓冲）
        // 对于大文件，Spring 会将文件写入临时目录
        var fileName = System.currentTimeMillis() + "_" + file.getOriginalFilename();
        var targetPath = UPLOAD_DIR.resolve(fileName);

        java.nio.file.Files.createDirectories(UPLOAD_DIR);

        // 使用 transferTo 实现高效的流式写入（利用零拷贝）
        try (var inputStream = file.getInputStream();
             var fileChannel = FileChannel.open(targetPath,
                 StandardOpenOption.CREATE, StandardOpenOption.WRITE)) {

            // 用 Channel 方式写入（避免不必要的 buffer 复制）
            var readableByteChannel = java.nio.channels.Channels.newChannel(inputStream);
            long transferred = 0;
            long position = 0;
            while ((transferred = fileChannel.transferFrom(readableByteChannel, position, 8192)) > 0) {
                position += transferred;
            }
        }

        // 异步触发后续处理（文档解析、切片、Embedding 等）
        Thread.ofVirtual().start(() -> processUploadedFile(targetPath));

        return "Uploaded: " + fileName + " (" + file.getSize() + " bytes)";
    }

    private void processUploadedFile(Path filePath) {
        // 异步处理：文档解析 → 切片 → Embedding → 写入向量数据库
        System.out.println("Processing: " + filePath);
    }
}
```

**大文件上传的最佳实践：**

1. **分片上传（Multipart Upload）**：对于超大文件（> 100MB），使用分片上传。MinIO/S3 支持 multipart upload API
2. **流式处理，避免全量加载进内存**：无论文件多大，始终使用流（Stream/Channel）
3. **异步处理**：上传完成后立即返回响应，后台异步处理（解析、切片等）
4. **限制并发**：使用 Semaphore 或 RateLimiter 限制同时上传的数量

### 7.3 WebSocket 实时通信

WebSocket 在 AI 应用中有多个场景：Agent 状态的实时推送、多 Agent 协作的消息通道、推理进度的实时更新。

```java
import org.springframework.web.socket.*;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import org.springframework.stereotype.Component;
import java.io.IOException;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class AiAgentWebSocketHandler extends TextWebSocketHandler {

    // 保存所有活跃的 WebSocket 会话
    private final ConcurrentHashMap<String, WebSocketSession> sessions = new ConcurrentHashMap<>();

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        sessions.put(session.getId(), session);
        System.out.println("WebSocket connected: " + session.getId());

        // 发送欢迎消息
        try {
            session.sendMessage(new TextMessage(
                "{\"type\":\"connected\",\"sessionId\":\"" + session.getId() + "\"}"));
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        var payload = message.getPayload();
        System.out.println("Received: " + payload);

        // 模拟 Agent 处理并返回结果
        // 实际场景中，这里会调用 Agent 执行引擎
        Thread.ofVirtual().start(() -> {
            try {
                for (int i = 0; i < 5; i++) {
                    var progressMsg = String.format(
                        "{\"type\":\"agent_progress\",\"step\":%d,\"status\":\"thinking\"}", i);
                    session.sendMessage(new TextMessage(progressMsg));
                    Thread.sleep(1000);
                }
                session.sendMessage(new TextMessage(
                    "{\"type\":\"agent_result\",\"data\":\"Task completed successfully\"}"));
            } catch (IOException | InterruptedException e) {
                e.printStackTrace();
            }
        });
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        sessions.remove(session.getId());
        System.out.println("WebSocket disconnected: " + session.getId());
    }

    // 向指定会话推送消息
    public void pushToSession(String sessionId, String message) throws IOException {
        var session = sessions.get(sessionId);
        if (session != null && session.isOpen()) {
            session.sendMessage(new TextMessage(message));
        }
    }

    // 广播消息
    public void broadcast(String message) {
        sessions.values().forEach(session -> {
            try {
                if (session.isOpen()) {
                    session.sendMessage(new TextMessage(message));
                }
            } catch (IOException e) {
                e.printStackTrace();
            }
        });
    }
}
```

**WebSocket 配置类：**

```java
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.*;

@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    private final AiAgentWebSocketHandler handler;

    public WebSocketConfig(AiAgentWebSocketHandler handler) {
        this.handler = handler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(handler, "/ws/agent")
            .setAllowedOrigins("*");  // 生产环境应限制来源
    }
}
```

**WebSocket 与 SSE 的选型：**

| 场景 | 推荐 | 原因 |
|------|------|------|
| LLM 流式响应（单向） | SSE | 协议简单、自动重连、HTTP/2 多路复用 |
| Agent 状态推送（单向） | SSE | 服务端 → 客户端，无需双向 |
| 对话交互（双向） | WebSocket | 双向通信、低延迟 |
| 文件传输 | WebSocket | 二进制帧支持，效率高 |
| 浏览器兼容 | SSE | 基于 HTTP，穿透代理/防火墙更容易 |
| 极低延迟要求 | WebSocket | 全双工，头部开销极小 |

---

## 八、性能对比与选型指南

### 8.1 IO 模型性能对比

| 维度 | BIO | NIO (Selector) | NIO.2 (AIO) | Netty |
|------|-----|----------------|-------------|-------|
| **并发连接数** | ~1000 | ~10000+ | ~10000+ | 100000+ |
| **线程模型** | 1 连接 1 线程 | 1 Selector 多连接 | 回调式 | EventLoop 组 |
| **编程复杂度** | 低 | 中 | 高（回调地狱） | 中（Pipeline 抽象） |
| **性能** | 低 | 高 | 中（依赖 OS 实现） | 最高 |
| **社区生态** | 基础 | 基础 | 少 | 极丰富（编解码、安全） |

### 8.2 技术选型决策树

```
需要什么 IO 能力？
│
├── 简单文件读写
│   └── java.io / java.nio.file.Files
│
├── 低并发网络服务（< 1000 连接）
│   └── BIO + Virtual Threads
│       （同步编程模型 + 轻量级线程 = 开发效率最优）
│
├── 高并发网络服务（> 10000 连接）
│   ├── 协议简单 → 原生 NIO + Selector
│   ├── 复杂协议/需要编解码 → Netty
│   └── HTTP 服务 → Spring Boot (底层 Tomcat/Netty)
│
├── 大文件传输
│   ├── 纯转发 → FileChannel.transferTo()（sendfile）
│   ├── 需要处理内容 → MappedByteBuffer（mmap）
│   └── AI 文档上传 → 流式接收 + 异步处理
│
├── LLM 流式响应
│   └── SSE (Spring MVC SseEmitter) + Virtual Threads
│
├── 实时双向通信
│   └── WebSocket (Spring WebSocket + Netty)
│
└── 消息队列/事件驱动
    └── Netty（Kafka、RocketMQ 的底层）
```

### 8.3 Virtual Threads 时代 IO 模型的变化

JDK 21+ Virtual Threads 改变了 IO 模型的选型逻辑：

```java
// 以前：高并发 IO 必须用 NIO + Reactor / CompletableFuture
// 现在：可以用 BIO 风格 + Virtual Threads（底层仍然是 NIO 实现）

void modernConcurrentIo() throws Exception {
    try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
        var futures = new java.util.ArrayList<java.util.concurrent.Future<String>>(1000);

        for (int i = 0; i < 1000; i++) {
            int taskId = i;
            futures.add(executor.submit(() -> {
                // 同步风格的网络调用
                // 当 IO 阻塞时，VT 被卸载（unmount），平台线程继续处理其他 VT
                // IO 就绪后，VT 被重新挂载（mount）到平台线程
                var url = URI.create("http://localhost:8080/api/task/" + taskId);
                try (var client = java.net.http.HttpClient.newHttpClient()) {
                    var request = java.net.http.HttpRequest.newBuilder(url).GET().build();
                    var response = client.send(request,
                        java.net.http.HttpResponse.BodyHandlers.ofString());
                    return response.body();
                }
            }));
        }

        for (var future : futures) {
            System.out.println(future.get().substring(0, Math.min(100, future.get().length())));
        }
    }
}
```

**关键认知转变：** Virtual Threads 不替代 NIO，而是改变了"如何使用 NIO"。底层 JDK 已将 `SocketChannel` 等 IO 操作的阻塞实现改造为通过 Virtual Threads 的 `park/unpark` 机制触发。开发者可以享受同步编程的简洁性，同时获得 NIO 的高并发能力。

---

## 九、常见问题

### Q1: ByteBuffer 的 flip() 到底做了什么？

`flip()` 将 Buffer 从写模式切换到读模式。具体操作是：`limit = position; position = 0;`。这意味着：可读范围的起点是 0，终点是之前写入的最后一个位置。忘记调用 `flip()` 是最常见的 NIO Bug 之一。

### Q2: Direct Buffer 何时释放？

Direct Buffer 的内存释放依赖于 `Cleaner` 和虚引用机制。当 DirectByteBuffer 对象被 GC 回收时，Cleaner 会调用 `Unsafe.freeMemory()` 释放堆外内存。由于依赖 GC，释放时机不确���，因此 Netty 实现了自己的引用计数和内存池机制。

### Q3: Netty 的 EventLoop 是否线程安全？

Netty 的设计保证了：一个 EventLoop 内的所有操作都是线程安全的，因为它们在同一个线程中串行执行。但**跨 EventLoop 的操作需要额外同步**。因此，不要在一个 EventLoop 中直接操作另一个 EventLoop 管理的 Channel。

### Q4: 何时使用 Pooled vs Unpooled ByteBuf？

**Pooled（推荐）**：高频分配/释放场景，如网络 IO、消息处理。池化减少了内存分配和 GC 压力。
**Unpooled**：一次性操作、测试代码、或分配频率极低的场景。简单但每次分配有开销。

### Q5: epoll 空轮询 Bug 会影响 JDK 25 吗？

JDK 25 中的 `EPollSelectorImpl` 已经实现了类似于 Netty 的防御性检查机制（JDK 11+ 开始逐步改进）。在大多数场景下，该问题已得到缓解。但 Netty 仍然保留重建 Selector 的策略作为双重保险。

---

## 相关条目

- [[02-现代Java25深度解析]] — Virtual Threads 深入解析：park/unpark 机制与 NIO 的关系
- [[02-Java并发深度解析]] — Java 并发编程：线程模型、Structured Concurrency、CompletableFuture
- [[01-操作系统基础]] — 操作系统 IO 模型：select/poll/epoll/kqueue 系统调用层分析
- [[04-Kafka深度解析]] — Kafka 核心设计：零拷贝在 Kafka 中的完整实现路线
