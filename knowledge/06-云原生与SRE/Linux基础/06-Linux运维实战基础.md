---
domain: 06-云原生与SRE
title: Linux 运维实战基础
status: draft
level: intermediate
sources:
  - level: L1
    url: https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html
    description: Linux Kernel cgroup v2 官方文档
  - level: L1
    url: https://systemd.io/
    description: systemd 官方文档
  - level: L1
    url: https://man7.org/linux/man-pages/
    description: Linux man-pages 官方手册页
  - level: L3
    url: https://www.brendangregg.com/linuxperf.html
    description: "Brendan Gregg — 《Systems Performance: Enterprise and the Cloud》"
  - level: L4
    url: https://docs.docker.com/engine/security/rootless/
    description: Docker 官方文档 — Rootless 模式与 Namespace 隔离
relations:
  prerequisite:
    - 01-数据结构与算法
  related:
    - 06-Docker与Kubernetes云原生部署
    - 02-JVM内部机制与调优
tags:
  - linux
  - performance
  - troubleshooting
  - systemd
  - cgroup
  - namespace
  - shell
  - java-ops
  - docker
  - container
created: 2026-07-20
updated: 2026-07-28
content_type: practice
---

# Linux 运维实战基础

## 概述

Linux 运维能力是 Java 工程师排查线上问题的底层基础。无论是分析 CPU 飙升、诊断内存泄漏、解读 OOM Killer 日志，还是理解容器资源隔离原理，都离不开对 Linux 性能工具链、进程管理、systemd、cgroup 和 namespace 的深入掌握。

本文面向 Java 开发者，聚焦日常排障和生产环境运维中最常用的 Linux 知识和命令，以实战视角组织内容，避免陷入手册式的罗列。读完本文后，你将能够独立完成从"发现异常"到"定位根因"的完整排障链路。

---

## 一、性能诊断命令

### 1.1 top / htop — 系统全局视图

**top** 是排障的起点。进入 top 界面后，第一行 `load average` 是三个数字（1分钟/5分钟/15分钟平均负载），表示处于可运行状态和不可中断睡眠状态的进程数。对于多核 CPU，需要除以核数判断：负载/核数 > 1 表示有进程在排队等 CPU。

第二行 CPU 状态各字段含义：

| 字段 | 含义 | 高值意味着什么 |
|------|------|---------------|
| `us` | 用户态 CPU 时间 | 应用程序计算密集 |
| `sy` | 内核态 CPU 时间 | 系统调用频繁，可能 IO 过多 |
| `ni` | 低优先级用户态 | nice 值调整过的进程 |
| `id` | 空闲 | `id=0` 意味着 CPU 100% 忙碌 |
| `wa` | 等待 IO | **磁盘 IO 瓶颈**的关键指标 |
| `hi` | 硬中断 | 硬件中断处理，高值检查网卡/磁盘 |
| `si` | 软中断 | **网络收发包**的软中断，si 单核 >10% 需关注 |
| `st` | 被 hypervisor 偷取 | 虚拟化环境中宿主机过载 |

**常用交互操作：**
- `shift+P`：按 CPU 使用率降序排列
- `shift+M`：按 RES（驻留物理内存）降序排列
- `1`：展开/折叠每个 CPU 核心的使用情况
- `c`：切换是否显示完整命令行
- `k`：向选中进程发送信号

**RES vs VIRT：**
- **VIRT**（虚拟内存）包含未实际分配、被 swap 换出、以及共享库的映射，不代表真实占用
- **RES**（驻留内存）是进程实际占用的物理内存，排查内存问题看 RES

`htop` 是 top 的增强版，提供彩色输出、鼠标操作、进程树视图（F5），以及更直观的 CPU/内存柱状图。推荐日常使用。

### 1.2 iostat — 磁盘 IO 分析

```bash
iostat -x 1          # 每秒输出扩展统计
```

关键输出列：

| 列 | 含义 | 排查线索 |
|----|------|----------|
| `r/s`, `w/s` | 每秒读/写请求数 | 判断读写比例 |
| `rkB/s`, `wkB/s` | 每秒读/写 KB 数 | 吞吐量瓶颈定位 |
| `await` | 平均每个 IO 请求的等待时间（ms） | **>20ms 需要关注**，含排队时间 |
| `svctm` | 平均每个 IO 请求的服务时间（ms） | 已废弃指标，参考价值有限 |
| `%util` | 设备带宽利用率 | **接近 100% = IO 瓶颈**，但 SSD/RAID 可能在此前先饱和 |

**注意：** `%util` 接近 100% 不代表一定存在性能问题。对于 SSD（尤其是 NVMe），设备可以并行处理多个请求，`%util` 可能很高但 `await` 仍然很低。真正判断 IO 瓶颈应结合 `await` 和应用程序的响应时间。

### 1.3 vmstat — 虚拟内存统计

```bash
vmstat 1             # 每秒输出
```

**核心输出分区解读：**

```
procs -----------memory---------- ---swap-- -----io---- -system-- ------cpu-----
 r  b   swpd   free   buff  cache   si   so    bi    bo   in   cs us sy id wa st
```

- **procs r（运行队列）**：正在运行和等待 CPU 的进程数。r > CPU 核数，说明 CPU 是瓶颈
- **procs b（阻塞）**：不可中断睡眠的进程数，通常等待 IO。b > 0 持续存在，检查磁盘
- **memory buff/cache**：缓冲区（块设备元数据）和页缓存（文件内容）。Linux 会积极使用空闲内存做缓存，用 `free -h` 看 `available` 才准确
- **swap si/so**：换入/换出。**任何持续的 si 或 so 都意味着严重的内存压力**，应用性能将急剧下降
- **system in/cs**：中断次数和上下文切换次数。cs 极高（>10万/秒/核）可能表示线程过多或锁竞争严重
- **system cs（上下文切换）**：Java 应用中上下文切换暴增，往往与 synchronized 锁竞争或线程数过多相关

### 1.4 sar — 历史性能数据收集

sar 属于 sysstat 工具包，能定时采集并保存历史性能数据，是事后分析的关键工具。

```bash
# 确保 sysstat 服务运行
systemctl enable --now sysstat

# 常用查询
sar -n DEV 1 5        # 网络接口流量统计（rxpck/s txpck/s rxkB/s txkB/s）
sar -r                # 内存使用历史（kbmemfree kbmemused %memused）
sar -q                # 系统负载历史（runq-sz plist-sz ldavg-1 ldavg-5 ldavg-15）
sar -b                # IO 统计历史（tps rtps wtps bread/s bwrtn/s）
sar -u                # CPU 使用历史
sar -n TCP,ETCP       # TCP 连接统计（active/s被动打开、重传段）
```

