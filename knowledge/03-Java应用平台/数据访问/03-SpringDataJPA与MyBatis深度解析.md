---
domain: 03-Java应用平台
title: Spring Data JPA与MyBatis深度解析
status: draft
level: intermediate
sources:
  - level: L1
    url: https://docs.spring.io/spring-data/jpa/reference/
    description: Spring Data JPA Reference Documentation
  - level: L1
    url: https://mybatis.org/mybatis-3/
    description: MyBatis 3 Official Documentation
  - level: L2
    url: https://github.com/spring-projects/spring-data-jpa
    description: Spring Data JPA source code
  - level: L3
    url: https://www.manning.com/books/java-persistence-with-spring-data-and-hibernate
    description: Java Persistence with Spring Data and Hibernate
relations:
  prerequisite:
    - 03-Spring核心IoC-AOP-事务
    - 01-数据库原理
  related:
    - 03-SpringBoot4深度解析
tags:
  - jpa
  - hibernate
  - mybatis
  - mybatis-plus
  - spring-data-jpa
  - n+1
  - jpql
  - criteria
  - entity-graph
  - repository
created: 2026-07-20
updated: 2026-07-20
content_type: practice
---

# Spring Data JPA 与 MyBatis 深度解析

## 概述

数据持久化是 Java 后端的核心战场。Spring Data JPA（基于 Hibernate）和 MyBatis（及其增强工具 MyBatis-Plus）代表了 Java 持久层的两大流派：**ORM 自动映射**与**SQL 显式控制**。

本文从 JPA 实体映射、关系管理、N+1 问题、Spring Data Repository 模式，到 MyBatis XML Mapper、动态 SQL、MyBatis-Plus 条件构造器，全面对比两种方案的适用场景，并提供可运行的代码示例（JDK 25 + Spring Boot 4.x）。

---

## 一、JPA 核心

### 1.1 Entity 映射

```java
@Entity
@Table(name = "users", indexes = {
    @Index(name = "idx_email", columnList = "email", unique = true)
})
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY) // 自增主键
    private Long id;

    @Column(nullable = false, length = 100)
    private String name;

    @Column(nullable = false, unique = true, length = 200)
    private String email;

    @Enumerated(EnumType.STRING) // 枚举存储为字符串，而非序数
    @Column(nullable = false)
    private UserStatus status;

    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    // 生命周期回调
    @PrePersist
    void prePersist() {
        this.createdAt = LocalDateTime.now();
        this.updatedAt = this.createdAt;
    }

    @PreUpdate
    void preUpdate() {
        this.updatedAt = LocalDateTime.now();
    }
}
```

### 1.2 关系映射

```java
// 一对多：一个用户有多个订单
@Entity
public class User {
    @OneToMany(mappedBy = "user", cascade = CascadeType.ALL, orphanRemoval = true,
               fetch = FetchType.LAZY) // 默认 LAZY
    private List<Order> orders = new ArrayList<>();

    // 辅助方法：维护双向关系
    public void addOrder(Order order) {
        orders.add(order);
        order.setUser(this);
    }
}

// 多对一：多个订单属于一个用户
@Entity
public class Order {
    @ManyToOne(fetch = FetchType.LAZY) // 多对一默认 EAGER！必须改为 LAZY
    @JoinColumn(name = "user_id", nullable = false)
    private User user;
}

// 多对多：用户和角色
@Entity
public class User {
    @ManyToMany
    @JoinTable(
        name = "user_roles",
        joinColumns = @JoinColumn(name = "user_id"),
        inverseJoinColumns = @JoinColumn(name = "role_id")
    )
    private Set<Role> roles = new HashSet<>();
}
```

**关键注意事项：**
- `@OneToMany` 和 `@ManyToMany` 默认 LAZY
- `@ManyToOne` 和 `@OneToOne` **默认 EAGER！** 这是最常见的性能陷阱，务必显式设置 `fetch = FetchType.LAZY`
- 级联操作（CascadeType）：PERSIST（级联保存）、MERGE（级联更新）、REMOVE（级联删除）、ALL（包含所有）

