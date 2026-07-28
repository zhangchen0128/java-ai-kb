---
domain: 04-数据与中间件
title: MySQL 深度解析
status: draft
level: advanced
sources:
  - level: L1
    url: https://dev.mysql.com/doc/refman/8.4/en/
    description: MySQL 8.4 官方参考手册 — InnoDB 架构、SQL 优化、复制与高可用
  - level: L2
    url: https://github.com/mysql/mysql-server
    description: MySQL 8.0/8.4 源码 — InnoDB 缓冲池、B+Tree 索引、Redo/Undo Log 实现
  - level: L3
    url: https://www.oreilly.com/library/view/high-performance-mysql/9781492080503/
    description: 《高性能MySQL（第4版）》— Baron Schwartz 等，MySQL 性能优化与架构设计权威指南
  - level: L4
    url: https://www.percona.com/blog/
    description: Percona Blog — MySQL 性能调优、死锁分析、复制延迟排查实战文章
relations:
  prerequisite:
    - 01-数据库原理
    - 04-PostgreSQL与pgvector深度解析
  related:
    - 05-缓存策略与多级缓存架构
    - 05-幂等设计与分布式锁
    - 03-SpringDataJPA与MyBatis深度解析
tags:
  - mysql
  - innodb
  - b+tree
  - mvcc
  - redo-log
  - binlog
  - replication
  - hikaricp
  - mybatis
  - shardingsphere
  - sql-optimization
  - deadlock
created: 2026-07-20
updated: 2026-07-20
content_type: concept
---

# MySQL 深度解析

## 概述

MySQL 是全球最流行的开源关系型数据库，在 Java 企业级应用中占据核心地位。根据 DB-Engines 排名，MySQL 长期位列关系型数据库前两名。在 AI 时代，PostgreSQL 凭借 pgvector 等扩展在向量检索领域获得关注，但 MySQL 凭借成熟的 InnoDB 存储引擎、完善的主从复制生态和海量的生产实践积累，仍然是绝大多数企业级 Java 应用的默认选择。

InnoDB 是 MySQL 5.5 起的默认存储引擎，也是事实上的唯一推荐引擎。它提供了 ACID 事务、行级锁、MVCC、聚簇索引、自适应哈希索引、双写缓冲等关键特性，是理解 MySQL 的核心。

本文从 InnoDB 架构出发，深入索引、事务与锁、日志系统、复制机制，并对比 MySQL 与 PostgreSQL 的设计差异，最后给出 Java 集成的最佳实践。

---

## 一、InnoDB 架构深度解析

### 1.1 缓冲池（Buffer Pool）

缓冲池是 InnoDB 最重要的内存结构，缓存数据页和索引页，直接决定读写性能。默认大小约为物理内存的 50%-80%。

```
InnoDB Buffer Pool 内存布局：
┌─────────────────────────────────────────────────────────────┐
│                    Buffer Pool Instance × N                   │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │              LRU List（按访问频度排序）                    │ │
│  │  ┌──────────────────────┬──────────────────────────┐    │ │
│  │  │    Young 区（5/8）    │    Old 区（3/8）          │    │ │
│  │  │   热点数据页          │   新读入/即将淘汰页        │    │ │
│  │  │   (多次访问晋升)      │   (midpoint insertion)    │    │ │
│  │  └──────────────────────┴──────────────────────────┘    │ │
│  ├─────────────────────────────────────────────────────────┤ │
│  │              Free List（空闲页链表）                       │ │
│  ├─────────────────────────────────────────────────────────┤ │
│  │              Flush List（脏页链表，按 oldest_modification） │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**LRU 链表与 midpoint insertion：**

新读入的页不直接插入 LRU 头部（避免一次全表扫描冲掉整个缓冲池），而是插入 Old 区头部（midpoint）。只有在 Old 区被再次访问（innodb_old_blocks_time 时间后），页才会晋升到 Young 区。这个机制防止了"预读污染"和"全表扫描污染"。

```ini
# Buffer Pool 核心参数
innodb_buffer_pool_size = 24G        # 缓冲池总大小
innodb_buffer_pool_instances = 8     # 多实例（建议 ≤ 8），减少并发竞争
innodb_old_blocks_pct = 37           # Old 区占比（37% ≈ 3/8）
innodb_old_blocks_time = 1000        # 在 Old 区驻留 1000ms 后才能晋升 Young
```

**预读机制（Read-Ahead）：**

InnoDB 支持两种预读：线性预读（检测顺序访问模式）和随机预读（检测同一 extent 内的连续访问）。预读页通过 `innodb_read_ahead_threshold` 控制触发阈值。在生产中，随机预读经常弊大于利（可能读入无用页），建议禁用：

```ini
innodb_random_read_ahead = OFF       # 禁用随机预读
innodb_read_ahead_threshold = 56     # 线性预读阈值（extent 内连续访问页数）
```

### 1.2 Change Buffer

Change Buffer 是 InnoDB 对非唯一二级索引的写缓存。当更新二级索引时，如果目标索引页不在缓冲池中，InnoDB 先将变更记录在 Change Buffer 中，等待后续 merge（读入该页时或后台定期 merge），避免随机读磁盘。

```
INSERT/UPDATE 二级索引列
    │
    ├── 目标索引页在 Buffer Pool？
    │   ├── 是 → 直接修改索引页
    │   └── 否 → 写入 Change Buffer（内存 + 磁盘）
    │
    └── Merge 时机：
        1. 该索引页被读入 Buffer Pool
        2. 后台 Master Thread 定期 merge
        3. 数据库关闭时（慢速 shutdown）
```

```ini
innodb_change_buffering = all        # all | none | inserts | deletes | changes | purges
innodb_change_buffer_max_size = 25   # 占 Buffer Pool 的 25%
```

Change Buffer 对写密集型场景（如日志表、订单表的大量插入）有显著提升。对于 SSD 存储，收益相对较低（随机读延迟小），但仍建议默认开启。

### 1.3 自适应哈希索引（AHI）

InnoDB 自动检测被频繁访问的热点 B+Tree 页面，并在内存中为它们建立哈希索引，将 B+Tree 的 O(log N) 查找优化为 O(1)。

```
触发条件：
- 连续访问同一索引页面（B+Tree 的某个"内部节点"）
- 访问模式满足特定条件（等值查询模式）
- 哈希表的大小受 innodb_adaptive_hash_index_parts 分区控制
```

```ini
innodb_adaptive_hash_index = ON      # 默认开启
innodb_adaptive_hash_index_parts = 8 # 哈希索引分区数，减少并发锁竞争
```

**注意事项：** AHI 对等值查询密集的 OLTP 场景（如 `WHERE id = ?`）收益明显，但在范围查询密集的场景可能增加维护开销。如果发现 `sem_wait` 等待事件集中在 AHI 锁竞争上，可临时禁用。

### 1.4 双写缓冲（Doublewrite Buffer）

InnoDB 页大小 16KB，而操作系统/磁盘通常以 4KB 写入。如果在写一个 16KB 页的过程中发生崩溃，可能产生"部分写失效"（partial page write）——页的一部分是新数据，一部分是旧数据，导致数据损坏。

```
Doublewrite Buffer 写入流程：
┌──────────┐    ┌──────────────────────┐    ┌──────────────┐
│ 脏页     │───▶│ Doublewrite Buffer    │───▶│ 数据文件      │
│ (16KB)  │    │ (磁盘上连续 1MB 区域)  │    │ (.ibd)       │
└──────────┘    └──────────────────────┘    └──────────────┘
                  ① 批量顺序写入（1MB）      ② 随机写入各页
                  完成后才执行第二步          利用 ① 恢复

