---
domain: 03-Java应用平台
title: Jackson-MapStruct-Validator序列化与校验
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
    url: https://github.com/FasterXML/jackson-docs
    description: Jackson Official Documentation — ObjectMapper, annotations, serialization/deserialization
  - level: L1
    url: https://mapstruct.org/documentation/stable/reference/html/
    description: MapStruct Reference Guide — @Mapper, @Mapping, Spring integration
  - level: L1
    url: https://docs.jboss.org/hibernate/stable/validator/reference/en-US/html_single/
    description: Hibernate Validator Reference — Bean Validation 3.0 (Jakarta Validation)
  - level: L2
    url: https://github.com/FasterXML/jackson-core
    description: Jackson source code — ObjectMapper, serializers, deserializers
relations:
  prerequisite:
    - 03-SpringBoot4深度解析
    - 02-反射与模块化系统
  related:
    - 03-Maven多模块工程实践
    - 03-SpringMVC与SSE流式输出
tags:
  - jackson
  - mapstruct
  - bean-validation
  - serialization
  - deserialization
  - json-schema
  - dto
  - objectmapper
created: 2026-07-20
updated: 2026-07-20
content_type: practice
---

# Jackson、MapStruct、Validator 序列化与校验

## 概述

JSON 序列化（Jackson）、对象转换（MapStruct）和 Bean 校验（Hibernate Validator）是 Java 后端日常开发中最高频使用的三个基础设施。三者看似独立，但在 DTO 设计、API 交互、AI 工具参数处理等场景中紧密协同。

本文以 JDK 25 + Spring Boot 4.x 为核心技术栈，深入讲解 Jackson 的核心配置和高级用法（包括 AI 场景中的 JSON Schema 自动生成）、MapStruct 的映射转换、Bean Validation 的校验体系，以及三者在实际项目中的协同模式。

---

## 一、Jackson 核心

### 1.1 ObjectMapper 配置

Spring Boot 4.x 自动配置了 `ObjectMapper`，但生产环境需要根据需求自定义：

```java
@Configuration
public class JacksonConfig {

    @Bean
    public Jackson2ObjectMapperBuilderCustomizer jacksonCustomizer() {
        return builder -> {
            // 基本配置
            builder.featuresToEnable(
                SerializationFeature.INDENT_OUTPUT,          // 开发环境：格式化输出
                DeserializationFeature.ACCEPT_SINGLE_VALUE_AS_ARRAY // 兼容单值和数组
            );
            builder.featuresToDisable(
                SerializationFeature.WRITE_DATES_AS_TIMESTAMPS, // 日期用 ISO-8601 字符串
                DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, // 忽略未知字段（生产环境推荐）
                SerializationFeature.FAIL_ON_EMPTY_BEANS        // 允许空 Bean 序列化
            );

            // 日期格式
            builder.dateFormat(new StdDateFormat());
            // Java 8 时间模块（Spring Boot 自动注册）
            builder.modules(new JavaTimeModule());

            // 属性命名策略
            builder.propertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);
        };
    }
}
```

### 1.2 核心注解

```java
public class UserDto {

    @JsonProperty("user_id") // JSON 字段名映射
    private Long id;

    @JsonIgnore // 完全忽略此字段
    private String password;

    @JsonInclude(JsonInclude.Include.NON_NULL) // null 时不序列化
    private String nickname;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "Asia/Shanghai")
    private LocalDateTime createdAt;

    @JsonAlias({"email_address", "mail"}) // 反序列化时的别名
    private String email;

    @JsonIgnoreProperties(ignoreUnknown = true) // 类级别：忽略未知字段
    public class NestedObject { /* ... */ }
}
```

### 1.3 自定义序列化器与反序列化器

```java
// 自定义序列化器：敏感信息脱敏
public class PhoneMaskSerializer extends StdSerializer<String> {

    public PhoneMaskSerializer() {
        super(String.class);
    }

    @Override
    public void serialize(String value, JsonGenerator gen, SerializerProvider provider)
            throws IOException {
        if (value == null || value.length() < 7) {
            gen.writeString(value);
        } else {
            // 脱敏：138****5678
            gen.writeString(value.substring(0, 3) + "****" + value.substring(7));
        }
    }
}

// 自定义反序列化器：字符串转枚举（兼容大小写）
public class CaseInsensitiveEnumDeserializer extends StdDeserializer<UserStatus> {

    public CaseInsensitiveEnumDeserializer() {
        super(UserStatus.class);
    }

    @Override
    public UserStatus deserialize(JsonParser p, DeserializationContext ctx)
            throws IOException {
        var value = p.getValueAsString();
        return Arrays.stream(UserStatus.values())
            .filter(e -> e.name().equalsIgnoreCase(value))
            .findFirst()
            .orElseThrow(() -> new IllegalArgumentException("Unknown status: " + value));
    }
}

// 使用
public class UserDto {
    @JsonSerialize(using = PhoneMaskSerializer.class)
    private String phone;

    @JsonDeserialize(using = CaseInsensitiveEnumDeserializer.class)
    private UserStatus status;
}
```

