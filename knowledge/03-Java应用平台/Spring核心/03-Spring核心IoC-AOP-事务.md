---
domain: 03-Java应用平台
title: Spring核心IoC-AOP-事务
status: verified
verification:
  reviewed_at: "2026-07-28"
  version_anchor: "JDK 25 / Spring Boot 4.x / Spring AI 2.x"
  code_status: tested
  lab: lab-spring-ai-chat
  evidence:
    scope: article-core
    source_files:
      - labs/lab-spring-ai-chat/src/main/java/com/javaai/kb/labs/spring-ai-chat/ChatDemo.java
    test_files:
      - labs/lab-spring-ai-chat/src/test/java/com/javaai/kb/labs/spring-ai-chat/ChatDemoTest.java
level: intermediate
sources:
  - level: L1
    url: https://docs.spring.io/spring-framework/reference/core.html
    description: Spring Framework Reference — IoC Container, AOP, Transaction Management, Events, Resources
  - level: L1
    url: https://docs.spring.io/spring-framework/reference/data-access/transaction.html
    description: Spring Transaction Management Reference
  - level: L2
    url: https://github.com/spring-projects/spring-framework
    description: Spring Framework source — DefaultListableBeanFactory, TransactionInterceptor, AbstractAutoProxyCreator
  - level: L3
    url: https://www.manning.com/books/spring-in-action-sixth-edition
    description: Spring in Action, Sixth Edition (Craig Walls, 2022)
relations:
  prerequisite:
    - 02-反射与模块化系统
    - 02-集合框架与泛型深度解析
  related:
    - 03-SpringBoot4深度解析
    - 03-SpringMVC与SSE流式输出
tags:
  - spring-ioc
  - spring-aop
  - spring-transaction
  - bean-lifecycle
  - circular-dependency
  - transaction-propagation
  - pointcut
  - application-event
created: 2026-07-20
updated: 2026-07-20
content_type: concept
---

# Spring 核心 IoC / AOP / 事务

## 概述

Spring Framework 是 Java 企业开发的事实标准，其三大核心能力——**IoC 容器**（控制反转与依赖注入）、**AOP**（面向切面编程）、**事务管理**——构成了现代 Java 应用的骨架。

本文从源码级别剖析 Bean 生命周期的完整链路、AOP 的代理选择策略和失效场景、Spring 事务的传播机制及其常见陷阱，以及事件机制和资源抽象。所有代码示例使用 JDK 25 + Spring Boot 4.x 风格。

---

## 一、Spring IoC 容器

### 1.1 BeanFactory vs ApplicationContext

| 特性 | BeanFactory | ApplicationContext |
|------|------------|-------------------|
| Bean 实例化 | 懒加载（首次获取时） | 预初始化（启动时，singleton） |
| 注解支持 | 需手动注册后处理器 | 自动注册 |
| 国际化（MessageSource） | 不支持 | 支持 |
| 事件发布 | 不支持 | 支持 |
| 使用场景 | 内存受限的嵌入式场景 | 99% 的应用场景 |

Spring Boot 4.x 默认使用 `AnnotationConfigApplicationContext` 作为实现：

```java
@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        var ctx = SpringApplication.run(Application.class, args);
        // ctx 的类型是 AnnotationConfigServletWebServerApplicationContext
    }
}
```

### 1.2 Bean 生命周期完整链路

一个 Bean 从创建到销毁经历以下阶段（源码级别）：

```
┌──────────────────────────────────────────────────────────────────┐
│                    Bean 生命周期（完整版）                         │
├──────────────────────────────────────────────────────────────────┤
│  1. Instantiate — 反射调用构造函数，创建 Bean 实例               │
│  2. Populate Properties — 填充属性（@Autowired/@Value 注入）    │
│  3. BeanNameAware.setBeanName()                                  │
│  4. BeanClassLoaderAware.setBeanClassLoader()                    │
│  5. BeanFactoryAware.setBeanFactory()                            │
│  6. EnvironmentAware.setEnvironment()                            │
│  7. BeanPostProcessor.postProcessBeforeInitialization()          │
│  8. @PostConstruct 标注的方法                                     │
│  9. InitializingBean.afterPropertiesSet()                        │
│ 10. BeanPostProcessor.postProcessAfterInitialization()  ← AOP 代理在此创建 │
│ 11. Bean 就绪，可以被使用                                        │
│ 12. @PreDestroy 标注的方法                                       │
│ 13. DisposableBean.destroy()                                     │
└──────────────────────────────────────────────────────────────────┘
```

**关键源码位置：** `AbstractAutowireCapableBeanFactory.doCreateBean()` 方法，约 500 行，是整个 Bean 创建的编排入口。