### 1.3 FetchType：LAZY vs EAGER

| 策略 | 加载时机 | SQL 数量 | 风险 |
|------|----------|----------|------|
| LAZY（推荐） | 首次访问关联属性时 | 按需追加 | 需要事务上下文（LazyInitializationException） |
| EAGER | 立即加载（JOIN 或额外 SELECT） | 1 + N（JOIN） | N+1 问题、笛卡尔积 |

**LazyInitializationException 解决方案：**
1. 在 Service 层（有事务）完成关联数据的加载
2. 使用 DTO 投影，明确查询哪些字段
3. 在 Controller 层使用 `OpenSessionInViewFilter`（不推荐生产环境）

### 1.4 级联操作

```java
// Persist：保存用户时自动保存关联订单
cascade = CascadeType.PERSIST

// Remove：删除用户时自动删除关联订单（配合 orphanRemoval）
cascade = CascadeType.REMOVE
orphanRemoval = true // 从集合中移除订单时，自动删除数据库记录

// 不做级联删除的安全做法：使用软删除
@SQLDelete(sql = "UPDATE orders SET deleted = true WHERE id = ?")
@Where(clause = "deleted = false") // Hibernate 6+ 改用 @SoftDelete
```

---

## 二、N+1 问题：原因与解决方案

### 2.1 问题演示

```java
// 查询所有用户（1 条 SQL）
List<User> users = userRepository.findAll(); // SELECT * FROM users

// 遍历用户获取订单（N 条 SQL！）
for (var user : users) {
    System.out.println(user.getOrders().size()); // 每个 user 触发一次 SELECT
}
// 总共：1 + N 条 SQL
```

### 2.2 解决方案一：@EntityGraph

```java
// 方案1：在 Repository 方法上直接声明
public interface UserRepository extends JpaRepository<User, Long> {

    @EntityGraph(attributePaths = {"orders", "roles"})
    List<User> findAll(); // 生成的 SQL 使用 LEFT JOIN FETCH

    @EntityGraph(attributePaths = {"orders"})
    Optional<User> findById(Long id);
}

// 方案2：在 Entity 上定义命名 EntityGraph
@NamedEntityGraph(
    name = "User.withOrders",
    attributeNodes = @NamedAttributeNode("orders")
)
@Entity
public class User { /* ... */ }

// 使用时引用
@EntityGraph("User.withOrders")
List<User> findAll();
```

### 2.3 解决方案二：JOIN FETCH

```java
// JPQL JOIN FETCH
@Query("SELECT DISTINCT u FROM User u LEFT JOIN FETCH u.orders WHERE u.status = :status")
List<User> findUsersWithOrders(@Param("status") UserStatus status);
```

### 2.4 解决方案三：Batch Size

```java
@Entity
public class User {
    @BatchSize(size = 50) // 一次加载 50 个关联对象
    @OneToMany(mappedBy = "user")
    private List<Order> orders;
}

// 全局配置（application.yml）
// spring.jpa.properties.hibernate.default_batch_fetch_size: 50
```

---

## 三、JPQL 与 Criteria

### 3.1 JPQL 语法

```java
// 基本查询
@Query("SELECT u FROM User u WHERE u.email = :email")
Optional<User> findByEmail(@Param("email") String email);

// 投影查询（返回 DTO）
public record UserSummary(Long id, String name, String email) {}

@Query("SELECT new com.example.dto.UserSummary(u.id, u.name, u.email) " +
       "FROM User u WHERE u.status = :status")
List<UserSummary> findSummariesByStatus(@Param("status") UserStatus status);

// 更新查询
@Modifying
@Query("UPDATE User u SET u.status = :status WHERE u.lastLoginAt < :threshold")
int deactivateInactiveUsers(@Param("status") UserStatus status,
                            @Param("threshold") LocalDateTime threshold);
```