sar 的独特价值在于它可以回答"昨晚凌晨 3 点系统为什么慢了"这类历史问题。默认数据保留 7-30 天（取决于发行版配置）。

### 1.5 pidstat — 进程级性能分析

```bash
pidstat -p $PID 1       # 指定进程每秒 CPU 统计
pidstat -t -p $PID 1    # 线程级 CPU 统计（定位 Java 线程的关键）
pidstat -d -p $PID 1    # 进程 IO 统计（kB_rd/s kB_wr/s）
pidstat -r -p $PID 1    # 进程内存统计（VSZ RSS %MEM）
pidstat -w -p $PID 1    # 上下文切换统计（cswch/s自愿 nvcswch/s非自愿）
pidstat -l              # 显示完整命令路径
```

**实战技巧：** 当 top 显示某 Java 进程 CPU 100% 时，`pidstat -t -p $PID 1` 找出高 CPU 的线程 TID，然后通过 jstack 定位具体代码。

### 1.6 mpstat — 每核 CPU 统计

```bash
mpstat -P ALL 1        # 每核每秒统计
```

常用于排查软中断不均问题：网卡多队列与 CPU 亲和性配置不当，会导致个别 CPU 核心的 `%soft` 飙升（>10-20%），而其他核心闲置。此时应调整 `/proc/irq/*/smp_affinity` 或网卡多队列配置。

### 1.7 free — 内存概览

```bash
free -h               # 人类可读格式
```

**buffer 和 cache 的区别：**
- **buffer**：块设备（如磁盘）的元数据缓存，如 inode、目录项
- **cache**：文件的页缓存（page cache），即文件内容的缓存

两者都可以在内存紧张时被内核回收。因此判断内存是否够用，应看 **available** 列而非 free 列。`available` = free + 可回收的 buffer/cache + 其他可释放内存。当 `available` 持续低于总内存的 10% 时，考虑扩容或排查内存泄漏。

### 1.8 df / du — 磁盘空间

```bash
df -h                 # 文件系统级别使用量
du -sh /opt/app/*     # 目录级别大小统计
du -h --max-depth=1 /opt/app   # 按一层深度展示
```

**快速查找大文件：**

```bash
find /opt/app -type f -size +100M -exec ls -lh {} \;    # 查找 >100MB 的文件
```

生产环境推荐 `ncdu`（NCurses Disk Usage），提供交互式的磁盘空间分析，适合在服务器上快速定位空间占用源。

---

## 二、网络诊断

### 2.1 ss — Socket 统计（替代 netstat）

```bash
ss -tlnp              # 查看所有 TCP 监听端口及对应进程
ss -s                 # 汇总统计（TCP/UDP/RAW 各类 socket 数量）
ss -tanp state time-wait | wc -l   # 统计 TIME_WAIT 连接数
```

**Recv-Q 与 Send-Q：**
- 对于 LISTEN 状态的 socket，`Send-Q` 表示 backlog（全连接队列最大长度），`Recv-Q` 表示当前已完成三次握手但未被 `accept()` 取走的连接数。如果 Recv-Q > 0，说明应用程序来不及处理新连接
- 对于 ESTAB 状态的 socket，`Recv-Q` 表示内核接收缓冲区中未被进程读取的数据量，`Send-Q` 表示已发送但未被对端 ACK 的数据量。非零值说明有数据积压

**连接状态过滤：**

```bash
ss -tan state established    # 所有 ESTABLISHED 连接
ss -tan state time-wait      # TIME_WAIT 连接
ss -tan state close-wait     # CLOSE_WAIT（常见泄漏状态）
```

**TIME_WAIT 过多：** 短连接场景（如频繁的 HTTP/1.0 请求）下，大量 TIME_WAIT 可能耗尽本地端口。内核参数可调整：`net.ipv4.tcp_tw_reuse = 1`。

**CLOSE_WAIT 堆积：** 这是真正的 Bug 信号。CLOSE_WAIT 表示对端已关闭连接，但本地进程没有调用 `close()`。在 Java 中通常意味着忘记关闭 Socket/连接池泄漏，或 finally 块中未释放资源。

### 2.2 tcpdump — 网络抓包

```bash
tcpdump -i eth0 port 8080 -w capture.pcap   # 抓包保存为 pcap 文件
tcpdump -i eth0 host 10.0.1.5 -A            # ASCII 输出，查看 HTTP 明文
tcpdump -i eth0 tcp and src net 192.168.1.0/24 -c 100  # 最多抓 100 个包
tcpdump -r capture.pcap -nn                 # 读取并显示 pcap 文件（不解析端口/主机名）
```

**常用过滤表达式：**

| 表达式 | 说明 |
|--------|------|
| `host 10.0.0.1` | 源或目标为该主机的包 |
| `src host 10.0.0.1` | 源为该主机的包 |
| `port 8080` | 源或目标端口为 8080 |
| `src port 12345` | 源端口为 12345 |
| `tcp[tcpflags] & (tcp-syn|tcp-fin) != 0` | SYN 或 FIN 包 |
| `greater 1500` | 大于 1500 字节的包 |

**注意事项：** 高流量生产环境沿网卡抓包会极大消耗 CPU。先用 BPF 过滤表达式缩小范围，必要时使用 `-s` 指定 snaplen 限制每个包的截取长度。

### 2.3 tshark — Wireshark 命令行版

```bash
tshark -r capture.pcap -Y "http.request"                  # 过滤 HTTP 请求
tshark -r capture.pcap -z io,stat,5,"tcp.port==8080"      # IO 统计（5秒间隔）
tshark -r capture.pcap -q -z conv,tcp                     # TCP 会话统计
```

### 2.4 curl — HTTP 客户端诊断

```bash
curl -v https://api.example.com           # 详细输出（包含 TLS 握手、请求/响应头）
curl -w "@curl-format.txt" https://...    # 自定义格式化输出
```

**格式化文件 `curl-format.txt`（性能分析专用）：**

```
time_namelookup:  %{time_namelookup}\n      # DNS 解析耗时
time_connect:     %{time_connect}\n         # TCP 连接建立耗时
time_appconnect:  %{time_appconnect}\n      # TLS 握手耗时
time_starttransfer: %{time_starttransfer}\n # 收到第一个字节耗时
time_total:       %{time_total}\n           # 总耗时
```

通过解析各阶段耗时，可以判断延迟发生在哪个环节（DNS连接TCP握手指向TLS握手应用程序处理传输）。