**第 10 步的深度解析（AOP 代理创建）：**
```
AbstractAutoProxyCreator.postProcessAfterInitialization()
 └─ wrapIfNecessary()
     └─ getAdvicesAndAdvisorsForBean()  // 找出匹配的切面
         └─ createProxy()
             ├─ 有接口 → JdkDynamicAopProxy
             └─ 无接口 → CglibAopProxy (Objenesis)
```

### 1.3 Bean 作用域

| 作用域 | 说明 | 典型场景 |
|--------|------|----------|
| **singleton** | 整个容器中只有一个实例（默认） | Service、Repository、Controller |
| **prototype** | 每次获取都创建新实例 | 有状态的 Bean、工具类 |
| **request** | 每个 HTTP 请求一个实例 | Web 应用的请求上下文 |
| **session** | 每个 HTTP Session 一个实例 | 用户会话数据 |
| **application** | 每个 ServletContext 一个实例 | 应用级共享数据 |

```java
@Scope("prototype")
@Component
public class ReportGenerator {
    // 每次注入/获取都创建新实例
}

// 注意：singleton Bean 中注入 prototype Bean 默认只会注入一次
// 解决方案：使用 @Lookup 或 ObjectFactory/Provider
@Component
public class ReportService {
    @Lookup
    public ReportGenerator getReportGenerator() {
        return null; // Spring 通过 CGLIB 覆盖此方法
    }
}
```

### 1.4 循环依赖与三级缓存

Spring 通过三级缓存解决单例 Bean 的构造器循环依赖（setter 注入的循环依赖可以解决，构造函数注入的循环依赖无法解决）：

```java
// DefaultSingletonBeanRegistry 中的三级缓存：
// 一级缓存（singletonObjects）：完全初始化完成的 Bean
// 二级缓存（earlySingletonObjects）：早期暴露的 Bean（未完成属性填充）
// 三级缓存（singletonFactories）：Bean 工厂（可生成早期 Bean 引用）

// 解决流程（A ← → B 循环依赖）：
// 1. 创建 A → 发现需要 B → 将 A 的 ObjectFactory 放入三级缓存
// 2. 创建 B → 发现需要 A → 从三级缓存获取 A 的 ObjectFactory
//    → 生成 A 的早期引用 → 放入二级缓存 → 从三级缓存移除
// 3. B 完成初始化 → 放入一级缓存
// 4. A 继续初始化（使用二级缓存中的 B 引用）→ 放入一级缓存
```

**最佳实践：** 避免循环依赖。使用构造函数注入（强制不可变）、重新设计模块边界、提取公共依赖为独立 Bean。

---

## 二、Spring AOP

### 2.1 AspectJ 注解体系

```java
@Aspect
@Component
public class LoggingAspect {

    // Pointcut：定义切点
    @Pointcut("execution(* com.example.service.*.*(..))")
    public void serviceLayer() {}

    // Before：方法执行前
    @Before("serviceLayer()")
    public void logBefore(JoinPoint joinPoint) {
        var methodName = joinPoint.getSignature().getName();
        var args = Arrays.toString(joinPoint.getArgs());
        System.out.printf("→ %s(%s)%n", methodName, args);
    }

    // AfterReturning：方法正常返回后
    @AfterReturning(pointcut = "serviceLayer()", returning = "result")
    public void logAfterReturning(JoinPoint joinPoint, Object result) {
        System.out.printf("← %s returned: %s%n",
            joinPoint.getSignature().getName(), result);
    }

    // AfterThrowing：方法抛出异常后
    @AfterThrowing(pointcut = "serviceLayer()", throwing = "ex")
    public void logAfterThrowing(JoinPoint joinPoint, Exception ex) {
        System.err.printf("✗ %s threw: %s%n",
            joinPoint.getSignature().getName(), ex.getMessage());
    }

    // Around：环绕通知（最强大，控制方法执行全过程）
    @Around("serviceLayer()")
    public Object logAround(ProceedingJoinPoint pjp) throws Throwable {
        var start = System.nanoTime();
        try {
            var result = pjp.proceed(); // 必须调用 proceed()，否则方法不执行
            var elapsed = (System.nanoTime() - start) / 1_000_000;
            System.out.printf("%s completed in %dms%n",
                pjp.getSignature(), elapsed);
            return result;
        } catch (Exception e) {
            System.err.printf("%s failed: %s%n", pjp.getSignature(), e.getMessage());
            throw e;
        }
    }
}
```

### 2.2 Pointcut 表达式

| 表达式 | 示例 | 说明 |
|--------|------|------|
| `execution` | `execution(public * com.example..*.*(..))` | 方法执行匹配 |
| `within` | `within(com.example.service.*)` | 类级别匹配 |
| `@annotation` | `@annotation(com.example.Log)` | 标注了特定注解的方法 |
| `@within` | `@within(org.springframework.stereotype.Service)` | 标注了特定注解的类 |
| `args` | `args(java.lang.String, ..)` | 方法参数类型匹配 |
| `bean` | `bean(userService)` | 按 Bean 名称匹配 |
| `this`/`target` | `this(com.example.Service)` | 代理对象/目标对象类型匹配 |

