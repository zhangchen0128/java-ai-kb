---
domain: 04-数据与中间件
title: Redis 深度解析
status: verified
verification:
  reviewed_at: 2026-07-27
  version_anchor: Redis 8 command and data model
  code_status: tested
  lab: lab-rag-pipeline
  evidence:
    scope: article-core
    source_files:
      - labs/lab-rag-pipeline/src/main/java/com/javaai/kb/labs/rag/ChunkerDemo.java
      - labs/lab-rag-pipeline/src/main/java/com/javaai/kb/labs/rag/DeterministicRagPipeline.java
    test_files:
      - labs/lab-rag-pipeline/src/test/java/com/javaai/kb/labs/rag/DeterministicRagPipelineTest.java
  performance:
    status: illustrative
level: advanced
sources:
  - level: L1
    url: https://redis.io/docs/latest/
    description: Redis 7.x 官方文档
  - level: L2
    url: https://github.com/redis/redis
    description: Redis 源码（SDS、quicklist、skiplist 实现）
  - level: L3
    url: https://redisbook.com/
    description: 《Redis 设计与实现》— 黄健宏，Redis 内部数据结构与机制
relations:
  prerequisite:
    - 01-数据库原理
    - 04-PostgreSQL与pgvector深度解析
  related:
    - 05-缓存策略与多级缓存架构
    - 05-幂等设计与分布式锁
tags:
  - redis
  - sds
  - rdb
  - aof
  - sentinel
  - cluster
  - redisson
  - vector-search
  - cache-strategy
  - lettuce
created: 2026-07-17
updated: 2026-07-27
content_type: production
---

# Redis 深度解析

> **性能数据声明：** 除非具体表格同时给出硬件、软件版本、数据规模、参数、
> 测试脚本、运行次数、P50/P95/P99、日期和原始结果链接，否则本文中的精确
> 性能数字均为“示意值，不代表基准结果”，不能用于容量规划或产品比较。

## 概述

Redis 是高性能的内存键值存储，广泛用于缓存、分布式锁、消息队列、限流和实时数据场景。在 AI 应用中，Redis Vector Search 为实时语义缓存和低延迟向量检索提供了新可能。

本文深入 Redis 内部数据结构实现、持久化机制、高可用架构、分布式锁原理、缓存策略模式，以及 Java 客户端选择和 AI 场景应用。

---

## 一、数据结构深入

### 1.1 String — SDS（Simple Dynamic String）

Redis 不直接使用 C 字符串，而是实现了 SDS：

```c
// Redis 7.x sds.h（简化）
typedef char *sds;
struct __attribute__ ((__packed__)) sdshdr64 {
    uint64_t len;    // 已使用长度（O(1) 获取）
    uint64_t alloc;  // 分配的总容量（不含头和空终止符）
    unsigned char flags; // sdshdr 类型标识
    char buf[];      // 实际数据
};
```

**与 C 字符串的优势：**
- O(1) 获取长度（len 字段）
- 杜绝缓冲区溢出（alloc 预分配）
- 二进制安全（不依赖 `\0` 终止，len 决定长度）
- 空间预分配和惰性释放（减少内存分配次数）

### 1.2 Hash — ziplist 到 hashtable 的演进

**小哈希使用 ziplist：** 连续内存块的紧凑结构，存储相邻的 field-value 对。

```
ziplist 触发条件（可配置）：
- hash-max-ziplist-entries = 512
- hash-max-ziplist-value = 64
```

**大哈希使用 hashtable：** 标准链式哈希表，使用 MurmurHash2 算法，渐进式 rehash。

```c
// dict.h（简化）
typedef struct dict {
    dictType *type;
    dictEntry **ht_table[2];  // 两个哈希表，用于渐进式 rehash
    unsigned long ht_used[2];
    long rehashidx;           // -1 表示未在 rehash
    int16_t pauserehash;
} dict;
```