崩溃恢复时：
- 检查数据文件的页 checksum
- 如果校验失败 → 从 Doublewrite Buffer 还原该页的完整副本
```

```ini
innodb_doublewrite = ON               # 强烈建议开启
innodb_doublewrite_dir = /data/mysql  # 双写文件路径（MySQL 8.0.20+ 可独立配置）
innodb_doublewrite_files = 2          # 双写文件数量
```

### 1.5 Redo Log（WAL）

Write-Ahead Logging（WAL）是 InnoDB 保证持久性的核心机制：任何数据页修改前，必须先将对应的 Redo Log 写入磁盘。

```
事务修改流程：
1. 修改 Buffer Pool 中的数据页（标记为脏页）
2. 生成 Redo Log Record 写入 Log Buffer
3. 事务提交时，Log Buffer 刷入 Redo Log File（按 innodb_flush_log_at_trx_commit 策略）
4. 脏页由后台线程异步刷入数据文件（Checkpoint）
```

**`innodb_flush_log_at_trx_commit` 策略对比：**

| 值 | 刷盘策略 | 数据安全 | 性能 | 适用场景 |
|---|---------|---------|------|---------|
| 0 | 每秒刷 Log Buffer → OS Cache → 磁盘 | 丢失 1 秒数据 | 最高 | 写入吞吐优先（日志） |
| 1 | 每次提交刷 Log Buffer → 磁盘（fsync） | 不丢数据 | 较低 | **默认，推荐** |
| 2 | 每次提交刷 Log Buffer → OS Cache；每秒 fsync | 丢 1 秒数据（OS 崩溃） | 中等 | 平衡选择 |

**组提交（Group Commit）：**

当多个事务几乎同时提交时，InnoDB 将它们合并为一次 fsync 操作，显著提升写入吞吐：

```
事务 T1 ──┐
事务 T2 ──┤─── 同一批次刷盘 ──→ 一次 fsync
事务 T3 ──┘
```

```ini
innodb_log_file_size = 2G             # 单个 Redo Log 文件大小
innodb_log_files_in_group = 2         # Redo Log 文件数量
innodb_log_buffer_size = 64M          # Log Buffer 大小
innodb_flush_log_at_trx_commit = 1   # 推荐值
```

### 1.6 Undo Log

Undo Log 存储数据的"修改前版本"，服务于两个目的：
1. **事务回滚：** 将数据恢复到事务开始前的状态
2. **MVCC：** 为并发读提供多版本数据（一致性非锁定读）

```
Undo Log 存储结构：
┌────────────────────┐
│  Rollback Segment  │  ← 每个回滚段包含 1024 个 undo slot
│  ├── undo slot 1   │
│  ├── undo slot 2   │
│  └── ...           │
└────────────────────┘

事务对记录的每次修改产生一条 Undo Log Record：
INSERT  → undo log 类型 TRX_UNDO_INSERT_REC（提交后可直接清理）
UPDATE  → undo log 类型 TRX_UNDO_UPD_EXIST_REC（需保留给 MVCC）
DELETE  → undo log 类型 TRX_UNDO_DEL_MARK_REC（标记删除，等待 purge）
```

**Purge 线程：** 负责清理不再被任何 ReadView 需要的 Undo Log 和标记删除的记录。如果 Purge 速度跟不上更新速度，会导致 Undo 表空间无限膨胀和历史数据版本堆积，查询性能下降（需要遍历更长的版本链）。

```ini
innodb_purge_threads = 4              # Purge 线程数（默认 4）
innodb_purge_batch_size = 300         # 每批 purge 的 undo log 页数
innodb_max_purge_lag = 0              # purge 延迟阈值（0=不限制）
innodb_undo_tablespaces = 2           # Undo 表空间数量
```

---

## 二、索引深入

### 2.1 聚簇索引（Clustered Index）

InnoDB 使用聚簇索引组织数据，即 B+Tree 的叶子节点直接存储完整的数据行。每张表有且仅有一个聚簇索引：

```
InnoDB B+Tree 聚簇索引结构：
                    ┌─────────────────────┐
                    │  根节点（Root Page）  │
                    │  id=50              │
                    └──────┬──────┬───────┘
                  ┌────────┘      └────────┐
          ┌──────▼──────┐          ┌──────▼──────┐
          │  内部节点     │          │  内部节点     │
          │  id=20,35   │          │  id=65,80   │
          └──┬───┬───┬──┘          └──┬───┬───┬──┘
        ┌────┘   │   └────┐      ┌────┘   │   └────┐
   ┌────▼──┐ ┌───▼──┐ ┌───▼──┐ ┌▼───┐ ┌──▼──┐ ┌───▼──┐
   │叶子节点│ │叶子节点│ │叶子节点│ │叶子 │ │叶子 │ │叶子  │
   │id=1..│ │id=21.│ │id=36.│ │id=51│ │id=66│ │id=81│
   │ 完整  │ │ 完整  │ │ 完整  │ │完整 │ │完整 │ │完整  │
   │ 数据行│ │ 数据行│ │ 数据行│ │数据 │ │数据 │ │数据  │
   └───────┘ └──────┘ └──────┘ └─────┘ └─────┘ └──────┘
```

**主键选择原则：**

| 主键类型 | 优势 | 劣势 |
|---------|------|------|
| 自增 BIGINT | 顺序插入，无页分裂，空间紧凑 | 暴露业务量，分布式不友好 |
| UUID v4 | 分布式生成，全局唯一 | 随机插入 → 大量页分裂，二级索引膨胀 |
| UUID v7（时间有序） | 分布式唯一 + 基本有序 | 标准较新，需要 MySQL 8.4 + 应用层支持 |
| 雪花算法（Snowflake） | 分布式唯一 + 递增趋势 | 需要额外组件，依赖时钟 |

**页分裂（Page Split）：**

当数据页（16KB）已满，新插入的记录需要在该页内找到位置时：

```
INSERT 随机主键（如 UUID）导致的页分裂：
原页：[1][5][8][12]      ← 已满，要插入 7
结果：
    首页：[1][5]           ← 分裂
    新页：[7][8][12]       ← 分配新页
    B+Tree 内部节点需要插入新指针 → 可能级联分裂
```

页分裂不仅消耗 CPU 和 IO，还导致数据页利用率降低（页填充因子下降），形成空间碎片。这就是为什么推荐自增或有序主键。

### 2.2 二级索引（Secondary Index）

二级索引的叶子节点存储的是**聚簇索引键值（主键值）**，而非完整数据行。查询通过二级索引找到主键值，再回到聚簇索引查找完整数据行——这就是"回表"：

```
二级索引（idx_name）查找 'zhang'：
          二级索引 B+Tree                  聚簇索引 B+Tree
    ┌─────────────────────┐       ┌─────────────────────┐
    │ idx_name='zhang'    │       │ 主键 id=10001        │
    │ → 主键 id = 10001   │──────▶│ → {name,age,email...}│
    │ → 主键 id = 10042   │       └─────────────────────┘
    └─────────────────────┘               一次"回表"
```

```sql
-- Cardinality 统计信息（索引中不重复值的数量）
SHOW INDEX FROM orders;
-- cardinality 越接近总行数，索引区分度越高，优化器越倾向于使用

-- 强制更新统计信息
ANALYZE TABLE orders;
```

### 2.3 覆盖索引（Covering Index）

如果查询需要的所有列都包含在二级索引中，则不需要回表：

```sql
-- 表结构：orders(id PK, user_id, status, amount, created_at)
-- 索引：idx_user_status(user_id, status)

-- 需要回表（amount 不在索引中）
SELECT amount FROM orders WHERE user_id = 1001 AND status = 'PAID';

