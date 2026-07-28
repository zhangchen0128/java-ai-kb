---
domain: 03-Java应用平台
title: Spring MVC 请求处理与 SSE 流式输出深度解析
status: draft
level: advanced
sources:
  - level: L1
    url: https://docs.spring.io/spring-framework/reference/web/webmvc.html
    description: Spring Framework 官方参考手册 — Web MVC 章节
  - level: L1
    url: https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-servlet.html
    description: Spring Framework 官方参考手册 — DispatcherServlet 章节
  - level: L2
    url: https://github.com/spring-projects/spring-framework/tree/main/spring-webmvc/src/main/java/org/springframework/web/servlet
    description: Spring Framework 源码 — DispatcherServlet 及其核心组件实现
  - level: L4
    url: https://spring.io/blog
    description: Spring 官方博客 — MVC 与 SSE 相关技术文章
  - level: L3
    description: 《Spring 实战》第6版 — Web MVC 与 REST 服务章节
relations:
  prerequisite: null
  related:
    - 03-Java应用平台/Spring核心/03-SpringBoot4深度解析
    - 03-Java应用平台/通信协议/03-WebFlux响应式编程
    - 03-Java应用平台/通信协议/03-WebSocket与gRPC通信
  contrast: null
tags:
  - spring-mvc
  - dispatcher-servlet
  - sse
  - server-sent-events
  - sse-emitter
  - controller-advice
  - exception-handling
  - virtual-threads
  - streaming
  - ai-integration
created: 2026-07-17
updated: 2026-07-17
content_type: practice
---

# Spring MVC 请求处理与 SSE 流式输出深度解析

## 概述

Spring MVC 是 Spring Framework 中构建 Web 应用的核心模块，基于 Servlet 容器实现。本文深入剖析 DispatcherServlet 的请求处理全链路，涵盖控制器参数绑定与类型转换、统一响应体包装、全局异常处理，并重点讲解 Server-Sent Events（SSE）在 AI 流式输出场景中的完整实现方案。WebFlux 作为响应式替代方案在最后做简要对比。

本文面向具备 Spring 开发经验的工程师，目标是从"会用"升级到"理解内部机制"，能够对请求处理链路进行调优和排障，并掌握利用 SSE + Virtual Threads 实现 LLM 流式响应的完整方案。

---

## 核心内容

### 一、DispatcherServlet 请求处理全链路（源码级分析）

DispatcherServlet 是整个 Spring MVC 的"前端控制器"（Front Controller）。所有 HTTP 请求都先到达它，再由它分发给具体的 Handler。理解它的内部处理流程是掌握 Spring MVC 的关键。

#### 1.1 整体架构与核心组件

DispatcherServlet 通过一系列**策略接口（Strategy Interfaces）**将请求处理拆解为可插拔的步骤：

```
HTTP Request
    │
    ▼
DispatcherServlet.doDispatch()
    │
    ├─[1] HandlerMapping      → 确定哪个 Handler 处理请求
    ├─[2] HandlerAdapter      → 用适配器模式调用 Handler
    ├─[3] HandlerInterceptor  → 前置拦截（preHandle）
    ├─[4] Handler             → 实际执行（Controller 方法）
    ├─[5] HandlerInterceptor  → 后置拦截（postHandle）
    ├─[6] ViewResolver        → 解析视图（仅 MVC 视图场景）
    ├─[7] ExceptionResolver   → 异常时触发（绕过步骤5-6）
    └─[8] HttpMessageConverter→ 读写请求/响应体（REST 场景）
```

每一个策略接口都有多个默认实现，Spring Boot 自动配置会注册最常用的一组。我们可以通过注入自定义 Bean 来扩展或替换。

#### 1.2 doDispatch() 源码级流程

以下是 DispatcherServlet 的核心方法 `doDispatch()` 的简化版源码分析（基于 Spring Framework 6.x 源码）：

```java
// DispatcherServlet.java — 核心调度方法的简化分析
protected void doDispatch(HttpServletRequest request, HttpServletResponse response) throws Exception {
    HttpServletRequest processedRequest = request;
    HandlerExecutionChain mappedHandler = null;
    boolean multipartRequestParsed = false;

    // 异步处理支持
    WebAsyncManager asyncManager = WebAsyncUtils.getAsyncManager(request);

    try {
        ModelAndView mv = null;
        Exception dispatchException = null;

        try {
            // 步骤1：检查是否为 multipart 请求，如果是则用 MultipartResolver 解析
            processedRequest = checkMultipart(request);
            multipartRequestParsed = (processedRequest != request);

            // 步骤2：通过 HandlerMapping 链确定 Handler
            // 遍历所有注册的 HandlerMapping，第一个返回非 null 的胜出
            mappedHandler = getHandler(processedRequest);
            if (mappedHandler == null) {
                noHandlerFound(processedRequest, response);  // 触发 404
                return;
            }

            // 步骤3：通过 HandlerAdapter 链找到能处理该 Handler 的适配器
            // Controller 返回各种类型（ModelAndView、@ResponseBody、String 等），
            // 每个 Adapter 只支持特定返回类型
            HandlerAdapter ha = getHandlerAdapter(mappedHandler.getHandler());

            // 步骤4：处理 Last-Modified 缓存头（GET/HEAD 请求）
            String method = request.getMethod();
            boolean isGet = HttpMethod.GET.matches(method);
            if (isGet || HttpMethod.HEAD.matches(method)) {
                long lastModified = ha.getLastModified(request, mappedHandler.getHandler());
                if (new ServletWebRequest(request, response).checkNotModified(lastModified) && isGet) {
                    return;  // 304 Not Modified
                }
            }

            // 步骤5：执行拦截器的 preHandle
            // 任何一个拦截器返回 false 则终止请求
            if (!mappedHandler.applyPreHandle(processedRequest, response)) {
                return;
            }

            // 步骤6：真正执行 Handler（Controller 方法）
            mv = ha.handle(processedRequest, response, mappedHandler.getHandler());

            // 步骤7：如果需要异步处理，直接返回（由异步线程完成后续步骤）
            if (asyncManager.isConcurrentHandlingStarted()) {
                return;
            }

            // 步骤8：如果没有 View（如 @ResponseBody 场景），应用默认视图名
            applyDefaultViewName(processedRequest, mv);

            // 步骤9：执行拦截器的 postHandle（执行在视图渲染之前）
            mappedHandler.applyPostHandle(processedRequest, response, mv);
        }
        catch (Exception ex) {
            dispatchException = ex;
        }
        catch (Throwable err) {
            dispatchException = new NestedServletException("Handler dispatch failed", err);
        }

        // 步骤10：处理分发结果（渲染视图或处理异常）
        processDispatchResult(processedRequest, response, mappedHandler, mv, dispatchException);
    }
    catch (Exception ex) {
        // 步骤11：触发拦截器的 afterCompletion（即使出错也会调用）
        triggerAfterCompletion(processedRequest, response, mappedHandler, ex);
    }
    catch (Throwable err) {
        triggerAfterCompletion(processedRequest, response, mappedHandler,
                new NestedServletException("Handler processing failed", err));
    }
    finally {
        // 步骤12：异步请求的 cleanup
        if (asyncManager.isConcurrentHandlingStarted()) {
            if (mappedHandler != null) {
                mappedHandler.applyAfterConcurrentHandlingStarted(processedRequest, response);
            }
        }
        else {
            // 清理 multipart 资源
            if (multipartRequestParsed) {
                cleanupMultipart(processedRequest);
            }
        }
    }
}
```