### 3.2 CriteriaBuilder 动态查询

```java
@Repository
public class UserSearchRepository {

    @PersistenceContext
    private EntityManager em;

    public List<User> searchUsers(String name, UserStatus status, LocalDate fromDate) {
        var cb = em.getCriteriaBuilder();
        var query = cb.createQuery(User.class);
        var root = query.from(User.class);

        var predicates = new ArrayList<Predicate>();

        if (name != null && !name.isBlank()) {
            predicates.add(cb.like(root.get("name"), "%" + name + "%"));
        }
        if (status != null) {
            predicates.add(cb.equal(root.get("status"), status));
        }
        if (fromDate != null) {
            predicates.add(cb.greaterThanOrEqualTo(
                root.get("createdAt"), fromDate.atStartOfDay()));
        }

        query.where(predicates.toArray(new Predicate[0]));
        return em.createQuery(query).getResultList();
    }
}
```

### 3.3 Specification 模式（Spring Data JPA）

```java
// 更优雅的动态查询方式
import org.springframework.data.jpa.domain.Specification;

public class UserSpecifications {
    public static Specification<User> nameContains(String name) {
        return (root, query, cb) ->
            name == null ? null : cb.like(root.get("name"), "%" + name + "%");
    }

    public static Specification<User> hasStatus(UserStatus status) {
        return (root, query, cb) ->
            status == null ? null : cb.equal(root.get("status"), status);
    }
}

// 使用
public interface UserRepository extends JpaRepository<User, Long>,
                                          JpaSpecificationExecutor<User> {}

// 组合多种条件
var spec = Specification
    .where(UserSpecifications.nameContains("zhang"))
    .and(UserSpecifications.hasStatus(UserStatus.ACTIVE));
List<User> users = userRepository.findAll(spec);
```

---

## 四、Spring Data JPA 核心功能

### 4.1 Auditing 审计

```java
@Configuration
@EnableJpaAuditing
public class JpaConfig {}

@Entity
@EntityListeners(AuditingEntityListener.class)
public class User {
    @CreatedDate
    private LocalDateTime createdAt;

    @LastModifiedDate
    private LocalDateTime updatedAt;

    @CreatedBy
    private String createdBy;

    @LastModifiedBy
    private String lastModifiedBy;
}

// 配合 AuditorAware
@Component
public class AuditorAwareImpl implements AuditorAware<String> {
    @Override
    public Optional<String> getCurrentAuditor() {
        // 从 SecurityContext 或请求上下文中获取当前用户
        return Optional.of(SecurityContextHolder.getContext()
            .getAuthentication().getName());
    }
}
```

### 4.2 分页与排序

```java
// 分页查询
Page<User> page = userRepository.findAll(PageRequest.of(0, 20,
    Sort.by(Sort.Direction.DESC, "createdAt")));

System.out.println("Total pages: " + page.getTotalPages());
System.out.println("Total elements: " + page.getTotalElements());

// Slice：不查询总数，更高效（适合无限滚动）
Slice<User> slice = userRepository.findByStatus(
    UserStatus.ACTIVE, PageRequest.of(0, 20));
while (slice.hasNext()) {
    slice = userRepository.findByStatus(
        UserStatus.ACTIVE, slice.nextPageable());
    slice.getContent().forEach(System.out::println);
}
```

---

## 五、MyBatis

### 5.1 XML Mapper

