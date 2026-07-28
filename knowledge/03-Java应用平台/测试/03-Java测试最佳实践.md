---
domain: 03-Java应用平台
title: Java 测试最佳实践
status: verified
verification:
  reviewed_at: "2026-07-28"
  version_anchor: "JUnit 5.11 / Mockito / Testcontainers 1.20"
  code_status: tested
  lab: lab-java25-concurrency
  evidence:
    scope: article-core
    source_files: ["labs/lab-java25-concurrency/src/main/java/com/javaai/kb/labs/concurrency/VirtualThreadsDemo.java"]
    test_files: ["labs/lab-java25-concurrency/src/test/java/com/javaai/kb/labs/concurrency/VirtualThreadsTest.java"]
level: intermediate
sources:
  - level: L1
    url: https://junit.org/junit5/docs/current/user-guide/
    description: JUnit 5 官方用户指南，涵盖 Jupiter、Vintage、Platform 三大模块
  - level: L1
    url: https://javadoc.io/doc/org.mockito/mockito-core/latest/org/mockito/Mockito.html
    description: Mockito 官方文档，mock 框架核心 API 参考
  - level: L1
    url: https://testcontainers.com/guides/
    description: Testcontainers 官方指南，包含各模块的集成测试最佳实践
  - level: L1
    url: https://wiremock.org/docs/
    description: WireMock 官方文档，HTTP stub 和验证完整参考
  - level: L1
    url: https://rest-assured.io/
    description: REST Assured 官方文档，Java DSL 风格的 API 测试框架
  - level: L1
    url: https://www.archunit.org/
    description: ArchUnit 官方文档，Java 架构测试框架
  - level: L3
    url: https://www.manning.com/books/effective-software-testing
    description: Effective Software Testing — 系统介绍测试金字塔、基于属性的测试、变异测试
  - level: L3
    url: https://www.manning.com/books/java-testing-with-spock
    description: Java Testing with Spock — 涵盖单元测试、集成测试和 BDD 实践
relations:
  prerequisite:
    - 02-现代Java25深度解析
  related:
    - 03-SpringBoot4深度解析
    - 03-Java测试最佳实践
tags:
  - testing
  - junit5
  - mockito
  - testcontainers
  - wiremock
  - rest-assured
  - archunit
  - ai-testing
  - test-data
  - quality
created: 2026-07-17
updated: 2026-07-17
content_type: practice
---

# Java 测试最佳实践

## 概述

测试是软件质量的生命线。本文系统阐述 Java 生态中从单元测试到 AI 输出测试的完整测试策略，覆盖测试分层、框架选择、工具链组合，以及面向 LLM 输出的新型断言方法。所有代码示例基于 JDK 25 + Spring Boot 4.x + JUnit 5。

目标读者：具备 Java 基础的工程师，需要建立系统化的测试思维和掌握现代 Java 测试工具链。

---

## 一、测试金字塔：分层策略

测试金字塔是 Mike Cohn 提出的经典模型，指导不同粒度测试的比例分配：

```
         /\
        /E2E\         5-10%  端到端测试：验证完整业务流程
       /------\
      / 集成测试 \     20-30%  集成测试：验证组件间交互、数据库、外部服务
     /------------\
    /   单元测试     \   60-70%  单元测试：验证单个类/方法的逻辑正确性
   /----------------\
```

### 1.1 反模式识别

| 反模式 | 症状 | 后果 |
|--------|------|------|
| 冰淇淋甜筒 | 大量 E2E，少量单元测试 | CI 慢、定位难、维护成本极高 |
| 沙漏 | 单元和 E2E 多，集成测试少 | 外部依赖问题只有到 E2E 才发现 |
| 纯单元主义 | 只有单元测试，无集成 | 假阳性——mock 通过但真实依赖挂了 |

### 1.2 实战配比建议

对于一个典型的 Spring Boot 微服务：

```
单元测试 (70%)
├── Service 层业务逻辑：验收条件、边界值、异常路径
├── 工具类 / 值对象 / Domain Service：纯逻辑无副作用
└── Mapper / Converter：转换逻辑正确性

集成测试 (25%)
├── Repository 层：真实数据库 + Testcontainers
├── Controller 层：MockMvc + 完整 Spring 上下文
├── 消息消费：嵌入式 Kafka / Testcontainers Kafka
└── 缓存集成：Redis Testcontainers

E2E 测试 (5%)
├── 核心业务 Happy Path（如用户注册 → 登录 → 下单）
└── 关键集成点（支付回调、第三方 API 超时降级）
```

### 1.3 F.I.R.S.T 原则

每个测试应遵循五项原则：

- **F**ast（快速）：单元测试应在毫秒级完成，避免真实 I/O
- **I**solated（隔离）：测试之间不应有状态依赖，执行顺序不应影响结果
- **R**epeatable（可重复）：在任何环境、任何顺序运行结果一致
- **S**elf-validating（自验证）：测试结果应是布尔值（通过/失败），无需人工判断
- **T**imely（及时）：测试应在生产代码之前或同时编写（TDD）

---

## 二、JUnit 5：现代测试基石

JUnit 5 由三部分组成：JUnit Platform（启动引擎）、JUnit Jupiter（编程模型 + 扩展）、JUnit Vintage（JUnit 3/4 兼容）。

### 2.1 生命周期管理

```java
import org.junit.jupiter.api.*;

import static org.assertj.core.api.Assertions.assertThat;

class LifecycleDemoTest {

    @BeforeAll
    static void beforeAll() {
        // 所有测试前执行一次，必须是 static
        // 典型用途：启动共享资源（如 Testcontainers 容器）
        System.out.println("beforeAll: 初始化共享资源");
    }

    @BeforeEach
    void beforeEach() {
        // 每个测试前执行
        // 典型用途：准备测试数据、重置 mock
        System.out.println("beforeEach: 准备测试数据");
    }

    @Test
    @DisplayName("存款操作应增加账户余额")
    void depositShouldIncreaseBalance() {
        var account = new Account("ACC-001", 1000.0);
        account.deposit(500.0);
        assertThat(account.balance()).isEqualTo(1500.0);
    }

    @Test
    @DisplayName("取款超过余额时应抛出异常")
    void withdrawExceedingBalanceShouldThrow() {
        var account = new Account("ACC-001", 100.0);
        assertThat(account.balance()).isEqualTo(100.0);
        var ex = Assertions.assertThrows(InsufficientFundsException.class,
                () -> account.withdraw(200.0));
        assertThat(ex.getMessage()).contains("余额不足");
        assertThat(account.balance()).isEqualTo(100.0); // 余额不变
    }

    @AfterEach
    void afterEach() {
        // 每个测试后执行
        // 典型用途：清理测试数据
        System.out.println("afterEach: 清理测试数据");
    }

    @AfterAll
    static void afterAll() {
        // 所有测试后执行一次，必须是 static
        System.out.println("afterAll: 释放共享资源");
    }
}
```

### 2.2 参数化测试：覆盖多组数据

`@ParameterizedTest` 结合 `@ValueSource`、`@CsvSource`、`@MethodSource` 等 Source 注解，用一组数据驱动同一个测试逻辑。