**其他常用选项：**
- `-H "Authorization: Bearer xxx"`：自定义请求头
- `-X POST -d '{"key":"value"}'`：指定方法和请求体
- `-o /dev/null -s`：静默模式，不输出响应体
- `-k`：跳过 TLS 证书验证（仅测试用）

### 2.5 mtr — 路由追踪增强版

```bash
mtr -r -c 100 10.0.1.5        # 发送 100 个包并输出报告
mtr -i 0.5 10.0.1.5           # 0.5 秒间隔的实时交互界面
```

mtr 结合了 `traceroute` 和 `ping` 的能力，持续发送探测包并统计每一跳的丢包率和延迟分布。注意：中间节点的丢包可能是路由器控制平面限速（ICMP rate limiting），不代表数据平面真实丢包。只有最后一跳的丢包率才是可靠的端到端指标。

### 2.6 nslookup / dig — DNS 诊断

```bash
nslookup example.com                              # 简单 A 记录查询
dig example.com +short                            # 仅输出 IP
dig example.com +trace                            # 从根服务器递归追踪
dig example.com MX                                # MX 记录
dig example.com CNAME                             # CNAME 记录
dig @8.8.8.8 example.com                          # 指定 DNS 服务器
```

### 2.7 iptables / nftables 基础

**四表五链模型：**

| 表 | 用途 | 关键链 |
|----|------|--------|
| filter | 包过滤（默认表） | INPUT / FORWARD / OUTPUT |
| nat | 网络地址转换 | PREROUTING / INPUT / OUTPUT / POSTROUTING |
| mangle | 包修改（TTL/MARK） | 五个链全覆盖 |
| raw | 连接跟踪例外 | PREROUTING / OUTPUT |

```
数据包流向：
PREROUTING → (路由决策) → INPUT → 本地进程
                         → FORWARD → POSTROUTING → 发出
              本地进程 → OUTPUT → POSTROUTING → 发出
```

**nftables** 是现代替代方案，将 iptables 的多个工具（iptables/ip6tables/arptables/ebtables）统一为一个框架，语法更简洁、规则管理更高效。截至 2024 年，主流发行版已默认 nftables。

---

## 三、进程管理

### 3.1 ps — 进程快照

```bash
ps aux                # BSD 风格，显示所有用户所有进程
ps -ef                # Unix 风格，-e 所有进程 -f 完整格式
ps -eo pid,tid,class,rtprio,ni,pri,psr,pcpu,stat,comm --sort=-pcpu | head -20
                      # 自定义列 + 按 CPU 降序
```

**字段说明：**
- `ni`：nice 值（-20 到 19，越低优先级越高）
- `stat`：进程状态（R运行/S睡眠/D不可中断睡眠/Z僵尸/T停止）
- `psr`：当前在哪个 CPU 核心上运行
- `wchan`：进程当前阻塞在哪个内核函数（ps -eo pid,wchan,comm）

### 3.2 pstree — 进程树

```bash
pstree -p            # 树形显示 + PID
pstree -p $PID       # 查看某进程的子进程树
```

### 3.3 lsof — 列出打开的文件

```bash
lsof -i :8080                         # 查看哪个进程占用了 8080 端口
lsof -p $PID                          # 进程打开的所有文件（含 socket、pipe、普通文件）
lsof -u tomcat                        # 指定用户打开的所有文件
lsof /var/log/app.log                 # 哪些进程正在写这个日志文件
lsof +D /opt/app                      # 目录下被打开的所有文件
lsof -c java                          # 命令名以 java 开头的进程
```

常用场景：端口被占用、文件被删除但空间未释放、查看进程打开了哪些 socket 连接。

### 3.4 strace — 系统调用追踪

```bash
strace -p $PID                           # attach 到运行中的进程
strace -f -p $PID                        # 跟踪子进程
strace -e trace=network -p $PID          # 只看网络相关系统调用
strace -e trace=file -p $PID             # 只看文件操作
strace -c -p $PID                        # 汇总统计（各系统调用次数、耗时、错误率）
strace -T -e trace=futex -p $PID         # 显示每个系统调用的耗时（定位锁等待）
strace -o /tmp/strace.log -p $PID        # 输出到文件
```

**常见 Java 场景下的 strace 使用：**
- `-e trace=futex` 查看锁竞争（频繁的 FUTEX_WAIT 意味着 synchronized 或 Lock 竞争）
- `-e trace=epoll_wait` 查看 IO 等待时间
- `-e trace=fsync,fdatasync` 查看是否频繁刷盘（影响 Kafka/数据库性能）
- `-e trace=connect,sendto,recvfrom` 查看网络调用模式

**注意：** strace 会对被跟踪进程产生明显的性能开销（每个系统调用都会触发上下文切换到 strace 进程），不要在已经高负载的生产进程上长时间运行。

### 3.5 kill / 信号

| 信号 | 编号 | 含义 | Java 场景 |
|------|------|------|-----------|
| SIGTERM | 15 | 优雅终止（默认） | Spring Boot 的 Graceful Shutdown |
| SIGKILL | 9 | 立即终止（不可捕获） | 强杀，不推荐 |
| SIGINT | 2 | Ctrl+C 中断 | 开发环境终止 |
| SIGHUP | 1 | 挂断信号 | nginx 的 reload：`kill -HUP $PID` |
| SIGQUIT | 3 | 退出并 core dump | **Java 线程堆栈**：`kill -3 $PID` 或 `kill -QUIT $PID` |
| SIGUSR1/USR2 | 10/12 | 用户自定义 | 应用程序自定义行为 |

**SIGQUIT 对 Java 的特殊意义：** 向 JVM 发送 SIGQUIT（`kill -3 $PID`）不会终止进程，而是向标准输出打印所有线程的完整堆栈信息。这是线上快速获取线程状态的标准手段。堆栈会输出到 JVM 的 stdout（通常是 catalina.out 或应用日志文件）。

### 3.6 后台进程管理

```bash
# 启动后台进程
java -jar app.jar &              # 后台运行，仍受 shell 控制

# nohup：忽略 SIGHUP，关闭终端后进程不退出
nohup java -jar app.jar > app.log 2>&1 &

# disown：从 shell 的 job 列表中移除
java -jar app.jar &
disown                           # 移除最近的后台 job

# 查看与恢复
jobs                             # 查看当前 shell 的 job 列表
fg %1                            # 将 job 1 恢复到前台
bg %1                            # 将 job 1 恢复到后台运行
```

**最佳实践：** 生产环境永远不要用 `nohup &`，应使用 systemd service 管理 Java 进程。

---

## 四、systemd

### 4.1 Unit 文件结构