-- 覆盖索引（查询列均在索引中）→ Extra: Using index
SELECT user_id, status FROM orders WHERE user_id = 1001 AND status = 'PAID';
```

**覆盖索引的实战价值：** 在分页查询中，先用覆盖索引定位主键范围，再回表取完整数据，可以显著减少随机 IO：

```sql
-- 常规分页（OFFSET 很大时，需要扫描大量无用行）
SELECT * FROM orders ORDER BY created_at LIMIT 100000, 20;

-- 优化：延迟关联（覆盖索引 + 子查询）
SELECT o.* FROM orders o
INNER JOIN (
    SELECT id FROM orders ORDER BY created_at LIMIT 100000, 20
) AS tmp ON o.id = tmp.id;
```

### 2.4 索引下推（ICP — Index Condition Pushdown）

MySQL 5.6 引入的 ICP 将 WHERE 条件中可被索引覆盖的部分下推到存储引擎层过滤，减少回表次数：

```
无 ICP：
存储引擎：按 idx_user_status 范围扫描 → 返回所有行给 Server 层
Server 层：再过滤 WHERE 的其余条件

有 ICP：
存储引擎：按 idx_user_status 范围扫描 → 在引擎层先过滤 → 返回过滤后行
Server 层：处理已大幅减少的行

适用条件：
- 使用二级索引
- WHERE 条件包含索引列（可以是索引中的列，不要求最左前缀匹配）
- 查询类型为 range、ref、eq_ref、ref_or_null
```

```sql
-- 联合索引 idx(a, b, c)
-- ICP 可以将 c 的条件下推到引擎层
SELECT * FROM t WHERE a > 10 AND c = 5;
-- 无 ICP：引擎只按 a > 10 扫描，所有行返回到 Server 层
-- 有 ICP：引擎按 a > 10 扫描 + 同时检查 c = 5，减少返回行
```

### 2.5 Multi-Range Read（MRR）与 Batched Key Access（BKA）

**MRR：** 将二级索引回表的随机 IO 转化为顺序 IO（按主键排序后批量回表）。

```
无 MRR：
二级索引顺序扫描 → 随机的主键值 → 逐个随机 IO 读取数据行

有 MRR：
二级索引顺序扫描 → 收集主键值到缓冲区 → 按主键排序 → 批量顺序 IO 读取
```

```ini
# 开启 MRR（优化器自动选择）
optimizer_switch = 'mrr=on,mrr_cost_based=off'
```

**BKA：** 在 JOIN 操作中结合 MRR。驱动表查出一批 ID 后，按被驱动表主键排序，批量回表查询。

```ini
optimizer_switch = 'batched_key_access=on'
```

### 2.6 B+Tree 页内结构

每个 InnoDB 页（Page，默认 16KB）的内部组织：

```
InnoDB Page 结构（16KB）：
┌──────────────────────────────────┐
│  File Header（38 bytes）          │ ← 页类型、页号、checksum、LSN
├──────────────────────────────────┤
│  Page Header（56 bytes）          │ ← 记录数、槽数、空闲空间指针等
├──────────────────────────────────┤
│  Infimum + Supremum（26 bytes）   │ ← 虚拟最小/最大记录（边界）
├──────────────────────────────────┤
│  User Records（变长）             │ ← 实际数据行（按主键顺序紧凑排列）
├──────────────────────────────────┤
│  Free Space（变长）               │ ← 空闲空间（插入/更新时使用）
├──────────────────────────────────┤
│  Page Directory（变长）           │ ← 槽数组（每 4-8 条记录一个槽，二分查找）
├──────────────────────────────────┤
│  File Trailer（8 bytes）          │ ← checksum + LSN（校验页完整性）
└──────────────────────────────────┘
```

**Page Directory 与二分查找：**

页内记录的查找通过 Page Directory 的槽（slot）实现。每个槽指向一组记录（4-8 条），在组内顺序扫描。这种"槽二分定位 + 组内顺序扫描"的方式在 16KB 页中非常高效。

---

## 三、事务与锁

### 3.1 MVCC（Multi-Version Concurrency Control）

InnoDB 的 MVCC 通过 Undo Log 实现行版本链。每行记录包含两个隐藏列：

```
InnoDB 行隐藏列：
┌─────────────────────────────────────────────────────────┐
│ DB_TRX_ID（6 bytes）  │ DB_ROLL_PTR（7 bytes）          │
│ 最后修改的事务 ID       │ 指向 Undo Log 回滚指针         │
└─────────────────────────────────────────────────────────┘

行版本链示例（同一行被 3 个事务修改）：
当前行（trx_id=300）──▶ Undo Log（trx_id=200）──▶ Undo Log（trx_id=100）
                           旧值: name='B'             旧值: name='A'
```

**ReadView 可见性判断：**

ReadView 是事务在执行快照读时创建的"数据可见性快照"，核心字段：

```
ReadView 结构：
- m_ids：创建 ReadView 时，当前活跃（未提交）的事务 ID 列表
- min_trx_id：m_ids 中的最小值
- max_trx_id：创建 ReadView 时，系统下一个将要分配的事务 ID（= max(m_ids) + 1）
- creator_trx_id：创建该 ReadView 的事务 ID
```

某行记录（trx_id）的可见性判断逻辑：

```
if (trx_id == creator_trx_id)           → 可见（自己的修改）
else if (trx_id < min_trx_id)           → 可见（在 ReadView 创建前已提交）
else if (trx_id >= max_trx_id)          → 不可见（在 ReadView 创建后才开始）
else if (trx_id in m_ids)              → 不可见（当时活跃，尚未提交）
else                                    → 可见（当时活跃但已提交）
```

**READ COMMITTED vs REPEATABLE READ 的 ReadView 差异：**

| 隔离级别 | ReadView 创建时机 | 效果 |
|---------|------------------|------|
| READ COMMITTED | 每次 SELECT 都创建新 ReadView | 可读到其他事务已提交的修改（不可重复读） |
| REPEATABLE READ | 事务中第一次 SELECT 创建，后续复用 | 整个事务看到同一快照（可重复读） |

### 3.2 行锁（Row-Level Locks）

InnoDB 的行锁实现在**索引记录**上，而非物理行上。如果 WHERE 条件无法使用索引（全表扫描），行锁会退化为表锁。

```
InnoDB 行锁类型：
┌──────────────────────────────────────────────────────────┐
│ Record Lock（记录锁）                                     │
│   锁定单个索引记录。例如：                               │
│   SELECT * FROM t WHERE id = 5 FOR UPDATE;              │
│   → 对 id=5 的索引记录加 X 锁                            │
├──────────────────────────────────────────────────────────┤
│ Gap Lock（间隙锁）                                        │
│   锁定索引记录之间的间隙（不含记录本身），防止幻读。       │
│   例如：表中 id 有 1, 5, 10，间隙为 (-∞,1), (1,5),      │
│   (5,10), (10,+∞)                                        │
│   SELECT * FROM t WHERE id BETWEEN 5 AND 10 FOR UPDATE; │
│   → 锁 (5,10] 的记录 + (5,10) 和 (10,+∞) 的间隙           │
├──────────────────────────────────────────────────────────┤
│ Next-Key Lock（临键锁）                                   │
│   = Record Lock + 它前面的 Gap Lock                      │
│   InnoDB 默认的行锁形式（REPEATABLE READ 下）             │
│   例如：id=5 的 Next-Key Lock = (1,5]                     │
├──────────────────────────────────────────────────────────┤
│ 插入意向锁（Insert Intention Lock）                       │
│   INSERT 时在目标间隙上设置的轻量级锁。                    │
│   多个事务可以在同一间隙设置插入意向锁（只要不冲突）       │
│   但与 Gap Lock 互斥（所以 INSERT 会被 Gap Lock 阻塞）    │
└──────────────────────────────────────────────────────────┘
```

### 3.3 意向锁（Intention Lock）

意向锁是表级锁，表示事务计划对表中的某些行加行锁。它解决了"行锁与表锁的共存"问题：

```
意向锁兼容矩阵：
         IS    IX    S     X