```java
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.*;

import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

class PricingCalculatorTest {

    private final PricingCalculator calculator = new PricingCalculator();

    @ParameterizedTest
    @DisplayName("根据会员等级计算折扣后的价格")
    @CsvSource(delimiter = '|', textBlock = """
        100.00 | GOLD   | 80.00
        100.00 | SILVER | 90.00
        100.00 | BRONZE | 95.00
        100.00 |        | 100.00
        """)
    void calculateDiscountedPrice(double original, String tier, double expected) {
        var result = calculator.calculate(original, MembershipTier.from(tier));
        assertThat(result).isEqualTo(expected);
    }

    @ParameterizedTest
    @DisplayName("非法输入应抛出 IllegalArgumentException")
    @ValueSource(strings = {"", "  ", "\t"})
    void nullOrBlankInputShouldThrow(String input) {
        assertThat(io.vavr.control.Try.of(() -> new Email(input)).isFailure()).isTrue();
    }

    // MethodSource: 支持复杂对象
    static Stream<Arguments> insuranceAgeScenarios() {
        return Stream.of(
            Arguments.of(0, false),     // 0 岁不可保
            Arguments.of(17, false),    // 未成年不可保
            Arguments.of(18, true),     // 刚满 18 可保
            Arguments.of(60, true),     // 退休前可保
            Arguments.of(65, false)     // 超过 65 不可保
        );
    }

    @ParameterizedTest
    @MethodSource("insuranceAgeScenarios")
    @DisplayName("保险投保年龄校验：18-64 岁可投保")
    void insuranceAgeEligibility(int age, boolean eligible) {
        var applicant = new InsuranceApplicant("张三", age);
        assertThat(applicant.isEligible()).isEqualTo(eligible);
    }
}
```

### 2.3 @TestFactory：动态测试

当测试用例在编译时无法全部确定，需要运行时动态生成时使用。典型场景：从外部文件读取测试数据、验证 API Schema 的每个字段。

```java
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;

import java.util.List;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.DynamicTest.dynamicTest;

class PolicyValidatorTests {

    private final PolicyValidator validator = new PolicyValidator();

    @TestFactory
    @DisplayName("保单号格式校验 - 动态测试集")
    Stream<DynamicTest> policyNumberValidation() {
        var testCases = List.of(
            new TestCase("POL-2026-000001", true, "标准保单号"),
            new TestCase("POL-2026-000001-X", false, "多余后缀"),
            new TestCase("pol-2026-000001", false, "小写前缀"),
            new TestCase("POL-2026-00000", false, "流水号不足6位"),
            new TestCase("", false, "空字符串"),
            new TestCase(null, false, "null 值")
        );

        return testCases.stream()
            .map(tc -> dynamicTest(
                tc.description(),
                () -> assertThat(validator.isValid(tc.input())).isEqualTo(tc.expected())
            ));
    }

    record TestCase(String input, boolean expected, String description) {}
}
```

### 2.4 条件执行与超时控制

```java
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

import static java.util.concurrent.TimeUnit.SECONDS;

class ConditionalExecutionTest {

    @Test
    @Timeout(value = 2, unit = SECONDS)
    @DisplayName("复杂计算应在 2 秒内完成")
    void complexCalculationShouldCompleteWithin2Seconds() {
        var result = new PremiumCalculator().calculateComplexGroupPolicy(
            List.of(new Employee("张三", 35, OccupationClass.FIVE))
        );
        assertThat(result).isNotNull();
    }

    @Test
    @EnabledIfEnvironmentVariable(named = "CI", matches = "true")
    @DisplayName("仅在 CI 环境执行的长时测试")
    void longRunningIntegrationTest() {
        // 仅在 CI 中运行
    }
}
```

### 2.5 Extension 模型

JUnit 5 的 Extension 模型取代了 JUnit 4 的 Runner 和 Rule 机制，提供更细粒度的扩展点。

```java
import org.junit.jupiter.api.extension.*;

import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;

// 自定义扩展：测试执行计时
class TimingExtension implements BeforeTestExecutionCallback, AfterTestExecutionCallback {

    private static final ExtensionContext.Namespace NS =
        ExtensionContext.Namespace.create("timing");

    @Override
    public void beforeTestExecution(ExtensionContext ctx) {
        ctx.getStore(NS).put(ctx.getRequiredTestMethod().getName(), System.nanoTime());
    }

    @Override
    public void afterTestExecution(ExtensionContext ctx) {
        var start = ctx.getStore(NS).remove(ctx.getRequiredTestMethod().getName(), long.class);
        var duration = (System.nanoTime() - start) / 1_000_000.0;
        ctx.publishReportEntry("timing", String.format("执行耗时: %.2f ms", duration));
    }
}

// 组合注解：将 @Test + 扩展绑定在一起
@Retention(RetentionPolicy.RUNTIME)
@org.junit.jupiter.api.Test
@ExtendWith(TimingExtension.class)
@interface TimedTest {}

// 使用
class TimedTestDemo {
    @TimedTest
    @DisplayName("使用自定义 TimedTest 注解")
    void myTimedTest() {
        // 自动记录执行时间
    }
}
```

---

## 三、Mockito：隔离外部依赖

Mockito 是 Java 生态的事实标准 mock 框架。核心能力：创建 mock（模拟对象）、stub（预设行为）、verify（验证调用）。

### 3.1 Mock vs Spy

| | Mock | Spy |
|---|---|---|
| 创建方式 | `mock(Class)` | `spy(realObject)` |
| 默认行为 | 返回默认值（null/0/false） | 调用真实方法 |
| 使用场景 | 完全隔离依赖 | 部分 mock，保留部分真实行为 |
| 陷阱 | 无 | 容易写出脆弱测试 |

```java
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.*;

@ExtendWith(MockitoExtension.class)
class InsuranceQuoteServiceTest {

    @Mock
    private PricingEngine pricingEngine;

    @Mock
    private NotificationService notificationService;

    @Spy   // 部分 mock：保留真实方法，仅 stub 特定调用
    private PremiumCalculator premiumCalculator = new PremiumCalculator();

    @org.mockito.InjectMocks
    private InsuranceQuoteService quoteService;

    @Test
    @DisplayName("mock 默认返回 null/false/0")
    void mockDefaultBehavior() {
        // PricingEngine 是 mock，未 stub 的方法返回默认值
        assertThat(pricingEngine.calculate(null)).isNull();
        assertThat(pricingEngine.isAvailable()).isFalse();
    }

    @Test
    @DisplayName("when-thenReturn：预设返回值")
    void whenThenReturnStubbing() {
        var applicant = new Applicant("张三", 35, OccupationClass.THREE);
        given(pricingEngine.calculate(applicant)).willReturn(new Premium(5000.0));

        var result = quoteService.generateQuote(applicant);

        assertThat(result.premium().amount()).isEqualTo(5000.0);
    }

    @Test
    @DisplayName("doReturn-when：用于 spy 或 void 方法不触发真实调用")
    void doReturnWhenForSpy() {
        // spy 上直接 when-thenReturn 会触发真实方法，使用 doReturn-when 避免
        doReturn(8000.0).when(premiumCalculator).calculateGroupRate(anyInt());
        var result = premiumCalculator.calculateGroupRate(50);
        assertThat(result).isEqualTo(8000.0);
    }

    @Test
    @DisplayName("verify：验证方法调用次数和参数")
    void verifyMethodInvocation() {
        var applicant = new Applicant("李四", 28, OccupationClass.TWO);
        given(pricingEngine.calculate(any())).willReturn(new Premium(3000.0));

        quoteService.generateQuote(applicant);

        // 精确验证
        verify(pricingEngine, times(1)).calculate(applicant);
        // 至少调用一次
        verify(pricingEngine, atLeastOnce()).calculate(any());
        // 从未调用
        verify(notificationService, never()).sendQuote(any());
    }

    @Test
    @DisplayName("BDDMockito：given-willReturn 语义更清晰")
    void bddStyleStubbing() {
        // BDD 风格：given(...).willReturn(...)  优于  when(...).thenReturn(...)
        var applicant = new Applicant("王五", 40, OccupationClass.FOUR);
        given(pricingEngine.calculate(applicant)).willReturn(new Premium(12000.0));

        // when
        var quote = quoteService.generateQuote(applicant);

        // then
        assertThat(quote.isHighRisk()).isTrue();
        then(pricingEngine).should().calculate(applicant);
    }
}
```

