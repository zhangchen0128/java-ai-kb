---
domain: 03-Java应用平台
title: Maven多模块工程实践
status: draft
level: intermediate
sources:
  - level: L1
    url: https://maven.apache.org/guides/introduction/introduction-to-the-pom.html
    description: Maven POM Reference Documentation
  - level: L1
    url: https://maven.apache.org/plugins/maven-compiler-plugin/
    description: Maven Compiler Plugin — Java 25 configuration
  - level: L1
    url: https://docs.spring.io/spring-boot/maven-plugin/
    description: Spring Boot Maven Plugin Reference — AOT processing
  - level: L4
    url: https://maven.apache.org/guides/mini/guide-multiple-modules.html
    description: Maven Multi-Module Guide
relations:
  prerequisite:
    - 03-SpringBoot4深度解析
  related:
    - 03-Jackson-MapStruct-Validator序列化与校验
    - 03-任务调度Quartz与XXL-JOB
tags:
  - maven
  - multi-module
  - dependency-management
  - bom
  - wraper
  - spotbugs
  - checkstyle
  - pmd
  - spring-boot
  - pom
created: 2026-07-20
updated: 2026-07-28
content_type: practice
---

# Maven 多模块工程实践

## 概述

Maven 是 Java 生态事实上的构建标准。在 AI 应用开发中，一个典型的项目往往包含多个模块：Web API 层、业务服务层、AI 集成层、数据访问层、公共工具层。如何合理划分模块、管理依赖、配置插件，直接影响项目的可维护性和构建效率。

本文从模块拆分原则、POM 管理策略、依赖治理、插件配置到静态分析集成，覆盖 Maven 多模块工程的完整实践。技术雷达中 Maven 4.x 是 Adopt 象限的主构建工具。

---

## 一、多模块设计

### 1.1 模块拆分原则

**按层拆分（传统分层架构）：**
```
my-app/
├── my-app-api/          # 对外接口定义（DTO、Feign 接口）
├── my-app-common/       # 公共工具类、常量、异常
├── my-app-service/      # 业务逻辑层
├── my-app-repository/   # 数据访问层（JPA/MyBatis Mapper）
└── my-app-web/          # Web 层（Controller、配置）
```

**按领域拆分（DDD 风格）：**
```
my-app/
├── my-app-common/       # 共享基础设施
├── my-app-user/         # 用户领域（service + repository + api）
├── my-app-order/        # 订单领域
├── my-app-product/      # 产品领域
└── my-app-web/          # Web 聚合层
```

### 1.2 AI 项目推荐模块结构

```
ai-knowledge-platform/
├── ai-knowledge-api/          # 公共 API 接口定义（Port 接口）
│   └── com.example.ai.api
│       ├── ChatModelPort.java
│       ├── EmbeddingModelPort.java
│       └── RetrievalPort.java
├── ai-knowledge-common/       # 公共工具、常量、DTO
│   └── com.example.ai.common
│       ├── dto/
│       ├── exception/
│       └── util/
├── ai-knowledge-domain/       # 领域模型与业务规则
│   └── com.example.ai.domain
│       ├── knowledge/
│       ├── agent/
│       └── conversation/
├── ai-knowledge-infra/        # 基础设施实现
│   └── com.example.ai.infra
│       ├── chat/              # Spring AI 适配器实现
│       ├── embedding/
│       ├── vectorstore/
│       └── mcp/               # MCP 客户端实现
├── ai-knowledge-service/      # 应用服务层
│   └── com.example.ai.service
│       ├── KnowledgeService.java
│       ├── AgentService.java
│       └── RagService.java
└── ai-knowledge-web/          # Web 层（启动入口）
    └── com.example.ai.web
        ├── controller/
        ├── config/
        └── AiKnowledgeApplication.java
```

**依赖方向（单向依赖，防止循环）：**
```
web → service → domain → common
web → infra → domain → common
service → api
infra → api
```

---

## 二、POM 管理