### 1.4 多态处理（@JsonTypeInfo）

AI 工具调用场景中，不同工具的参数结构不同，多态序列化是关键：

```java
// 工具调用请求基类
@JsonTypeInfo(
    use = JsonTypeInfo.Id.NAME,
    include = JsonTypeInfo.As.PROPERTY,
    property = "tool_type" // 类型标识字段
)
@JsonSubTypes({
    @JsonSubTypes.Type(value = WebSearchTool.class, name = "web_search"),
    @JsonSubTypes.Type(value = DatabaseQueryTool.class, name = "database_query"),
    @JsonSubTypes.Type(value = FileReadTool.class, name = "file_read")
})
public abstract class ToolCall {
    private String toolName;
    // ...
}

public class WebSearchTool extends ToolCall {
    private String query;
    private int maxResults;
}

public class DatabaseQueryTool extends ToolCall {
    private String sql;
    private String database;
}

// 序列化结果（根据实际类型自动添加 tool_type）：
// {"tool_type": "web_search", "toolName": "search", "query": "Java AI", "maxResults": 10}
```

### 1.5 JSON Schema 生成（AI 场景）

在 AI Tool Calling 中，需要根据 Java 类自动生成 JSON Schema 供模型理解工具参数：

```java
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.module.jsonSchema.JsonSchemaGenerator;

public class ToolSchemaGenerator {

    private final ObjectMapper mapper;
    private final JsonSchemaGenerator schemaGenerator;

    public ToolSchemaGenerator() {
        this.mapper = new ObjectMapper();
        this.schemaGenerator = new JsonSchemaGenerator(mapper);
    }

    // 从 Java 类自动生成 JSON Schema
    public String generateSchema(Class<?> toolClass) throws Exception {
        var schema = schemaGenerator.generateSchema(toolClass);
        return mapper.writerWithDefaultPrettyPrinter()
            .writeValueAsString(schema);
    }

    // 从方法参数生成 OpenAI Function Calling 格式的 schema
    public Map<String, Object> generateFunctionSchema(Method method) {
        var schema = new LinkedHashMap<String, Object>();
        schema.put("type", "object");

        var properties = new LinkedHashMap<String, Object>();
        var required = new ArrayList<String>();

        for (var param : method.getParameters()) {
            var paramSchema = new LinkedHashMap<String, Object>();
            var paramType = mapJavaToJsonType(param.getType());
            paramSchema.put("type", paramType);

            // 提取注解描述
            if (param.isAnnotationPresent(Description.class)) {
                paramSchema.put("description", param.getAnnotation(Description.class).value());
            }

            properties.put(param.getName(), paramSchema);

            if (param.isAnnotationPresent(NotNull.class) ||
                param.isAnnotationPresent(NotBlank.class)) {
                required.add(param.getName());
            }
        }

        schema.put("properties", properties);
        if (!required.isEmpty()) {
            schema.put("required", required);
        }
        return schema;
    }

    private String mapJavaToJsonType(Class<?> type) {
        if (type == String.class) return "string";
        if (type == int.class || type == long.class || type == Integer.class || type == Long.class)
            return "integer";
        if (type == double.class || type == float.class || type == Double.class || type == Float.class)
            return "number";
        if (type == boolean.class || type == Boolean.class) return "boolean";
        if (type.isArray() || Collection.class.isAssignableFrom(type)) return "array";
        return "object";
    }
}

// 使用：为 Tool 方法生成 JSON Schema
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.PARAMETER)
@interface Description {
    String value();
}

class WebSearchTool {
    public String search(
        @Description("搜索关键词") String query,
        @Description("最大返回结果数") int limit) {
        // ...
    }
}
```

### 1.6 Structured Output 序列化

AI 的 Structured Output（结构化输出）要求将模型输出严格反序列化为 Java 对象：

```java
// Spring AI 中的 Structured Output
public record WeatherInfo(
    @JsonProperty("city") String city,
    @JsonProperty("temperature") double temperature,
    @JsonProperty("condition") String condition,
    @JsonProperty("humidity") int humidity
) {}

// Jackson 反序列化模型输出
var mapper = new ObjectMapper()
    .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
var weather = mapper.readValue(modelOutput, WeatherInfo.class);
```

---

## 二、MapStruct

### 2.1 基础映射