**关键设计要点：**

1. **HandlerMapping 策略链：** `getHandler()` 遍历所有 HandlerMapping（如 RequestMappingHandlerMapping、SimpleUrlHandlerMapping），返回第一个非 null 的 HandlerExecutionChain。Chain 中包装了 Handler 对象和所有匹配的 Interceptor。

2. **HandlerAdapter 适配器模式：** Controller 方法的返回类型千差万别——`ModelAndView`、`String`、`@ResponseBody` 注解的方法返回 POJO、`HttpEntity`、`ResponseEntity`、`Callable`、`DeferredResult` 等。每种返回类型都有对应的 Adapter，核心的 `RequestMappingHandlerAdapter` 处理 `@RequestMapping` 注解的方法。

3. **Interceptor 生命周期：** preHandle -> Handler 执行 -> postHandle -> afterCompletion（总是执行）。如果 preHandle 返回 false 或 Handler 抛出异常，postHandle 被跳过，但 afterCompletion 始终执行。这是实现横切关注点（日志、鉴权、性能监控）的标准位置。

4. **异常处理的分流：** `processDispatchResult()` 检查 dispatchException 是否为 null。如果非 null，遍历注册的 HandlerExceptionResolver（包括 @ExceptionHandler 方法和 @ControllerAdvice），找到能处理该异常的 Resolver 后调用其 `resolveException()` 方法。

#### 1.3 核心策略接口的自定义

所有策略接口都可以通过注入自定义 Bean 来替换默认实现。最常见的场景：

```java
// 自定义 HandlerMapping 示例：API 版本路由
@Configuration
public class WebMvcConfig implements WebMvcConfigurer {

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        // 自定义拦截器：请求日志 + 鉴权
        registry.addInterceptor(new LoggingInterceptor())
                .order(1)
                .addPathPatterns("/api/**")
                .excludePathPatterns("/api/health");

        registry.addInterceptor(new AuthInterceptor())
                .order(2)
                .addPathPatterns("/api/**")
                .excludePathPatterns("/api/public/**");
    }

    @Override
    public void configureHandlerExceptionResolvers(List<HandlerExceptionResolver> resolvers) {
        // 自定义异常解析器（优先级高于 @ControllerAdvice）
        resolvers.add(new CustomHandlerExceptionResolver());
    }

    @Override
    public void addFormatters(FormatterRegistry registry) {
        // 注册自定义格式化器
        registry.addFormatter(new CustomCurrencyFormatter());
    }
}
```

---

### 二、控制器：参数绑定、类型转换与校验

#### 2.1 @RestController vs @Controller

Spring MVC 提供两种控制器注解：

| 注解 | 语义 | @ResponseBody 行为 |
|------|------|--------------------|
| `@Controller` | 传统 MVC 控制器，返回视图名 | 方法上需显式标注 |
| `@RestController` | REST 控制器，返回数据 | 隐式加在所有方法上 |

`@RestController` 是一个组合注解，等价于 `@Controller + @ResponseBody`。源码如下：

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Documented
@Controller
@ResponseBody
public @interface RestController {
    @AliasFor(annotation = Controller.class)
    String value() default "";
}
```

选择指南：只要返回 JSON/XML 数据，就一定用 `@RestController`。仅在服务端渲染（Thymeleaf 等模板引擎）场景用 `@Controller`。

#### 2.2 参数绑定详解

Spring MVC 通过 `HandlerMethodArgumentResolver` 接口处理参数解析。每种参数注解都有对应的 Resolver：

**@PathVariable — 路径变量**

```java
// 单个变量
@GetMapping("/users/{userId}")
public User getUser(@PathVariable("userId") Long userId) { /* ... */ }

// Map 绑定（不推荐生产使用，精度不够）
@GetMapping("/users/{userId}/orders/{orderId}")
public Order getOrder(@PathVariable Map<String, String> pathVars) { /* ... */ }
```

底层通过 `PathVariableMethodArgumentResolver` 解析，它从 `HttpServletRequest` 的属性（key 为 `HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE`）中提取值。

**@RequestParam — 查询参数 / 表单参数**

```java
@GetMapping("/users")
public Page<User> listUsers(
        @RequestParam("page") int page,                    // 必填（默认）
        @RequestParam(value = "size", defaultValue = "20") int size,  // 可选，带默认值
        @RequestParam(required = false) String keyword,     // 可选
        @RequestParam(required = false) List<Long> ids      // 数组绑定：?ids=1&ids=2&ids=3
) { /* ... */ }
```

**@RequestBody — JSON 请求体**

```java
@PostMapping("/users")
public User createUser(@RequestBody @Valid UserCreateRequest request) {
    // HttpMessageConverter 链（默认 Jackson）将 JSON 反序列化为 Java 对象
    return userService.create(request);
}
```

底层通过 `RequestResponseBodyMethodProcessor` 解析。它遍历所有 `HttpMessageConverter`，找到第一个 `canRead()` 返回 true 的 Converter 进行反序列化。

**自定义参数解析器**

```java
// 场景：从 JWT Token 中提取当前用户信息
@Component
public class CurrentUserArgumentResolver implements HandlerMethodArgumentResolver {

    @Override
    public boolean supportsParameter(MethodParameter parameter) {
        return parameter.hasParameterAnnotation(CurrentUser.class)
                && parameter.getParameterType().equals(UserContext.class);
    }

    @Override
    public Object resolveArgument(MethodParameter parameter,
                                  ModelAndViewContainer mavContainer,
                                  NativeWebRequest webRequest,
                                  WebDataBinderFactory binderFactory) {
        var request = (HttpServletRequest) webRequest.getNativeRequest();
        var token = request.getHeader("Authorization");
        // 解析 JWT 并返回 UserContext
        return jwtService.parseToken(token);
    }
}