### 2.1 Parent POM

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0
         https://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>4.0.0</version>
        <relativePath/>
    </parent>

    <groupId>com.example</groupId>
    <artifactId>ai-knowledge-platform</artifactId>
    <version>1.0.0-SNAPSHOT</version>
    <packaging>pom</packaging>

    <name>AI Knowledge Platform</name>
    <description>AI Knowledge Platform — Multi-module Spring Boot 4.x Project</description>

    <!-- 子模块声明（聚合） -->
    <modules>
        <module>ai-knowledge-api</module>
        <module>ai-knowledge-common</module>
        <module>ai-knowledge-domain</module>
        <module>ai-knowledge-infra</module>
        <module>ai-knowledge-service</module>
        <module>ai-knowledge-web</module>
    </modules>

    <!-- 统一版本管理 -->
    <properties>
        <java.version>25</java.version>
        <maven.compiler.release>25</maven.compiler.release>
        <spring-ai.version>2.0.0</spring-ai.version>
        <mybatis-plus.version>3.5.10</mybatis-plus.version>
        <mapstruct.version>1.6.3</mapstruct.version>
        <guava.version>33.4.0-jre</guava.version>
        <spotbugs.version>4.8.6</spotbugs.version>
        <checkstyle.version>3.6.0</checkstyle.version>
        <pmd.version>3.26.0</pmd.version>
    </properties>

    <!-- 依赖管理（不实际引入，只管理版本） -->
    <dependencyManagement>
        <dependencies>
            <!-- Spring AI BOM -->
            <dependency>
                <groupId>org.springframework.ai</groupId>
                <artifactId>spring-ai-bom</artifactId>
                <version>${spring-ai.version}</version>
                <type>pom</type>
                <scope>import</scope>
            </dependency>

            <!-- 项目内部模块 -->
            <dependency>
                <groupId>com.example</groupId>
                <artifactId>ai-knowledge-api</artifactId>
                <version>${project.version}</version>
            </dependency>
            <dependency>
                <groupId>com.example</groupId>
                <artifactId>ai-knowledge-common</artifactId>
                <version>${project.version}</version>
            </dependency>

            <!-- 第三方库锁定版本 -->
            <dependency>
                <groupId>com.baomidou</groupId>
                <artifactId>mybatis-plus-spring-boot3-starter</artifactId>
                <version>${mybatis-plus.version}</version>
            </dependency>
            <dependency>
                <groupId>org.mapstruct</groupId>
                <artifactId>mapstruct</artifactId>
                <version>${mapstruct.version}</version>
            </dependency>
        </dependencies>
    </dependencyManagement>

    <!-- 所有子模块共享的依赖 -->
    <dependencies>
        <!-- 编译时工具 -->
        <dependency>
            <groupId>org.projectlombok</groupId>
            <artifactId>lombok</artifactId>
            <optional>true</optional>
        </dependency>
        <dependency>
            <groupId>org.mapstruct</groupId>
            <artifactId>mapstruct</artifactId>
        </dependency>

        <!-- 测试 -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-test</artifactId>
            <scope>test</scope>
        </dependency>
    </dependencies>

    <!-- 插件管理（统一版本和配置） -->
    <build>
        <pluginManagement>
            <plugins>
                <plugin>
                    <groupId>org.apache.maven.plugins</groupId>
                    <artifactId>maven-compiler-plugin</artifactId>
                    <configuration>
                        <release>25</release>
                        <parameters>true</parameters> <!-- 保留方法参数名（反射需要） -->
                        <annotationProcessorPaths>
                            <path>
                                <groupId>org.projectlombok</groupId>
                                <artifactId>lombok</artifactId>
                            </path>
                            <path>
                                <groupId>org.mapstruct</groupId>
                                <artifactId>mapstruct-processor</artifactId>
                                <version>${mapstruct.version}</version>
                            </path>
                        </annotationProcessorPaths>
                    </configuration>
                </plugin>

                <plugin>
                    <groupId>org.springframework.boot</groupId>
                    <artifactId>spring-boot-maven-plugin</artifactId>
                    <configuration>
                        <excludes>
                            <exclude>
                                <groupId>org.projectlombok</groupId>
                                <artifactId>lombok</artifactId>
                            </exclude>
                        </excludes>
                    </configuration>
                    <executions>
                        <execution>
                            <id>process-aot</id>
                            <goals>
                                <goal>process-aot</goal> <!-- AOT 编译预处理 -->
                            </goals>
                        </execution>
                    </executions>
                </plugin>

                <plugin>
                    <groupId>org.codehaus.mojo</groupId>
                    <artifactId>flatten-maven-plugin</artifactId>
                    <version>1.6.0</version>
                    <configuration>
                        <flattenMode>ci</flattenMode> <!-- CI 友好 POM（去除变量引用） -->
                    </configuration>
                </plugin>
            </plugins>
        </pluginManagement>
    </build>