**渐进式 rehash 流程：**
1. 为 `ht_table[1]` 分配内存（通常为 `ht_table[0]` 已使用的 2 倍）
2. `rehashidx = 0`，开始渐进迁移
3. 每次增删改查操作顺带迁移一个槽位
4. 后台定时任务批量迁移（1ms 内迁移 100 个槽位）
5. 迁移完毕后 `ht_table[1]` 成为 `ht_table[0]`，释放旧表

### 1.3 List — quicklist

Redis 7.x 使用 quicklist（ziplist + linkedlist 的混合体）：

```
quicklist
┌──────────┐   ┌──────────┐   ┌──────────┐
│ listNode │──▶│ listNode │──▶│ listNode │
│ ziplist  │   │ ziplist  │   │ ziplist  │
└──────────┘   └──────────┘   └──────────┘
```

```ini
# quicklist 参数
list-max-ziplist-size = -2  # 每个 ziplist 最大 8KB
list-compress-depth = 0     # 不压缩（1 表示两端不压缩中间压缩）
```

### 1.4 ZSet — skiplist + dict

有序集合使用跳表 + 哈希表的组合：`dict` 提供 O(1) 按成员查分值，`skiplist` 提供 O(log N) 范围查询。

```c
// server.h（简化）
typedef struct zskiplistNode {
    sds ele;                    // 成员
    double score;               // 分值
    struct zskiplistNode *backward; // 后退指针
    struct zskiplistLevel {
        struct zskiplistNode *forward;
        unsigned long span;     // 到下一节点的跨度（用于计算 rank）
    } level[];                  // 多层索引
} zskiplistNode;

typedef struct zskiplist {
    struct zskiplistNode *header, *tail;
    unsigned long length;
    int level;                  // 当前最大层数
} zskiplist;
```

**跳表层数随机生成：** 每层有 25% 概率增加一层（p=0.25），因此平均层数 = 1/(1-p) = 1.33 层。

### 1.5 Stream — 消费组与 ACK

Stream 是 Redis 5.0 引入的持久化消息队列，支持消费组、ACK 机制和死信处理。

```
Stream 内部结构（radix tree 按消息 ID 组织）：
stream
├── consumer_group_1
│   ├── consumer_A: pending_ids = [id1, id3]
│   └── consumer_B: pending_ids = [id2]
└── consumer_group_2
    └── consumer_C: pending_ids = [id4]
```

```bash
# 创建消费组
XGROUP CREATE mystream mygroup $ MKSTREAM

# 消费消息（消费者 A）
XREADGROUP GROUP mygroup consumer_a COUNT 2 BLOCK 5000 STREAMS mystream >

# 确认消息
XACK mystream mygroup 1692632086370-0

# 处理死信（pending 超过 60 秒未 ACK 的消息）
XPENDING mystream mygroup - + 100
# 认领超时消息
XCLAIM mystream mygroup consumer_b 60000 1692632086370-0
```

---

## 二、持久化机制

### 2.1 RDB（Redis Database）

**触发时机：**
- `SAVE`（阻塞主线程） / `BGSAVE`（fork 子进程）
- 配置 `save <seconds> <changes>` 自动触发

**COW（Copy-On-Write）原理：**

```
BGSAVE 过程：
1. fork() 子进程（父进程内存页表复制，数据页标记为只读）
2. 父进程继续处理命令，写操作时触发页错误 → 内核复制页 → 标记可写
3. 子进程读取原始数据页，写入 RDB 文件
4. 子进程完成后通知父进程，替换旧 RDB
```

**RDB 调优：**
```ini
save 900 1     # 900秒内1次修改 → 触发
save 300 10    # 300秒内10次修改
save 60 10000  # 60秒内10000次修改

rdbcompression yes       # LZF 压缩
rdbchecksum yes          # CRC64 校验
stop-writes-on-bgsave-error yes
```

### 2.2 AOF（Append Only File）

**fsync 策略：**

| 策略 | `appendfsync` | 安全性 | 性能 |
|------|---------------|--------|------|
| always | 每次命令 fsync | 最高，不丢数据 | 最低（磁盘速度） |
| everysec | 每秒 fsync | 最多丢 1 秒数据 | 中等（推荐） |
| no | 交由 OS | 最差 | 取决于 OS 配置 |