// 使用
@GetMapping("/profile")
public UserProfile profile(@CurrentUser UserContext user) {
    return profileService.getByUserId(user.getUserId());
}
```

#### 2.3 类型转换体系：Formatter 与 Converter

Spring 提供两层类型转换抽象：

| 接口 | 签名 | 用途 |
|------|------|------|
| `Converter<S, T>` | `T convert(S source)` | 任意类型间的单向转换，无本地化 |
| `GenericConverter` | 更灵活的版本 | 多类型转换，支持泛型 |
| `Formatter<T>` | `T parse(String, Locale)` + `String print(T, Locale)` | String <-> Object 转换，支持 I18N |
| `FormatterRegistrar` | 批量注册 Formatter | 模块化的 Formatter 注册入口 |

**Converter 示例：JSON 字符串转 POJO**

```java
@Component
public class StringToJsonNodeConverter implements Converter<String, JsonNode> {

    private final ObjectMapper objectMapper;

    public StringToJsonNodeConverter(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Override
    public JsonNode convert(String source) {
        try {
            return objectMapper.readTree(source);
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException("Invalid JSON: " + source, e);
        }
    }
}
```

**Formatter 示例：自定义枚举绑定**

```java
// 支持不区分大小写的枚举绑定
public class CaseInsensitiveEnumFormatter<T extends Enum<T>> implements Formatter<T> {

    private final Class<T> enumType;

    public CaseInsensitiveEnumFormatter(Class<T> enumType) {
        this.enumType = enumType;
    }

    @Override
    public T parse(String text, Locale locale) throws ParseException {
        for (var constant : enumType.getEnumConstants()) {
            if (constant.name().equalsIgnoreCase(text)) {
                return constant;
            }
        }
        throw new IllegalArgumentException("No enum constant " + enumType.getCanonicalName() + "." + text);
    }

    @Override
    public String print(T object, Locale locale) {
        return object.name().toLowerCase();
    }
}

// 注册（实现 FormatterRegistrar）
@Component
public class EnumFormatterRegistrar implements FormatterRegistrar {
    @Override
    public void registerFormatters(FormatterRegistry registry) {
        registry.addFormatterForFieldAnnotation(new CaseInsensitiveFormatterFactory());
    }
}
```

#### 2.4 校验：@Valid 与 @Validated

Spring MVC 在参数绑定时自动触发校验：

```java
// @Valid：JSR-380 标准（Jakarta Bean Validation）
// @Validated：Spring 扩展，支持分组校验

// 定义校验分组
public interface Create {}
public interface Update {}

public record UserCreateRequest(
        @NotBlank(message = "用户名不能为空", groups = {Create.class, Update.class})
        String username,

        @Email(message = "邮箱格式不正确")
        @NotBlank(groups = Create.class)  // 仅创建时必填
        String email,

        @Min(value = 18, message = "年龄不能小于18岁")
        @Max(value = 150, message = "年龄不能大于150岁")
        Integer age
) {}

@PostMapping("/users")
public User createUser(@RequestBody @Validated(Create.class) UserCreateRequest request) {
    // 校验失败会抛出 MethodArgumentNotValidException（由全局异常处理器统一处理）
    return userService.create(request);
}

@PutMapping("/users/{id}")
public User updateUser(@RequestBody @Validated(Update.class) UserCreateRequest request) {
    return userService.update(request);
}
```

**MethodValidation（方法级校验）：**

```java
@RestController
@Validated  // 类上必须标注
public class UserController {

    @GetMapping("/users/{id}")
    public User getUser(@PathVariable @Min(1) @Max(1000000) Long id) {
        // 参数校验失败会抛出 ConstraintViolationException
        return userService.findById(id);
    }
}
```

---

### 三、统一响应体包装与全局异常处理

在 REST API 中，前端期望统一的响应格式。Spring 提供两大利器：`ResponseBodyAdvice` 和 `@ControllerAdvice`。

#### 3.1 统一响应体：ResponseBodyAdvice

`ResponseBodyAdvice` 在所有 `HttpMessageConverter.write()` 之前被调用，可以修改响应体内容。

```java
// 统一响应体结构
public record ApiResponse<T>(
        int code,
        String message,
        T data,
        long timestamp,
        String traceId
) {
    public static <T> ApiResponse<T> success(T data) {
        return new ApiResponse<>(0, "success", data, System.currentTimeMillis(), MDC.get("traceId"));
    }

    public static <T> ApiResponse<T> error(int code, String message, T data) {
        return new ApiResponse<>(code, message, data, System.currentTimeMillis(), MDC.get("traceId"));
    }
}

// ResponseBodyAdvice 实现
@ControllerAdvice
public class ApiResponseAdvice implements ResponseBodyAdvice<Object> {

    @Override
    public boolean supports(MethodParameter returnType, Class<? extends HttpMessageConverter<?>> converterType) {
        // 跳过已经是 ApiResponse 类型或某些特殊类型
        var returnClass = returnType.getParameterType();
        return !returnClass.equals(ApiResponse.class)
                && !returnClass.equals(byte[].class)
                && !returnClass.equals(Resource.class);  // 文件下载跳过包装
    }

    @Override
    public Object beforeBodyWrite(Object body,
                                  MethodParameter returnType,
                                  MediaType selectedContentType,
                                  Class<? extends HttpMessageConverter<?>> selectedConverterType,
                                  ServerHttpRequest request,
                                  ServerHttpResponse response) {
        // 如果 Controller 返回了 String，需要特殊处理
        // 因为 StringHttpMessageConverter 只接受 String 类型
        if (body instanceof String) {
            try {
                return new ObjectMapper().writeValueAsString(ApiResponse.success(body));
            } catch (JsonProcessingException e) {
                throw new RuntimeException(e);
            }
        }
        return ApiResponse.success(body);
    }
}
```

**关键注意事项：**
- `supports()` 必须正确处理 `String` 返回类型，否则会抛出 `ClassCastException`
- 文件下载（`ResponseEntity<Resource>` 或 `byte[]`）应在 `supports()` 中排除
- SSE 流式输出应排除，因为 SSE 需要多次写入响应流

#### 3.2 全局异常处理：@ControllerAdvice + @ExceptionHandler

```java
@ControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    // 参数校验异常（@Valid）
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ApiResponse<List<FieldErrorVO>> handleValidation(MethodArgumentNotValidException ex) {
        var errors = ex.getBindingResult().getFieldErrors().stream()
                .map(fe -> new FieldErrorVO(fe.getField(), fe.getDefaultMessage()))
                .toList();
        return ApiResponse.error(400, "参数校验失败", errors);
    }