IS       ✓     ✓     ✓     ✗
IX       ✓     ✓     ✗     ✗
S        ✓     ✗     ✓     ✗
X        ✗     ✗     ✗     ✗

流程：
- 事务要加行级 S 锁 → 先加表级 IS 锁
- 事务要加行级 X 锁 → 先加表级 IX 锁
- 另一个事务要加表级 X 锁（如 LOCK TABLES ... WRITE）
  → 需要等待已有的 IS/IX 锁释放
```

### 3.4 死锁检测

InnoDB 自动检测死锁（通过等待图）。检测到死锁后，回滚持有最少行锁的事务（`SHOW ENGINE INNODB STATUS` 可查看详情）。

```
死锁等待图示例：
事务 T1：锁定 id=1，等待 id=2
事务 T2：锁定 id=2，等待 id=1
→ 等待图形成环路 → InnoDB 回滚 T2（undo log 量较小者）
```

```ini
innodb_deadlock_detect = ON          # 死锁检测（高并发下可能成为瓶颈）
innodb_lock_wait_timeout = 50        # 行锁等待超时（秒），超时后报错而非检测死锁
```

**死锁避免策略：**

1. 按相同顺序加锁（如始终先锁 id 小的行）
2. 缩短事务（将非数据库操作移出事务）
3. 使用唯一索引减少锁冲突范围
4. 高并发场景考虑关闭死锁检测 + 设置合理超时时间

**死锁日志解读：**

```
------------------------
LATEST DETECTED DEADLOCK
------------------------
2026-07-20 10:15:30 0x7f8b2c001700
*** (1) TRANSACTION:                            ← 事务 T1
UPDATE orders SET status = 'CANCELLED' WHERE id = 1001
*** (1) HOLDS THE LOCK(S):                      ← T1 持有的锁
RECORD LOCKS ... index PRIMARY ... lock_mode X locks rec but not gap
*** (1) WAITING FOR THIS LOCK TO BE GRANTED:   ← T1 等待的锁
RECORD LOCKS ... index idx_user ... lock_mode X locks gap

*** (2) TRANSACTION:                            ← 事务 T2
UPDATE orders SET status = 'SHIPPED' WHERE user_id = 2001 AND id = 1002
*** (2) HOLDS THE LOCK(S):
RECORD LOCKS ... index idx_user ... lock_mode X locks gap
*** (2) WAITING FOR THIS LOCK TO BE GRANTED:
RECORD LOCKS ... index PRIMARY ... lock_mode X locks rec but not gap
*** WE ROLL BACK TRANSACTION (2)               ← InnoDB 选择回滚 T2
```

### 3.5 事务隔离级别

| 隔离级别 | 脏读 | 不可重复读 | 幻读 | InnoDB 实现 |
|---------|------|----------|------|-----------|
| READ UNCOMMITTED | 可能 | 可能 | 可能 | 不加锁读最新版本 |
| READ COMMITTED | 否 | 可能 | 可能 | 每次 SELECT 创建新 ReadView |
| REPEATABLE READ（默认） | 否 | 否 | 否* | 事务内复用 ReadView + Next-Key Lock |
| SERIALIZABLE | 否 | 否 | 否 | 所有 SELECT 隐式加 LOCK IN SHARE MODE |

\* InnoDB 通过 Next-Key Lock 在 REPEATABLE READ 级别就防止了幻读（标准的 REPEATABLE READ 不防幻读）。

---

## 四、日志系统

### 4.1 Binlog（二进制日志）

Binlog 是 MySQL Server 层（非 InnoDB 特有）的逻辑日志，记录所有修改数据的 SQL 语句或行变更。主要用于复制和数据恢复。

**三种格式对比：**

| 格式 | 记录方式 | 优势 | 劣势 |
|------|---------|------|------|
| STATEMENT | 记录执行的 SQL 语句 | 日志量小 | 不确定函数（NOW()/UUID()）可能不一致 |
| ROW（推荐） | 记录每行变更的具体值 | 精确，不会出现主从不一致 | 日志量大（UPDATE 全表时尤为明显） |
| MIXED | 默认 STATEMENT，特定情况切换 ROW | 平衡 | 不彻底，行为有时难以预测 |

```ini
binlog_format = ROW                   # 推荐格式
sync_binlog = 1                       # 每次提交 fsync binlog（最安全）
binlog_cache_size = 4M                # 每个事务的 binlog 缓存
max_binlog_size = 1G                  # 单个 binlog 文件大小
expire_logs_days = 7                  # binlog 保留天数
```

### 4.2 两阶段提交（2PC）

为了保证 InnoDB Redo Log 和 Server 层 Binlog 的一致性，MySQL 使用两阶段提交：

```
事务提交流程（两阶段提交）：
┌──────────────────────────────────────────────────────────────┐
│ Phase 1: Prepare                                              │
│   1. InnoDB 写 Redo Log，状态标记为 PREPARE                   │
│   2. fsync Redo Log（按 innodb_flush_log_at_trx_commit 策略）  │
│                                                               │
│ Phase 2: Commit                                               │
│   3. 写 Binlog（写入 binlog cache → binlog file）              │
│   4. fsync Binlog（按 sync_binlog 策略）                       │
│   5. InnoDB 写 Redo Log，状态标记为 COMMIT                    │
│      （这一步的 fsync 通常与组提交合并）                       │
└──────────────────────────────────────────────────────────────┘

崩溃恢复逻辑：
- 如果 Redo Log 中有 PREPARE 状态的事务
    → 检查 Binlog 中是否有对应事务的完整记录
    → 有 → 提交事务（已经写入 binlog，需要保持一致性）
    → 无 → 回滚事务（主库崩溃，binlog 未写，从库不会收到）
```

**为什么需要两阶段提交？** 如果先写 Redo Log 再写 Binlog，Redo Log 写入后崩溃，Binlog 丢失 → 主库通过 Redo Log 恢复了该事务，从库没有收到 → 主从不一致。反过来也一样。两阶段提交保证了两者在崩溃恢复时的一致性。

### 4.3 Redo Log 循环写

Redo Log 是固定大小的环形文件，通过 LSN（Log Sequence Number）和 Checkpoint 管理空间：

```
Redo Log 循环写示意图：
┌────────────────────────────────────────────────────────────┐
│  Redo Log File 1 (2G)     │  Redo Log File 2 (2G)         │
│  ┌──────────────────────┐ │ ┌──────────────────────────┐  │
│  │··········████████████│ │ │███████··················│  │
│  │  已刷盘       活跃区 │ │ │活跃区   已刷盘           │  │
│  └──────────────────────┘ │ └──────────────────────────┘  │
│       ▲ checkpoint_LSN    │     ▲ current_LSN              │
│                            │                                │
│  活跃区 = current_LSN - checkpoint_LSN                     │
│  活跃区不能超过 Redo Log 总大小（否则需等待 checkpoint）      │
└────────────────────────────────────────────────────────────┘
```

**Checkpoint 触发时机：**
- Sharp Checkpoint：数据库正常关闭时，刷所有脏页
- Fuzzy Checkpoint：后台持续刷新部分脏页（最常见）
- 活跃区超过 75% 总大小：自适应刷新加速

```ini
innodb_flush_log_at_trx_commit = 1   # 每次提交 fsync Redo Log
innodb_log_file_size = 2G             # 单文件大小（调大减少 checkpoint 频率）
innodb_log_files_in_group = 2         # 文件数量
innodb_log_buffer_size = 64M          # Log Buffer
```

设置建议：将 Redo Log 总大小设为 15-30 分钟的写入量（通过 `SHOW GLOBAL STATUS LIKE 'innodb_os_log_written'` 估算），以减少 checkpoint 频率。

### 4.4 Undo Log 与 Purge

Undo Log 的生命周期管理：

```
Undo Log 生命周期：
创建（数据修改）→ 使用中（活跃事务/ReadView 引用）→ 可清理（Purge 线程）
                                                        │
                                                    ┌───▼────┐
                                                    │ Purge   │
                                                    │ 清理     │
                                                    │ Undo Log│
                                                    └─────────┘
