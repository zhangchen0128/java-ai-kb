# 05 — 分布式架构

> 一致性、幂等、锁、事务、缓存、限流、熔断、降级、高可用、微服务。

## 子域

| 子域 | 条目 |
|------|------|
| [事务与一致性](事务与一致性/) | 分布式事务(2PC/Saga/TCC/Outbox/Seata)、缓存策略(Cache-Aside/多级/一致性) |
| [弹性设计](弹性设计/) | 幂等设计(Token/唯一索引)、分布式锁(Redis/ZK/DB)、熔断限流(Resilience4j/Sentinel) |
| [高可用](高可用/) | 高可用指标、故障转移、多活架构、优雅关闭、灾备恢复(RPO/RTO) |

## 主栈

Resilience4j + Redisson + Spring Cloud Gateway