    // 方法参数校验异常（@Validated 在类上）
    @ExceptionHandler(ConstraintViolationException.class)
    public ApiResponse<String> handleConstraintViolation(ConstraintViolationException ex) {
        var messages = ex.getConstraintViolations().stream()
                .map(v -> v.getPropertyPath() + ": " + v.getMessage())
                .toList();
        return ApiResponse.error(400, "参数校验失败", String.join("; ", messages));
    }

    // 业务异常
    @ExceptionHandler(BusinessException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ApiResponse<String> handleBusiness(BusinessException ex) {
        log.warn("业务异常: {}", ex.getMessage());
        return ApiResponse.error(ex.getCode(), ex.getMessage(), null);
    }

    // HTTP 消息不可读（JSON 格式错误）
    @ExceptionHandler(HttpMessageNotReadableException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ApiResponse<String> handleNotReadable(HttpMessageNotReadableException ex) {
        return ApiResponse.error(400, "请求体格式错误: " + ex.getMessage(), null);
    }

    // 兜底异常：捕获所有未处理的异常
    @ExceptionHandler(Exception.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    public ApiResponse<String> handleAll(Exception ex) {
        log.error("未处理的异常", ex);
        return ApiResponse.error(500, "服务器内部错误", null);
    }
}

// 辅助 VO
public record FieldErrorVO(String field, String message) {}
```

**异常处理优先级机制：**
1. 优先匹配 Controller 内部定义的 `@ExceptionHandler`（就近原则）
2. 然后是同一包下的 `@ControllerAdvice`
3. 最后是全局 `@ControllerAdvice`（无 basePackages 限制）
4. 同层级中，异常类型越具体的 Handler 优先

---

### 四、SSE（Server-Sent Events）完整使用指南

SSE 是一种基于 HTTP 长连接的服务器推送技术。相比 WebSocket，它更轻量：单向（服务器->客户端）、纯文本（UTF-8 的 `text/event-stream`）、自动重连、穿透代理友好。

#### 4.1 SseEmitter 核心 API

Spring MVC 提供 `SseEmitter` 作为 SSE 的 Java 抽象：

```java
@RestController
@RequestMapping("/api/sse")
public class SseDemoController {

    // 基本使用：单条消息推送
    @GetMapping("/simple")
    public SseEmitter simpleSSE() {
        var emitter = new SseEmitter(60_000L);  // 超时 60 秒

        // 使用 Virtual Thread 执行异步任务
        Thread.ofVirtual().start(() -> {
            try {
                for (int i = 0; i < 10; i++) {
                    emitter.send(SseEmitter.event()
                            .id(String.valueOf(i))
                            .name("progress")
                            .data("Step " + i + " completed"));
                    Thread.sleep(1000);
                }
                emitter.send(SseEmitter.event()
                        .name("complete")
                        .data("DONE"));
                emitter.complete();
            } catch (Exception e) {
                emitter.completeWithError(e);
            }
        });

        return emitter;
    }

    // 事件对象的类型安全发送
    @GetMapping("/typed")
    public SseEmitter typedSSE() {
        var emitter = new SseEmitter(30_000L);

        Thread.ofVirtual().start(() -> {
            try {
                for (int i = 0; i <= 100; i += 20) {
                    emitter.send(SseEmitter.event()
                            .id(UUID.randomUUID().toString())
                            .name("task-progress")
                            .data(new ProgressEvent("task-001", i), MediaType.APPLICATION_JSON));
                    Thread.sleep(500);
                }
                emitter.complete();
            } catch (Exception e) {
                emitter.completeWithError(e);
            }
        });

        return emitter;
    }
}

public record ProgressEvent(String taskId, int percentage) {}
```

**SseEmitter 状态流转：**

```
CREATED  →  (客户端连接)  →  PROCESSING  →  completed / completedWithError / timeout
                                                         ↓
                                                   回调触发（可清理资源）
```

#### 4.2 超时处理与资源清理

SseEmitter 的超时机制是必须理解的关键点：

```java
@GetMapping("/with-timeout")
public SseEmitter sseWithTimeout() {
    // 超时参数：30 秒，单位毫秒
    var emitter = new SseEmitter(30_000L);

    // 注册超时回调
    emitter.onTimeout(() -> {
        log.warn("SSE 连接超时，emitter: {}", emitter);
        // 清理相关资源：关闭数据库连接、释放锁等
    });

    // 注册完成回调
    emitter.onCompletion(() -> {
        log.info("SSE 数据传输完成");
    });

    // 注册错误回调
    emitter.onError(throwable -> {
        log.error("SSE 传输异常", throwable);
    });

    Thread.ofVirtual().start(() -> {
        try {
            // 长时间操作：逐批查询数据并发送
            for (int batch = 0; batch < 100; batch++) {
                if (emitter.isExpired()) {
                    log.info("Emitter 已过期，停止发送");
                    return;
                }
                var batchData = simulateLongQuery(batch);
                emitter.send(SseEmitter.event()
                        .data(batchData, MediaType.APPLICATION_JSON));
                Thread.sleep(500);
            }
            emitter.complete();
        } catch (IOException e) {
            // 客户端断开连接导致 IOException
            log.info("客户端已断开连接，停止 SSE 推送");
        } catch (Exception e) {
            try {
                emitter.completeWithError(e);
            } catch (IOException ex) {
                log.error("发送错误事件失败", ex);
            }
        }
    });

    return emitter;
}
```

**重要：** 超时后 SseEmitter 会自动调用 `complete()`，并且 AsyncContext 会被释放。如果异步线程继续尝试 `send()`，会抛出 `AsyncRequestTimeoutException`。必须在发送前检查过期状态或捕获异常。

#### 4.3 客户端的 SSE 接收与自动重连

标准 SSE 客户端使用浏览器内置的 `EventSource` API（注意：`EventSource` 不支持自定义请求头，需要认证的场景用 `fetch` + 手动解析流）。

```html
<!DOCTYPE html>
<html>
<head><title>SSE Client Demo</title></head>
<body>
<div id="output"></div>
<script>
// === 方式一：EventSource（不支持自定义请求头，浏览器自动重连） ===
const eventSource = new EventSource('/api/sse/simple');

// 监听默认消息事件（没有 event: 字段的数据）
eventSource.onmessage = (event) => {
    console.log('Default event:', event.data);
};

// 监听自定义事件
eventSource.addEventListener('progress', (event) => {
    document.getElementById('output').innerHTML +=
        `<p>Progress: ${event.data} (id: ${event.lastEventId})</p>`;
});

eventSource.addEventListener('complete', (event) => {
    document.getElementById('output').innerHTML += `<p>Complete!</p>`;
    eventSource.close();  // 主动关闭连接
});

// EventSource 会在以下情况自动重连：
// 1. 连接断开（网络问题）
// 2. 服务端主动关闭连接
// 3. 每次重连间隔递增（由浏览器实现）
// 重连时浏览器自动发送 Last-Event-ID 请求头
eventSource.onerror = (event) => {
    if (eventSource.readyState === EventSource.CLOSED) {
        console.log('连接已关闭，不再重连');
    } else {
        console.log('连接错误，尝试重连...');
    }
};

// === 方式二：fetch + ReadableStream（支持自定义请求头、POST） ===
async function fetchSSE() {
    try {
        const response = await fetch('/api/ai/chat/stream', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + getToken()
            },
            body: JSON.stringify({ message: 'Hello' })
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // SSE 格式解析：事件以 \n\n 分隔
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';  // 保留不完整的最后一行

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const json = line.substring(6);
                    if (json === '[DONE]') {
                        console.log('Stream complete');
                        return;
                    }
                    const data = JSON.parse(json);
                    console.log('Received:', data);
                }
            }
        }
    } catch (error) {
        console.error('SSE fetch error:', error);
        // 手动重连逻辑
        setTimeout(() => fetchSSE(), 3000);
    }
}
</script>
</body>
</html>
```

#### 4.4 WebSocket 与 SSE 对比

| 维度 | SSE | WebSocket |
|------|-----|-----------|
| 通信方向 | 单向：服务器 -> 客户端 | 双向：全双工 |
| 协议 | HTTP/1.1 或 HTTP/2 | WebSocket 协议（ws:// / wss://） |
| 消息格式 | UTF-8 文本（`text/event-stream`） | 二进制帧或文本帧 |
| 自动重连 | 浏览器内置（EventSource） | 需要手动实现 |
| 穿透代理 | 天然兼容（基于 HTTP） | 部分代理需要配置支持 |
| 连接数限制 | HTTP/1.1 下受浏览器同域限制（通常6个），HTTP/2 无此限制 | 无同域连接数限制 |
| 消息推送性能 | 适合低频推送（< 100/s） | 适合高频、低延迟双向通信 |
| 实现复杂度 | 极低 | 中等 |
| Java API | `SseEmitter` | Spring WebSocket / WebFlux WebSocket |
| Spring 生态 | MVC 原生支持 | 需额外 starter（`spring-boot-starter-websocket`） |

**选择决策：SSE 适合以下场景 — AI 流式输出、任务进度推送、服务器日志实时推送、通知推送、实时数据面板更新。**

---

### 五、AI 场景：SSE 实现 LLM Chat Completion 流式输出（Virtual Threads）

这是 SSE 在 AI 应用中最关键的实战场景。LLM 的 Chat Completion API 通常支持两种模式：一次性返回（`stream: false`）和流式返回（`stream: true`）。流式返回使用 SSE 逐 Token 推送生成的文本，大幅降低首 Token 延迟（TTFT），提升用户体验。

#### 5.1 完整实现：Chat Completion 流式输出

以下是一个生产级的 Chat Stream Controller 实现，包含超时控制、错误处理、客户端断开感知、资源清理：

```java
@RestController
@RequestMapping("/api/ai/chat")
public class ChatStreamController {