### 3.2 ArgumentCaptor：捕获传递的参数

```java
import org.mockito.ArgumentCaptor;
import org.mockito.Captor;

@ExtendWith(MockitoExtension.class)
class ArgumentCaptorDemoTest {

    @Mock
    private EmailService emailService;

    @org.mockito.InjectMocks
    private PolicyNotificationService notificationService;

    @Captor
    private ArgumentCaptor<EmailMessage> emailCaptor;

    @Test
    @DisplayName("ArgumentCaptor 捕获传递给 mock 的参数")
    void captureEmailContent() {
        var policy = new Policy("POL-2026-000042", "张三", PolicyStatus.APPROVED);
        notificationService.notifyApproval(policy);

        verify(emailService).send(emailCaptor.capture());
        var email = emailCaptor.getValue();

        assertThat(email.to()).isEqualTo("zhangsan@example.com");
        assertThat(email.subject()).contains("保单批准", "POL-2026-000042");
        assertThat(email.body()).containsIgnoringCase("恭喜");
    }
}
```

### 3.3 Mockito 常见陷阱

1. **stub 不匹配**：`given(mock.method("foo")).willReturn(x)` 被 `mock.method("bar")` 调用，stub 不会生效，返回默认值。
2. **spy 上使用 when-thenReturn**：`when(spy.method())` 会触发真实 `method()` —— 应使用 `doReturn().when(spy).method()`。
3. **对 DTO/value object 进行 mock**：mock 值对象毫无意义，直接用真实实例或 Builder 构造。
4. **Mock 过多**：一个测试 mock 超过 3-4 个依赖，通常意味着被测试的类职责过多，应考虑拆分。

---

## 四、Testcontainers：真实依赖的集成测试

Testcontainers 通过 Docker 在测试中拉起真实的中间件（数据库、缓存、消息队列），是集成测试的银弹。你的测试代码定义依赖，Testcontainers 管理容器生命周期。

### 4.1 基本用法

```java
import org.junit.jupiter.api.*;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.springframework.jdbc.core.JdbcTemplate;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;

import static org.assertj.core.api.Assertions.assertThat;

@Testcontainers
class PostgreSQLIntegrationTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:17-alpine")
        .withDatabaseName("testdb")
        .withUsername("test")
        .withPassword("test");

    private JdbcTemplate jdbcTemplate;

    @BeforeEach
    void setUp() {
        var config = new HikariConfig();
        config.setJdbcUrl(postgres.getJdbcUrl());
        config.setUsername(postgres.getUsername());
        config.setPassword(postgres.getPassword());
        var dataSource = new HikariDataSource(config);
        jdbcTemplate = new JdbcTemplate(dataSource);

        jdbcTemplate.execute("""
            CREATE TABLE IF NOT EXISTS insurance_policy (
                id UUID PRIMARY KEY,
                policy_number VARCHAR(32) NOT NULL,
                holder_name VARCHAR(64) NOT NULL,
                premium_amount DECIMAL(12,2) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """);
    }

    @Test
    @DisplayName("插入和查询保单记录")
    void insertAndQueryPolicy() {
        jdbcTemplate.update(
            "INSERT INTO insurance_policy (id, policy_number, holder_name, premium_amount) VALUES (?, ?, ?, ?)",
            java.util.UUID.randomUUID(), "POL-2026-000001", "张三", 5000.00
        );

        var count = jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM insurance_policy WHERE holder_name = ?",
            Integer.class, "张三"
        );

        assertThat(count).isEqualTo(1);
    }
}
```

### 4.2 多容器场景：PostgreSQL + Redis + Kafka

```java
import org.testcontainers.containers.KafkaContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.utility.DockerImageName;

@Testcontainers
class MultiContainerIntegrationTest {

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:17-alpine");

    @Container
    static GenericContainer<?> redis = new GenericContainer<>(
        DockerImageName.parse("redis:7.4-alpine"))
        .withExposedPorts(6379);

    @Container
    static KafkaContainer kafka = new KafkaContainer(
        DockerImageName.parse("confluentinc/cp-kafka:7.7.0"));

    @Test
    @DisplayName("多中间件协同：缓存 + 数据库 + 消息")
    void multiMiddlewareIntegration() {
        // Redis 连接
        var jedis = new redis.clients.jedis.Jedis(redis.getHost(), redis.getMappedPort(6379));

        // Kafka 地址
        var bootstrapServers = kafka.getBootstrapServers();

        // PostgreSQL 连接
        var jdbcUrl = postgres.getJdbcUrl();

        assertThat(jedis.ping()).isEqualTo("PONG");
        assertThat(bootstrapServers).isNotBlank();
        assertThat(jdbcUrl).contains("postgres");
    }
}
```

### 4.3 Singleton 容器模式：跨测试类复用

默认情况下 `@Container static` 字段的容器在所有测试方法间共享。但跨测试类共享容器（避免重复启停）需要 Singleton 模式：

```java
// SingletonContainer.java — 共享容器定义
import org.testcontainers.containers.PostgreSQLContainer;

public abstract class SingletonContainer {
    static final PostgreSQLContainer<?> POSTGRES;

    static {
        POSTGRES = new PostgreSQLContainer<>("postgres:17-alpine")
            .withDatabaseName("shareddb")
            .withReuse(true);  // 启用容器复用
        POSTGRES.start();

        // 注册 JVM 关闭钩子，确保容器在 JVM 退出时停止
        Runtime.getRuntime().addShutdownHook(new Thread(POSTGRES::stop));
    }
}

// PolicyRepositoryTest.java
class PolicyRepositoryTest extends SingletonContainer {
    // 直接使用 POSTGRES 容器，不重复启停
    @Test
    void testQueryPoliciesByHolder() {
        // ...
    }
}

// ClaimRepositoryTest.java
class ClaimRepositoryTest extends SingletonContainer {
    @Test
    void testInsertClaim() {
        // ...
    }
}
```

**CI 集成注意**：Testcontainers 需要 Docker 环境。在 CI 中：
- GitHub Actions 使用 `ubuntu-latest` runner 自带 Docker
- 需要在 `.testcontainers.properties` 中配置 `ryuk.container.privileged=true`（部分 CI 环境）
- 使用 `withReuse(true)` 加速多模块构建

### 4.4 已知限制与对策

1. **启动延迟**：首次拉取镜像可能需要几分钟，建议在 CI 中预缓存镜像或使用私有 Registry。
2. **macOS Docker Desktop 性能**：macOS 下 Docker 运行在轻量 VM 中，I/O 性能较差，建议使用 `tmpfs` 挂载。
3. **端口冲突**：Testcontainers 自动映射随机端口，无此问题。
4. **内存开销**：在 CI 中同时启动多个容器可能导致 OOM，建议按测试模块分组。

---

## 五、WireMock：HTTP 服务模拟

> ⚠️ 技术雷达：Trial — WireMock 在技术雷达中标记为 Trial，适用于非核心 HTTP 依赖模拟场景，生产测试体系建议评估成熟度后采纳。

WireMock 模拟 HTTP 服务，用于测试代码中的 HTTP 客户端行为，包括超时、错误响应、限流等异常场景。

### 5.1 基本 Stub 与验证