</project>
```

### 2.2 BOM（Bill of Materials）

BOM 是 Maven 提供的版本管理机制，用于统一管理一组依赖的版本：

```xml
<!-- 创建自定义 BOM（供公司内部多个项目使用） -->
<project>
    <groupId>com.example</groupId>
    <artifactId>ai-platform-bom</artifactId>
    <version>1.0.0</version>
    <packaging>pom</packaging>

    <dependencyManagement>
        <dependencies>
            <dependency>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-starter-parent</artifactId>
                <version>4.0.0</version>
                <type>pom</type>
                <scope>import</scope>
            </dependency>
            <!-- 锁定所有 AI 相关依赖版本 -->
        </dependencies>
    </dependencyManagement>
</project>

<!-- 其他项目使用这个 BOM -->
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>com.example</groupId>
            <artifactId>ai-platform-bom</artifactId>
            <version>1.0.0</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>
```

### 2.3 聚合 vs 继承

| 机制 | 作用 | 关键标签 |
|------|------|----------|
| **聚合（Aggregation）** | 一次构建所有子模块 | `<modules>` |
| **继承（Inheritance）** | 复用 POM 配置 | `<parent>` |

两者通常结合使用：Parent POM 同时声明子模块（聚合）和提供公共配置（继承）。

---

## 三、Maven Wrapper

Maven Wrapper 确保所有开发者使用相同版本的 Maven：

```bash
# 在项目根目录执行（一次性）
mvn wrapper:wrapper -Dmaven=4.0.0

# 生成文件：
# .mvn/wrapper/maven-wrapper.properties  ← 配置 Maven 版本和下载地址
# mvnw                                    ← Unix/Mac 可执行脚本
# mvnw.cmd                                ← Windows 可执行脚本

# 之后所有构建命令使用 mvnw 代替 mvn：
./mvnw clean package
./mvnw spring-boot:run
```

---

## 四、依赖管理

### 4.1 Scope（作用域）

| Scope | 编译时 | 测试时 | 运行时 | 传递性 | 典型场景 |
|-------|--------|--------|--------|--------|----------|
| **compile**（默认） | 是 | 是 | 是 | 是 | 业务依赖 |
| **provided** | 是 | 是 | 否 | 否 | Servlet API、Lombok |
| **runtime** | 否 | 是 | 是 | 是 | JDBC 驱动 |
| **test** | 否 | 是 | 否 | 否 | JUnit、Mockito |
| **system** | 是 | 是 | 否 | 否 | 本地 jar（不推荐） |

### 4.2 Optional 依赖

```xml
<!-- 声明可选依赖：不会传递给依赖方 -->
<dependency>
    <groupId>com.example</groupId>
    <artifactId>optional-lib</artifactId>
    <optional>true</optional>
</dependency>
```

### 4.3 依赖排除

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
    <!-- 排除 Tomcat，使用 Undertow -->
    <exclusions>
        <exclusion>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-tomcat</artifactId>
        </exclusion>
    </exclusions>
</dependency>
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-undertow</artifactId>
</dependency>
```

### 4.4 依赖冲突解决

**冲突原则：最短路径优先（Nearest Wins）**

```
项目
 ├─ spring-boot-starter-web (依赖 Jackson 2.18.0)
 └─ 直接声明 jackson-databind 2.19.0

结果：使用 2.19.0（直接依赖路径更短）
```

**最佳实践：** 使用 `dependencyManagement` 显式锁定版本，并配合 `maven-enforcer-plugin` 检测冲突：

```xml
<plugin>
    <groupId>org.apache.maven.plugins</groupId>
    <artifactId>maven-enforcer-plugin</artifactId>
    <executions>
        <execution>
            <id>enforce-dependency-convergence</id>
            <goals>
                <goal>enforce</goal>
            </goals>
            <configuration>
                <rules>
                    <dependencyConvergence/> <!-- 检测依赖版本不一致 -->
                </rules>
            </configuration>
        </execution>
    </executions>
</plugin>
```

---

## 五、关键插件配置

### 5.1 spring-boot-maven-plugin（AOT 处理）

```xml
<plugin>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-maven-plugin</artifactId>
    <configuration>
        <image>
            <builder>paketobuildpacks/builder-jammy-base:latest</builder>
            <name>registry.example.com/${project.artifactId}:${project.version}</name>
        </image>
    </configuration>
    <executions>
        <execution>
            <id>process-aot</id>
            <goals>
                <goal>process-aot</goal>
            </goals>
        </execution>
    </executions>
</plugin>
```

### 5.2 flatten-maven-plugin（CI 友好 POM）

```xml
<plugin>
    <groupId>org.codehaus.mojo</groupId>
    <artifactId>flatten-maven-plugin</artifactId>
    <configuration>
        <flattenMode>ci</flattenMode>
    </configuration>
    <executions>
        <execution>
            <id>flatten</id>
            <phase>process-resources</phase>
            <goals>
                <goal>flatten</goal>
            </goals>
        </execution>
    </executions>
</plugin>
```