```ini
# /etc/systemd/system/my-app.service
[Unit]
Description=My Java Application
After=network-online.target          # 网络就绪后启动
Wants=network-online.target
Requires=postgresql.service          # 强依赖（PostgreSQL 启动失败则本服务不启动）

[Service]
Type=simple                          # simple | forking | oneshot | notify
User=appuser
Group=appgroup
WorkingDirectory=/opt/app
ExecStart=/usr/bin/java -jar /opt/app/app.jar
ExecStop=/bin/kill -TERM $MAINPID
Restart=on-failure                   # no | always | on-success | on-failure | on-abnormal
RestartSec=10
TimeoutStopSec=30                    # 30 秒内未正常退出则 SIGKILL
Environment="JAVA_OPTS=-Xms2g -Xmx2g"
EnvironmentFile=/etc/app/env.conf    # 从文件加载环境变量
SuccessExitStatus=143                # 将 SIGTERM 的退出码当作正常退出
StandardOutput=journal               # 日志输出到 journald
StandardError=journal

[Install]
WantedBy=multi-user.target
```

**Type 说明：**
- **simple**（最常用，也是默认值）：ExecStart 启动的进程就是主进程。适用于 Java 应用（前台运行）
- **forking**：进程会 fork 后退出父进程，子进程继续运行。常用于 nginx、Redis 等传统守护进程
- **oneshot**：一次性任务，等待进程退出后进入 inactive 状态。配合 `RemainAfterExit=yes` 可用于配置类操作
- **notify**：进程启动后通过 `sd_notify()` 通知 systemd 已就绪。支持 Type=notify 的应用可获得更精确的就绪检测

### 4.2 journalctl — 日志查询

```bash
journalctl -u my-app                         # 查看指定服务的所有日志
journalctl -u my-app -f                      # follow 模式，实时查看
journalctl -u my-app --since "2026-07-20 10:00:00" --until "2026-07-20 11:00:00"
journalctl -u my-app -p err                  # 只看 ERROR 及以上级别
journalctl -u my-app -o json                 # JSON 结构化输出（便于程序解析）
journalctl --disk-usage                      # 日志占用磁盘空间
journalctl --vacuum-size=500M                # 清理日志至 500MB 以内
```

**日志级别：** emerg(0) alert(1) crit(2) err(3) warning(4) notice(5) info(6) debug(7)

### 4.3 systemctl — 服务管理

```bash
systemctl start my-app
systemctl stop my-app
systemctl restart my-app
systemctl reload my-app           # 重新加载配置（需 ExecReload 定义）
systemctl status my-app
systemctl enable my-app           # 开机自启
systemctl disable my-app
systemctl mask my-app             # 禁止启动（创建到 /dev/null 的软链接）
systemctl unmask my-app
systemctl daemon-reload           # 修改 unit 文件后重新加载
systemctl list-unit-files --type=service
systemctl list-units --state=failed   # 查看启动失败的服务
```

### 4.4 Timer — 替代 Cron

```ini
# /etc/systemd/system/my-backup.timer
[Timer]
OnCalendar=daily                  # 每天一次，等价于 "*-*-* 00:00:00"
# OnCalendar=*-*-* 02:30:00       # 每天凌晨 2:30
# OnCalendar=Mon..Fri 10:00       # 工作日 10:00
# OnBootSec=5min                  # 启动后 5 分钟
OnUnitActiveSec=1h               # 上次任务启动后 1 小时
Persistent=true                   # 如果上次执行被跳过，系统启动后补执行
RandomizedDelaySec=300           # 随机延迟最多 5 分钟（分散负载）

[Install]
WantedBy=timers.target
```

**timer 相比 cron 的优势：**
- 精度到微秒（cron 分钟级）
- 与 service 单元紧密绑定，自动处理依赖和日志
- `Persistent=true` 避免因为机器关机而跳过任务
- 定时任务日志统一在 journald 中管理
- 可以为每个定时任务设置资源限制（MemoryMax/CPUQuota）

---

## 五、cgroup v2

### 5.1 统一层级结构

cgroup v1 中，每个子系统（CPU/memory/blkio 等）有独立的层级树，一个进程可以属于不同层级树的不同位置，管理复杂且易出错。cgroup v2 采用**单一层级结构**，所有控制器挂载在同一棵树 `/sys/fs/cgroup/` 下。

```bash
ls /sys/fs/cgroup/
# 输出：cgroup.controllers  cgroup.subtree_control  ...
#       system.slice/  user.slice/  init.scope/
```

- `cgroup.controllers`：当前 cgroup 可用的控制器列表（cpuset cpu io memory hugetlb pids rdma）
- `cgroup.subtree_control`：启用了哪些控制器可以下发给子 cgroup

### 5.2 CPU 限制

```bash
# cpu.max 格式：$MAX $PERIOD
echo "200000 1000000" > /sys/fs/cgroup/myapp/cpu.max
# 表示每 1 秒（1,000,000 微秒 = 1 秒）最多使用 0.2 秒 CPU
# 等价于 0.2 个 CPU 核心

# cpu.weight：优先级权重（替代 cgroup v1 的 cpu.shares）
echo 100 > /sys/fs/cgroup/myapp/cpu.weight
# 默认 100，范围 1-10000。当 CPU 竞争时，高权重获得更多 CPU 时间
```

**Docker 对应关系：**
- `--cpus=2.0` → `cpu.max = "200000 100000"`（不设 period 的简化形式，2 个核 = 200%）
- `--cpu-shares` → `cpu.weight`

### 5.3 Memory 限制

```bash
# memory.max：硬限制（OOM Killer 触发边界）
echo "2147483648" > /sys/fs/cgroup/myapp/memory.max  # 2GB

# memory.high：软限制（超过后限流但不直接杀进程）
echo "1610612736" > /sys/fs/cgroup/myapp/memory.high  # 1.5GB

# memory.low：尽力保护（内存紧张时尽量不回收，但不保证）
echo "1073741824" > /sys/fs/cgroup/myapp/memory.low    # 1GB
```

**三个层级的行为：**
1. `memory.low`：内存回收时尽量保护的底线。如果全局内存充足，low 不起作用；内存紧张时，比 low 低的 cgroup 先被回收
2. `memory.high`：超过 high 值时，进程会被限流（throttle），并触发内存回收，但不会被 OOM Kill。给应用"刹车"的时间
3. `memory.max`：超过 max 值时触发 OOM Killer，进程被 kill

**最佳实践：** Docker 的 `--memory` 映射为 `memory.max`（硬限制）。给 Java 应用设置 container memory limit 时，务必同步设置 `-Xmx` 低于 limit，为 Metaspace、线程栈、堆外内存预留空间。推荐 JVM 堆 = 容器内存 * 75%，例如 2GB 容器的 `-Xmx` 设为 1.5GB。