    private static final Logger log = LoggerFactory.getLogger(ChatStreamController.class);
    private final ChatModelService chatModelService;

    // JDK 25: 使用构造器注入（无需 @Autowired）
    public ChatStreamController(ChatModelService chatModelService) {
        this.chatModelService = chatModelService;
    }

    /**
     * 流式聊天接口。
     * 客户端发起 POST 请求后，服务器通过 SSE 逐 Token 推送模型响应。
     *
     * @param request  用户消息
     * @param response HttpServletResponse，用于设置 SSE 响应头
     * @return SseEmitter
     */
    @PostMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter chatStream(@RequestBody ChatRequest request,
                                  HttpServletResponse response) {
        // 设置正确的 SSE 响应头（部分浏览器对 charset 有严格要求）
        response.setHeader("Cache-Control", "no-cache");
        response.setHeader("Connection", "keep-alive");
        response.setHeader("X-Accel-Buffering", "no");  // 禁用 nginx 缓冲
        response.setCharacterEncoding("UTF-8");

        // 超时时间设置为 5 分钟（根据模型最大生成 Token 数估算）
        // 假设 50 token/s，最大 4000 tokens = 80 秒，留足余量
        var emitter = new SseEmitter(300_000L);

        // 超时时的清理逻辑
        var cleanup = registerCleanup(emitter, request);

        // 使用 Virtual Thread 处理，不占用 Tomcat Worker 线程池
        Thread.ofVirtual()
                .name("chat-stream-" + request.conversationId())
                .start(() -> handleChatStream(emitter, request, cleanup));

        return emitter;
    }

    /**
     * 注册资源清理回调。返回一个 Runnable，在流结束时关闭资源。
     */
    private Runnable registerCleanup(SseEmitter emitter, ChatRequest request) {
        Runnable cleanup = () -> {
            log.info("清理 chat stream 资源, conversationId: {}", request.conversationId());
            // 通知模型服务取消生成、释放 Token 等
            chatModelService.cancelGeneration(request.conversationId());
        };

        emitter.onTimeout(() -> {
            log.warn("SSE timeout, conversationId: {}", request.conversationId());
            cleanup.run();
        });
        emitter.onError(e -> {
            log.error("SSE error, conversationId: {}", request.conversationId(), e);
            cleanup.run();
        });
        emitter.onCompletion(() -> {
            log.info("SSE complete, conversationId: {}", request.conversationId());
            cleanup.run();
        });

        return cleanup;
    }