```java
// Entity
@Entity
public class User {
    private Long id;
    private String name;
    private String email;
    private String password;
    private LocalDateTime createdAt;
}

// DTO
public record UserDto(
    Long id,
    String name,
    String email,
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    LocalDateTime createdAt
) {}

// MapStruct Mapper
@Mapper(componentModel = "spring") // 注册为 Spring Bean
public interface UserMapper {

    UserMapper INSTANCE = Mappers.getMapper(UserMapper.class);

    // 字段名相同自动映射
    UserDto toDto(User user);

    // 字段名不同需要显式映射
    @Mapping(source = "name", target = "fullName")
    @Mapping(source = "email", target = "contactEmail")
    @Mapping(target = "password", ignore = true) // 忽略敏感字段
    UserDetailDto toDetailDto(User user);

    // 日期格式化
    @Mapping(source = "createdAt", target = "createTime",
             dateFormat = "yyyy-MM-dd HH:mm:ss")
    UserDto toDtoWithFormat(User user);
}
```

### 2.2 嵌套映射与表达式

```java
public record OrderEntity(Long id, UserEntity user, List<OrderItemEntity> items,
                          BigDecimal totalAmount, OrderStatus status) {}

public record OrderDto(Long orderId, String userName, int itemCount,
                       String totalAmount, String statusCode) {}

@Mapper(componentModel = "spring")
public interface OrderMapper {

    @Mapping(source = "id", target = "orderId")
    @Mapping(source = "user.name", target = "userName") // 嵌套属性访问
    @Mapping(source = "items", target = "itemCount",
             qualifiedByName = "countItems")
    @Mapping(target = "totalAmount",
             expression = "java(order.totalAmount().toPlainString())") // Java 表达式
    @Mapping(source = "status", target = "statusCode",
             qualifiedByName = "statusToString")
    OrderDto toDto(OrderEntity order);

    @Named("countItems")
    default int countItems(List<OrderItemEntity> items) {
        return items == null ? 0 : items.size();
    }

    @Named("statusToString")
    default String statusToString(OrderStatus status) {
        return status.name();
    }
}
```

### 2.3 @AfterMapping / @BeforeMapping

```java
@Mapper(componentModel = "spring")
public abstract class UserMapper {

    @Mapping(source = "firstName", target = "firstName")
    @Mapping(source = "lastName", target = "lastName")
    public abstract UserDto toDto(UserEntity entity);

    @AfterMapping // 映射完成后执行
    protected void enrichDto(UserEntity entity, @MappingTarget UserDto.UserDtoBuilder dto) {
        // 组合全名
        dto.fullName(entity.getFirstName() + " " + entity.getLastName());
        // 从外部服务获取额外信息
        dto.departmentName(departmentService.getDepartmentName(entity.getDepartmentId()));
    }

    @BeforeMapping // 映射前执行
    protected void validateSource(UserEntity entity) {
        if (entity.getEmail() == null) {
            throw new IllegalArgumentException("Email is required");
        }
    }

    @Autowired
    private DepartmentService departmentService;
}
```

### 2.4 MapStruct vs BeanUtils vs 手动转换

| 方案 | 性能 | 类型安全 | 编译检查 | 适用场景 |
|------|------|----------|----------|----------|
| **MapStruct** | 最高（编译期生成，纯 getter/setter） | 编译时检查 | 是 | 所有场景（推荐） |
| **Spring BeanUtils** | 低（反射） | 运行时检查 | 否 | 简单场景 |
| **手动转换** | 最高 | 编译时检查 | 是 | 字段极少且不需要复用 |
| **Jackson convertValue** | 低（序列化+反序列化） | 运行时检查 | 否 | 不推荐 |

**MapStruct 性能优势：** 生成的代码是纯 Java getter/setter 调用，零反射开销，比 BeanUtils 快 10-20 倍，比 Jackson convertValue 快 5-10 倍。

---

## 三、Hibernate Validator（Bean Validation）

### 3.1 内置约束注解

```java
public class CreateUserRequest {

    @NotNull(message = "用户名不能为空")
    @Size(min = 2, max = 50, message = "用户名长度必须在 2-50 之间")
    private String username;

    @NotBlank(message = "邮箱不能为空")
    @Email(message = "邮箱格式不正确")
    private String email;

    @NotNull
    @Min(value = 18, message = "年龄必须 >= 18")
    @Max(value = 120, message = "年龄必须 <= 120")
    private Integer age;

    @NotNull
    @Pattern(regexp = "^1[3-9]\\d{9}$", message = "手机号格式不正确")
    private String phone;

    @NotEmpty(message = "角色列表不能为空")
    private List<@Valid Role> roles; // 级联校验（嵌套对象也校验）

    @Positive(message = "金额必须为正数")
    @Digits(integer = 10, fraction = 2, message = "金额整数位最多10位，小数位最多2位")
    private BigDecimal amount;

    @Future(message = "日期必须在未来")
    private LocalDate dueDate;
}
```