### 5.4 IO 限制

```bash
# io.max：格式 <设备号> <读写类型> <上限>
# 读写类型：rbps(读字节)/wbps(写字节)/riops(读IOPS)/wiops(写IOPS)
echo "8:0 wbps=104857600" > /sys/fs/cgroup/myapp/io.max
# 限制 8:0 设备（sda）写吞吐为 100MB/s

# io.weight：IO 优先级权重（同 CPU 权重逻辑）
echo 500 > /sys/fs/cgroup/myapp/io.weight
```

### 5.5 cgroupfs 手动操作

```bash
# 创建 cgroup
mkdir /sys/fs/cgroup/myapp

# 查看有哪些控制器可用
cat /sys/fs/cgroup/cgroup.controllers

# 启用控制器给子 cgroup 使用
echo "+cpu +memory +io" > /sys/fs/cgroup/cgroup.subtree_control

# 限制 CPU
echo "50000 100000" > /sys/fs/cgroup/myapp/cpu.max     # 0.5 核

# 限制内存
echo "1073741824" > /sys/fs/cgroup/myapp/memory.max     # 1GB

# 将进程加入 cgroup
echo $PID > /sys/fs/cgroup/myapp/cgroup.procs

# 查看 cgroup 中的进程
cat /sys/fs/cgroup/myapp/cgroup.procs
```

### 5.6 Docker / K8s 中的 cgroup

| Docker / K8s 参数 | cgroup v2 文件 | 说明 |
|-------------------|----------------|------|
| `--cpus=2` | `cpu.max` | 最多使用 2 个 CPU 核心 |
| `--memory=2g` | `memory.max` | 内存硬限制 2GB |
| `--memory-reservation=1.5g` | `memory.low` | 尽力保护 1.5GB |
| `--cpu-shares=512` | `cpu.weight` | CPU 权重 512 |
| `--blkio-weight=500` | `io.weight` | IO 权重 500 |

K8s Pod 的 `resources.requests` 和 `resources.limits` 最终通过 kubelet → CRI → cgroup 路径生效。`limits.memory` 映射到 `memory.max`，`requests.memory` 影响调度但不直接对应单个 cgroup 参数。

---

## 六、Namespace — 容器隔离原理

Linux namespace 是容器技术的基石。Docker 容器之所以看起来像一个独立的系统，正是因为创建了 7 个独立的 namespace。

### 6.1 七个命名空间

| Namespace | 系统调用参数 | 隔离内容 | 影响范围 |
|-----------|-------------|----------|----------|
| PID | CLONE_NEWPID | 进程 PID 编号 | 容器内 PID 1 ≠ 宿主机 PID |
| Network | CLONE_NEWNET | 网络栈（网卡/路由/iptables/端口） | 容器有独立 IP 和端口空间 |
| Mount | CLONE_NEWNS | 挂载点（文件系统） | 容器看到独立的文件系统树 |
| UTS | CLONE_NEWUTS | 主机名和域名 | 容器可设置独立 hostname |
| IPC | CLONE_NEWIPC | System V IPC / POSIX 消息队列 | 容器间 IPC 隔离 |
| User | CLONE_NEWUSER | UID/GID 映射 | Rootless 容器的基础 |
| Cgroup | CLONE_NEWCGROUP | cgroup 文件系统视图 | 容器内看到的 /sys/fs/cgroup 是隔离的 |

### 6.2 PID Namespace

容器内进程的 PID 在宿主机上有不同的编号。例如容器内 PID 1 的 nginx，在宿主机上可能是 PID 12345。`/proc` 文件系统在 namespace 内部也是隔离的——容器内 `ls /proc` 只能看到自己的进程。

这种隔离带来的影响：`top` 命令在容器内看到的总内存可能是宿主机的，因为 `/proc/meminfo` 在旧内核中未被 namespace 隔离。从 Linux 4.x 开始，/proc 中部分文件（如 `/proc/meminfo`、`/proc/cpuinfo`）已支持基于 cgroup 的虚拟化视图，但需要开启内核选项。

### 6.3 Network Namespace

每个容器拥有独立的网络栈，包括虚拟网卡（veth pair 的一端）、IP 地址、路由表和 iptables 规则。

**veth pair 工作原理：**
```
容器 eth0 (veth1)  ←→  veth2 (宿主机，接入 docker0 网桥)
```

Docker 默认的 `docker0` 网桥充当虚拟交换机，所有容器的 veth pair 接入这个网桥，实现容器间二层互通。出容器流量经过 SNAT（iptables MASQUERADE）访问外网。

```bash
# 查看容器的 veth pair
ip link show           # 宿主机所有网络接口
ip addr show docker0   # docker0 网桥

# 从宿主机进入容器的 network namespace
nsenter -t $CONTAINER_PID -n ip addr
```

### 6.4 Mount Namespace

容器启动时，Docker 将容器镜像的各层（layer）通过 overlay2 联合挂载，形成容器的根文件系统。容器内的 `mount` 操作只在当前 mount namespace 内可见，不会影响宿主机。

### 6.5 User Namespace — Rootless 容器

User namespace 允许将容器内的 UID 0（root）映射为宿主机上的普通用户（如 UID 1000）。即使攻击者逃逸出容器，也只是获得了宿主机上的普通用户权限。

**UID 映射示例：**
```
容器内 UID 0 (root)  →  宿主机 UID 100000
容器内 UID 1-65536    →  宿主机 UID 100001-165536
```

Rootless Docker（Docker 20.10+）利用 User Namespace 实现无需 root 权限运行 Docker daemon，是安全加固的最佳实践。

---

## 七、Shell 脚本

### 7.1 变量操作

```bash
NAME="world"
echo "Hello, ${NAME}"
echo "Length: ${#NAME}"                    # 变量长度

# 默认值
echo "${UNDEFINED:-default value}"         # 变量未定义时使用默认值
echo "${UNDEFINED:=default value}"         # 同上，同时赋值给变量
echo "${UNDEFINED:?error: VAR is unset}"  # 未定义时报错退出（set -u 模式）

# 字符串截取
STR="Hello World"
echo "${STR:0:5}"       # 输出 "Hello"（offset:0, length:5）
echo "${STR:6}"         # 输出 "World"（offset:6 到末尾）
echo "${STR#Hello }"    # 从左边删除最短匹配，输出 "World"
echo "${STR##* }"       # 从左边删除最长匹配，输出 "World"
echo "${STR%.txt}"      # 从右边删除最短匹配（常用于去文件扩展名）
```

### 7.2 条件判断