    /**
     * 核心流式处理逻辑。模拟调用 LLM API 的流式接口，逐 Token 发送。
     */
    private void handleChatStream(SseEmitter emitter, ChatRequest request, Runnable cleanup) {
        try {
            // 第 1 步：保存用户消息（可以在这里做敏感词审核）
            saveUserMessage(request);

            // 第 2 步：发送会话元数据事件
            var conversationId = request.conversationId() != null
                    ? request.conversationId()
                    : UUID.randomUUID().toString();
            emitter.send(SseEmitter.event()
                    .id("1")
                    .name("metadata")
                    .data(new StreamMetadata(conversationId, "started"), MediaType.APPLICATION_JSON));

            // 第 3 步：调用模型流式 API，逐 Token 发送
            int tokenCount = 0;
            StringBuilder fullResponse = new StringBuilder();
            long eventId = 2;  // SseEmitter.event().id() 要求 String 但此处用序号

            try (var stream = chatModelService.chatStream(request)) {
                while (stream.hasNext()) {
                    // 检查客户端是否断开
                    if (emitter.isExpired()) {
                        log.info("Emitter expired, stop streaming");
                        break;
                    }

                    var token = stream.next();
                    tokenCount++;

                    // 发送 token delta 事件
                    emitter.send(SseEmitter.event()
                            .id(String.valueOf(eventId++))
                            .name("token")
                            .data(new TokenDelta(token.content(), tokenCount), MediaType.APPLICATION_JSON));

                    fullResponse.append(token.content());

                    // 可选：发送心跳保持连接（每 30 个 token 或 15 秒）
                    if (tokenCount % 30 == 0) {
                        emitter.send(SseEmitter.event()
                                .comment("heartbeat"));  // 注释事件，浏览器 JavaScript 不会触发回调
                    }
                }
            }

            // 第 4 步：发送完成事件
            var usage = new TokenUsage(tokenCount, stream.estimatedPromptTokens());
            emitter.send(SseEmitter.event()
                    .id(String.valueOf(eventId))
                    .name("done")
                    .data(usage, MediaType.APPLICATION_JSON));

            // 第 5 步：保存完整消息到数据库
            saveAssistantMessage(request, fullResponse.toString(), tokenCount);

            // 第 6 步：完成 SSE
            emitter.complete();
            log.info("Chat stream finished, conversationId: {}, tokens: {}", conversationId, tokenCount);

        } catch (IOException e) {
            // 客户端断开连接是最常见的情况
            log.info("Client disconnected, conversationId: {}", request.conversationId());
            try {
                emitter.complete();
            } catch (IOException ignored) {}
        } catch (Exception e) {
            log.error("Chat stream error, conversationId: {}", request.conversationId(), e);
            try {
                emitter.send(SseEmitter.event()
                        .name("error")
                        .data(new StreamError(e.getClass().getSimpleName(), e.getMessage())));
                emitter.completeWithError(e);
            } catch (IOException ex) {
                log.error("Failed to send error event", ex);
            }
        } finally {
            cleanup.run();
        }
    }

    // 辅助方法（简化实现）
    private void saveUserMessage(ChatRequest request) {
        // 实现：持久化用户消息到数据库
    }

    private void saveAssistantMessage(ChatRequest request, String fullResponse, int tokenCount) {
        // 实现：持久化助手回复到数据库
    }
}

// === 数据对象 ===

public record ChatRequest(
        String conversationId,
        String message,
        Map<String, Object> context
) {}

public record TokenDelta(
        String content,
        int index
) {}

public record StreamMetadata(
        String conversationId,
        String status
) {}

public record TokenUsage(
        int completionTokens,
        int promptTokens
) {}

public record StreamError(
        String type,
        String message
) {
    public static StreamError fromException(Exception e) {
        return new StreamError(e.getClass().getSimpleName(), e.getMessage());
    }
}
```

#### 5.2 ChatModelService：模拟 LLM API 流式调用

```java
@Service
public class ChatModelService {

    private static final Logger log = LoggerFactory.getLogger(ChatModelService.class);

    /**
     * 模拟调用 LLM 的流式 API。
     * 生产环境中这里会通过 OpenAI SDK、Anthropic SDK 或 Spring AI 进行实际的 API 调用。
     *
     * @param request 聊天请求
     * @return 可遍历的 Token 流，实现了 AutoCloseable 以便资源清理
     */
    public TokenStream chatStream(ChatRequest request) {
        // 生产实现：通过 Spring AI ChatClient 调用
        // var flux = chatClient.prompt()
        //         .user(request.message())
        //         .stream()
        //         .content();
        // return new FluxTokenStream(flux);

        // 演示实现：模拟延迟和 Token 生成
        return new SimulatedTokenStream(request.message());
    }

    public void cancelGeneration(String conversationId) {
        // 实现：通过模型 API 的 cancel 机制停止生成
        log.info("Cancel generation for conversation: {}", conversationId);
    }

    /**
     * Token 流接口
     */
    public interface TokenStream extends AutoCloseable, Iterator<TokenDelta> {
        boolean hasNext();
        TokenDelta next();
        int estimatedPromptTokens();
        @Override void close();
    }

    /**
     * 模拟 Token 流实现（演示用）
     */
    private static class SimulatedTokenStream implements TokenStream {
        private final List<TokenDelta> tokens;
        private int index = 0;

        SimulatedTokenStream(String prompt) {
            // 模拟模型逐 Token 生成
            this.tokens = simulateTokens(prompt);
        }

        private List<TokenDelta> simulateTokens(String prompt) {
            var words = ("根据您的问题「" + prompt + "」，我来为您详细解答。"
                    + "这是一个很复杂的问题，涉及多个方面。"
                    + "首先，我们需要理解核心概念。"
                    + "其次，在实践中需要注意以下几点。"
                    + "最后，总结一下关键要点。"
                    + "建议结合实际案例来加深理解。").split("(?<=\\S)(?=\\s)");
            var result = new ArrayList<TokenDelta>();
            for (int i = 0; i < words.length; i++) {
                result.add(new TokenDelta(words[i], i));
            }
            return result;
        }

        @Override
        public boolean hasNext() {
            // 模拟延迟 50-100ms 每个 token
            try {
                Thread.sleep(ThreadLocalRandom.current().nextLong(50, 100));
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return false;
            }
            return index < tokens.size();
        }

        @Override
        public TokenDelta next() {
            if (!hasNext()) {
                throw new NoSuchElementException();
            }
            return tokens.get(index++);
        }

        @Override
        public int estimatedPromptTokens() {
            return tokens.size() / 4;  // 粗略估算
        }

        @Override
        public void close() {
            tokens.clear();
        }
    }

    /**
     * Spring AI Reactor Flux 适配器（生产使用）
     */
    private static class FluxTokenStream implements TokenStream {
        private final Iterator<String> delegate;
        private int index = 0;
        private boolean closed = false;

        FluxTokenStream(Flux<String> flux) {
            // 阻塞式获取 Virtual Thread 场景下可使用 toIterable()
            this.delegate = flux.toIterable().iterator();
        }

        @Override
        public boolean hasNext() {
            return !closed && delegate.hasNext();
        }

        @Override
        public TokenDelta next() {
            return new TokenDelta(delegate.next(), index++);
        }

        @Override
        public int estimatedPromptTokens() { return 0; }