```

```ini
-- 查看 Undo 表空间大小和 Purge 延迟
SELECT name, file_size / 1024 / 1024 AS size_mb
FROM information_schema.INNODB_TABLESPACES
WHERE name LIKE 'undo%';

-- 查看 Purge 进度
SHOW ENGINE INNODB STATUS\G
-- 关注 History list length（Undo 待清理页数，值过大说明 Purge 跟不上）
```

---

## 五、复制

### 5.1 主从复制架构

```
主从复制基本流程：
┌──────────────────────┐
│  Master（主库）        │
│  ┌──────────────────┐ │
│  │ 事务提交          │ │
│  │ → Binlog 写入     │─┼──────────────────────┐
│  └──────────────────┘ │                      │
│  ┌──────────────────┐ │              Binlog Dump Thread
│  │ Binlog Dump      │◀├──────────┐           │
│  │ Thread           │─┼──────┐   │           │
│  └──────────────────┘ │      │   │           │
└──────────────────────┘      │   │   ┌───────▼──────────┐
                               │   │   │  Slave（从库）    │
                               │   │   │  ┌─────────────┐ │
                               │   │   │  │ IO Thread   │ │
                               │   └───┼──▶ 接收 Binlog  │ │
                               │       │  │ → Relay Log  │ │
                               │       │  └─────────────┘ │
                               │       │  ┌─────────────┐ │
                               │       │  │ SQL Thread  │ │
                               │       └──▶ 回放 Relay  │ │
                               │          │ Log         │ │
                               │          └─────────────┘ │
                               │          └───────────────┘
```

**复制延迟监控：**

```sql
-- 主库查看当前 Binlog 位置
SHOW MASTER STATUS;

-- 从库查看复制状态
SHOW SLAVE STATUS\G
-- 关键指标：
-- Seconds_Behind_Master: 从库 SQL 线程落后主库的秒数（粗略估计）
-- Relay_Log_Space: Relay Log 总大小
-- Slave_IO_Running / Slave_SQL_Running: IO 和 SQL 线程状态
```

**延迟原因与应对：**
- 主库大事务（一次修改百万行）→ 拆分事务
- 从库性能不足（单线程回放历史遗留）→ 并行复制
- 网络延迟（跨机房）→ 半同步复制

### 5.2 半同步复制（Semi-Sync）

默认的异步复制存在丢数据风险（主库提交后崩溃，Binlog 未传到从库）。半同步复制在提交后等待至少一个从库确认收到 Binlog：

```
半同步复制（after_sync 模式）：
Master 事务提交：
1. 写 Redo Log（PREPARE）
2. 写 Binlog
3. 等待从库确认收到 Binlog（af-sync timeout 内）
   ├── 收到 ACK → 写 Redo Log（COMMIT）→ 返回客户端
   └── 超时 → 降级为异步复制 → 写 Redo Log（COMMIT）→ 返回客户端
4. 从库收到 Binlog 后回复 ACK（此时不要求从库已回放）
```

```ini
# 主库配置
plugin-load = "rpl_semi_sync_master=semisync_master.so"
rpl_semi_sync_master_enabled = ON
rpl_semi_sync_master_timeout = 10000   # 等待 ACK 超时（10秒）

# 从库配置
plugin-load = "rpl_semi_sync_slave=semisync_slave.so"
rpl_semi_sync_slave_enabled = ON
```

### 5.3 GTID 复制

GTID（Global Transaction Identifier）为每个事务分配全局唯一标识符，替代传统的 binlog 文件名 + 位点：

```
GTID 格式：server_uuid:transaction_id
示例：3E11FA47-71CA-11E1-9E33-C80AA9429562:1-100
```

**GTID 优势：**
- 无需手动维护 binlog 位点（CHANGE MASTER 时指定 `MASTER_AUTO_POSITION = 1`）
- 故障转移后自动定位（从库自动找到新主的 binlog 位点）
- 跳过错误事务更安全：`SET GTID_NEXT` 注入空事务

```sql
-- 开启 GTID
SET GLOBAL gtid_mode = ON_PERMISSIVE;
SET GLOBAL gtid_mode = ON;
SET GLOBAL enforce_gtid_consistency = ON;

-- 查看已执行的 GTID 集合
SHOW MASTER STATUS;          -- 主库已执行
SHOW SLAVE STATUS\G          -- 从库已接收和应用
```

### 5.4 并行复制

MySQL 5.7 引入基于组提交的并行复制（LOGICAL_CLOCK），允许多个 Worker 线程并行回放不同事务：

```
基于 Writeset 的并行复制（MySQL 8.0）：
事务 T1: UPDATE orders SET ... WHERE id = 1001  → writeset: {orders.pk.1001}
事务 T2: UPDATE orders SET ... WHERE id = 2001  → writeset: {orders.pk.2001}
事务 T3: UPDATE orders SET ... WHERE id = 1001  → writeset: {orders.pk.1001}

并行判定：
- T1 和 T2 的 writeset 无交集 → 可并行回放
- T1 和 T3 的 writeset 有交集 → 必须串行回放（保持提交顺序）
```

```ini
# 从库并行复制配置
slave_parallel_type = LOGICAL_CLOCK          # 基于组提交的并行
slave_parallel_workers = 4                   # Worker 线程数
slave_preserve_commit_order = ON             # 保持主库提交顺序
binlog_transaction_dependency_tracking = WRITESET  # 基于 writeset 依赖跟踪
```

### 5.5 读写分离

在 Java 应用中实现读写分离的几种方式：

```
读写分离架构：
应用层
  ├── 写请求（INSERT/UPDATE/DELETE）──▶ 主库（Master）
  └── 读请求（SELECT）──────────────▶ 从库 1（Slave 1）
                                    │ 从库 2（Slave 2）
                                    └ 从库 3（Slave 3）
```

**ShardingSphere 读写分离配置示例：**

```yaml
# ShardingSphere 5.x 读写分离 + 负载均衡
spring:
  shardingsphere:
    datasource:
      names: master, slave0, slave1
      master:
        type: com.zaxxer.hikari.HikariDataSource
        driver-class-name: com.mysql.cj.jdbc.Driver
        jdbc-url: jdbc:mysql://master:3306/mydb
        username: root
        password: ${DB_PASSWORD}
      slave0:
        type: com.zaxxer.hikari.HikariDataSource
        driver-class-name: com.mysql.cj.jdbc.Driver
        jdbc-url: jdbc:mysql://slave0:3306/mydb
        username: root
        password: ${DB_PASSWORD}
      slave1:
        type: com.zaxxer.hikari.HikariDataSource
        driver-class-name: com.mysql.cj.jdbc.Driver
        jdbc-url: jdbc:mysql://slave1:3306/mydb
        username: root
        password: ${DB_PASSWORD}
    rules:
      readwrite-splitting:
        data-sources:
          myds:
            type: Static
            props:
              write-data-source-name: master
              read-data-source-names: slave0, slave1
            load-balancer-name: round_robin
        load-balancers:
          round_robin:
            type: ROUND_ROBIN