```xml
<!-- UserMapper.xml -->
<mapper namespace="com.example.mapper.UserMapper">

    <!-- ResultMap：字段映射 -->
    <resultMap id="userResultMap" type="com.example.entity.User">
        <id property="id" column="id"/>
        <result property="name" column="name"/>
        <result property="email" column="email"/>
        <result property="createdAt" column="created_at"/>
        <!-- 一对多关联 -->
        <collection property="orders" ofType="com.example.entity.Order"
                    select="com.example.mapper.OrderMapper.findByUserId"
                    column="id"/>
    </resultMap>

    <!-- 动态查询 -->
    <select id="findByCondition" resultMap="userResultMap">
        SELECT * FROM users
        <where>
            <if test="name != null and name != ''">
                AND name LIKE CONCAT('%', #{name}, '%')
            </if>
            <if test="status != null">
                AND status = #{status}
            </if>
            <if test="ids != null and ids.size() > 0">
                AND id IN
                <foreach collection="ids" item="id" open="(" separator="," close=")">
                    #{id}
                </foreach>
            </if>
        </where>
        ORDER BY created_at DESC
    </select>

    <!-- 批量插入 -->
    <insert id="batchInsert">
        INSERT INTO users (name, email, status, created_at) VALUES
        <foreach collection="users" item="user" separator=",">
            (#{user.name}, #{user.email}, #{user.status}, #{user.createdAt})
        </foreach>
    </insert>

</mapper>
```

### 5.2 动态 SQL 标签

| 标签 | 功能 | 示例场景 |
|------|------|----------|
| `<if>` | 条件判断 | 搜索筛选条件 |
| `<choose>/<when>/<otherwise>` | 多条件选择 | 按不同字段排序 |
| `<foreach>` | 遍历集合 | IN 查询、批量插入 |
| `<where>` | 自动处理 WHERE 和 AND/OR | 动态查询条件拼接 |
| `<set>` | 自动处理 SET 和逗号 | 动态更新字段 |
| `<trim>` | 自定义截断前缀/后缀 | 复杂 SQL 生成 |
| `<bind>` | 创建变量 | OGNL 表达式预处理 |

### 5.3 注解方式

```java
@Mapper
public interface UserMapper {

    @Select("SELECT * FROM users WHERE id = #{id}")
    User findById(Long id);

    @Select("SELECT * FROM users WHERE email = #{email}")
    @Results({
        @Result(property = "createdAt", column = "created_at"),
        @Result(property = "orders", column = "id",
                many = @Many(select = "com.example.mapper.OrderMapper.findByUserId"))
    })
    User findByEmail(String email);

    @Insert("INSERT INTO users(name, email, status, created_at) " +
            "VALUES(#{name}, #{email}, #{status}, #{createdAt})")
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int insert(User user);
}
```

### 5.4 Plugin 拦截器

MyBatis Plugin 可以实现分页、审计、SQL 监控等功能：

```java
// 自定义 SQL 监控拦截器
@Intercepts({
    @Signature(type = StatementHandler.class, method = "prepare",
               args = {Connection.class, Integer.class})
})
public class SqlMonitorInterceptor implements Interceptor {

    @Override
    public Object intercept(Invocation invocation) throws Throwable {
        var statementHandler = (StatementHandler) invocation.getTarget();
        var sql = statementHandler.getBoundSql().getSql();
        var start = System.nanoTime();
        try {
            return invocation.proceed();
        } finally {
            var elapsed = (System.nanoTime() - start) / 1_000_000;
            System.out.printf("[SQL] %s (took %dms)%n",
                sql.replaceAll("\\s+", " ").trim(), elapsed);
        }
    }
}
```

---

## 六、MyBatis-Plus

### 6.1 BaseMapper

```java
@Mapper
public interface UserMapper extends BaseMapper<User> {
    // 无需写任何 SQL，自动获得 CRUD 方法：
    // insert(), deleteById(), updateById(), selectById(), selectList(), selectPage()
}
```

### 6.2 条件构造器