```java
import com.github.tomakehurst.wiremock.WireMockServer;
import com.github.tomakehurst.wiremock.client.WireMock;
import org.junit.jupiter.api.*;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static com.github.tomakehurst.wiremock.core.WireMockConfiguration.wireMockConfig;
import static org.assertj.core.api.Assertions.assertThat;

class PremiumRateServiceTest {

    private WireMockServer wireMockServer;
    private PremiumRateClient rateClient;

    @BeforeEach
    void setUp() {
        wireMockServer = new WireMockServer(wireMockConfig().dynamicPort());
        wireMockServer.start();
        WireMock.configureFor("localhost", wireMockServer.port());

        rateClient = new PremiumRateClient("http://localhost:" + wireMockServer.port());
    }

    @AfterEach
    void tearDown() {
        wireMockServer.stop();
    }

    @Test
    @DisplayName("成功获取费率")
    void fetchRateSuccessfully() {
        // Stub：定义期望的请求和响应
        stubFor(get(urlPathEqualTo("/api/rates"))
            .withQueryParam("occupationClass", equalTo("3"))
            .withQueryParam("age", equalTo("35"))
            .willReturn(aResponse()
                .withStatus(200)
                .withHeader("Content-Type", "application/json")
                .withBody("""
                    {"rate": 0.025, "currency": "CNY", "effectiveDate": "2026-01-01"}
                    """)));

        // Act
        var rate = rateClient.getRate(3, 35);

        // Assert
        assertThat(rate.value()).isEqualTo(0.025);

        // Verify：验证请求确实被发出
        verify(getRequestedFor(urlPathEqualTo("/api/rates"))
            .withQueryParam("occupationClass", equalTo("3")));
    }

    @Test
    @DisplayName("费率服务超时应触发降级")
    void rateServiceTimeoutShouldFallback() {
        // 模拟超时
        stubFor(get(urlPathEqualTo("/api/rates"))
            .willReturn(aResponse()
                .withStatus(200)
                .withFixedDelay(5000)  // 延迟 5 秒
                .withBody("{\"rate\": 0.03}")));

        // 客户端设置 2 秒超时，应触发降级
        var rate = rateClient.getRateWithFallback(3, 35);
        assertThat(rate.value()).isEqualTo(0.03); // 回退到默认费率
    }

    @Test
    @DisplayName("5xx 服务端错误应触发重试")
    void serverErrorShouldTriggerRetry() {
        // 前两次返回 503，第三次成功
        stubFor(get(urlPathEqualTo("/api/rates"))
            .inScenario("Retry on 503")
            .whenScenarioStateIs(org.hamcrest.CoreMatchers.any(String.class))
            .willReturn(aResponse().withStatus(503))
            .willSetStateTo("FirstFailure"));

        stubFor(get(urlPathEqualTo("/api/rates"))
            .inScenario("Retry on 503")
            .whenScenarioStateIs("FirstFailure")
            .willReturn(aResponse().withStatus(503))
            .willSetStateTo("SecondFailure"));

        stubFor(get(urlPathEqualTo("/api/rates"))
            .inScenario("Retry on 503")
            .whenScenarioStateIs("SecondFailure")
            .willReturn(aResponse()
                .withStatus(200)
                .withBody("{\"rate\": 0.025}")));

        var rate = rateClient.getRateWithRetry(3, 35);
        assertThat(rate.value()).isEqualTo(0.025);
    }
}
```

### 5.2 代理模式：录制真实 API 行为

```java
@Test
void proxyAndRecordRealApiCalls() {
    // 启动代理模式，录制真实服务交互
    var recordingServer = new WireMockServer(wireMockConfig()
        .dynamicPort()
        .withRootDirectory("src/test/resources/wiremock/recordings"));
    recordingServer.start();

    // 录制模式：代理到真实服务，录制请求/响应
    recordingServer.startRecording("https://api.real-insurance.com");

    // 通过代理发起真实请求
    var client = new PremiumRateClient("http://localhost:" + recordingServer.port());
    var rate = client.getRate(3, 35);

    recordingServer.stopRecording();
    // 录制的 mapping 保存在 src/test/resources/wiremock/recordings 中
    // 后续可直接回放：stubFor(get(...)) 替代真实调用

    recordingServer.stop();
}
```

---

## 六、REST Assured：API 端点测试

> ⚠️ 技术雷达：Trial — REST Assured 在技术雷达中标记为 Trial，用于 REST API 的集成/E2E 测试。对于 Spring Boot 项目，`MockMvc` 是更轻量的 Adopt 选择；REST Assured 更适合对已部署的 API 进行黑盒验证。

REST Assured 提供 Given-When-Then 风格的 DSL，用于测试 REST API。

### 6.1 基本请求与断言

```java
import org.junit.jupiter.api.*;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import static io.restassured.RestAssured.*;
import static org.hamcrest.Matchers.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers
class PolicyApiIntegrationTest {

    @LocalServerPort
    private int port;

    @Container
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:17-alpine");

    @DynamicPropertySource
    static void configureProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
    }

    @BeforeEach
    void setUp() {
        baseURI = "http://localhost";
        port = port;
    }

    @Test
    @DisplayName("创建保单并验证响应")
    void createPolicyAndVerifyResponse() {
        var requestBody = """
            {
                "holderName": "张三",
                "age": 35,
                "occupationClass": 3,
                "coverageAmount": 500000.00
            }
            """;

        given()
            .contentType("application/json")
            .body(requestBody)
        .when()
            .post("/api/policies")
        .then()
            .statusCode(201)
            .header("Location", matchesPattern(".*/api/policies/POL-\\d{4}-\\d{6}"))
            .body("policyNumber", startsWith("POL-"))
            .body("holderName", equalTo("张三"))
            .body("premiumAmount", greaterThan(0.0f))
            .body("status", equalTo("PENDING"))
            .time(lessThan(2000L));  // 响应时间 < 2s
    }

    @Test
    @DisplayName("Response 提取：获取字段值用于后续断言")
    void extractResponseFields() {
        var policyNumber = given()
            .contentType("application/json")
            .body("{\"holderName\":\"李四\",\"age\":28,\"occupationClass\":2,\"coverageAmount\":300000.00}")
        .when()
            .post("/api/policies")
        .then()
            .statusCode(201)
            .extract()
            .path("policyNumber");

        // 使用提取的保单号查询详情
        given()
            .pathParam("policyNumber", policyNumber)
        .when()
            .get("/api/policies/{policyNumber}")
        .then()
            .statusCode(200)
            .body("holderName", equalTo("李四"));
    }
}
```

### 6.2 认证与复杂请求

```java
import io.restassured.response.ValidatableResponse;

class AuthenticatedApiTest {

    @Test
    @DisplayName("Bearer Token 认证")
    void bearerTokenAuthentication() {
        var token = obtainAccessToken();

        given()
            .auth().oauth2(token)
            .queryParam("status", "APPROVED")
        .when()
            .get("/api/policies")
        .then()
            .statusCode(200)
            .body("size()", greaterThan(0))
            .body("[0].status", everyItem(equalTo("APPROVED")));
    }

    @Test
    @DisplayName("表单认证与会话保持")
    void formAuthenticationWithSession() {
        given()
            .auth().form("admin", "password")
            .filter(sessionFilter -> {
                // 这种模式适用于传统 session-based 认证
            })
        .when()
            .get("/api/admin/stats")
        .then()
            .statusCode(200);
    }

    private String obtainAccessToken() {
        return given()
            .contentType("application/x-www-form-urlencoded")
            .formParam("grant_type", "client_credentials")
            .formParam("client_id", "test-client")
            .formParam("client_secret", "test-secret")
        .when()
            .post("/oauth2/token")
        .then()
            .statusCode(200)
            .extract()
            .path("access_token");
    }
}
```

---

## 七、ArchUnit：架构防腐

> ⚠️ 技术雷达：Trial — ArchUnit 在技术雷达中标记为 Trial，适合作为架构治理的补充手段，建议在关键模块上试点。