```

---

## 六、MySQL vs PostgreSQL 对比

### 6.1 MVCC 实现差异

| 维度 | MySQL（InnoDB） | PostgreSQL |
|------|----------------|-----------|
| 多版本存储 | Undo Log 回滚段（版本链） | Tuple 多版本（表内同存多版本） |
| 旧版本清理 | Purge 线程异步清理 Undo Log | VACUUM 清理死元组（Dead Tuple） |
| 更新代价 | 就地更新 + 写 Undo（页面内） | 标记旧版本 + 插入新版本（追加） |
| 表膨胀 | 较低（Undo 独立管理） | 可能较高（需频繁 VACUUM） |
| 回滚效率 | 快（Undo Log 直接回滚） | 快（多版本就地可见） |

**InnoDB MVCC 的优势：** 更新时不需要整个移动行（页面内就地更新），配合 Redo Log 的 WAL 机制，写入效率高。

**PostgreSQL MVCC 的优势：** 回滚不依赖 Undo Log，版本信息在表中，概念更清晰；但表膨胀需要 VACUUM 维护。

### 6.2 索引类型差异

| 索引类型 | MySQL（InnoDB） | PostgreSQL |
|---------|----------------|-----------|
| B-Tree/B+Tree | 仅 B+Tree（聚簇/二级） | B-Tree（默认，支持多种扫描） |
| Hash | 自适应哈希索引（自动，非用户创建） | Hash 索引（等值查询） |
| 全文索引 | ngram FULLTEXT（MySQL 8.0+） | GIN + tsvector |
| 空间索引 | R-Tree（GIS） | GiST（通用搜索树）+ SP-GiST |
| 倒排索引 | 无原生支持 | GIN（通用倒排索引） |
| 块索引 | 无 | BRIN（块范围索引，时序数据高效） |
| 表达式索引 | 函数索引（MySQL 8.0.13+） | 表达式索引 |
| 部分索引 | 不支持 | 部分索引（WHERE 条件过滤） |

### 6.3 JSON 支持

```sql
-- MySQL JSON：函数式操作
SELECT JSON_EXTRACT(doc, '$.name') FROM t;
SELECT doc->>'$.name' FROM t;  -- 简写
CREATE INDEX idx_name ON t((CAST(doc->>'$.name' AS CHAR(100))));  -- 虚拟列索引

-- PostgreSQL JSONB：原生 GIN 索引 + 丰富的操作符
SELECT doc->>'name' FROM t;
SELECT doc @> '{"status": "active"}'::jsonb;  -- 包含查询
CREATE INDEX idx_doc ON t USING GIN (doc jsonb_path_ops);
```

### 6.4 AI 向量检索能力

这是 MySQL 在 AI 时代的最明显短板：

| 能力 | MySQL | PostgreSQL |
|------|-------|-----------|
| 原生向量检索 | 不支持 | pgvector 扩展（IVFFlat/HNSW） |
| 语义相似度查询 | 不支持 | `ORDER BY embedding <=> $vec LIMIT 10` |
| 混合检索 | 需要外部系统（ES） | pgvector + 内置全文检索 |
| 向量维度 | 无 | 最多 2000（pgvector 0.5+） |

### 6.5 选型建议

```
新项目数据库选型决策树：
├── 需要向量检索/AI 场景？
│   ├── 是 → PostgreSQL + pgvector（默认选择）
│   └── 否 → 团队 MySQL 经验丰富？
│            ├── 是 → MySQL 8.4
│            └── 否 → PostgreSQL（更丰富的功能集）
│
├── 遗留系统已在 MySQL？
│   └── 继续 MySQL，AI 向量单独用 PostgreSQL/pgvector 或 Qdrant
│
├── 需要多主写入/复杂复制拓扑？
│   └── MySQL（MySQL Group Replication / InnoDB Cluster）
│
└── 需要最强 SQL 标准兼容和扩展能力？
    └── PostgreSQL
```

---

## 七、Java 集成

### 7.1 HikariCP MySQL 配置

HikariCP 是 Spring Boot 4.x 的默认连接池，针对 MySQL 的推荐配置：

```yaml
# application.yml — MySQL + HikariCP 推荐配置
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/mydb?useUnicode=true&characterEncoding=utf8mb4&useSSL=true&serverTimezone=Asia/Shanghai&rewriteBatchedStatements=true&cachePrepStmts=true&useServerPrepStmts=true&cacheResultSetMetadata=true&maintainTimeStats=false
    username: ${DB_USER}
    password: ${DB_PASSWORD}
    hikari:
      # 连接池大小：通常 CPU 核数 * 2 + 有效磁盘数
      maximum-pool-size: 20
      minimum-idle: 10
      # 超时配置
      connection-timeout: 30000        # 等待连接的最大时间（30s）
      idle-timeout: 600000             # 空闲连接最大存活时间（10min）
      max-lifetime: 1800000            # 连接最大存活时间（30min，需小于 MySQL wait_timeout）
      # 连接验证
      connection-test-query: "SELECT 1"
      validation-timeout: 5000
      # 泄漏检测（开发/测试环境建议开启）
      leak-detection-threshold: 60000  # 60 秒未归还视为泄漏（生产环境谨慎开启）
      # 连接池名称（便于监控识别）
      pool-name: "MySQL-HikariPool"
      # 其他优化
      auto-commit: true
      read-only: false
```

**MySQL JDBC URL 关键参数说明：**

| 参数 | 作用 |
|------|------|
| `rewriteBatchedStatements=true` | 将批量 INSERT 重写为 `INSERT INTO ... VALUES (...), (...), (...)` 单条语句 |
| `cachePrepStmts=true` | 客户端缓存 PreparedStatement |
| `useServerPrepStmts=true` | 使用服务端 PreparedStatement（减少 SQL 解析） |
| `cacheResultSetMetadata=true` | 缓存 ResultSet 元数据 |
| `maintainTimeStats=false` | 关闭时间统计缓存（减少内存分配） |

### 7.2 慢查询日志分析

```ini
# MySQL 服务端配置
slow_query_log = ON
slow_query_log_file = /var/log/mysql/slow.log
long_query_time = 0.5                 # 超过 0.5 秒记录
log_queries_not_using_indexes = ON    # 记录未使用索引的查询
log_slow_admin_statements = ON        # 记录 DDL 等管理语句
min_examined_row_limit = 1000         # 扫描行数 > 1000 才记录
```

**pt-query-digest 分析示例：**

```bash
# 分析慢查询日志
pt-query-digest /var/log/mysql/slow.log > slow_report.txt

# 实时分析（从 TCP dump）
tcpdump -i any port 3306 -s 65535 -x -w mysql.pcap
pt-query-digest --type tcpdump mysql.pcap
```

### 7.3 MyBatis 批量操作优化

```java
// MySQL 批量插入 — JDK 25 + MyBatis + Virtual Threads
@Repository
public interface OrderMapper {