        @Override
        public void close() { closed = true; }
    }
}
```

#### 5.3 为什么使用 Virtual Threads 而非 WebFlux 处理 SSE

SSE 场景下，每个客户端连接需要维持一个长连接。传统 Servlet 容器（Tomcat）的 Worker 线程池有限（默认 200），如果有大量 SSE 连接，Worker 线程会很快耗尽。

Virtual Threads 从根本上解决了这个问题：
- 每个 SSE 连接绑定一个 Virtual Thread，而非平台线程
- Virtual Thread 在 `Thread.sleep()` 或阻塞 I/O 时释放底层的平台线程（Carrier Thread）
- 可以支撑数万个并发 SSE 连接而不会耗尽平台线程资源

```java
@Configuration
public class TomcatVirtualThreadConfig {

    @Bean
    public TomcatProtocolHandlerCustomizer<?> protocolHandlerVirtualThreadExecutor() {
        return protocolHandler -> {
            // 将 Tomcat 的请求处理线程池替换为 Virtual Thread Per Task Executor
            protocolHandler.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
        };
    }
}
```

此配置后，每个 HTTP 请求（包括 SSE 长连接）都在独立的 Virtual Thread 上运行。当 SSESender 线程因 `Thread.sleep()` 阻塞时，底层平台线程被释放处理其他请求。

#### 5.4 生产级注意事项汇总

1. **Nginx 缓冲问题：** 如果前端使用 Nginx 反向代理，默认会缓冲代理响应。必须添加配置：`proxy_buffering off;` 和 `proxy_cache off;`。或者在响应头中设置 `X-Accel-Buffering: no`。

2. **HTTP/2 的多路复用：** 建议升级到 HTTP/2，可以突破 HTTP/1.1 的"同域 6 个并发连接"限制，且 Header 压缩减少开销。

3. **事件 ID 的语义：** `SseEmitter.event().id()` 对应 SSE 规范的 `id:` 字段。浏览器 EventSource 将 `lastEventId` 作为重连时的 `Last-Event-ID` 请求头发送。可以利用此机制实现断点续传。

4. **SseEmitter 超时与 Tomcat 异步超时：** `SseEmitter(timeout)` 的超时需要小于 Tomcat 的 `asyncTimeout`（默认 30 秒，可配置 `spring.mvc.async.request-timeout`）。如果 Tomcat 异步超时先触发，SSE 连接的 AsyncContext 被销毁，后续 `send()` 会失败。

```yaml
# application.yml
spring:
  mvc:
    async:
      request-timeout: 300000  # 5分钟，与 SseEmitter 超时保持一致
```

5. **连接泄漏防护：** 始终在 `onTimeout`、`onError`、`onCompletion` 回调中释放资源。使用 try-with-resources 或 finally 确保模型 API 的流被关闭。

6. **监控指标：**

```java
@Component
public class SseMetrics {
    private final MeterRegistry registry;
    private final Counter activeConnections;
    private final Counter totalEvents;
    private final Counter errors;

    public SseMetrics(MeterRegistry registry) {
        this.registry = registry;
        this.activeConnections = Counter.builder("sse.connections.active").register(registry);
        this.totalEvents = Counter.builder("sse.events.total").register(registry);
        this.errors = Counter.builder("sse.errors.total").register(registry);
    }

    public void onConnectionOpen() { activeConnections.increment(); }
    public void onConnectionClose() { activeConnections.increment(-1); }
    public void onEvent() { totalEvents.increment(); }
    public void onError() { errors.increment(); }
}
```

---

### 六、WebFlux 简要对比

WebFlux 是 Spring 5 引入的响应式 Web 框架，基于 Reactor（Mono/Flux）和 Netty。在 Virtual Threads 普及之前，它是处理高并发 SSE/WebSocket 的推荐方案。

#### 6.1 Mono 与 Flux 基础

```java
@RestController
public class ReactiveSSEController {

    // Mono: 0 或 1 个元素
    @GetMapping("/reactive/user/{id}")
    public Mono<User> getUser(@PathVariable Long id) {
        return Mono.fromCallable(() -> userService.findById(id))
                .subscribeOn(Schedulers.boundedElastic());
    }

    // Flux: 0 到 N 个元素，自动以 SSE 格式序列化
    @GetMapping(value = "/reactive/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<String> streamData() {
        return Flux.interval(Duration.ofSeconds(1))
                .map(i -> "Event " + i)
                .take(10);
    }
}
```

#### 6.2 WebFlux Router Functions

```java
@Configuration
public class RouterConfig {

    @Bean
    public RouterFunction<ServerResponse> routes(UserHandler handler) {
        return RouterFunctions
                .route(GET("/api/v2/users/{id}").and(accept(APPLICATION_JSON)), handler::getUser)
                .andRoute(POST("/api/v2/users").and(accept(APPLICATION_JSON)), handler::createUser)
                .andRoute(GET("/api/v2/users/{id}/stream").and(accept(TEXT_EVENT_STREAM)), handler::streamUser);
    }
}

@Component
public class UserHandler {
    private final UserService userService;

    public UserHandler(UserService userService) {
        this.userService = userService;
    }

    public Mono<ServerResponse> getUser(ServerRequest request) {
        var id = Long.parseLong(request.pathVariable("id"));
        return userService.findById(id)
                .flatMap(user -> ServerResponse.ok().bodyValue(user))
                .switchIfEmpty(ServerResponse.notFound().build());
    }