```bash
# [ ] 和 [[ ]] 的区别
# [ ] 是 POSIX 标准的 test 命令，兼容性好但功能有限
# [[ ]] 是 bash 扩展，支持正则匹配和更多操作符

if [[ "$NAME" =~ ^[A-Z][a-z]+$ ]]; then    # 正则匹配（仅 [[ ]] 支持）
    echo "匹配"
fi

# 文件测试
[[ -f /etc/passwd ]]   # 是否是普通文件
[[ -d /opt/app ]]      # 是否是目录
[[ -x /usr/bin/java ]] # 是否可执行
[[ -s /var/log/app.log ]]  # 文件非空

# 数值比较
[[ $CPU_USE -gt 80 ]]  # >80
[[ $COUNT -ge 10 ]]    # >=10
```

### 7.3 循环结构

```bash
# for 循环
for service in nginx redis postgresql; do
    systemctl status "$service"
done

# while read 逐行处理（注意管道子 shell 陷阱）
# 错误写法（管道右侧在子 shell 中，COUNT 不会影响父 shell）：
cat file.txt | while read line; do COUNT=$((COUNT+1)); done

# 正确写法（使用进程替换，避免子 shell）：
while IFS= read -r line; do
    COUNT=$((COUNT+1))
done < <(cat file.txt)
# 或使用输入重定向：
while IFS= read -r line; do ...; done < file.txt
```

**管道子 shell 陷阱：** Bash 中管道 `|` 的每个命令都在子 shell 中执行。在 `while` 循环中修改的变量，循环结束后在父 shell 中不可见。解决方案是使用进程替换 `< <(...)` 或输入重定向。

### 7.4 函数

```bash
check_port() {
    local port=$1            # local 限制作用域
    local host=${2:-localhost}  # 默认参数
    if nc -z "$host" "$port" 2>/dev/null; then
        echo "端口 $host:$port 可达"
        return 0             # 返回退出码
    else
        echo "端口 $host:$port 不可达"
        return 1
    fi
}

# 参数：$1 $2 ... $@（所有参数列表） $#（参数个数）
# 返回值：return 0-255（退出码），如需返回字符串用 echo + $(命令替换)
```

### 7.5 错误处理

```bash
set -e              # 任何命令返回非零值时立即退出
set -u              # 使用未定义变量时报错
set -o pipefail     # 管道中任何命令失败，整个管道返回失败

# 综合使用（推荐每一脚本都加）：
set -euo pipefail

# trap 捕获错误并清理
cleanup() {
    echo "清理临时文件..."
    rm -f /tmp/myapp-*.tmp
}
trap cleanup EXIT            # 脚本退出时执行（正常或异常退出均触发）
trap 'echo "错误发生在行 $LINENO"' ERR   # 命令出错时触发
```

### 7.6 常用一行脚本

```bash
# awk：按列提取、求和、去重
awk '{print $1}' access.log | sort | uniq -c | sort -rn           # IP 访问量 Top N
awk '{sum+=$NF} END {print sum}' data.txt                          # 最后一列求和
awk '{count[$1]++} END {for(k in count) print k, count[k]}' data.csv  # 按第一列分组计数

# sed：替换、删除
sed -i 's/old/new/g' file.txt                                      # 原地替换
sed -i '/^$/d' file.txt                                             # 删除空行

# sort + uniq：计数和去重
sort file.txt | uniq -c | sort -rn | head -10                       # 出现次数 Top 10

# xargs：并行执行
find . -name "*.log" -print0 | xargs -0 -P 4 gzip                   # 4 进程并行压缩
docker ps -q | xargs docker stats --no-stream                       # 所有容器资源统计

# find + exec：批量操作
find /opt/app/logs -name "*.log" -mtime +7 -exec rm -f {} \;       # 删除 7 天前日志
find /opt/app -type f -size +100M -exec ls -lh {} \;               # 查找大文件
```

---

## 八、Java 运维场景

### 8.1 OOM 时的系统状态诊断

```bash
# 1. 查看内核 OOM 日志
dmesg -T | grep -i 'killed process'     # -T 显示人类可读时间戳

# 2. 查看 OOM score（值越高越容易被 kill）
cat /proc/$PID/oom_score               # 当前分数
cat /proc/$PID/oom_score_adj           # 调整因子（-1000 到 1000，-1000 完全豁免）

# 3. 系统日志中的 OOM Killer 记录
grep -i 'out of memory' /var/log/syslog
journalctl -k | grep -i oom
```

**OOM Killer 决策逻辑：** 内核根据 `oom_score` 选择进程 kill。`oom_score` 综合考虑进程的内存占用、运行时间、优先级等因素。Docker 守护进程默认 `oom_score_adj=-500`，降低了被 kill 的概率。Java 进程在生产环境中通常设置 `oom_score_adj=-500` 或更低优先清理。

### 8.2 JVM 内存映射分析

```bash
# pmap：进程内存映射详情
pmap -x $PID | sort -k3 -rn | head -20

# 关注指标：
# - anon（匿名内存）：Java 堆 + 线程栈，是内存占用大头
# - RSS：实际常驻物理内存
# - Dirty：脏页（已修改待写回），高 Dirty 说明内存分配活跃
```

**pmap 输出解读：**
- 大块的 `anon` 区域（几百 MB 到几 GB）通常是 Java 堆
- 1024KB 大小的 `anon` 区域通常是线程栈（`-Xss` 决定大小）
- 标记为 `[stack]` 和 `[anon]` 的区域合计 + [heap] = 进程的实际物理内存使用

### 8.3 线程堆栈 + 系统调用关联分析

**完整排障链路：**

```bash
# Step 1: 找到高 CPU 进程
top -H -p $PID

# Step 2: 找到高 CPU 线程（TID，即轻量级进程的 PID）
# 假设 TID = 12345

# Step 3: 转换 TID 为十六进制（jstack 中线程 ID 是十六进制）
printf "%x\n" 12345   # 输出 0x3039

# Step 4: 在 jstack 输出中搜索这个十六进制 TID
jstack $PID | grep -A 20 "0x3039"
# 找到对应线程的堆栈，分析代码路径

# Step 5: 如果需要了解该线程到底在等什么（系统调用层面）
strace -T -p 12345    # 查看该线程当前和最近阻塞的系统调用
```

**典型问题场景：**
- `jstack` 显示线程 `BLOCKED` + `strace -e trace=futex` 显示 `FUTEX_WAIT` 长时间等待 → 锁竞争
- `jstack` 显示 `RUNNABLE` + CPU 高 → 检查是否有死循环或密集计算
- `jstack` 显示 `WAITING (parking)` + `strace` 显示 `epoll_wait` → 等待 IO 或事件
- `jstack` 显示线程都在 `RUNNABLE` 但 CPU 不高 → 可能是 IO 密集（`strace` 查看 `read/write` 调用频率和耗时）