### 3.2 自定义 Validator

```java
// 自定义约束注解
@Target({ElementType.FIELD, ElementType.PARAMETER})
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = EnumValueValidator.class)
public @interface EnumValue {
    String message() default "值不在允许的枚举范围内";
    Class<?>[] groups() default {};
    Class<? extends Payload>[] payload() default {};
    Class<? extends Enum<?>> enumClass();
    String[] allowedValues() default {};
}

// 约束校验器
public class EnumValueValidator implements ConstraintValidator<EnumValue, String> {

    private Set<String> allowedValues;

    @Override
    public void initialize(EnumValue annotation) {
        if (annotation.allowedValues().length > 0) {
            allowedValues = Set.of(annotation.allowedValues());
        } else {
            allowedValues = Arrays.stream(annotation.enumClass().getEnumConstants())
                .map(Enum::name)
                .collect(Collectors.toSet());
        }
    }

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        return value == null || allowedValues.contains(value);
    }
}

// 使用
public class UpdateRequest {
    @EnumValue(enumClass = UserStatus.class, message = "无效的用户状态")
    private String status;
}
```

### 3.3 分组校验（Groups）

```java
// 分组接口
public interface Create {}
public interface Update {}

public class UserDto {
    @NotNull(groups = Update.class) // 仅在更新时校验
    private Long id;

    @NotBlank(groups = {Create.class, Update.class})
    private String name;
}

// Controller 中使用
@PostMapping
public Result create(@Validated(Create.class) @RequestBody UserDto dto) { /* ... */ }

@PutMapping("/{id}")
public Result update(@Validated(Update.class) @RequestBody UserDto dto) { /* ... */ }
```

### 3.4 方法级校验

```java
@Service
@Validated // 开启方法级校验
public class UserService {

    public User createUser(
        @NotNull @Valid UserDto dto,
        @NotBlank String operatorId) { // 方法参数校验
        // ...
        return user;
    }

    public @NotNull User findById(@Positive Long id) { // 返回值校验
        return userRepository.findById(id).orElse(null);
        // 如果返回 null，会抛出 ConstraintViolationException
    }
}
```

### 3.5 DTO 校验模式

**Controller 层校验（推荐）：**
```java
@PostMapping("/users")
public ResponseEntity<?> createUser(@Valid @RequestBody CreateUserRequest request) {
    // @Valid 触发校验，失败时抛出 MethodArgumentNotValidException
    // 通过全局异常处理器统一返回 400 错误
    return ResponseEntity.ok(userService.createUser(request));
}

@ControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> handleValidation(MethodArgumentNotValidException ex) {
        var errors = ex.getBindingResult().getFieldErrors().stream()
            .map(e -> e.getField() + ": " + e.getDefaultMessage())
            .toList();
        return ResponseEntity.badRequest().body(new ErrorResponse("VALIDATION_FAILED", errors));
    }
}
```

**Service 层校验（补充，用于非 Web 场景）：**
```java
@Service
@Validated
public class UserService {
    public void process(@Valid UserDto dto) {
        // 被异步消息、定时任务调用时，Service 层也需要校验
    }
}
```

---

## 常见问题

**Q: Jackson 的 ObjectMapper 是全局单例，如何针对特定接口自定义配置？**
A: 不要修改全局 ObjectMapper。使用 `@JsonView` 控制不同接口的字段可见性，或创建专用的 DTO 类。

**Q: MapStruct 如何映射继承关系？**
A: 使用 `@MapperConfig` 共享配置，父类映射方法用 `@InheritConfiguration` 或显式调用 `@Mapping(target = "...", ignore = true)`。

**Q: 校验失败时如何返回结构化错误？**
A: 使用全局异常处理器捕获 `MethodArgumentNotValidException` 和 `ConstraintViolationException`，提取字段级错误构造统一响应。

**Q: @Valid 和 @Validated 的区别？**
A: `@Valid` 是 JSR-303 标准注解，`@Validated` 是 Spring 的扩展，支持分组校验和方法级校验。Controller 参数校验两者都可用，Service 方法级校验必须用 `@Validated`。

**Q: MapStruct 性能比 BeanUtils 好多少？**
A: MapStruct 编译期生成纯 Java 代码，零反射开销。JMH 基准测试中，MapStruct 比 Spring BeanUtils 快 10-20 倍，比 Jackson convertValue 快 5-10 倍。

---

## 相关条目

- [[03-Maven多模块工程实践]]：MapStruct 的 Maven 编译配置
- [[03-SpringMVC与SSE流式输出]]：Controller 层校验与 JSON 响应
- [[12-ToolCalling完整剖析]]：AI Tool 的 JSON Schema 生成
- [[08-OpenAI兼容协议详解]]：Structured Output 与 JSON Schema