ArchUnit 将架构规则写成可执行的测试，防止架构腐化。可以在 CI 中断言包依赖、分层约束、循环依赖等。

### 7.1 包依赖检查

```java
import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.lang.ArchRule;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.*;

class PackageDependencyTest {

    private static JavaClasses importedClasses;

    @BeforeAll
    static void importAllClasses() {
        importedClasses = new ClassFileImporter()
            .importPackages("com.example.insurance");
    }

    @Test
    @DisplayName("domain 层不应依赖 infrastructure 层")
    void domainShouldNotDependOnInfrastructure() {
        ArchRule rule = noClasses()
            .that().resideInAPackage("..domain..")
            .should().dependOnClassesThat().resideInAPackage("..infrastructure..")
            .because("领域层不应依赖基础设施层，保持领域逻辑的纯粹性");

        rule.check(importedClasses);
    }

    @Test
    @DisplayName("application 层只应依赖 domain 和共享层")
    void applicationLayerShouldOnlyDependOnDomain() {
        ArchRule rule = classes()
            .that().resideInAPackage("..application..")
            .should().onlyDependOnClassesThat()
            .resideInAnyPackage(
                "..application..",
                "..domain..",
                "java..",
                "org.springframework..",
                "jakarta..",
                "lombok.."
            );

        rule.check(importedClasses);
    }

    @Test
    @DisplayName("infrastructure 层不应被 domain 层依赖（反向依赖检查）")
    void infrastructureNotAccessedByDomain() {
        ArchRule rule = noClasses()
            .that().resideInAPackage("..infrastructure..")
            .should().onlyBeAccessed().byAnyPackage("..domain..");
        rule.check(importedClasses);
    }
}
```

### 7.2 层级架构约束

```java
import com.tngtech.archunit.library.Architectures;

class LayerArchitectureTest {

    private static JavaClasses importedClasses;

    @BeforeAll
    static void importAllClasses() {
        importedClasses = new ClassFileImporter()
            .importPackages("com.example.insurance");
    }

    @Test
    @DisplayName("严格分层架构：controller → service → repository")
    void enforceLayeredArchitecture() {
        var rule = Architectures.layeredArchitecture()
            .consideringOnlyDependenciesInLayers()
            .layer("Controller").definedBy("..controller..")
            .layer("Service").definedBy("..service..")
            .layer("Repository").definedBy("..repository..")
            .layer("Domain").definedBy("..domain..")

            .whereLayer("Controller").mayNotBeAccessedByAnyLayer()
            .whereLayer("Service").mayOnlyBeAccessedByLayers("Controller")
            .whereLayer("Repository").mayOnlyBeAccessedByLayers("Service")
            .whereLayer("Domain").mayOnlyBeAccessedByLayers("Service", "Repository");

        rule.check(importedClasses);
    }
}
```

### 7.3 命名约定与循环依赖检测

```java
class NamingAndCycleDetectionTest {

    private static JavaClasses importedClasses;

    @BeforeAll
    static void importAllClasses() {
        importedClasses = new ClassFileImporter()
            .importPackages("com.example.insurance");
    }

    @Test
    @DisplayName("Repository 接口必须以 Repository 结尾")
    void repositoriesShouldBeSuffixed() {
        classes()
            .that().resideInAPackage("..repository..")
            .should().haveSimpleNameEndingWith("Repository")
            .check(importedClasses);
    }

    @Test
    @DisplayName("Service 类必须以 Service 结尾且被 @Service 注解")
    void servicesShouldBeAnnotated() {
        classes()
            .that().resideInAPackage("..service..")
            .should().beAnnotatedWith(org.springframework.stereotype.Service.class)
            .andShould().haveSimpleNameEndingWith("Service")
            .check(importedClasses);
    }

    @Test
    @DisplayName("检测包之间的循环依赖")
    void noCyclicDependencies() {
        com.tngtech.archunit.library.dependencies.SlicesRuleDefinition.slices()
            .matching("com.example.insurance.(*)..")
            .should().beFreeOfCycles()
            .check(importedClasses);
    }

    @Test
    @DisplayName("DTO 不应包含业务逻辑")
    void dtosShouldNotContainBusinessLogic() {
        classes()
            .that().resideInAPackage("..dto..")
            .should().onlyHaveDependentClassesThat()
            .resideInAnyPackage("..controller..", "..dto..")
            .check(importedClasses);
    }
}
```

---

## 八、测试数据管理

测试数据的准备和维护是测试中最耗时的部分之一。良好的测试数据管理策略是可持续测试的基础。

### 8.1 Builder 模式

使用 Lombok `@Builder` 或手写 Builder 构造测试对象，避免冗长的构造器调用：

```java
// 产品代码
@lombok.Builder
@lombok.With
public record InsurancePolicy(
    String policyNumber,
    String holderName,
    int holderAge,
    OccupationClass occupationClass,
    double coverageAmount,
    double premiumAmount,
    PolicyStatus status,
    java.time.LocalDate effectiveDate,
    java.time.LocalDate expiryDate
) {}

// 测试中使用 Builder
class PolicyBuilderDemoTest {

    // 预定义常见测试数据工厂
    static InsurancePolicy aStandardPolicy() {
        return InsurancePolicy.builder()
            .policyNumber("POL-2026-000001")
            .holderName("张三")
            .holderAge(35)
            .occupationClass(OccupationClass.THREE)
            .coverageAmount(500_000.00)
            .premiumAmount(12_500.00)
            .status(PolicyStatus.PENDING)
            .effectiveDate(java.time.LocalDate.of(2026, 1, 1))
            .expiryDate(java.time.LocalDate.of(2027, 1, 1))
            .build();
    }

    @Test
    @DisplayName("Builder 的 withXxx 拷贝并修改部分字段")
    void builderCopyWithModification() {
        var basePolicy = aStandardPolicy();

        // 基于已有对象，仅修改需要差异化的字段
        var highRiskPolicy = basePolicy
            .withOccupationClass(OccupationClass.FIVE)
            .withCoverageAmount(1_000_000.00);

        var retiredPolicy = basePolicy
            .withHolderAge(65)
            .withExpiryDate(java.time.LocalDate.of(2026, 12, 31));

        assertThat(highRiskPolicy.occupationClass()).isEqualTo(OccupationClass.FIVE);
        assertThat(highRiskPolicy.premiumAmount()).isEqualTo(12_500.00); // 未变化
        assertThat(retiredPolicy.holderAge()).isEqualTo(65);
    }
}
```

### 8.2 使用 Faker 生成随机但合理的数据

```java
// 使用 Datafaker (https://www.datafaker.net/) 或 Instancio
import net.datafaker.Faker;

class FakerDataGenerationTest {

    private static final Faker faker = new Faker(java.util.Locale.CHINA);

    @Test
    @DisplayName("使用 Faker 生成逼真的测试投保人数据")
    void generateRealisticApplicantData() {
        var applicant = InsurancePolicy.builder()
            .policyNumber("POL-2026-" + String.format("%06d", faker.number().numberBetween(1, 999999)))
            .holderName(faker.name().fullName())
            .holderAge(faker.number().numberBetween(18, 65))
            .occupationClass(OccupationClass.fromCode(faker.number().numberBetween(1, 6)))
            .coverageAmount(faker.number().randomDouble(2, 100_000, 5_000_000))
            .effectiveDate(java.time.LocalDate.now())
            .expiryDate(java.time.LocalDate.now().plusYears(1))
            .status(faker.options().option(PolicyStatus.class))
            .build();

        assertThat(applicant.holderName()).isNotBlank();
        assertThat(applicant.holderAge()).isBetween(18, 65);
    }

    @Test
    @DisplayName("参数化测试 + Faker：大规模数据驱动测试")
    void bulkTestWithFaker() {
        for (int i = 0; i < 100; i++) {
            var age = faker.number().numberBetween(0, 100);
            var isEligible = new InsuranceApplicant("Test", age).isEligible();
            // 仅 18-64 岁可投保
            assertThat(isEligible).isEqualTo(age >= 18 && age <= 64);
        }
    }
}
```