### 8.4 快速排障流程

```
发现问题（监控告警/用户反馈）
    │
    ▼
top → 确认高 CPU / 高内存 / 高负载的进程
    │
    ├── CPU 高 → pidstat -t -p $PID → 定位高 CPU 线程
    │       → jstack 转换 16 进制 → 分析 Java 代码路径
    │       → strace -T 跟踪系统调用耗时
    │
    ├── 内存高 → pmap -x $PID → 确认堆/栈/堆外分布
    │       → jcmd $PID GC.heap_info → 确认堆使用情况
    │       → jcmd $PID VM.native_memory summary → Native Memory Tracking
    │
    ├── 线程多 → pstree -p $PID | wc -l → jstack 统计线程状态
    │       → 检查是否线程泄漏（未使用线程池或未关闭）
    │
    └── IO 高 → iostat -x → pidstat -d -p $PID
            → lsof -p $PID | wc -l → 检查打开文件数
```

---

## 九、代码示例

### 示例一：Java 应用健康检查 Shell 脚本

```bash
#!/bin/bash
set -euo pipefail

APP_NAME="my-java-app"
PID_FILE="/var/run/${APP_NAME}.pid"
HTTP_URL="http://localhost:8080/actuator/health"
LOG_FILE="/var/log/${APP_NAME}-health.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

# 1. 检查进程是否存在
if [[ ! -f "$PID_FILE" ]]; then
    log "ERROR: PID 文件 $PID_FILE 不存在"
    exit 1
fi

PID=$(cat "$PID_FILE")
if ! kill -0 "$PID" 2>/dev/null; then
    log "ERROR: 进程 $PID 不存在"
    exit 2
fi
log "进程 $PID 存在"

# 2. 检查端口是否监听
if ! ss -tlnp | grep -q ":$PORT.*$PID"; then
    log "ERROR: 端口 $PORT 未被进程 $PID 监听"
    exit 3
fi
log "端口 $PORT 监听正常"

# 3. 检查 HTTP Health Endpoint
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$HTTP_URL" 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" != "200" ]]; then
    log "ERROR: Health endpoint 返回 $HTTP_CODE"
    exit 4
fi
log "Health endpoint 正常 (HTTP 200)"

log "健康检查通过"
exit 0
```

### 示例二：使用 JDK 25 ProcessHandle API 监控系统资源

```java
import java.time.Duration;
import java.time.Instant;

/**
 * 利用 JDK 25 的 ProcessHandle API 获取进程和系统信息，
 * 替代传统的 shell 调用（如 ps/top/free），更适合 Java 程序的资源监控。
 */
public class SystemResourceMonitor {

    public record SystemMetrics(
            int cpuCores,
            double processCpuPercent,
            long processRssBytes,
            long systemTotalMemory,
            long systemFreeMemory,
            int threadCount,
            long openFileDescriptors
    ) {}

    public static SystemMetrics collect() {
        var handle = ProcessHandle.current();
        var info = handle.info();

        // CPU 使用率：采样两次计算差值
        var snapshot1 = handle.cpuDuration().orElse(Duration.ZERO);
        var time1 = Instant.now();
        try { Thread.sleep(100); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        var snapshot2 = handle.cpuDuration().orElse(Duration.ZERO);
        var time2 = Instant.now();

        var cpuDelta = snapshot2.minus(snapshot1).toNanos();
        var timeDelta = Duration.between(time1, time2).toNanos();
        double cpuPercent = (double) cpuDelta / timeDelta * 100;

        // 内存：通过 OperatingSystemMXBean 获取更详细的数据
        var osBean = java.lang.management.ManagementFactory.getOperatingSystemMXBean();

        long rssBytes = 0;
        if (osBean instanceof com.sun.management.OperatingSystemMXBean extendedOsBean) {
            rssBytes = extendedOsBean.getTotalMemorySize() - extendedOsBean.getFreeMemorySize();
        }

        return new SystemMetrics(
                Runtime.getRuntime().availableProcessors(),
                Math.min(cpuPercent, 100.0),
                rssBytes,
                ((com.sun.management.OperatingSystemMXBean) osBean).getTotalMemorySize(),
                ((com.sun.management.OperatingSystemMXBean) osBean).getFreeMemorySize(),
                handle.children().mapToInt(c -> 1).sum() + 1,
                info.totalCpuDuration().isPresent() ? 0 : -1 // 需要 OS 特定方式获取
        );
    }

    public static void main(String[] args) {
        var metrics = collect();
        System.out.printf("""
                系统资源监控:
                  CPU 核心数:    %d
                  进程 CPU 使用率: %.2f%%
                  进程 RSS:       %d MB
                  系统总内存:     %d MB
                  系统空闲内存:   %d MB
                  线程数:         %d
                """,
                metrics.cpuCores(),
                metrics.processCpuPercent(),
                metrics.processRssBytes() / (1024 * 1024),
                metrics.systemTotalMemory() / (1024 * 1024),
                metrics.systemFreeMemory() / (1024 * 1024),
                metrics.threadCount()
        );
    }
}
```

### 示例三：Spring Boot Actuator + OS 指标收集暴露 Prometheus 格式