**AOF 重写机制：**

```
重写前（AOF 文件）：
SET counter 1
INCR counter
INCR counter
INCR counter

重写后：
SET counter 4
```

重写过程：
1. `BGREWRITEAOF` → fork 子进程
2. 子进程读取数据库当前状态，写入新 AOF
3. 重写期间的新命令写入 AOF 重写缓冲区
4. 子进程完成后，将缓冲区的命令追加到新 AOF
5. 原子 rename 替换旧 AOF

### 2.3 混合持久化（Redis 4.0+）

```ini
aof-use-rdb-preamble yes
```

混合持久化将 RDB 快照 + AOF 增量日志结合：
1. AOF 重写时，先写入 RDB 格式的快照
2. 快照后的命令以 AOF 格式追加

恢复时先加载 RDB 快照（快速），再重放增量 AOF 命令（数据一致）。

---

## 三、高可用架构

### 3.1 主从复制

**全量复制流程：**
```
Slave                              Master
  | --- PSYNC ? -1 ---------------> |  （首次：请求全量）
  |                                  |  fork → BGSAVE
  | <-- FULLRESYNC <replid> 0 ---- | 
  |                                  |  发送 RDB
  | <-- RDB 文件传输 ------------- |
  |                                  加载 RDB
  | --- PSYNC <replid> <offset> --> |  （请求增量同步）
  | <-- 增量数据（replication buffer）
```

**部分复制（PSYNC）：**
```
Slave                              Master
  | --- PSYNC <replid> <offset> --> |
  |                                  |  检查 replication backlog
  |                                  |  如果 offset 在 backlog 范围内
  | <-- CONTINUE ----------------- |  （增量同步）
  |                                  |  否则
  | <-- FULLRESYNC --------------  |  （全量同步）
```

关键参数：
```ini
repl-backlog-size = 64mb      # 复制积压缓冲区大小
repl-backlog-ttl = 3600       # 1 小时后未使用释放
```

### 3.2 Sentinel

Sentinel 解决主从架构的故障自动转移问题。

**主观下线（SDOWN）vs 客观下线（ODOWN）：**

```
Sentinel 节点判断链路：
PING 超时 → SDOWN（单 Sentinel 认为下线）
         → 询问其他 Sentinel → quorum 个确认 → ODOWN（共识下线）
```

**领头选举（Leader Election）：**

```
1. 发现 ODOWN 的 Sentinel 发起选举（epoch 自增）
2. 向其他 Sentinel 发送 is-master-down-by-addr（含 runid）
3. 收到请求的 Sentinel：先到先得（同一 epoch 内）
4. 获得多数票（> N/2）的 Sentinel 成为 Leader
5. Leader 执行故障转移
```

**故障转移步骤：**
1. 选出新主（优先级最高 > 复制偏移最大 > runid 最小）
2. 从节点 `SLAVEOF NEW_MASTER`
3. 旧主恢复后成为新主的从节点

### 3.3 Cluster

Redis Cluster 使用哈希槽（16384 个）分片数据。

```
CRC16(key) % 16384 → 哈希槽 → 负责的节点
```

**MOVED vs ASK 重定向：**

```
Client                         Node A (槽 0-5000)
  | --- GET key{slot=6000} ---> |
  | <-- MOVED 6000 192.168.1.3:6379 （永久重定向）
  |                              客户端更新槽位映射表

Client                         Node B (槽 5001-10000)
  | --- GET key{slot=6000} ---> |
  |                              正在迁移，本地无此 key
  | <-- ASK 6000 192.168.1.3:6379 （临时重定向）
  | --- ASKING → GET key ------> | (Node C)
```

**客户端路由策略（Lettuce 实现）：**

```java
// Lettuce 集群客户端自动处理 MOVED/ASK
var client = RedisClusterClient.create("redis://localhost:7000,localhost:7001");
var connection = client.connect();
var commands = connection.sync();
commands.set("key", "value"); // 自动路由到正确节点
```