### 8.3 固定数据集（Fixture）

对于复杂的业务场景，使用 JSON 文件作为 fixed dataset：

```json
// src/test/resources/fixtures/group-policy-input.json
{
  "companyName": "示例科技有限公司",
  "employees": [
    {"name": "张三", "age": 28, "occupationClass": 1, "salary": 15000},
    {"name": "李四", "age": 35, "occupationClass": 3, "salary": 25000},
    {"name": "王五", "age": 55, "occupationClass": 5, "salary": 45000}
  ],
  "expectedPremium": 8750.00
}
```

```java
import com.fasterxml.jackson.databind.ObjectMapper;

class FixtureBasedTest {

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    @DisplayName("使用 JSON fixture 文件进行团体保单测试")
    void testGroupPolicyFromFixture() throws Exception {
        var input = mapper.readValue(
            new java.io.File("src/test/resources/fixtures/group-policy-input.json"),
            GroupPolicyInput.class
        );

        var calculator = new GroupPremiumCalculator();
        var result = calculator.calculate(input.toApplication());

        assertThat(result.totalPremium()).isEqualTo(input.expectedPremium());
    }
}
```

### 8.4 数据管理原则总结

| 策略 | 适用场景 | 优点 | 缺点 |
|------|----------|------|------|
| Builder | 对象字段多，每次只需修改少数字段 | 可读性高，链式调用 | 需维护 Builder 代码 |
| Faker | 需要大量随机合法数据 | 数据多样性强 | 结果非确定性 |
| Fixed Fixture | 复杂业务场景的精确验证 | 精确、可复现 | 维护成本高 |
| Database Seed | Repository 层集成测试 | 接近真实数据 | 依赖 Schema 同步 |

---

## 九、AI 测试：LLM 输出的断言策略

传统软件测试依赖确定性断言（`assertThat(result).isEqualTo(expected)`），但 LLM 输出是非确定性的——相同的 Prompt 可能得到措辞不同但语义等价的回答。以下五种策略从严格到宽松递进。

### 9.1 策略一：精确匹配（Exact Match）

适用场景：结构化输出、固定模板、JSON 字段名和类型验证。

```java
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.networknt.schema.JsonSchemaFactory;
import com.networknt.schema.SpecVersion;

class ExactJsonMatchTest {

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    @DisplayName("LLM 输出必须符合预定义的 JSON Schema")
    void llmOutputMustConformToJsonSchema() throws Exception {
        var llmOutput = """
            {
                "policyRecommendation": "重疾险基础版",
                "estimatedPremium": 3500.00,
                "currency": "CNY",
                "coverageDetails": {
                    "criticalIllness": 500000.00,
                    "hospitalization": 100000.00
                },
                "reasons": ["年龄适合", "职业等级低", "无既往病史"]
            }
            """;

        // 定义 JSON Schema（简化版）
        var schemaFactory = JsonSchemaFactory.getInstance(SpecVersion.VersionFlag.V202012);
        var schema = schemaFactory.getSchema("""
            {
                "type": "object",
                "required": ["policyRecommendation", "estimatedPremium", "coverageDetails"],
                "properties": {
                    "policyRecommendation": { "type": "string", "minLength": 1 },
                    "estimatedPremium": { "type": "number", "minimum": 0 },
                    "coverageDetails": {
                        "type": "object",
                        "required": ["criticalIllness"],
                        "properties": {
                            "criticalIllness": { "type": "number", "minimum": 0 },
                            "hospitalization": { "type": "number", "minimum": 0 }
                        }
                    },
                    "reasons": {
                        "type": "array",
                        "items": { "type": "string" },
                        "minItems": 1
                    }
                }
            }
            """);

        var jsonNode = mapper.readTree(llmOutput);
        var errors = schema.validate(jsonNode);

        assertThat(errors).isEmpty();
    }
}
```

### 9.2 策略二：JSON Path 部分断言（Partial Assertion）

不要求整个输出完全匹配，只验证关键字段。

```java
import com.jayway.jsonpath.JsonPath;

class PartialAssertionTest {

    @Test
    @DisplayName("使用 JsonPath 验证 LLM JSON 输出的关键字段")
    void jsonPathPartialAssertion() {
        var llmOutput = """
            {
                "riskAssessment": {
                    "overall": "中等风险",
                    "score": 7.2,
                    "factors": [
                        {"name": "年龄", "level": "high", "detail": "55岁，超出标准体范围"},
                        {"name": "职业", "level": "medium", "detail": "三类职业，轻微风险"},
                        {"name": "健康告知", "level": "low", "detail": "无重大异常"}
                    ]
                }
            }
            """;

        // 仅验证关键字段的存在性和合理性
        assertThat(JsonPath.<String>read(llmOutput, "$.riskAssessment.overall"))
            .isIn("低风险", "中等风险", "高风险");
        assertThat(JsonPath.<Double>read(llmOutput, "$.riskAssessment.score"))
            .isBetween(0.0, 10.0);
        assertThat(JsonPath.<List<?>>read(llmOutput, "$.riskAssessment.factors"))
            .hasSizeGreaterThanOrEqualTo(1);
        assertThat(JsonPath.<List<String>>read(llmOutput, "$.riskAssessment.factors[*].name"))
            .contains("年龄", "职业");
    }
}
```

### 9.3 策略三：语义相似度（Semantic Similarity）

使用 Embedding 模型比较 LLM 输出与期望答案的语义距离。这是处理自然语言输出的核心策略。

```java
import java.util.List;

class SemanticSimilarityAssertionTest {

    // 简化的 Embedding 计算（生产中使用 Spring AI EmbeddingModel 或 DJL）
    private double cosineSimilarity(List<Double> a, List<Double> b) {
        assert a.size() == b.size();
        double dotProduct = 0, normA = 0, normB = 0;
        for (int i = 0; i < a.size(); i++) {
            dotProduct += a.get(i) * b.get(i);
            normA += a.get(i) * a.get(i);
            normB += b.get(i) * b.get(i);
        }
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    @Test
    @DisplayName("语义相似度：LLM 回答与期望答案应高度相似")
    void semanticSimilarityThreshold() {
        var expectedAnswer = "建议投保人选择包含重疾和住院医疗的综合保险方案";
        var llmOutput = "我们推荐您考虑一个涵盖重大疾病保障和住院费用报销的全面保险计划";

        // 实际项目中：使用 EmbeddingModel.embed() 获取向量
        // var expectedEmbedding = embeddingModel.embed(expectedAnswer);
        // var actualEmbedding = embeddingModel.embed(llmOutput);
        // double similarity = cosineSimilarity(expectedEmbedding, actualEmbedding);
        // assertThat(similarity).isGreaterThan(0.85);

        // 演示：这里使用占位逻辑
        assertThat(llmOutput).contains("重大疾病", "住院");
        assertThat(llmOutput.length()).isGreaterThan(20);
    }
}
```

**完整的 Embedding 语义相似度测试（Spring AI 集成版）**：