    // MyBatis 批量插入（配合 rewriteBatchedStatements=true）
    int batchInsert(@Param("list") List<Order> orders);
}
```

```xml
<!-- OrderMapper.xml -->
<insert id="batchInsert">
    INSERT INTO orders (user_id, product_id, amount, status, created_at)
    VALUES
    <foreach collection="list" item="item" separator=",">
        (#{item.userId}, #{item.productId}, #{item.amount},
         #{item.status}, #{item.createdAt})
    </foreach>
</insert>
```

```java
@Service
public class OrderService {

    private final OrderMapper orderMapper;
    private final SqlSessionTemplate sqlSession;

    // 流式查询（游标模式）— 使用 Virtual Thread 处理大结果集
    public void processLargeResultSet(OrderCriteria criteria,
                                       Consumer<Order> processor) {
        try (var sqlSession = sqlSession.getSqlSessionFactory()
                .openSession(ExecutorType.SIMPLE)) {
            var mapper = sqlSession.getMapper(OrderMapper.class);

            var cursor = mapper.streamByCriteria(criteria);
            try (var stream = cursor.stream()) {
                stream.forEach(processor);
            }
        }
    }
}
```

```java
// MyBatis 流式查询 Mapper 方法
@Select("""
    SELECT /*+ MAX_EXECUTION_TIME(60000) */ *
    FROM orders
    WHERE created_at >= #{startTime}
      AND created_at < #{endTime}
    ORDER BY id
    """)
@Options(fetchSize = 1000, resultSetType = ResultSetType.FORWARD_ONLY)
Cursor<Order> streamByCriteria(OrderCriteria criteria);
```

**Service 层使用 Virtual Threads：**

```java
// Spring Boot 4.x 默认已启用 Virtual Threads（spring.threads.virtual.enabled=true）
@Service
public class BatchOrderProcessor {

    private final OrderService orderService;
    private final ExecutorService vtExecutor;

    public BatchOrderProcessor() {
        // Virtual Threads per Task Executor（每个任务一个虚拟线程）
        this.vtExecutor = Executors.newVirtualThreadPerTaskExecutor();
    }

    public void processShard(int shardId) {
        try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
            // 结构化并发：并行处理 3 个分片
            var task1 = scope.fork(() -> processOrders(shardId * 3));
            var task2 = scope.fork(() -> processOrders(shardId * 3 + 1));
            var task3 = scope.fork(() -> processOrders(shardId * 3 + 2));

            scope.join();           // 等待全部完成
            scope.throwIfFailed();  // 任一失败则抛出异常
        } catch (Exception e) {
            throw new RuntimeException("Batch processing failed", e);
        }
    }

    private List<Order> processOrders(int subShardId) {
        // 业务处理逻辑
        return List.of();
    }
}
```

**HikariCP MySQL DataSource 完整 Java Config：**

```java
@Configuration
public class MySQLDataSourceConfig {

    @Bean
    @ConfigurationProperties(prefix = "spring.datasource")
    public DataSource dataSource() {
        var config = new HikariConfig();
        config.setJdbcUrl("jdbc:mysql://localhost:3306/mydb"
                + "?rewriteBatchedStatements=true"
                + "&cachePrepStmts=true"
                + "&useServerPrepStmts=true"
                + "&characterEncoding=utf8mb4"
                + "&useSSL=true");
        config.setUsername(System.getenv("DB_USER"));
        config.setPassword(System.getenv("DB_PASSWORD"));
        config.setMaximumPoolSize(20);
        config.setMinimumIdle(10);
        config.setConnectionTimeout(30_000);
        config.setIdleTimeout(600_000);
        config.setMaxLifetime(1_800_000);
        config.setConnectionTestQuery("SELECT 1");
        config.setLeakDetectionThreshold(60_000);
        config.setPoolName("MySQL-HikariPool");

        // 连接初始化 — 设置会话变量
        config.setConnectionInitSql("SET NAMES utf8mb4, time_zone = '+08:00'");

        return new HikariDataSource(config);
    }

    @Bean
    public TransactionTemplate transactionTemplate(
            PlatformTransactionManager transactionManager) {
        return new TransactionTemplate(transactionManager);
    }
}
```

---

## 八、代码示例

### 8.1 HikariCP + MySQL DataSource 配置类（Spring Boot 4.x）

```java
// ===== application.yml =====
// spring:
//   datasource:
//     url: jdbc:mysql://localhost:3306/mydb?rewriteBatchedStatements=true&cachePrepStmts=true&useServerPrepStmts=true&characterEncoding=utf8mb4
//     username: ${DB_USER}
//     password: ${DB_PASSWORD}
//     hikari:
//       maximum-pool-size: 20
//       minimum-idle: 10
//       connection-timeout: 30000
//       idle-timeout: 600000
//       max-lifetime: 1800000
//       leak-detection-threshold: 60000
//       connection-test-query: "SELECT 1"
//       pool-name: "MySQL-HikariPool"

@Configuration
@EnableTransactionManagement
public class DataSourceConfig {

    @Bean
    @Primary
    @ConfigurationProperties(prefix = "spring.datasource")
    public DataSource dataSource() {
        return DataSourceBuilder.create()
                .type(HikariDataSource.class)
                .build();
    }

    // NamedParameterJdbcTemplate — 推荐用于简单查询（避免 MyBatis 的开销）
    @Bean
    public NamedParameterJdbcTemplate namedJdbcTemplate(DataSource ds) {
        return new NamedParameterJdbcTemplate(ds);
    }
}
```

### 8.2 MyBatis 批量插入优化示例

```java
// 批量插入 Service — 自动分批，避免单次插入过大
@Service
public class OrderBatchService {

    private static final int BATCH_SIZE = 1000;
    private final SqlSessionTemplate sqlSession;

    public OrderBatchService(SqlSessionTemplate sqlSession) {
        this.sqlSession = sqlSession;
    }