---

## 四、分布式锁

### 4.1 Redisson 看门狗（Watchdog）

Redisson 解决了简单 SET NX PX 锁的"锁提前释放"问题：

```java
// 1. 获取锁
RLock lock = redisson.getLock("order:123:lock");

// 自动续期（看门狗每 10 秒检查，持锁超时 30 秒）
lock.lock();  // 等价于 lock.lock(30, TimeUnit.SECONDS)

try {
    // 业务逻辑
} finally {
    lock.unlock();
}
```

**看门狗原理（Redisson 源码分析）：**

```
lock() 流程：
1. Lua 脚本：SETNX + PEXPIRE（原子）
2. 定时任务（netty timer）：
   - 每 internalLockLeaseTime/3 = 10s 执行一次
   - 检查锁是否还被当前线程持有
   - 如果持有 → PEXPIRE 续期到 30s
3. unlock() 时取消定时任务

Lua 续期脚本（简化）：
if redis.call('hexists', KEYS[1], ARGV[2]) == 1 then
    return redis.call('pexpire', KEYS[1], ARGV[1])
end
```

### 4.2 红锁（RedLock）争议

Martin Kleppmann 在《How to do distributed locking》中指出红锁的问题：

1. **时钟跳跃：** 如果获取锁后 GC/时钟跳跃，锁可能在"还持有"的幻觉中过期
2. **Fencing Token：** 应附带单调递增的 token，资源服务器需要校验

```java
// Redisson 的红锁实现
RLock lock1 = redisson1.getLock("lock");
RLock lock2 = redisson2.getLock("lock");
RLock lock3 = redisson3.getLock("lock");
RedissonRedLock redLock = new RedissonRedLock(lock1, lock2, lock3);

redLock.lock();
try {
    // 关键资源操作
} finally {
    redLock.unlock();
}
```

**生产建议：** 在多数场景中，单 Redis 实例 + Redisson 看门狗 已足够。红锁仅在对一致性有极高要求且可接受复杂度和性能开销时使用。更严格的一致性场景应使用 ZooKeeper 或数据库锁。

### 4.3 SET NX PX 原子性

```java
// Jedis 方式（SET NX PX 原子命令）
String result = jedis.set("lock:key", "unique_value",
        SetParams.setParams().nx().px(30000));
if ("OK".equals(result)) {
    try {
        // 业务逻辑
    } finally {
        // Lua 脚本原子释放（确保释放的是自己持有的锁）
        String script = """
            if redis.call('get', KEYS[1]) == ARGV[1] then
                return redis.call('del', KEYS[1])
            else
                return 0
            end""";
        jedis.eval(script, List.of("lock:key"), List.of("unique_value"));
    }
}
```

---

## 五、缓存策略

### 5.1 Cache-Aside 模式

```
读操作：
1. 查缓存
2. 命中 → 返回
3. 未命中 → 查 DB → 写缓存 → 返回

写操作：
1. 更新 DB
2. 删除缓存（而非更新缓存）
```

**为什么是删除缓存而非更新？**
- 更新缓存+更新DB之间存在时序问题
- 如果写入顺序是 写DB→写缓存，并发读写可能导致缓存脏数据
- 删除缓存+惰性加载更简单可靠

**先删缓存还是先更新DB？**

| 顺序 | 风险 |
|------|------|
| 先删缓存 → 更新DB | 删缓存后、更新DB前的空隙，读请求查到旧数据并写入缓存 |
| 先更新DB → 删缓存 | 更新DB后、删缓存前读到的仍是旧缓存（窗口极小） |

### 5.2 延迟双删

```java
@Service
public class UserService {

    private final UserRepository userRepo;
    private final StringRedisTemplate redis;
    private final TaskExecutor taskExecutor;

    // 延迟双删策略
    public void updateUser(Long userId, UserDto dto) {
        // 1. 第一次删除缓存
        redis.delete("user:" + userId);

        // 2. 更新数据库
        userRepo.update(userId, dto);

        // 3. 延迟第二次删除（异步，等待并发读完成）
        taskExecutor.execute(() -> {
            try {
                Thread.sleep(500); // 视业务场景调整
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            redis.delete("user:" + userId);
        });
    }
}
```