**AI 场景中的 AOP 应用示例——自动记录 Tool 调用耗时：**

```java
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
@interface ToolMethod {
    String name();
}

@Aspect
@Component
public class ToolMetricsAspect {

    @Around("@annotation(toolMethod)")
    public Object measureToolExecution(ProceedingJoinPoint pjp, ToolMethod toolMethod)
            throws Throwable {
        var start = System.nanoTime();
        try {
            return pjp.proceed();
        } finally {
            var elapsed = (System.nanoTime() - start) / 1_000_000.0;
            System.out.printf("[Metrics] Tool '%s' executed in %.2fms%n",
                toolMethod.name(), elapsed);
            // 实际项目中：将指标发送到 Micrometer/Prometheus
        }
    }
}
```

### 2.3 AOP 失效场景（高频踩坑）

**场景1：自调用（Self-Invocation）**

```java
@Service
public class UserService {

    @Transactional  // 直接调用：事务生效
    public void createUser() { /* ... */ }

    public void batchCreate() {
        // AOP 失效！这是内部调用（this.createUser()），不经过代理
        createUser(); // 等价于 this.createUser()
    }
}

// 解决方案1：注入自己（通过 ApplicationContext 或 @Lazy @Autowired）
// 解决方案2：将方法拆分到不同的 Bean 中
// 解决方案3：使用 AopContext.currentProxy()
@Service
public class UserService {
    public void batchCreate() {
        ((UserService) AopContext.currentProxy()).createUser();
        // 需要在配置中启用：@EnableAspectJAutoProxy(exposeProxy = true)
    }
}
```

**场景2：非 public 方法**

```java
@Service
public class UserService {
    @Transactional
    protected void internalMethod() { // 事务不生效！
        // Spring AOP 默认只代理 public 方法（CGLIB 可以代理 protected）
    }
}
```

**场景3：异常类型不匹配**

```java
@Transactional(rollbackFor = RuntimeException.class) // 默认
public void process() throws Exception {
    throw new Exception("Checked exception"); // 不会回滚！
}

// 解决方案
@Transactional(rollbackFor = Exception.class) // 所有异常都回滚
public void process() throws Exception { /* ... */ }
```

---

## 三、Spring 事务管理

### 3.1 @Transactional 原理

Spring 事务通过 `TransactionInterceptor` 实现，它是 AOP 的 Around 通知：

```
调用 createOrder() → TransactionInterceptor.invoke()
 ├─ PlatformTransactionManager.getTransaction()  // 开启事务
 ├─ invocation.proceed()                          // 执行目标方法
 ├─ 若成功：PlatformTransactionManager.commit()  // 提交事务
 └─ 若异常：PlatformTransactionManager.rollback() // 回滚事务
```

### 3.2 事务隔离级别

| 隔离级别 | 脏读 | 不可重复读 | 幻读 | 性能 |
|----------|------|-----------|------|------|
| READ_UNCOMMITTED | 是 | 是 | 是 | 最高 |
| READ_COMMITTED | 否 | 是 | 是 | 高 |
| REPEATABLE_READ | 否 | 否 | 是（MySQL）/否（PG） | 中 |
| SERIALIZABLE | 否 | 否 | 否 | 最低 |

**默认隔离级别取决于数据库：** MySQL 默认为 REPEATABLE_READ，PostgreSQL 默认为 READ_COMMITTED。

```java
@Transactional(isolation = Isolation.READ_COMMITTED)
public void transferMoney(Long fromId, Long toId, BigDecimal amount) {
    accountRepo.debit(fromId, amount);
    accountRepo.credit(toId, amount);
}
```

### 3.3 事务传播行为

| 传播行为 | 说明 | 典型场景 |
|----------|------|----------|
| **REQUIRED**（默认） | 有事务则加入，没有则新建 | 绝大多数场景 |
| **REQUIRES_NEW** | 始终新建事务，挂起当前事务 | 日志记录（独立提交，不影响主事务） |
| **NESTED** | 嵌套事务，支持 Savepoint 回滚 | 部分失败不影响整体（需要 JDBC Savepoint 支持） |
| SUPPORTS | 有则加入，没有则非事务执行 | 只读查询 |
| NOT_SUPPORTED | 总是非事务执行 | 不需要事务的操作 |
| MANDATORY | 必须在已有事务中执行，否则抛异常 | 强制事务约束 |
| NEVER | 必须在非事务下执行，否则抛异常 | 禁止事务场景 |