**作用：** 发布时生成去除了 `${revision}` 等变量引用的 `.flattened-pom.xml`，确保 CI 系统和 Maven Central 能正确解析。

---

## 六、静态分析集成

### 6.1 SpotBugs（字节码级别缺陷检测）

```xml
<plugin>
    <groupId>com.github.spotbugs</groupId>
    <artifactId>spotbugs-maven-plugin</artifactId>
    <version>${spotbugs.version}</version>
    <configuration>
        <effort>Max</effort>
        <threshold>Low</threshold>
        <failOnError>true</failOnError>
    </configuration>
    <executions>
        <execution>
            <goals>
                <goal>check</goal>
            </goals>
        </execution>
    </executions>
</plugin>
```

### 6.2 Checkstyle（代码风格检查）

```xml
<plugin>
    <groupId>org.apache.maven.plugins</groupId>
    <artifactId>maven-checkstyle-plugin</artifactId>
    <version>${checkstyle.version}</version>
    <configuration>
        <configLocation>checkstyle.xml</configLocation>
        <failsOnError>true</failsOnError>
    </configuration>
    <executions>
        <execution>
            <goals>
                <goal>check</goal>
            </goals>
        </execution>
    </executions>
</plugin>
```

### 6.3 PMD（源码级别潜在问题检测）

```xml
<plugin>
    <groupId>org.apache.maven.plugins</groupId>
    <artifactId>maven-pmd-plugin</artifactId>
    <version>${pmd.version}</version>
    <configuration>
        <rulesets>
            <ruleset>category/java/bestpractices.xml</ruleset>
            <ruleset>category/java/errorprone.xml</ruleset>
        </rulesets>
    </configuration>
</plugin>
```

---

## 七、子模块 Web 层完整 pom.xml 示例

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0
         https://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <parent>
        <groupId>com.example</groupId>
        <artifactId>ai-knowledge-platform</artifactId>
        <version>1.0.0-SNAPSHOT</version>
    </parent>

    <artifactId>ai-knowledge-web</artifactId>
    <packaging>jar</packaging>

    <dependencies>
        <!-- 内部模块 -->
        <dependency>
            <groupId>com.example</groupId>
            <artifactId>ai-knowledge-service</artifactId>
        </dependency>
        <dependency>
            <groupId>com.example</groupId>
            <artifactId>ai-knowledge-infra</artifactId>
        </dependency>

        <!-- Spring Boot Starters -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-actuator</artifactId>
        </dependency>

        <!-- 数据库（运行时依赖） -->
        <dependency>
            <groupId>org.postgresql</groupId>
            <artifactId>postgresql</artifactId>
            <scope>runtime</scope>
        </dependency>
    </dependencies>

    <build>
        <plugins>
            <plugin>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-maven-plugin</artifactId>
            </plugin>
        </plugins>
    </build>
</project>
```

---

## 常见问题

**Q: Maven 多模块中如何避免循环依赖？**
A: 1) 遵循依赖方向原则（上层依赖下层，下层不依赖上层）；2) 使用 `maven-enforcer-plugin` 的 `banCircularDependencies` 规则；3) 出现循环时，抽取公共接口到独立模块（依赖倒置）。

**Q: dependencyManagement 和 dependencies 的区别？**
A: `dependencyManagement` 只声明版本（不实际引入），子模块需要显式声明 `groupId` + `artifactId` 才会引入依赖。`dependencies` 直接引入依赖。最佳实践：版本管理放在 parent 的 `dependencyManagement` 中。

**Q: Spring Boot 项目一定要用 spring-boot-starter-parent 吗？**
A: 不必须，但强烈推荐。它预设了所有合理的默认配置（Java 版本、编码、资源过滤、插件管理）。如果公司有自己的 parent POM，可用 `spring-boot-dependencies` BOM 替代。

**Q: Maven 和 Gradle 如何选？**
A: 项目中 Maven 是主栈（Adopt）。Gradle 构建速度快（增量构建和缓存），适合超大型多模块项目，但学习成本高。默认使用 Maven。

---

## 相关条目

- [[03-SpringBoot4深度解析]]：Spring Boot 启动流程
- [[03-Jackson-MapStruct-Validator序列化与校验]]：编译期代码生成与序列化
- [[03-任务调度Quartz与XXL-JOB]]：定时任务依赖配置
- [[09-架构抽象层设计]]：AI 项目模块结构设计