### 5.3 布隆过滤器穿透防护

```java
@Configuration
public class BloomFilterConfig {

    @Bean
    public BloomFilter<String> userIdBloomFilter() {
        // Guava 本地布隆过滤器
        return BloomFilter.create(
                Funnels.stringFunnel(StandardCharsets.UTF_8),
                1_000_000,  // 期望元素数
                0.01        // 误判率 1%
        );
    }
}

// 结合 Redis 模块布隆过滤器（更推荐，共享状态）
// BF.RESERVE user:bloom 0.01 1000000
// BF.ADD user:bloom "user_123"
// BF.EXISTS user:bloom "user_123"

@Service
public class UserQueryService {

    private final RedisTemplate<String, User> redis;
    private final UserRepository users;

    public UserQueryService(RedisTemplate<String, User> redis, UserRepository users) {
        this.redis = redis;
        this.users = users;
    }

    public User getUser(String userId) {
        // 1. 布隆过滤器快速排除不存在的 key
        Boolean exists = redis.execute((RedisCallback<Boolean>) conn ->
                conn.execute("BF.EXISTS", "user:bloom".getBytes(), userId.getBytes()));

        if (Boolean.FALSE.equals(exists)) {
            return null; // 一定不存在，无需查 DB
        }

        // 2. 查缓存 / 查 DB
        var key = "user:" + userId;
        var cached = redis.opsForValue().get(key);
        if (cached != null) {
            return cached;
        }
        var loaded = users.findById(userId).orElse(null);
        if (loaded != null) {
            redis.opsForValue().set(key, loaded, Duration.ofMinutes(10));
        }
        return loaded;
    }
}
```

---

## 六、Java 客户端对比

### 6.1 Lettuce vs Jedis

| 维度 | Lettuce | Jedis |
|------|---------|-------|
| 连接模型 | 单连接复用（基于 Netty） | 每线程一个连接 |
| 异步支持 | 原生异步/响应式 API | 需额外 JedisPool 封装 |
| 线程安全 | 完全线程安全 | Jedis 实例非线程安全 |
| 连接数占用 | 低（单连接） | 高（每线程一个） |
| 集群支持 | 原生支持 Cluster/Sentinel | 支持但 API 较旧 |
| Spring Boot 默认 | Spring Boot 2.x+ 默认 | 旧版默认 |

**Lettuce 异步 API 示例：**

```java
// 异步 API
var future = redisAsyncCommands.get("key");
future.thenAccept(value -> System.out.println("Got: " + value));

// 响应式 API
redisReactiveCommands.get("key")
        .map(value -> "Processed: " + value)
        .subscribe(System.out::println);
```

### 6.2 Spring Data Redis 配置

```yaml
spring:
  data:
    redis:
      host: localhost
      port: 6379
      password: ${REDIS_PASSWORD}
      lettuce:
        pool:
          max-active: 16
          max-idle: 8
          min-idle: 4
          max-wait: 2000ms
      timeout: 3000ms
      cluster:
        nodes:
          - 192.168.1.10:6379
          - 192.168.1.11:6379
          - 192.168.1.12:6379
```

---

## 七、AI 场景：Redis Vector Search

### 7.1 向量索引创建

```bash
# 创建向量索引（余弦距离）
FT.CREATE idx:docs ON HASH PREFIX 1 doc:
  SCHEMA text TEXT content VARCHAR
  embedding VECTOR FLAT 6 TYPE FLOAT32 DIM 1536 DISTANCE_METRIC COSINE
```