    public Mono<ServerResponse> streamUser(ServerRequest request) {
        var flux = Flux.interval(Duration.ofMillis(500))
                .map(i -> "data-" + i)
                .take(100);
        return ServerResponse.ok()
                .contentType(MediaType.TEXT_EVENT_STREAM)
                .body(flux, String.class);
    }
}
```

#### 6.3 WebFlux vs Virtual Threads：选择指南

| 维度 | WebFlux (Reactor) | Spring MVC + Virtual Threads |
|------|-------------------|------------------------------|
| 编程模型 | 声明式、函数式、响应式 | 传统的命令式、同步式 |
| 学习曲线 | 陡峭（Mono/Flux 操作符、背压、Scheduler） | 低（传统 Thread 模型） |
| 调试体验 | 困难（堆栈跟踪被 Reactor 包装） | 正常（堆栈与传统线程一致） |
| 生态兼容性 | 需要响应式驱动（R2DBC、Reactive Redis 等） | 兼容所有传统 JDBC/JPA/Servlet 生态 |
| 并发模型 | 事件循环 + 少量线程（Netty） | Virtual Threads + 线程池（Tomcat） |
| SSE 适用性 | 原生支持（Flux 可直接返回） | 需 SseEmitter 手动管理 |
| 高并发（10000+ 连接） | 优秀（事件循环模型天然适合） | 良好（Virtual Threads 轻量，但有线程切换开销） |
| 何时选择 | (1) 已有 Reactor 技术栈 (2) 需要背压控制 (3) 极致资源利用率 | (1) 传统 Spring MVC 迁移 (2) 团队不熟悉响应式 (3) 依赖 JDBC 等阻塞 API |

**技术雷达立场（依据 `TECHNOLOGY_RADAR.md`）：**
- Spring MVC + SSE + Virtual Threads：**Adopt**（首推方案）
- WebFlux：**Trial**（实验性保留，特定场景使用）

在 99% 的企业业务场景中，Spring MVC + Virtual Threads 是在易用性、可维护性、性能之间最均衡的选择。

---

### 七、DispatcherServlet 源码补充：关键策略接口的初始化

DispatcherServlet 的核心策略接口在 `initStrategies()` 方法中初始化：

```java
// DispatcherServlet.java — initStrategies() 方法的关键逻辑
protected void initStrategies(ApplicationContext context) {
    // 1. MultipartResolver：文件上传处理器
    //    Spring Boot 自动配置 StandardServletMultipartResolver
    initMultipartResolver(context);

    // 2. LocaleResolver：国际化语言解析
    //    默认 AcceptHeaderLocaleResolver（从 Accept-Language 请求头获取）
    initLocaleResolver(context);

    // 3. ThemeResolver：主题解析（很少用到）
    initThemeResolver(context);

    // 4. HandlerMappings：处理器映射器链
    //    核心：RequestMappingHandlerMapping
    //    额外：BeanNameUrlHandlerMapping、SimpleUrlHandlerMapping、WelcomePageHandlerMapping
    initHandlerMappings(context);

    // 5. HandlerAdapters：处理器适配器链
    //    核心：RequestMappingHandlerAdapter
    //    额外：HttpRequestHandlerAdapter、SimpleControllerHandlerAdapter
    initHandlerAdapters(context);

    // 6. HandlerExceptionResolvers：异常解析器链
    //    核心：ExceptionHandlerExceptionResolver（处理 @ExceptionHandler）
    //    额外：ResponseStatusExceptionResolver、DefaultHandlerExceptionResolver
    initHandlerExceptionResolvers(context);

    // 7. RequestToViewNameTranslator：请求到视图名的默认翻译
    initRequestToViewNameTranslator(context);

    // 8. ViewResolvers：视图解析器链（REST 场景下不使用）
    initViewResolvers(context);

    // 9. FlashMapManager：Flash 属性（重定向后保持数据）
    initFlashMapManager(context);
}
```

每个 `init*` 方法遵循相同的策略模式：
1. 先从容器中按类型查找 Bean
2. 如果未找到，使用默认策略（`getDefaultStrategies()` 从 `DispatcherServlet.properties` 加载）
3. 如果未找到任何实现，记录日志但不中断启动

`DispatcherServlet.properties` 位于 spring-webmvc jar 的 `org/springframework/web/servlet/` 目录下，定义了所有策略接口的默认实现类。

---

## 常见问题

**Q1：`@ResponseBody` 方法的返回值是怎么变成 JSON 的？**

`RequestMappingHandlerAdapter` 在处理返回值时，发现方法标注了 `@ResponseBody` 或类标注了 `@RestController`，会使用 `RequestResponseBodyMethodProcessor` 处理返回值。该类遍历所有 `HttpMessageConverter`（默认包括 `MappingJackson2HttpMessageConverter`），找到第一个 `canWrite()` 返回 true 的 Converter，调用其 `write()` 方法将对象序列化为 JSON 写入响应体。

**Q2：拦截器（Interceptor）和过滤器（Filter）有什么区别？**

| 维度 | Filter | HandlerInterceptor |
|------|--------|--------------------|
| 规范 | Servlet 规范 | Spring MVC 框架 |
| 作用范围 | 所有请求 | 仅进入 DispatcherServlet 的请求 |
| 能力 | 可修改请求/响应 | 可访问 Handler（Controller 方法信息） |
| 生命周期 | init → doFilter → destroy | preHandle → postHandle → afterCompletion |

Filter 用于横切关注点（编码、CORS、XSS 防御）；Interceptor 用于应用逻辑（鉴权、日志、性能监控）。Filter 无法知道当前请求会被哪个 Controller 方法处理，而 Interceptor 可以。

**Q3：SseEmitter 的并发限制是多少？**

理论上，使用 Virtual Threads + 合理配置 Tomcat `asyncTimeout` 后，单个 Tomcat 实例可以支撑数万并发 SSE 连接。实际限制通常来自操作系统文件描述符数量（`ulimit -n`）和网络带宽。每个 SSE 连接是一个 TCP 长连接，占用一个文件描述符。

**Q4：为什么 EventSource 不支持 POST？**

`EventSource` 是 W3C 规范定义的浏览器 API，设计上只支持 GET 请求，目的是简单、安全地订阅服务器事件。复杂场景（POST、自定义请求头）应使用 `fetch` API + `ReadableStream` 手动解析 SSE 流。

**Q5：如何实现 SSE 的断点续传？**

利用 SSE 的 `id:` 字段机制。服务端为每条消息设置递增的 ID，客户端断开重连时浏览器自动发送 `Last-Event-ID` 请求头。服务端读取此头，从对应 ID 之后的事件开始重新推送。

```java
@GetMapping("/resumable-sse")
public SseEmitter resumableSSE(@RequestHeader(value = "Last-Event-ID", defaultValue = "0") long lastEventId) {
    var emitter = new SseEmitter(60_000L);
    Thread.ofVirtual().start(() -> {
        try {
            // 从 lastEventId 之后的事件开始发送
            var events = eventStore.getEventsAfter(lastEventId);
            for (var event : events) {
                emitter.send(event.toSseEvent());
            }
            emitter.complete();
        } catch (Exception e) {
            emitter.completeWithError(e);
        }
    });
    return emitter;
}
```

---

## 相关条目

- [[03-SpringBoot4深度解析]] — Spring Boot 自动配置如何装配 DispatcherServlet
- [[02-现代Java25深度解析]] — Virtual Threads 深度解析
- [[02-现代Java25深度解析]] — WebFlux 与 Virtual Threads 的选型对比
- [[08-OpenAI兼容协议详解]] — OpenAI 兼容协议与流式响应事件模型
- [[09-SpringAI2深度解析]] — Spring AI ChatClient 流式调用