    public int batchInsertOrders(List<Order> orders) {
        var mapper = sqlSession.getMapper(OrderMapper.class);

        return IntStream.range(0, (orders.size() + BATCH_SIZE - 1) / BATCH_SIZE)
                .map(i -> {
                    var from = i * BATCH_SIZE;
                    var to = Math.min(from + BATCH_SIZE, orders.size());
                    return mapper.batchInsert(orders.subList(from, to));
                })
                .sum();
    }
}
```

```xml
<!-- OrderMapper.xml — 批量 INSERT（配合 rewriteBatchedStatements=true -->
<insert id="batchInsert" parameterType="list">
    INSERT INTO orders (order_no, user_id, product_id, amount, status, created_at)
    VALUES
    <foreach collection="list" item="item" separator=",">
        (#{item.orderNo}, #{item.userId}, #{item.productId},
         #{item.amount}, #{item.status}, #{item.createdAt})
    </foreach>
    ON DUPLICATE KEY UPDATE
        amount = VALUES(amount),
        status = VALUES(status)
</insert>
```

### 8.3 慢查询分析工具类

```java
// MySQL 监控指标采集 — 通过 JMX + Micrometer
@Component
public class MySQLMetricsCollector {

    private final MeterRegistry meterRegistry;
    private final DataSource dataSource;

    public MySQLMetricsCollector(MeterRegistry meterRegistry,
                                  DataSource dataSource) {
        this.meterRegistry = meterRegistry;
        this.dataSource = dataSource;
    }

    @Scheduled(fixedRate = 30_000)  // 每 30 秒采集
    public void collectPoolMetrics() {
        if (dataSource instanceof HikariDataSource hikari) {
            var poolMetrics = hikari.getHikariPoolMXBean();
            if (poolMetrics != null) {
                gaugeValue("hikari.active", poolMetrics.getActiveConnections());
                gaugeValue("hikari.idle", poolMetrics.getIdleConnections());
                gaugeValue("hikari.pending", poolMetrics.getPendingConnections());
                gaugeValue("hikari.total", poolMetrics.getTotalConnections());
            }
        }
    }

    @Scheduled(fixedRate = 60_000)  // 每 60 秒检查慢查询
    public void checkSlowQueries() {
        try (var conn = dataSource.getConnection();
             var stmt = conn.createStatement()) {

            // 查询 MySQL 当前慢查询状态
            var rs = stmt.executeQuery("""
                SHOW GLOBAL STATUS
                WHERE Variable_name IN (
                    'Slow_queries', 'Questions', 'Innodb_rows_read',
                    'Innodb_buffer_pool_read_requests',
                    'Innodb_buffer_pool_reads'
                )
                """);

            while (rs.next()) {
                var name = rs.getString("Variable_name");
                var value = rs.getLong("Value");
                meterRegistry.counter("mysql.global_status",
                        "variable", name).increment(value - getPrevValue(name));
            }
        } catch (SQLException e) {
            // 监控自身异常不影响业务
        }
    }

    private final Map<String, Long> prevValues = new ConcurrentHashMap<>();

    private void gaugeValue(String name, long value) {
        Gauge.builder("hikari." + name, () -> value)
                .register(meterRegistry);
    }

    private long getPrevValue(String name) {
        return prevValues.getOrDefault(name, 0L);
    }
}

// 慢查询日志分析封装 — 基于 pt-query-digest
public class SlowQueryAnalyzer {

    public record QueryStats(String fingerprint, long count, double avgTime,
                              double maxTime, long rowsExamined) {}

    /**
     * 解析慢查询日志文件，提取统计信息。
     * 实际生产环境建议使用 percona-toolkit 的 pt-query-digest
     * 或集成 SkyWalking MySQL 插件进行分布式追踪。
     */
    public List<QueryStats> analyze(Path slowLogPath) throws IOException {
        var stats = new HashMap<String, QueryStats>();

        try (var lines = Files.lines(slowLogPath)) {
            // 简化示例：解析慢日志格式
            // # Time: 2026-07-20T10:15:30.123456+08:00
            // # Query_time: 2.500000  Lock_time: 0.000100
            // # Rows_sent: 1000  Rows_examined: 100000
            // SELECT ... FROM orders WHERE ...
            // 实际项目中应使用成熟的解析库
        }

        return new ArrayList<>(stats.values());
    }
}
```

---

## 九、常见问题

### 9.1 死锁排查

**问题：** 业务高峰期频繁出现 `Deadlock found when trying to get lock; try restarting transaction`。

**排查步骤：**
1. 查看死锁日志：`SHOW ENGINE INNODB STATUS\G`，找到 LATEST DETECTED DEADLOCK 段
2. 分析涉及的事务 SQL 和持有的锁
3. 检查两个事务是否以相反顺序锁定资源

**解决方案：**
- 统一加锁顺序（如所有事务都按主键升序锁定）
- 为 WHERE 条件创建合适的索引（避免锁升级为表锁或大范围 Gap Lock）
- 缩短事务时间，将非数据库操作移出事务块
- 将大事务拆分为多个小事务

### 9.2 索引失效场景

| 场景 | 示例 | 原因 |
|------|------|------|
| 对索引列使用函数 | `WHERE DATE(created_at) = '2026-07-20'` | 函数破坏了索引的有序性 |
| 隐式类型转换 | `WHERE phone = 13900000000`（phone 是 VARCHAR） | MySQL 将字符串转为数字，导致全表扫描 |
| LIKE 以 % 开头 | `WHERE name LIKE '%zhang'` | 前缀匹配无法使用 B+Tree 有序性 |
| OR 条件包含非索引列 | `WHERE id = 1 OR status = 'PENDING'`（status 无索引） | 优化器可能选择全表扫描 |
| 联合索引不满足最左前缀 | 索引 `(a,b,c)`，查询 `WHERE b = 1 AND c = 2` | B+Tree 按 a→b→c 排序，跳过 a 无法定位 |
| NOT IN / != / <> | `WHERE status != 'CANCELLED'` | 否定条件无法利用索引顺序 |
| 统计信息不准确 | ANALYZE TABLE 后索引生效 | 优化器误判索引选择度 |
| JOIN 字符集不一致 | 两个表 JOIN 列字符集不同 | 字符集转换导致无法使用索引 |

**验证索引使用：**
```sql
EXPLAIN SELECT * FROM orders WHERE user_id = 1001;
-- 关注 type 列: const > eq_ref > ref > range > index > ALL
-- 关注 Extra 列: Using index（覆盖索引）> Using index condition（ICP）> Using where > Using filesort
```

### 9.3 主从延迟处理

**问题：** 主从延迟过大（`Seconds_Behind_Master` 超过 10 秒），影响读写分离的正确性。

**排查思路：**
1. 确认是否存在大事务（主库一个事务修改百万行）
2. 检查从库硬件（磁盘 IO 是否达到瓶颈——通常是因为单线程回放 + 机械硬盘随机 IO）
3. 确认网络状况（跨机房延迟）

**解决方案：**
- 主库拆分大事务为小批量提交
- 从库启用并行复制（`slave_parallel_workers`）
- 从库使用 SSD 提升回放性能
- 对于必须实时读的场景，关键业务强制读主库

### 9.4 连接池打满

**问题：** HikariCP 连接池耗尽，`Connection is not available, request timed out after 30000ms`。

**常见原因：**
1. 慢查询占用连接不释放（最常见——某个查询执行 2 分钟，占满连接池）
2. 连接泄漏（获取连接后未 `close()`，MyBatis/Spring 事务管理异常未正确释放）
3. `maxLifetime` 配置大于 MySQL `wait_timeout`，连接被 MySQL 回收但连接池不知情

**排查与修复：**
```yaml
# 1. 开启连接泄漏检测
hikari:
  leak-detection-threshold: 30000  # 超过 30s 未归还 → 日志打印堆栈

# 2. 设置 max-lifetime 略小于 MySQL wait_timeout
hikari:
  max-lifetime: 870000  # 14.5min < MySQL 默认 8h wait_timeout

# 3. 设置连接超时上限（MySQL 端）
SET GLOBAL max_execution_time = 30000;  # 单查询最多 30 秒（MySQL 5.7.8+）
```

### 9.5 慢查询优化思路

**系统化排查：**

```
慢查询优化流程：
1. 定位慢查询
   ├── 慢查询日志 + pt-query-digest 统计 TOP N
   └── SkyWalking/Jaeger Trace 定位具体接口

2. EXPLAIN 分析执行计划
   ├── type = ALL？→ 缺失索引
   ├── rows 过大？→ 索引区分度不够
   ├── Extra = Using filesort？→ ORDER BY 列不在索引中
   ├── Extra = Using temporary？→ GROUP BY 需要临时表
   └── Extra = Using where + rows 小？
       → 索引选择正确，检查其他原因

3. 优化方案
   ├── 创建合适的索引（最左前缀、覆盖索引）
   ├── 改写 SQL（避免 SELECT *、子查询改 JOIN、
   │   分页用延迟关联、IN 改 EXISTS）
   ├── 表结构调整（分区、归档历史数据）
   ├── 应用层优化（缓存 Redis、ES 预处理）
   └── 架构调整（读写分离、分库分表）

4. 验证效果
   ├── EXPLAIN 确认执行计划变化
   ├── 压测验证吞吐和延迟
   └── 灰度发布观察实际效果
```

**实战案例：**

```sql
-- 原 SQL（慢查询 — 全表扫描 + filesort）
SELECT id, user_id, amount, created_at
FROM orders
WHERE DATE(created_at) = '2026-07-20'
ORDER BY amount DESC
LIMIT 20;

-- 优化 1：字段不套函数，用范围查询
SELECT id, user_id, amount, created_at
FROM orders
WHERE created_at >= '2026-07-20 00:00:00'
  AND created_at < '2026-07-21 00:00:00'
ORDER BY amount DESC
LIMIT 20;

-- 优化 2：如果 created_at, amount 经常联合查询，建联合索引
ALTER TABLE orders ADD INDEX idx_created_amount (created_at, amount DESC);
-- 注意：MySQL 8.0+ 支持降序索引
```

---

## 相关条目

- [[04-PostgreSQL与pgvector深度解析]] — PostgreSQL 深度解析与向量检索
- [[05-缓存策略与多级缓存架构]] — 缓存策略与多级缓存架构
- [[05-幂等设计与分布式锁]] — 幂等性与分布式锁
- [[03-SpringDataJPA与MyBatis深度解析]] — MyBatis 与 Spring Data JPA