```java
@Service
public class RedisVectorService {

    private final RedissonClient redisson;
    private final EmbeddingModel embeddingModel;

    // 添加文档向量
    public void addDocument(String docId, String content, float[] embedding) {
        var key = "doc:" + docId;
        var map = new HashMap<String, Object>();
        map.put("content", content);
        map.put("embedding", embeddingToBytes(embedding));
        redisson.getMap(key).putAll(map);
    }

    private byte[] embeddingToBytes(float[] embedding) {
        var buffer = ByteBuffer.allocate(embedding.length * Float.BYTES);
        buffer.order(ByteOrder.LITTLE_ENDIAN);
        for (var val : embedding) {
            buffer.putFloat(val);
        }
        return buffer.array();
    }
}
```

### 7.2 KNN 查询

```bash
# KNN 搜索（返回最近 10 个）
FT.SEARCH idx:docs "*=>[KNN 10 @embedding $vec AS dist]"
  SORTBY dist
  PARAMS 2 vec <binary_blob>
  RETURN 3 content dist
  DIALECT 2
```

### 7.3 语义缓存

```java
public record CachedResponse(String query, String response, long timestamp) {}

public record SemanticMatch(CachedResponse value, double similarity) {}

public interface SemanticCacheIndex {
    List<SemanticMatch> search(float[] embedding, int topK);
}

@Service
public class SemanticCacheService {

    private final EmbeddingModel embeddingModel;
    private final SemanticCacheIndex index;

    public SemanticCacheService(EmbeddingModel embeddingModel, SemanticCacheIndex index) {
        this.embeddingModel = embeddingModel;
        this.index = index;
    }

    public Optional<CachedResponse> findSimilarQuery(String userQuery, double threshold) {
        var queryEmbedding = embeddingModel.embed(userQuery);
        return index.search(queryEmbedding, 5).stream()
            .filter(match -> match.similarity() >= threshold)
            .max(Comparator.comparingDouble(SemanticMatch::similarity))
            .map(SemanticMatch::value);
    }
}
```

---

## 八、常见问题

### 8.1 热 Key / 大 Key

**热 Key 应对：**
```java
// 1. 本地缓存前置（Caffeine + Redis）
@Cacheable(cacheNames = "hot-products", key = "#productId")
public Product getProduct(Long productId) { ... }

// 2. key 分片（冗余多份 + 随机访问其一）
String key = "product:" + productId + ":" + ThreadLocalRandom.current().nextInt(10);
```

**大 Key 检测与处理：**
```bash
# 检测
redis-cli --bigkeys
redis-cli MEMORY USAGE big:hash:key

# 异步删除（Redis 4.0+，避免阻塞）
UNLINK big:hash:key
```

### 8.2 缓存雪崩 / 击穿

**雪崩（大量 key 同时过期）：** 随机 TTL（base_ttl + random_ttl），多级缓存，熔断降级。

**击穿（热点 key 过期时大量请求直达 DB）：**
```java
public String getWithMutex(String key) {
    var value = redis.opsForValue().get(key);
    if (value != null) return value;

    // 加互斥锁
    var lockKey = "lock:" + key;
    try {
        if (redis.opsForValue().setIfAbsent(lockKey, "1", 10, TimeUnit.SECONDS)) {
            // 查 DB
            value = db.query(key);
            redis.opsForValue().set(key, value, 30, TimeUnit.MINUTES);
        } else {
            Thread.sleep(50); // 等持锁线程写入缓存
            return getWithMutex(key);  // 重试
        }
    } finally {
        redis.delete(lockKey);
    }
    return value;
}
```

### 8.3 集群扩容与数据倾斜

```bash
# 查看槽位分布
redis-cli CLUSTER NODES
redis-cli CLUSTER SLOTS

# 重新分片（在线）
redis-cli --cluster reshard 192.168.1.10:6379 \
  --cluster-from <source_node_id> \
  --cluster-to <target_node_id> \
  --cluster-slots 1000
```

---

## 相关条目

- [[04-PostgreSQL与pgvector深度解析]] — PostgreSQL 深度解析
- [[05-缓存策略与多级缓存架构]] — 缓存策略与多级缓存
- [[05-幂等设计与分布式锁]] — 幂等性与分布式锁
- [[04-Kafka深度解析]] — Kafka 消息队列