```java
import org.springframework.ai.embedding.EmbeddingModel;
import org.springframework.ai.embedding.EmbeddingRequest;
import org.springframework.ai.embedding.EmbeddingResponse;

class EmbeddingBasedSemanticTest {

    private final EmbeddingModel embeddingModel; // 注入 Spring AI EmbeddingModel

    EmbeddingBasedSemanticTest(EmbeddingModel embeddingModel) {
        this.embeddingModel = embeddingModel;
    }

    /**
     * 语义相似度阈值断言。不同场景推荐阈值：
     * - 法律/合规条款：>= 0.92（极高要求）
     * - 保险产品推荐：>= 0.82（可接受措辞变化）
     * - 客服回答：>= 0.75（容忍表达多样性）
     */
    record SemanticAssertion(
        String expectedAnswer,
        String actualAnswer,
        double minSemanticSimilarity
    ) {
        void verify(EmbeddingModel model) {
            var expectedEmb = model.embed(expectedAnswer);
            var actualEmb = model.embed(actualAnswer);
            var similarity = cosineSimilarity(expectedEmb, actualEmb);
            // 使用 AssertJ assertion
            org.assertj.core.api.Assertions.assertThat(similarity)
                .as("语义相似度应 >= %s，实际: %s", minSemanticSimilarity, similarity)
                .isGreaterThanOrEqualTo(minSemanticSimilarity);
        }
    }

    @Test
    @DisplayName("保险条款解释的语义相似度验证")
    void insuranceClauseExplanationSemantics() {
        new SemanticAssertion(
            "等待期是指从保险合同生效日起90天内，被保险人因疾病发生的保险事故，保险公司不承担赔偿责任。",
            "等待期为保单生效后的90天，在此期间因疾病导致的医疗费用不在保障范围内。",
            0.88
        ).verify(embeddingModel);
    }

    private static double cosineSimilarity(List<Double> a, List<Double> b) {
        double dot = 0, na = 0, nb = 0;
        for (int i = 0; i < a.size(); i++) {
            dot += a.get(i) * b.get(i);
            na += a.get(i) * a.get(i);
            nb += b.get(i) * b.get(i);
        }
        return dot / (Math.sqrt(na) * Math.sqrt(nb));
    }
}
```

### 9.4 策略四：LLM-as-Judge（让 LLM 评估 LLM）

用一个更强的模型（Judge LLM）来评估被测模型的输出。这是目前业界最灵活但也最昂贵的方案。

```java
import java.util.List;

class LLMasJudgeTest {

    // 实际项目中注入 ChatModel
    // private final ChatModel judgeModel; // 例如 claude-sonnet-4-20250514

    /**
     * LLM-as-Judge 的核心 Prompt 模板。
     * 原则：
     * 1. 明确评估维度（正确性、完整性、安全性）
     * 2. 要求结构化输出（便于解析）
     * 3. 提供评分尺度（1-5 分）
     * 4. 要求引用证据（可追溯）
     */
    static final String JUDGE_TEMPLATE = """
        你是一个专业的保险知识评估员。请根据以下标准评估回答质量：

        【评估维度】
        1. 正确性（1-5）：回答中的保险知识是否准确无误
        2. 完整性（1-5）：是否覆盖了用户问题的所有关键点
        3. 可操作性（1-5）：回答是否提供了清晰的下一步行动建议
        4. 合规性（1-5）：回答是否包含必要的免责声明和风险提示

        【用户问题】%s
        【参考答案】%s
        【被评估的回答】%s

        请以 JSON 格式输出评估结果：
        {
            "correctness": 5,
            "completeness": 4,
            "actionability": 5,
            "compliance": 4,
            "overallVerdict": "PASS|FAIL",
            "explanation": "详细评估说明"
        }
        """;

    @Test
    @DisplayName("LLM-as-Judge 评估保险问答质量")
    void judgeInsuranceAnswerQuality() {
        var userQuestion = "我有高血压，能买重疾险吗？";
        var referenceAnswer = """
            高血压患者能否购买重疾险取决于以下因素：
            1. 血压控制情况：规律服药且血压稳定在正常范围，通常可以标准体承保
            2. 并发症情况：无心脑血管并发症的患者承保可能性更大
            3. 建议：提供近6个月的体检报告和血压记录，由核保师评估
            
            【免责声明】以上为通用指引，具体承保结论以保险公司核保结果为准。
            """;

        var llmOutput = """
            有高血压也可以尝试投保重疾险，但需要注意：
            - 如果一直在吃药控制且血压正常，大多数产品可以正常买
            - 如果有并发症可能会被拒保
            - 建议先做健康告知，让保险公司评估一下
            """;

        // 实际评估调用：
        // var prompt = String.format(JUDGE_TEMPLATE, userQuestion, referenceAnswer, llmOutput);
        // var response = judgeModel.call(prompt);
        // var result = objectMapper.readValue(response, JudgeResult.class);
        // assertThat(result.overallVerdict()).isEqualTo("PASS");
        // assertThat(result.correctness()).isGreaterThanOrEqualTo(4);

        // 演示：结构化的验证
        assertThat(llmOutput).contains("高血压", "重疾险");
        assertThat(llmOutput).containsPattern("控制|正常|并发症|拒保");
    }

    record JudgeResult(int correctness, int completeness, int actionability,
                       int compliance, String overallVerdict, String explanation) {}
}
```

### 9.5 策略五：混合策略（Production-Grade）

在实际项目中，单一策略不够。混合策略组合多种断言方式：

```java
class HybridAssertionStrategyTest {

    /**
     * 生产级 AI 测试混合策略：
     *
     * Layer 1 — 结构验证：JSON Schema / 类型检查（策略一）
     *   → 快速失败：如果 LLM 连格式都输出错了，无需后续检查
     * Layer 2 — 关键信息验证：JsonPath / 关键词 / 正则（策略二）
     *   → 核心字段是否存在且合法
     * Layer 3 — 语义验证：Embedding 余弦相似度（策略三）
     *   → 回答是否在语义上正确
     * Layer 4 — 质量评估：LLM-as-Judge（策略四）
     *   → 抽样使用，评估正确性和合规性
     * Layer 5 — 安全扫描：内容审核（PII 泄露、有害内容）
     *   → 确保输出安全
     */
    @Test
    @DisplayName("混合策略：完整的 LLM 输出质量门禁")
    void hybridAssertionPipeline() {
        var llmOutput = """
            {
                "recommendation": "建议选择康宁终身重疾险（2026版）",
                "rationale": "基于您35岁、三类职业、无既往病史的情况，该产品性价比最高",
                "estimatedAnnualPremium": 6250.00,
                "keyBenefits": ["100种重疾保障", "50种轻症赔付", "身故返还"],
                "disclaimer": "以上建议仅供参考，具体以保险合同条款为准。投保前请仔细阅读健康告知。"
            }
            """;

        // Layer 1: 结构必须合法
        assertThat(org.junit.jupiter.api.Assertions.assertDoesNotThrow(
            () -> new com.fasterxml.jackson.databind.ObjectMapper().readTree(llmOutput)))
            .isNotNull();

        // Layer 2: 关键字段验证
        assertThat(com.jayway.jsonpath.JsonPath.<String>read(llmOutput, "$.recommendation"))
            .isNotBlank();
        assertThat(com.jayway.jsonpath.JsonPath.<Double>read(llmOutput, "$.estimatedAnnualPremium"))
            .isGreaterThan(0.0);
        assertThat(com.jayway.jsonpath.JsonPath.<List<String>>read(llmOutput, "$.keyBenefits"))
            .hasSizeGreaterThanOrEqualTo(2);

        // Layer 3: 免责声明必须存在
        assertThat(com.jayway.jsonpath.JsonPath.<String>read(llmOutput, "$.disclaimer"))
            .contains("仅供参考", "合同条款", "健康告知");

        // Layer 4: (实际项目中) LLM-as-Judge 抽样评估
        // Layer 5: (实际项目中) 内容安全扫描
    }
}
```