```java
@Service
public class OrderService {

    @Transactional // REQUIRED，默认
    public void createOrder(OrderDto dto) {
        // 主事务：创建订单
        orderRepo.save(dto.toEntity());
        // 记录日志（独立事务，即使主事务失败，日志也保留）
        auditService.log("Order created: " + dto.orderId());
    }
}

@Service
public class AuditService {
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void log(String message) {
        // 独立事务，不受调用方事务影响
        auditRepo.save(new AuditLog(message));
    }
}
```

### 3.4 PlatformTransactionManager

Spring 为不同数据访问技术提供不同的事务管理器：

```java
// JDBC / JPA：DataSourceTransactionManager / JpaTransactionManager
// Hibernate：HibernateTransactionManager
// JTA（分布式事务）：JtaTransactionManager

// Spring Boot 自动配置会根据类路径自动选择
// 有 spring-data-jpa → JpaTransactionManager
// 有 spring-jdbc 但没有 JPA → DataSourceTransactionManager
```

### 3.5 事务失效场景（高频踩坑）

1. **自调用**：同上文的 AOP 自调用问题
2. **非 public 方法**：Spring AOP 通过动态代理实现，默认只能拦截 public 方法
3. **Checked Exception**：默认只回滚 RuntimeException 和 Error
4. **catch 吞掉异常**：方法内 try-catch 捕获了异常，事务感知不到
5. **跨数据源**：单个 TransactionManager 只管理一个数据源

---

## 四、Spring 事件机制

```java
// 1. 定义事件
public record OrderCreatedEvent(Long orderId, String userId, BigDecimal amount) {}

// 2. 发布事件
@Service
public class OrderService {
    private final ApplicationEventPublisher publisher;

    public OrderService(ApplicationEventPublisher publisher) {
        this.publisher = publisher;
    }

    @Transactional
    public void createOrder(OrderDto dto) {
        orderRepo.save(dto.toEntity());
        publisher.publishEvent(new OrderCreatedEvent(dto.orderId(), dto.userId(), dto.amount()));
    }
}

// 3. 监听事件
@Component
public class OrderEventListener {

    // 同步监听（默认）
    @EventListener
    public void handleOrderCreated(OrderCreatedEvent event) {
        smsService.sendNotification(event.userId(), "Order created!");
    }

    // 事务提交后监听（确保数据已持久化）
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void handleAfterCommit(OrderCreatedEvent event) {
        // 此时事务已提交，适合发送消息、调用外部 API
        messageQueue.send("order-topic", event);
    }

    // 异步监听
    @Async
    @EventListener
    public void handleAsync(OrderCreatedEvent event) {
        // 异步处理，不阻塞主线程
        metricsService.recordOrder(event);
    }
}
```

**AI 场景应用：** 当知识库文档更新时，发布 `DocumentUpdatedEvent`，触发 Embedding 重新生成的监听器。

---

## 五、资源抽象

Spring 的 `Resource` 接口提供统一的资源访问抽象：

```java
@Component
public class ConfigLoader {
    // 支持 classpath:、file:、http: 等前缀
    @Value("classpath:prompts/system-prompt.txt")
    private Resource systemPrompt;

    @Value("file:${app.data-dir}/faq.json")
    private Resource faqFile;

    public String loadSystemPrompt() throws IOException {
        return Files.readString(Path.of(systemPrompt.getURI()));
    }
}
```

---

## 常见问题

**Q: 为什么 Spring 推荐构造函数注入？**
A: 构造函数注入强制依赖不可变（final），避免 NPE，便于单元测试，且能检测循环依赖（启动时就会报错而非运行时）。Spring 4.3+ 对单构造函数自动注入。

**Q: @Transactional 放在 Controller 还是 Service？**
A: 放在 Service 层。Controller 负责请求解析和响应构造，Service 负责业务逻辑和事务边界。这样做事务边界清晰，Service 可被多个 Controller 复用。

**Q: AOP 代理选择 JDK 还是 CGLIB？**
A: Spring Boot 4.x 默认使用 CGLIB。JDK 动态代理仅代理接口方法，CGLIB 通过继承代理所有方法（final 方法除外）。如果不需要接口多态，CGLIB 更方便。

**Q: 分布式事务如何处理？**
A: Spring 的本地事务不支持分布式。使用 Seata（AT/TCC/Saga 模式）、事务消息（RocketMQ）、或最终一致性（Saga Pattern + Outbox Pattern）。

---

## 相关条目

- [[03-SpringBoot4深度解析]]：自动配置与 Starter 机制
- [[02-反射与模块化系统]]：AOP 底层反射和动态代理
- [[03-SpringMVC与SSE流式输出]]：Web 层核心
- [[03-SpringDataJPA与MyBatis深度解析]]：事务在持久层的应用