```java
@Service
public class UserService {

    @Autowired
    private UserMapper userMapper;

    // LambdaQueryWrapper：类型安全，避免字段名硬编码
    public List<User> searchUsers(String keyword) {
        return userMapper.selectList(
            new LambdaQueryWrapper<User>()
                .like(StringUtils.hasText(keyword), User::getName, keyword)
                .or()
                .like(StringUtils.hasText(keyword), User::getEmail, keyword)
                .eq(User::getStatus, UserStatus.ACTIVE)
                .orderByDesc(User::getCreatedAt)
        );
    }

    // 分页查询
    public Page<User> pageUsers(int pageNum, int pageSize) {
        return userMapper.selectPage(
            new Page<>(pageNum, pageSize),
            new LambdaQueryWrapper<User>()
                .eq(User::getStatus, UserStatus.ACTIVE)
        );
    }
}
```

### 6.3 自动填充

```java
@Component
public class MetaObjectHandler implements com.baomidou.mybatisplus.core.handlers.MetaObjectHandler {

    @Override
    public void insertFill(MetaObject metaObject) {
        this.strictInsertFill(metaObject, "createdAt", LocalDateTime.class, LocalDateTime.now());
        this.strictInsertFill(metaObject, "updatedAt", LocalDateTime.class, LocalDateTime.now());
    }

    @Override
    public void updateFill(MetaObject metaObject) {
        this.strictUpdateFill(metaObject, "updatedAt", LocalDateTime.class, LocalDateTime.now());
    }
}

@Entity
public class User {
    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;
}
```

---

## 七、JPA vs MyBatis 选型

| 维度 | Spring Data JPA | MyBatis / MyBatis-Plus |
|------|----------------|------------------------|
| **学习曲线** | 较陡（Hibernate 生态复杂） | 平缓（写 SQL 即可） |
| **标准 CRUD** | Spring Data Repository 方法命名自动生成 SQL | MyBatis-Plus BaseMapper 自动提供 |
| **复杂查询** | JPQL/Criteria（语法受限） | 原生 SQL（灵活、可控） |
| **多表关联** | Entity 关系映射 + @EntityGraph | 手写 JOIN SQL |
| **动态查询** | Specification / CriteriaBuilder | 动态 SQL 标签（更灵活） |
| **性能调优** | Hibernate 缓存/N+1 需要理解框架行为 | SQL 层面直接控制，更透明 |
| **数据库迁移** | Hibernate ddl-auto（开发便利） | Flyway / Liquibase（推荐） |
| **适用场景** | 标准 CRUD + 简单查询 + 少量关联 | 复杂报表 + 动态 SQL + 多表关联 + 存储过程 |

**推荐策略：** 在一个项目中同时使用两者——JPA 处理简单 CRUD，MyBatis 处理复杂查询。通过不同的包名和 Mapper 路径区分。

---

## 常见问题

**Q: N+1 问题如何系统性排查？**
A: 1) 开启 Hibernate SQL 日志：`spring.jpa.show-sql=true`；2) 使用 `hibernate.default_batch_fetch_size=50` 全局缓解；3) Datadog/NewRelic 等 APM 工具监控 SQL 数量。

**Q: JPA 的一级缓存和二级缓存是什么？**
A: 一级缓存（Session 级别）：同一事务内，相同 ID 的查询不会重复访问数据库（默认开启）。二级缓存（SessionFactory 级别）：跨事务共享，需要显式配置（Redis/Caffeine 等缓存提供者）。

**Q: MyBatis 中 # 和 $ 的区别？**
A: `#{}`是预编译占位符（防止 SQL 注入），`${}`是字符串拼接（存在 SQL 注入风险）。除非用于动态表名/列名，始终使用 `#{}`。

**Q: 多数据源场景如何配置？**
A: Spring Boot 通过 `@Primary` 标注主数据源，自定义 `DataSource`、`EntityManagerFactory`、`TransactionManager` Bean。MyBatis 通过 `@MapperScan` 指定不同包名的 `sqlSessionFactoryRef`。

---

## 相关条目

- [[03-Spring核心IoC-AOP-事务]]：事务管理
- [[03-SpringBoot4深度解析]]：自动配置
- [[04-PostgreSQL与pgvector深度解析]]：数据库选型
- [[01-数据库原理]]：索引与查询优化