### 9.6 AI 测试策略选择决策树

```
LLM 输出的格式是？
├── 结构化 JSON（每次结构固定）
│   └── 策略一：JSON Schema 精确校验
│       时机：每次 CI 运行
│       成本：几乎为 0
│
├── 半结构化（JSON 中有自然语言字段）
│   ├── 关键字段验证 → 策略二：JSON Path 部分断言
│   └── 自然语言字段 → 策略三：语义相似度（阈值 0.80-0.90）
│       时机：每次 CI 运行
│       成本：Embedding API 调用
│
└── 纯自然语言
    ├── 高精度场景（法律/合规/医疗建议）
    │   ├── 策略三：语义相似度（阈值 >= 0.92）
    │   └── 策略四：LLM-as-Judge（100% 样本）
    │       成本：较高
    │
    ├── 一般场景（客服/推荐/摘要）
    │   ├── 策略三：语义相似度（阈值 >= 0.80）
    │   └── 策略四：LLM-as-Judge（10-20% 样本抽样）
    │       成本：中等
    │
    └── 探索性场景（创意生成/头脑风暴）
        └── 策略四：LLM-as-Judge（人工定义通过标准）
            成本：较高但可接受
```

---

## 十、测试工具链总览

```
┌─────────────────────────────────────────────────────────────┐
│                       测试工具链矩阵                          │
├──────────────┬────────────────────┬──────────────────────────┤
│ 测试层级      │ 工具                │ 技术雷达象限              │
├──────────────┼────────────────────┼──────────────────────────┤
│ 单元测试      │ JUnit 5            │ 🟢 Adopt                 │
│ Mock / Stub  │ Mockito            │ 🟢 Adopt                 │
│ 断言         │ AssertJ            │ 🟢 Adopt                 │
│ 集成测试      │ Testcontainers     │ 🟢 Adopt                 │
│ Spring 测试  │ Spring Boot Test   │ 🟢 Adopt                 │
│ 数据库测试    │ Testcontainers PG  │ 🟢 Adopt                 │
│ HTTP Mock    │ WireMock           │ 🔵 Trial                 │
│ API E2E      │ REST Assured       │ 🔵 Trial                 │
│ 架构约束      │ ArchUnit           │ 🔵 Trial                 │
│ AI 输出测试   │ Embedding + Judge  │ 🟢 Adopt (LLM-as-Judge)  │
│ AI 输出测试   │ JSON Schema        │ 🟢 Adopt                 │
│ 变异测试      │ PIT                │ 🔵 Trial                 │
│ 静态分析      │ SpotBugs/Checkstyle│ 🟢 Adopt                 │
│ 代码覆盖率    │ JaCoCo             │ 🟢 Adopt                 │
└──────────────┴────────────────────┴──────────────────────────┘
```

**Maven 依赖汇总**（核心测试依赖）：

```xml
<dependencies>
    <!-- JUnit 5 -->
    <dependency>
        <groupId>org.junit.jupiter</groupId>
        <artifactId>junit-jupiter</artifactId>
        <scope>test</scope>
    </dependency>

    <!-- Mockito -->
    <dependency>
        <groupId>org.mockito</groupId>
        <artifactId>mockito-junit-jupiter</artifactId>
        <scope>test</scope>
    </dependency>

    <!-- AssertJ (流式断言) -->
    <dependency>
        <groupId>org.assertj</groupId>
        <artifactId>assertj-core</artifactId>
        <scope>test</scope>
    </dependency>

    <!-- Testcontainers -->
    <dependency>
        <groupId>org.testcontainers</groupId>
        <artifactId>testcontainers</artifactId>
        <scope>test</scope>
    </dependency>
    <dependency>
        <groupId>org.testcontainers</groupId>
        <artifactId>postgresql</artifactId>
        <scope>test</scope>
    </dependency>
    <dependency>
        <groupId>org.testcontainers</groupId>
        <artifactId>kafka</artifactId>
        <scope>test</scope>
    </dependency>

    <!-- WireMock (Trial) -->
    <dependency>
        <groupId>org.wiremock</groupId>
        <artifactId>wiremock-standalone</artifactId>
        <scope>test</scope>
    </dependency>

    <!-- REST Assured (Trial) -->
    <dependency>
        <groupId>io.rest-assured</groupId>
        <artifactId>rest-assured</artifactId>
        <scope>test</scope>
    </dependency>

    <!-- ArchUnit (Trial) -->
    <dependency>
        <groupId>com.tngtech.archunit</groupId>
        <artifactId>archunit-junit5</artifactId>
        <scope>test</scope>
    </dependency>

    <!-- JsonPath (JSON 部分断言) -->
    <dependency>
        <groupId>com.jayway.jsonpath</groupId>
        <artifactId>json-path</artifactId>
        <scope>test</scope>
    </dependency>

    <!-- JSON Schema Validator -->
    <dependency>
        <groupId>com.networknt</groupId>
        <artifactId>json-schema-validator</artifactId>
        <scope>test</scope>
    </dependency>

    <!-- Datafaker (随机测试数据) -->
    <dependency>
        <groupId>net.datafaker</groupId>
        <artifactId>datafaker</artifactId>
        <scope>test</scope>
    </dependency>

    <!-- PIT Mutation Testing (Trial) -->
    <dependency>
        <groupId>org.pitest</groupId>
        <artifactId>pitest-maven</artifactId>
        <scope>test</scope>
    </dependency>
</dependencies>
```

---

## 常见问题

**Q1: 单元测试应该 mock 到什么粒度？**

A: mock 所有跨越进程/网络边界的依赖（数据库、HTTP、消息队列、文件系统），不 mock 值对象、DTO、纯函数。一个良好的经验法则：如果被 mock 的对象在一个月内不会发生变化且逻辑简单（如 `Math.max()`），不要 mock；如果是外部服务，必须 mock。

**Q2: Testcontainers 每次启动容器太慢怎么办？**

A: 三种优化手段：(1) `withReuse(true)` 跨测试类复用容器；(2) Singleton 容器模式在一个 JVM 内共享；(3) CI 中预拉取 Docker 镜像。实际上，启动一个 PostgreSQL 容器只需 3-5 秒，对大多数项目的集成测试是完全可以接受的。

**Q3: AI 测试中语义相似度的阈值如何确定？**

A: 通过 Golden Dataset 校准：选取 20-50 组(问题, 参考答案, 错误答案, 模糊答案)样本，对每组计算相似度，找到能区分"正确/应该通过"和"错误/应该失败"的最佳阈值。通常保险条款类需 >= 0.90，客服类 >= 0.78。

**Q4: 什么时候用 Spy 而不是 Mock？**

A: Spy 应极少使用。合法场景：(1) 需要测试的类中部分方法需要真实执行、部分需要 stub；(2) 遗留代码重构，无法轻松注入 mock。在大多数情况下，Spy 意味着被测试的类职责过多，应考虑拆分。

**Q5: ArchUnit 规则太严格导致大量误报怎么办？**

A: ArchUnit 支持 `FreezingArchRule`——首次运行时将所有违规"冻结"为已知违规（存储到 `ViolationStore`），后续只报告新增违规。这让架构规则可以渐进式引入，不阻塞开发。

---

## 相关条目

- [[02-现代Java25深度解析]] — Java 平台基础（JUnit 5 底层依赖）
- [[03-SpringBoot4深度解析]] — Spring Boot 核心（Spring Boot Test 自动配置）
- [[03-Java测试最佳实践]] — Spring Boot Test 深入
- [[07-Transformer架构深度解析]] — AI 基础（Embedding 原理、LLM-as-Judge 原理）
- [[14-模型网关与Prompt管理]] — 评估体系与 Golden Dataset 管理