```java
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.binder.MeterBinder;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.lang.management.ManagementFactory;
import java.lang.management.OperatingSystemMXBean;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * 自定义 Micrometer MeterBinder，将 OS 级别指标（CPU、内存、磁盘）注册到
 * Prometheus Metrics Endpoint，配合 Spring Boot Actuator 暴露。
 * Spring Boot Actuator 默认已暴露 JVM 指标，本类补充 OS 级别指标。
 */
@Component
public class OsMetricsBinder implements MeterBinder {

    @Override
    public void bindTo(MeterRegistry registry) {
        var osBean = ManagementFactory.getPlatformMXBean(OperatingSystemMXBean.class);

        // CPU 使用率（进程级别）
        Gauge.builder("os.process.cpu.usage", osBean, bean -> {
                    try {
                        return ((com.sun.management.OperatingSystemMXBean) bean).getProcessCpuLoad();
                    } catch (Exception e) {
                        return Double.NaN;
                    }
                })
                .description("进程 CPU 使用率 (0.0-1.0)")
                .register(registry);

        // 系统 CPU 使用率
        Gauge.builder("os.system.cpu.usage", osBean, bean -> {
                    try {
                        return ((com.sun.management.OperatingSystemMXBean) bean).getCpuLoad();
                    } catch (Exception e) {
                        return Double.NaN;
                    }
                })
                .description("系统整体 CPU 使用率 (0.0-1.0)")
                .register(registry);

        // 系统总内存和空闲内存
        Gauge.builder("os.system.memory.total.bytes", osBean,
                        bean -> ((com.sun.management.OperatingSystemMXBean) bean).getTotalMemorySize())
                .description("系统总物理内存（字节）")
                .register(registry);

        Gauge.builder("os.system.memory.free.bytes", osBean,
                        bean -> ((com.sun.management.OperatingSystemMXBean) bean).getFreeMemorySize())
                .description("系统空闲物理内存（字节）")
                .register(registry);

        // 磁盘使用率（根分区）
        Gauge.builder("os.disk.usage.percent", this, self -> self.getDiskUsagePercent("/"))
                .description("磁盘分区使用率 (%)")
                .tag("mount", "/")
                .register(registry);

        // 磁盘可用空间
        Gauge.builder("os.disk.free.bytes", this, self -> self.getDiskFreeBytes("/"))
                .description("磁盘分区可用空间（字节）")
                .tag("mount", "/")
                .register(registry);
    }

    private double getDiskUsagePercent(String path) {
        try {
            var store = Files.getFileStore(Paths.get(path));
            long total = store.getTotalSpace();
            long free = store.getUsableSpace();
            if (total > 0) {
                return (double) (total - free) / total * 100;
            }
        } catch (IOException ignored) {
        }
        return Double.NaN;
    }

    private long getDiskFreeBytes(String path) {
        try {
            return Files.getFileStore(Paths.get(path)).getUsableSpace();
        } catch (IOException ignored) {
            return -1;
        }
    }
}
```

```yaml
# application.yml — Actuator 配置暴露 Prometheus 端点
management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics,prometheus
  metrics:
    export:
      prometheus:
        enabled: true
    tags:
      application: ${spring.application.name}
      environment: ${ENV:dev}
```

访问 `GET /actuator/prometheus` 即可获得包含 JVM + OS 指标的 Prometheus 格式数据，可直接被 Prometheus server 抓取。

---

## 常见问题

**Q1: Java 进程假死（端口监听但不响应）如何诊断？**

假死通常表现为端口 `LISTEN` 但请求超时或拒绝。诊断步骤：
1. `ss -tlnp | grep $PID` — 确认端口监听，检查 Recv-Q 是否有积压
2. `netstat -s | grep -i listen` — 查看是否有 `ListenOverflows` 和 `ListenDrops`，表示全连接队列溢出
3. `jstack $PID` — 检查所有线程状态。如果大部分线程 `BLOCKED` 或 `WAITING`，可能是死锁或资源耗尽
4. 用 `strace -p $PID -e trace=accept` 查看是否在调用 `accept()`，如果没有，说明事件循环/IO 线程已经不工作了
5. 检查 GC 日志 — Full GC 频繁会导致长时间 STW（Stop-The-World），应用看起来像"假死"
6. 检查线程数 — `cat /proc/$PID/status | grep Threads`，如果线程数达到 `ulimit -u` 上限，新连接无法处理

**Q2: `su` 和 `su -` 的区别及环境变量问题？**

`su user` 切换用户但保留原用户的环境变量（HOME、PATH 等不变），工作目录也不变。`su - user`（或 `su -l user`）模拟完整的登录过程，加载 target user 的 profile（`~/.bashrc`、`~/.bash_profile`），环境变量完全切换。Java 运维中常见问题：用 `su appuser` 启动 Java 进程，但 `JAVA_HOME` 仍是 root 的设置，导致使用了错误的 JDK 版本。**始终使用 `su - appuser` 来避免环境变量混乱。**

**Q3: systemd 服务启动顺序如何控制？**

通过 `After=`、`Before=`、`Requires=`、`Wants=` 指令控制：
- `After=postgresql.service`：在本服务启动**之前**先启动 postgresql。但仅表示顺序，不表示依赖
- `Requires=postgresql.service`：强依赖，postgresql 启动失败时本服务不启动；postgresql 停止时本服务也被停止
- `Wants=postgresql.service`：弱依赖，尝试启动 postgresql 但如其失败不影响本服务

**典型 Java 应用启动顺序：** `After=network-online.target postgresql.service redis.service` + `Requires=postgresql.service`，确保网络和数据库就绪后才启动。

**Q4: cgroup memory 限制导致 Java OOM 怎么办？**

Docker 的 `--memory` 限制最终作用于 cgroup memory.max。当 Java 进程总 RSS（堆 + Metaspace + 线程栈 + Native Memory + Code Cache）超出限制时，OOM Killer 直接 kill 进程，JVM 自身的 `-XX:+ExitOnOutOfMemoryError` 不会触发。

解决方案：
1. 设置 `-Xmx` 留出足够余量：`-Xmx = 容器内存 * 0.75`
2. 限制 Metaspace：`-XX:MaxMetaspaceSize=256m`
3. 限制线程栈：`-Xss256k`（默认 1MB，大并发下栈占用不小）
4. 监控 Native Memory：`-XX:NativeMemoryTracking=summary` + `jcmd $PID VM.native_memory summary`
5. 使用 JDK 25 的容器感知特性：`-XX:+UseContainerSupport`（默认开启），JVM 会读取 cgroup 限制作为默认堆大小计算的依据

**Q5: 容器内 `top`/`free` 显示的内存和宿主机不一致？**

这是 Linux namespace 隔离的历史遗留问题。容器内读取 `/proc/meminfo` 获取的是宿主机的全局内存信息，而非 cgroup 限制。解决方法：
- 使用 `docker stats` 或 `kubectl top pod` 查看容器实际的资源使用
- 从 Linux 4.x 开始，内核支持 cgroup 感知的 `/proc/meminfo`，但需要特定选项编译和挂载
- 使用 JDK 25 的 `-XX:+UseContainerSupport` 让 JVM 正确感知 cgroup 内存限制
- 在容器内，更可靠的方式是通过 cgroup 文件系统直接读取：`cat /sys/fs/cgroup/memory.max`（cgroup v2）或 `cat /sys/fs/cgroup/memory/memory.limit_in_bytes`（cgroup v1）

---

## 相关条目

- [[06-Docker与Kubernetes云原生部署]] — 容器和 K8s 的完整部署实践
- [[02-JVM内部机制与调优]] — JVM 层面内存诊断与 GC 调优
- [[05-熔断限流与弹性设计]] — Resilience4j 限流熔断与高可用设计
- [[06-OpenTelemetry可观测性体系]] — 可观测性三支柱与 Java 集成
