---
domain: "03-Java应用平台"
title: "Spring Security OAuth2、OIDC 与 JWT 深度解析"
status: "verified"
level: "advanced"
sources:
  - level: "L0"
    url: "https://datatracker.ietf.org/doc/html/rfc6749"
    description: "RFC 6749: The OAuth 2.0 Authorization Framework"
  - level: "L0"
    url: "https://datatracker.ietf.org/doc/html/rfc7636"
    description: "RFC 7636: Proof Key for Code Exchange (PKCE) by OAuth Public Clients"
  - level: "L0"
    url: "https://datatracker.ietf.org/doc/html/rfc7519"
    description: "RFC 7519: JSON Web Token (JWT)"
  - level: "L0"
    url: "https://openid.net/specs/openid-connect-core-1_0.html"
    description: "OpenID Connect Core 1.0 Specification"
  - level: "L1"
    url: "https://docs.spring.io/spring-security/reference/"
    description: "Spring Security 官方参考文档 — SecurityFilterChain、OAuth2、JWT、Method Security"
  - level: "L1"
    url: "https://docs.spring.io/spring-security/reference/servlet/oauth2/index.html"
    description: "Spring Security OAuth2 官方文档 — Authorization Code、Client Credentials、Resource Server"
  - level: "L2"
    url: "https://github.com/spring-projects/spring-security/tree/main/oauth2"
    description: "Spring Security 源码 — OAuth2 模块实现"
relations:
  prerequisite:
  related:
    - "03-Java应用平台/Spring核心/03-SpringBoot4深度解析"
    - "03-Java应用平台/Web与安全/03-SpringMVC与SSE流式输出"
    - "15-AI安全与治理/15-AI安全全面防护体系"
  derived: []
  contrast: []
  version-of: []
  replaces: []
tags:
  - "spring-security"
  - "oauth2"
  - "oidc"
  - "jwt"
  - "authentication"
  - "authorization"
  - "resource-server"
  - "sso"
  - "pkce"
  - "multi-tenant"
created: "2026-07-17"
updated: "2026-07-17"
---

# Spring Security OAuth2、OIDC 与 JWT 深度解析

## 概述

Spring Security 是 Java 生态中最成熟的安全框架，其 OAuth2/OIDC/JWT 模块为现代 Web 应用提供了从认证（Authentication）到授权（Authorization）的完整方案。本文深入剖析 Spring Security 的架构内核、OAuth 2.0 四种授权流程、OIDC 协议细节、JWT 生成与验证机制，并结合 Spring Boot 4.x 和 JDK 25 编写可直接运行的代码示例。

本文覆盖七大主题：(1) Spring Security 核心架构；(2) OAuth 2.0 四种授权流程与 PKCE；(3) OpenID Connect 1.0 协议；(4) JWT 全生命周期管理；(5) 方法级安全与 SpEL 表达式；(6) 资源服务器 JWT 解码与鉴权；(7) 生产级多租户与混合认证方案。

---

## 核心内容

### 一、Spring Security 核心架构

#### 1.1 SecurityFilterChain — 过滤器链模型

Spring Security 的本质是一个 servlet 过滤器链。每个 HTTP 请求经过一系列过滤器（Filter），每个过滤器负责一个安全检查维度。核心接口是 `SecurityFilterChain`，它包含一个有序的 `SecurityFilter` 列表。

Spring Security 预置了以下关键过滤器及其执行顺序：

```
ChannelProcessingFilter           (1)   — HTTPS 强制
SecurityContextPersistenceFilter  (2)   — SecurityContext 持久化/恢复
HeaderWriterFilter               (3)   — 安全响应头（X-Content-Type-Options 等）
CsrfFilter                        (4)   — CSRF 防护
LogoutFilter                      (5)   — 登出处理
OAuth2AuthorizationRequestRedirectFilter (6) — OAuth2 登录重定向到授权服务器
OAuth2LoginAuthenticationFilter   (7)   — OAuth2 登录回调处理
BearerTokenAuthenticationFilter   (8)   — Bearer Token 认证（JWT）
BasicAuthenticationFilter         (9)   — HTTP Basic 认证
RequestCacheAwareFilter           (10)  — 登录后恢复原始请求
SecurityContextHolderAwareRequestFilter (11) — 扩展 ServletRequest API
RememberMeAuthenticationFilter    (12)  — Remember-Me 认证
AnonymousAuthenticationFilter     (13)  — 匿名用户填充
ExceptionTranslationFilter        (14)  — 认证/授权异常转译（401/403）
AuthorizationFilter               (15)  — 授权决策（最核心）
```

**自定义 SecurityFilterChain 配置（Spring Boot 4.x 风格）：**

```java
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain defaultSecurityFilterChain(HttpSecurity http) throws Exception {
        http
            // 关闭 CSRF（API 服务器使用 JWT 时通常关闭）
            .csrf(csrf -> csrf.disable())
            // 无状态会话管理（REST API 不使用服务端 session）
            .sessionManagement(session ->
                session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            // 配置路由权限
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/public/**").permitAll()
                .requestMatchers("/api/admin/**").hasRole("ADMIN")
                .requestMatchers("/api/users/**").hasAnyRole("USER", "ADMIN")
                .anyRequest().authenticated()
            )
            // 配置 OAuth2 资源服务器（JWT Bearer Token）
            .oauth2ResourceServer(oauth2 -> oauth2
                .jwt(jwt -> jwt
                    .jwtAuthenticationConverter(jwtAuthenticationConverter())
                )
            );
        return http.build();
    }

    // see Section 6 for implementation
    private JwtAuthenticationConverter jwtAuthenticationConverter() {
        // ...
    }
}
```

#### 1.2 Authentication — 认证对象

`Authentication` 是 Spring Security 的核心接口，封装了认证主体的所有信息。它在认证前保存用户提交的凭证（如用户名/密码或 Bearer Token），认证后保存主体的权限信息。

```java
public interface Authentication extends Principal, Serializable {
    Collection<? extends GrantedAuthority> getAuthorities();  // 权限列表
    Object getCredentials();                                   // 凭证（密码/Token）
    Object getDetails();                                       // 额外详情（IP、UserAgent）
    Object getPrincipal();                                     // 主体（用户名/UserDetails/Jwt）
    boolean isAuthenticated();                                 // 是否已认证
    void setAuthenticated(boolean isAuthenticated);
}
```

**认证生命周期：**

```
Client Request
      │
      ▼
┌─────────────────────┐
│  AuthenticationFilter │  ← 从请求中提取凭证，构造 Authentication
│  (e.g. BearerToken   │     (此时 isAuthenticated = false)
│   AuthenticationFilter)│
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ AuthenticationManager │  ← 委托给 Provider 链
│  └─ Authentication   │
│     Provider 链       │
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ JwtAuthenticationProvider │ ← 对于 JWT: 验证签名、解析 Claims
│  (或 DaoAuthentication   │
│   Provider 等)            │
└──────────┬──────────┘
           ▼
    认证成功？
    ├─ YES ──► 返回完全填充的 Authentication（isAuthenticated = true）
    │          存入 SecurityContextHolder
    └─ NO  ──► 抛出 AuthenticationException
                ExceptionTranslationFilter 捕获 → 返回 401
```

#### 1.3 SecurityContext — 安全上下文

`SecurityContext` 保存当前线程的 `Authentication` 对象。`SecurityContextHolder` 通过 `SecurityContextHolderStrategy` 决定存储策略：

| 策略 | 说明 | 适用场景 |
|------|------|----------|
| `MODE_THREADLOCAL` | 默认策略，每个线程独立 | 同步 servlet，每个请求一个线程 |
| `MODE_INHERITABLETHREADLOCAL` | 子线程继承父线程的上下文 | 异步但需要传递上下文的场景 |
| `MODE_GLOBAL` | 全局共享（仅测试用） | 不适用生产环境 |

**在 Virtual Threads 环境下（JDK 25），`MODE_THREADLOCAL` 使用 `ScopedValue` 替代传统 `ThreadLocal`：**

```java
import java.util.concurrent.StructuredTaskScope;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;

public class ScopedValueSecurityContextDemo {

    void demonstrateContextPropagation() throws Exception {
        var context = SecurityContextHolder.getContext();

        // JDK 25 Structured Concurrency：子任务继承安全上下文
        try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
            var task1 = scope.fork(() -> {
                // SecurityContext 自动传播到 Virtual Thread
                var auth = SecurityContextHolder.getContext().getAuthentication();
                return processWithContext(auth);
            });
            scope.join().throwIfFailed();
        }
    }

    private String processWithContext(
            org.springframework.security.core.Authentication auth) {
        return "Processing for: " + auth.getName();
    }
}
```

**获取当前认证用户的常见模式：**

```java
// 方式一：在 Controller 方法参数上注入
@GetMapping("/me")
public Map<String, Object> currentUser(@AuthenticationPrincipal Jwt jwt) {
    return Map.of(
        "sub", jwt.getSubject(),
        "claims", jwt.getClaims()
    );
}

// 方式二：通过 SecurityContextHolder 静态方法获取（工具类中常用）
public static String currentUserId() {
    var auth = SecurityContextHolder.getContext().getAuthentication();
    if (auth instanceof JwtAuthenticationToken jwtAuth) {
        return jwtAuth.getToken().getSubject();
    }
    return "anonymous";
}
```

---

### 二、OAuth 2.0 授权流程与 PKCE

OAuth 2.0（RFC 6749）定义了四种授权流程（Grant Type）。下面逐一剖析流程细节和 Spring Security 实现。

#### 2.1 Authorization Code Flow（授权码流程 — 机密客户端）

最安全的授权流程，适用于有后端服务器的应用（Server-side Web Apps）。核心思想是"授权码"作为中介，令牌不经过浏览器。

```
文本流程图：

   ┌──────────┐                                    ┌──────────────────┐
   │  Browser │                                    │   Client App     │
   │ (User-Agent)│                                 │  (Spring Boot)   │
   └────┬─────┘                                    └────────┬─────────┘
        │                                                   │
        │ (1) User clicks "Login with Provider"             │
        │──────────────────────────────────────────────────►│
        │                                                   │ (2) Redirect to
        │                                                   │   Authorization Server
        │  (3) HTTP 302 Location:                           │
        │   /oauth2/authorize?                              │
        │   response_type=code&                             │
        │   client_id=myapp&                                │
        │   redirect_uri=https://app/callback&              │
        │   scope=openid+profile+email&                     │
        │   state=xcoivjuywkdkhvusuye3kch                   │
        │◄──────────────────────────────────────────────────│
        │                                                   │
        │  (4) Follow redirect to                           │
        │   Authorization Server login page                 │
        │──────────────────────────────────────►            │
        │  ┌────────────────────────────┐                   │
        │  │   Authorization Server     │                   │
        │  │   (Keycloak / Auth0 /      │                   │
        │  │    Spring Auth Server)     │                   │
        │  │                            │                   │
        │  │  (5) User authenticates    │                   │
        │  │  (6) User consents scopes  │                   │
        │  └────────────────────────────┘                   │
        │                                                   │
        │  (7) HTTP 302 Location:                           │
        │   https://app/callback?                           │
        │   code=SplxlOBeZQQYbYS6WxSbIA&                    │
        │   state=xcoivjuywkdkhvusuye3kch                   │
        │──────────────────────────────────────────────────►│
        │                                                   │ (8) Verify state
        │                                                   │ (9) Exchange code
        │                                                   │     for tokens (POST)
        │                                                   │     /oauth2/token
        │                                                   │     with client_secret
        │                                                   │ (10) Receive:
        │                                                   │ {access_token, refresh_token, id_token}
        │                                                   │ (11) Persist session
        │                                                   │ (12) Issue app cookie
        │  (13) HTTP 302 → /dashboard                       │
        │◄──────────────────────────────────────────────────│
```

**Spring Security OAuth2 Client 配置（application.yml）：**

```yaml
spring:
  security:
    oauth2:
      client:
        registration:
          keycloak:
            client-id: myapp
            client-secret: ${KEYCLOAK_CLIENT_SECRET}
            client-authentication-method: client_secret_basic
            authorization-grant-type: authorization_code
            redirect-uri: "{baseUrl}/login/oauth2/code/{registrationId}"
            scope:
              - openid
              - profile
              - email
        provider:
          keycloak:
            issuer-uri: https://auth.example.com/realms/my-realm
            authorization-uri: https://auth.example.com/realms/my-realm/protocol/openid-connect/auth
            token-uri: https://auth.example.com/realms/my-realm/protocol/openid-connect/token
            user-info-uri: https://auth.example.com/realms/my-realm/protocol/openid-connect/userinfo
            jwk-set-uri: https://auth.example.com/realms/my-realm/protocol/openid-connect/certs
```

#### 2.2 Authorization Code Flow with PKCE — 公共客户端增强

OAuth 2.0 公共客户端（SPA、移动 App）不能安全保存 `client_secret`，因此 RFC 7636 定义了 PKCE（Proof Key for Code Exchange），通过 `code_verifier` 和 `code_challenge` 防止授权码拦截攻击。

**PKCE 完整流程（文本图）：**

```
Client (SPA)                               Authorization Server
     │                                              │
     │ (1) Generate code_verifier (cryptographically random, 43-128 chars)
     │     code_verifier = base64url(random(32 bytes))
     │     e.g. "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
     │                                              │
     │ (2) Derive code_challenge from code_verifier
     │     code_challenge = base64url(SHA256(code_verifier))
     │                                              │
     │ (3) GET /authorize?                          │
     │     response_type=code&                      │
     │     client_id=spa-app&                       │
     │     code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&
     │     code_challenge_method=S256               │
     │──────────────────────────────────────────────►│
     │                                              │ (4) Authenticate user
     │                                              │ (5) Store code_challenge
     │                                              │ (6) Return auth code
     │◄─── code=abcd1234 ────────────────────────── │
     │                                              │
     │ (7) POST /token                              │
     │     grant_type=authorization_code&           │
     │     code=abcd1234&                           │
     │     code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk   │
     │──────────────────────────────────────────────►│
     │                                              │ (8) Compute SHA256(code_verifier)
     │                                              │     Compare with stored code_challenge
     │                                              │ (9) If match → return tokens
     │◄─── {access_token, refresh_token, id_token}─│
```

**PKCE 攻击防御分析：**

拦截者可获取 `code_challenge`（已在 URL 中）和授权码，但无法通过步骤 (7)，因为没有 `code_verifier`。SHA256 的单向性确保无法从 `code_challenge` 反推 `code_verifier`。

#### 2.3 Client Credentials Flow（客户端凭证流程）

用于服务间通信（Machine-to-Machine），不涉及用户交互。

```
Client App                                  Authorization Server
     │                                              │
     │ POST /oauth2/token                           │
     │   grant_type=client_credentials&              │
     │   client_id=service-a&                        │
     │   client_secret=xxx&                         │
     │   scope=read write                           │
     │──────────────────────────────────────────────►│
     │                                              │ Validate client_id/secret
     │                                              │ Issue access_token (JWT)
     │◄─── {access_token: "eyJ...", expires_in: 3600}──│
     │                                              │
     │ Use access_token for subsequent API calls    │
     │ (Authorization: Bearer eyJ...)               │
```

**Spring Security 服务间调用配置（ClientRegistration + WebClient）：**

```java
import org.springframework.security.oauth2.client.AuthorizedClientServiceReactiveOAuth2AuthorizedClientManager;
import org.springframework.security.oauth2.client.InMemoryReactiveOAuth2AuthorizedClientService;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.InMemoryReactiveClientRegistrationRepository;
import org.springframework.security.oauth2.client.web.reactive.function.client.ServerOAuth2AuthorizedClientExchangeFilterFunction;
import org.springframework.security.oauth2.core.AuthorizationGrantType;
import org.springframework.web.reactive.function.client.WebClient;

@Configuration
public class ServiceToServiceConfig {

    @Bean
    public WebClient downstreamWebClient() {
        // 定义 Client Credentials 注册信息
        var registration = ClientRegistration.withRegistrationId("downstream-api")
            .clientId("service-a")
            .clientSecret(System.getenv("SERVICE_A_SECRET"))
            .authorizationGrantType(AuthorizationGrantType.CLIENT_CREDENTIALS)
            .tokenUri("https://auth.example.com/oauth2/token")
            .scope("read", "write")
            .build();

        var clientRegistrations = new InMemoryReactiveClientRegistrationRepository(registration);
        var clientService = new InMemoryReactiveOAuth2AuthorizedClientService(clientRegistrations);
        var authorizedClientManager =
            new AuthorizedClientServiceReactiveOAuth2AuthorizedClientManager(clientRegistrations, clientService);

        // WebClient 自动获取并刷新 Bearer Token
        var oauth2Filter = new ServerOAuth2AuthorizedClientExchangeFilterFunction(authorizedClientManager);
        oauth2Filter.setDefaultClientRegistrationId("downstream-api");

        return WebClient.builder()
            .filter(oauth2Filter)
            .build();
    }

    // 使用：WebClient 自动注入 Bearer Token
    public void callDownstream() {
        var response = downstreamWebClient()
            .get()
            .uri("https://api.downstream.example.com/resource")
            .retrieve()
            .bodyToMono(String.class)
            .block();
    }
}
```

#### 2.4 Refresh Token Flow（令牌刷新）

Access Token 短期有效（通常 5-15 分钟），Refresh Token 长期有效（可配置，通常数小时到数天），用于在 Access Token 过期后获取新令牌，无需用户重新认证。

```
Client                                        Authorization Server
     │                                              │
     │ Access Token expired (HTTP 401)              │
     │                                              │
     │ POST /oauth2/token                           │
     │   grant_type=refresh_token&                   │
     │   refresh_token=tGzv3JOkF0XG5Qx2TlKWIA&      │
     │   client_id=myapp&                            │
     │   client_secret=xxx                          │
     │──────────────────────────────────────────────►│
     │                                              │ Validate refresh_token
     │                                              │ (has not expired? not revoked?)
     │                                              │
     │◄─── {access_token: NEW,                     │
     │      refresh_token: NEW_OR_SAME,              │
     │      expires_in: 3600}                        │
     │                                              │
     │ Continue with new access_token               │
```

**Refresh Token Rotation（令牌轮换）安全实践：**

每次刷新后发放新的 Refresh Token，旧的立即失效。如果攻击者使用被盗的 Refresh Token，合法用户的刷新将失败（违反时间顺序），可触发安全告警并撤销所有令牌。

---

### 三、OpenID Connect (OIDC) 协议

OIDC 是 OAuth 2.0 之上的身份认证层，核心扩展在于引入 `id_token`（JWT 格式）和 `UserInfo` 端点。

#### 3.1 ID Token 结构

`id_token` 是一个 JWT，包含关于认证用户的声明（Claims）。关键声明：

| Claim | 类型 | 说明 |
|-------|------|------|
| `iss` | string | Issuer（发行者），必须与 OIDC Provider URL 匹配 |
| `sub` | string | Subject（主体），用户在 Provider 中的唯一标识 |
| `aud` | string/array | Audience（受众），必须是 client_id |
| `exp` | number | Expiration Time（过期时间），Unix timestamp |
| `iat` | number | Issued At（签发时间） |
| `auth_time` | number | 用户认证发生的时间 |
| `nonce` | string | 防重放攻击的随机值 |
| `amr` | array | Authentication Methods References — ["pwd", "mfa", "sms"] |
| `acr` | string | Authentication Context Class Reference — 认证强度等级 |

**示例 ID Token Payload：**

```json
{
  "iss": "https://auth.example.com/realms/my-realm",
  "sub": "user-884a2f9b",
  "aud": "myapp",
  "exp": 1721234567,
  "iat": 1721230967,
  "auth_time": 1721230960,
  "nonce": "n-0S6_WzA2Mj",
  "amr": ["pwd", "otp"],
  "name": "Zhang Wei",
  "given_name": "Wei",
  "family_name": "Zhang",
  "preferred_username": "zhangwei",
  "email": "zhangwei@example.com",
  "email_verified": true
}
```

#### 3.2 UserInfo 端点

`id_token` 携带基础身份信息，更多 Claims 通过 `GET /userinfo` 端点获取（使用 Access Token 认证）。OIDC 规范定义了标准 Claims 集：

```java
// Spring Security OIDC UserInfo 响应映射
// 返回示例（JSON）:
// {
//   "sub": "user-884a2f9b",
//   "name": "Zhang Wei",
//   "email": "zhangwei@example.com",
//   "picture": "https://auth.example.com/avatars/zhangwei.jpg",
//   "profile": "https://auth.example.com/users/zhangwei",
//   "zoneinfo": "Asia/Shanghai",
//   "locale": "zh-CN",
//   "updated_at": 1721200000
// }
```

**OIDC 标准 Scope → Claims 映射：**

| Scope | 返回的 Claims |
|-------|--------------|
| `openid` | `sub`（必需） |
| `profile` | `name`, `family_name`, `given_name`, `middle_name`, `nickname`, `preferred_username`, `profile`, `picture`, `website`, `gender`, `birthdate`, `zoneinfo`, `locale`, `updated_at` |
| `email` | `email`, `email_verified` |
| `address` | `address`（结构化地址对象） |
| `phone` | `phone_number`, `phone_number_verified` |

#### 3.3 OIDC Discovery（自动发现）

OIDC Provider 在 `/.well-known/openid-configuration` 发布所有端点信息：

```
GET https://auth.example.com/.well-known/openid-configuration

{
  "issuer": "https://auth.example.com",
  "authorization_endpoint": "https://auth.example.com/oauth2/authorize",
  "token_endpoint": "https://auth.example.com/oauth2/token",
  "userinfo_endpoint": "https://auth.example.com/oauth2/userinfo",
  "jwks_uri": "https://auth.example.com/oauth2/jwks",
  "end_session_endpoint": "https://auth.example.com/oauth2/logout",
  "scopes_supported": ["openid", "profile", "email", "address", "phone"],
  "response_types_supported": ["code", "id_token", "token id_token"],
  "grant_types_supported": ["authorization_code", "client_credentials", "refresh_token"],
  "token_endpoint_auth_methods_supported": ["client_secret_basic", "private_key_jwt"],
  "id_token_signing_alg_values_supported": ["RS256", "ES256"]
}
```

Spring Security OAuth2 Client 通过 `issuer-uri` 配置即可自动发现所有端点，无需逐个手动指定。

---

### 四、JWT 全生命周期管理

#### 4.1 JWT 结构与编码

JWT 由三部分组成，以 `.` 分隔，每部分均采用 Base64URL 编码：

```
eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.                            ← Header
eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ. ← Payload
SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c                        ← Signature
```

**Header（头部）标准字段：**

```json
{
  "alg": "RS256",    // 签名算法
  "typ": "JWT",      // 令牌类型
  "kid": "2026-07-key-01"  // Key ID，用于多密钥轮换时标识签名密钥
}
```

**Payload（载荷）注册声明（RFC 7519 Section 4.1）：**

```json
{
  "iss": "https://auth.example.com",  // Issuer
  "sub": "user-884a2f9b",            // Subject
  "aud": ["api.example.com"],         // Audience (string or array)
  "exp": 1721234567,                  // Expiration Time
  "nbf": 1721230967,                  // Not Before
  "iat": 1721230967,                  // Issued At
  "jti": "unique-token-id-abc123"     // JWT ID (唯一标识，防重放)
}
```

**Signature（签名）生成公式：**

```
RS256:
  signature = RSASSA-PKCS1-V1_5-SIGN(
      SHA256(base64url(header) + "." + base64url(payload)),
      privateKey
  )

ES256:
  signature = ECDSA-SIGN(
      SHA256(base64url(header) + "." + base64url(payload)),
      privateKey
  )
```

#### 4.2 签名算法选择：RS256 vs ES256 vs HS256

| 算法 | 类型 | 密钥 | 签名长度 | 性能 | 推荐场景 |
|------|------|------|----------|------|----------|
| **RS256** | RSA + SHA-256 | 2048-bit RSA Key | ~256 bytes | 验证快（公钥），签名慢 | 生态最广泛，传统首选 |
| **ES256** | ECDSA + P-256 + SHA-256 | 256-bit EC Key | ~64 bytes | 签名/验证都快 | 推荐首选（更紧凑、更安全） |
| **EdDSA** | Ed25519 | 256-bit Key | ~64 bytes | 最快 | 下一代标准，逐步普及 |
| HS256 | HMAC + SHA-256 | ≥256-bit Shared Secret | 32 bytes | 快（对称加密） | 内部微服务，不推荐与外部共享 |

**ES256 推荐理由：** 相比 RS256，ES256 的 256-bit 密钥提供等效于 3072-bit RSA 的安全强度，签名体积更小（64 vs 256 bytes），签名和验证速度更快。Spring Security 对 ES256 和 RS256 均有原生支持。

#### 4.3 JWT 生成代码（JJWT 库 0.12.x + JDK 25 风格）

```java
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.ECPrivateKey;
import java.security.interfaces.ECPublicKey;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Date;
import java.util.UUID;

public class JwtTokenService {

    private final ECPrivateKey privateKey;
    private final ECPublicKey publicKey;
    private final String issuer = "https://auth.example.com";

    public JwtTokenService() throws Exception {
        // 生成 ES256 密钥对（生产环境应从 KMS/Vault 加载）
        var generator = KeyPairGenerator.getInstance("EC");
        generator.initialize(256);
        KeyPair keyPair = generator.generateKeyPair();
        this.privateKey = (ECPrivateKey) keyPair.getPrivate();
        this.publicKey = (ECPublicKey) keyPair.getPublic();
    }

    /** 生成 Access Token（短期，ES256 签名） */
    public String generateAccessToken(String subject, String[] roles, String tenantId) {
        var now = Instant.now();
        return Jwts.builder()
            .issuer(issuer)
            .subject(subject)
            .audience().add("api.example.com").and()
            .issuedAt(Date.from(now))
            .expiration(Date.from(now.plus(5, ChronoUnit.MINUTES)))  // 5min 短期
            .notBefore(Date.from(now))
            .id(UUID.randomUUID().toString())  // jti：防重放
            .claim("roles", roles)
            .claim("tenant_id", tenantId)
            .header()
                .keyId("2026-07-es256-key-01")  // kid：密钥标识
                .and()
            .signWith(privateKey)  // ES256 自动检测
            .compact();
    }

    /** 生成 Refresh Token（长期，更大熵值的 jti） */
    public String generateRefreshToken(String subject) {
        var now = Instant.now();
        return Jwts.builder()
            .issuer(issuer)
            .subject(subject)
            .issuedAt(Date.from(now))
            .expiration(Date.from(now.plus(24, ChronoUnit.HOURS)))  // 24h
            .id(UUID.randomUUID().toString() + "-refresh")
            .claim("token_type", "refresh")
            .signWith(privateKey)
            .compact();
    }

    /** 验证并解析 JWT */
    public JwtValidationResult validateAndParse(String token) {
        try {
            var claims = Jwts.parser()
                .verifyWith(publicKey)       // 验证签名
                .requireIssuer(issuer)       // 验证发行者
                .requireAudience("api.example.com")  // 验证受众
                .clockSkewSeconds(30)        // 允许 30 秒时钟偏差
                .build()
                .parseSignedClaims(token)
                .getPayload();

            return new JwtValidationResult(
                true,
                claims.getSubject(),
                claims.get("roles", String[].class),
                claims.get("tenant_id", String.class),
                claims.getId(),
                null
            );
        } catch (Exception e) {
            return new JwtValidationResult(false, null, null, null, null, e.getMessage());
        }
    }

    public record JwtValidationResult(
        boolean valid,
        String subject,
        String[] roles,
        String tenantId,
        String jti,
        String errorMessage
    ) {}
}
```

#### 4.4 JWT 验证流程（资源服务器端）

资源服务器（Resource Server）在收到 Bearer Token 后必须执行以下验证步骤（RFC 7519 + 安全最佳实践）：

```
验证流程图：

Receive Request: Authorization: Bearer eyJ...
        │
        ▼
┌───────────────────┐
│ 1. 解析 Header     │  ── 解码 Base64URL → 提取 alg, kid
└────────┬──────────┘
         ▼
┌───────────────────┐
│ 2. 算法白名单验证  │  ── MUST verify alg is in ["RS256", "ES256"]
│   拒绝 "none"      │     REJECT "none", "HS256" (if using RSA/EC keys)
└────────┬──────────┘
         ▼
┌───────────────────┐
│ 3. 获取签名公钥    │  ── kid → JWKS endpoint → matching public key
│   (JWKS Lookup)   │
└────────┬──────────┘
         ▼
┌───────────────────┐
│ 4. 验证签名        │  ── Verify(base64url(header.body), signature, publicKey)
│   (cryptographic) │
└────────┬──────────┘  Signature valid?
                        ├─ NO → 401 Unauthorized
                        └─ YES ↓
         ▼
┌───────────────────┐
│ 5. 验证时效性      │  ── exp > now AND (nbf == null OR nbf <= now)
│   验证 issuer      │     iss == expected issuer
│   验证 audience    │     aud contains expected audience
└────────┬──────────┘
         ▼
┌───────────────────┐
│ 6. 验证 jti 未使用 │  ── Check Redis/JDBC: jti not in used-token set
│   (防重放攻击)     │
└────────┬──────────┘
         ▼
┌───────────────────┐
│ 7. 构建 Authentication│ → JwtAuthenticationToken
│   populate SecurityContext │
└───────────────────┘
         ▼
   授权成功，继续过滤器链
```

**重要安全提示 — 算法混淆攻击防御：**

攻击者可能将 Header 中的 `alg` 从 `RS256` 改为 `HS256`，然后使用服务端的 RSA 公钥作为 HMAC 共享密钥来伪造签名。Nimbus JOSE + JWT 和 JJWT 库均已内置防御（要求 `alg` 与密钥类型匹配）。始终使用最新版本的 JWT 库。

#### 4.5 JWT 存储与传输策略

| 存储位置 | 安全性 | XSS 风险 | CSRF 风险 | 推荐 |
|----------|--------|----------|-----------|------|
| `localStorage` | 低 | 可被任意 JS 读取 | 无 | 不推荐存储 Token |
| `sessionStorage` | 中 | 可被同标签页 JS 读取 | 无 | 短期 Token 可用 |
| `HttpOnly Cookie` | 高 | JS 不可读 | 需要 CSRF 保护 | 推荐（Web 应用） |
| `Memory` (JS 闭包) | 最高 | 不可读 | 无 | 推荐（SPA） |
| `Authorization Header` | 传输中 | N/A | N/A | 推荐（API 调用） |

**BFF（Backend For Frontend）模式是生产最佳实践**：Token 存储在服务端 session 中，浏览器只持有加密的 session cookie。前端不直接接触 Access Token。

```java
// BFF Pattern: Token 存储服务端，前端仅持有 session cookie
@Controller
public class AuthController {

    // Token 存储在 Redis，按 session_id 索引
    private final StringRedisTemplate redis;

    @PostMapping("/login/callback")
    public String oauthCallback(@RequestParam String code, HttpSession session) {
        // 换取 token
        var tokens = exchangeCodeForTokens(code);
        // 将 token 存入 Redis，key = session_id
        redis.opsForValue().set(
            "session:" + session.getId() + ":access_token",
            tokens.accessToken(),
            Duration.ofMinutes(5)
        );
        redis.opsForValue().set(
            "session:" + session.getId() + ":refresh_token",
            tokens.refreshToken(),
            Duration.ofHours(24)
        );
        return "redirect:/dashboard";
    }
}
```

#### 4.6 JWT 撤销（Revocation）策略

JWT 是无状态的，标准的撤销方式有：

**(1) jti 黑名单（短期 Token 首选）：**

```java
public class JtiBlacklistRevocationService {

    private final StringRedisTemplate redis;

    /** 撤销某个 jti 的 Token（用户登出、角色变更时调用） */
    public void revoke(String jti, Date expirationTime) {
        var ttl = Duration.between(Instant.now(), expirationTime.toInstant());
        if (ttl.isPositive()) {
            // 将 jti 加入 Redis 黑名单，TTL 等于 Token 剩余有效期
            redis.opsForValue().set("jti:revoked:" + jti, "1", ttl);
        }
    }

    /** 检查 jti 是否已被撤销 */
    public boolean isRevoked(String jti) {
        return Boolean.TRUE.equals(redis.hasKey("jti:revoked:" + jti));
    }
}
```

**(2) 用户级时间戳撤销（批量撤销）：**

```java
/** 在 Token 中嵌入用户级时间戳，撤销时更新全局时间戳 */
public String generateTokenWithUserTimestamp(String userId) {
    var revokedAfter = getRevokedAfterTimestamp(userId); // 从 Redis 获取
    // ... JWT builder
    .claim("iat", now)          // Token 签发时间
    .claim("rev", revokedAfter) // 用户级撤销时间戳
    // 验证时: if (jwtIat < revokedAfter) → reject
}
```

**(3) Refresh Token 撤销：** 删除 Redis/DB 中的 Refresh Token 记录，配合短有效期 Access Token（5-15 分钟），实现近乎实时的令牌失效。

---

### 五、方法级安全与 SpEL 表达式

Spring Security Method Security 是授权控制的最后一道防线，在 Controller 或 Service 层方法上应用。

#### 5.1 启用方法安全

```java
@Configuration
@EnableMethodSecurity  // Spring Boot 4.x / Security 6.x 推荐
public class MethodSecurityConfig {
    // @EnableMethodSecurity 默认启用 @PreAuthorize, @PostAuthorize, @PreFilter, @PostFilter
}
```

#### 5.2 @PreAuthorize / @PostAuthorize 与 SpEL 表达式

```java
@RestController
@RequestMapping("/api/orders")
public class OrderController {

    // === 基础角色检查 ===
    @PreAuthorize("hasRole('ADMIN')")
    @GetMapping("/admin-dashboard")
    public String adminDashboard() {
        return "Admin Dashboard";
    }

    // === 基于参数值的授权 ===
    // 只有订单所有者或管理员可以查看
    @PreAuthorize("#orderId == authentication.principal.claims['user_id'] " +
                  "or hasRole('ADMIN')")
    @GetMapping("/{orderId}")
    public Order getOrder(@PathVariable String orderId) {
        return orderService.findById(orderId);
    }

    // === 基于返回值的授权 ===
    // 确保返回的订单属于当前用户
    @PostAuthorize("returnObject.ownerId == authentication.principal.claims['user_id']")
    @GetMapping("/details/{orderId}")
    public Order getOrderDetails(@PathVariable String orderId) {
        return orderService.findDetails(orderId);
    }

    // === 多租户授权（详见 7.2） ===
    @PreAuthorize("@tenantAccessValidator.canAccessTenant("
                  + "#tenantId, authentication)")
    @GetMapping("/tenant/{tenantId}/dashboard")
    public String tenantDashboard(@PathVariable String tenantId) {
        return "Tenant " + tenantId + " Dashboard";
    }

    // === @PreFilter / @PostFilter — 集合过滤 ===
    // 只返回属于当前租户的订单列表
    @PostFilter("filterObject.tenantId == authentication.principal.claims['tenant_id']")
    @GetMapping("/tenant/{tenantId}/orders")
    public List<Order> listOrders(@PathVariable String tenantId) {
        return orderService.findAll();
    }
}
```

#### 5.3 常用 SpEL 表达式速查

| 表达式 | 说明 |
|--------|------|
| `hasRole('ADMIN')` | 检查是否有 ROLE_ADMIN |
| `hasAnyRole('ADMIN', 'MANAGER')` | 检查是否有任一角色 |
| `hasAuthority('SCOPE_read')` | 检查是否有特定权限/scope |
| `hasAnyAuthority('read', 'write')` | 检查是否有任一权限 |
| `isAuthenticated()` | 是否已认证（非匿名） |
| `isAnonymous()` | 是否是匿名用户 |
| `isFullyAuthenticated()` | 是否完全认证（非 Remember-Me） |
| `authentication` | 当前 Authentication 对象 |
| `principal` | 当前 Principal（等同 authentication.principal） |
| `#paramName` | 方法参数值 |
| `returnObject` | 方法返回值（仅 @PostAuthorize / @PostFilter） |
| `filterObject` | 集合中当前元素（仅 @PreFilter / @PostFilter） |
| `@beanName.method(args)` | 调用 Spring Bean 的方法 |

#### 5.4 自定义 PermissionEvaluator

Spring Security 允许通过实现 `PermissionEvaluator` 接口实现基于 ACL 的复杂授权逻辑：

```java
import org.springframework.security.access.PermissionEvaluator;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Component;
import java.io.Serializable;

@Component("acl")
public class AclPermissionEvaluator implements PermissionEvaluator {

    private final AclService aclService;

    public AclPermissionEvaluator(AclService aclService) {
        this.aclService = aclService;
    }

    @Override
    public boolean hasPermission(Authentication auth, Object targetDomainObject,
                                  Object permission) {
        if (auth == null || targetDomainObject == null || !(permission instanceof String)) {
            return false;
        }
        var userId = auth.getName();
        var resourceId = targetDomainObject.toString();
        return aclService.hasPermission(userId, resourceId, (String) permission);
    }

    @Override
    public boolean hasPermission(Authentication auth, Serializable targetId,
                                  String targetType, Object permission) {
        if (auth == null || targetId == null || !(permission instanceof String)) {
            return false;
        }
        var userId = auth.getName();
        return aclService.hasPermission(userId, targetId.toString(),
                                         targetType, (String) permission);
    }
}

// 使用方式（SpEL 中引用 Bean 名 "acl"）：
// @PreAuthorize("hasPermission(#documentId, 'com.example.Document', 'DELETE')")
```

**注册 PermissionEvaluator：**

```java
@Configuration
@EnableMethodSecurity
public class MethodSecurityConfig {

    @Bean
    public static MethodSecurityExpressionHandler methodSecurityExpressionHandler(
            AclPermissionEvaluator acl) {
        var handler = new DefaultMethodSecurityExpressionHandler();
        handler.setPermissionEvaluator(acl);
        return handler;
    }
}
```

---

### 六、资源服务器 JWT 解码配置

#### 6.1 JWT Decoder 完整配置

```java
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationConverter;
import org.springframework.security.oauth2.server.resource.authentication.JwtGrantedAuthoritiesConverter;
import org.springframework.security.web.SecurityFilterChain;

import javax.crypto.spec.SecretKeySpec;
import java.util.Base64;

@Configuration
@EnableWebSecurity
@EnableMethodSecurity
public class ResourceServerConfig {

    // === 方式一：对称密钥 (HS256) — 内部微服务 ===
    @Bean
    public JwtDecoder hmacJwtDecoder() {
        var secretKey = System.getenv("JWT_SECRET_KEY");
        var keyBytes = Base64.getDecoder().decode(secretKey);
        var key = new SecretKeySpec(keyBytes, "HmacSHA256");
        return NimbusJwtDecoder.withSecretKey(key).build();
    }

    // === 方式二：非对称密钥 — JWKS 端点 (RS256/ES256) ===
    @Bean
    public JwtDecoder jwksJwtDecoder() {
        return NimbusJwtDecoder
            .withJwkSetUri("https://auth.example.com/oauth2/jwks")
            .jwsAlgorithms(algs -> algs.addAll(Set.of("RS256", "ES256")))  // 算法白名单
            .build();
    }

    // === 自定义 Authority 转换器 ===
    @Bean
    public JwtAuthenticationConverter jwtAuthenticationConverter() {
        var grantedAuthoritiesConverter = new JwtGrantedAuthoritiesConverter();
        // 默认前缀 "SCOPE_" → 改为 "ROLE_"
        grantedAuthoritiesConverter.setAuthorityPrefix("ROLE_");
        // 从 "roles" claim（而不是默认的 "scope"）提取权限
        grantedAuthoritiesConverter.setAuthoritiesClaimName("roles");

        var jwtConverter = new JwtAuthenticationConverter();
        jwtConverter.setJwtGrantedAuthoritiesConverter(grantedAuthoritiesConverter);
        return jwtConverter;
    }

    // === SecurityFilterChain ===
    @Bean
    public SecurityFilterChain resourceServerFilterChain(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf.disable())
            .sessionManagement(session ->
                session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/health", "/actuator/**").permitAll()
                .requestMatchers("/api/admin/**").hasRole("ADMIN")
                .anyRequest().authenticated()
            )
            .oauth2ResourceServer(oauth2 -> oauth2
                .jwt(jwt -> jwt
                    .decoder(jwksJwtDecoder())
                    .jwtAuthenticationConverter(jwtAuthenticationConverter())
                )
            );
        return http.build();
    }
}
```

#### 6.2 自定义 JWT 校验器（Reactive 变体）

```java
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.jwt.*;
import reactor.core.publisher.Mono;

@Configuration
public class CustomJwtValidationConfig {

    @Bean
    public ReactiveJwtDecoder customReactiveJwtDecoder() {
        var decoder = NimbusReactiveJwtDecoder
            .withJwkSetUri("https://auth.example.com/oauth2/jwks")
            .jwsAlgorithms(algs -> algs.add("ES256"))
            .build();

        // 组合多个校验器
        OAuth2TokenValidator<Jwt> audienceValidator = new JwtClaimValidator<List<String>>(
            "aud", aud -> aud != null && aud.contains("api.example.com")
        );

        OAuth2TokenValidator<Jwt> issuerValidator =
            JwtValidators.createDefaultWithIssuer("https://auth.example.com");

        var combinedValidator = new DelegatingOAuth2TokenValidator<>(
            issuerValidator, audienceValidator
        );

        decoder.setJwtValidator(combinedValidator);
        return decoder;
    }
}
```

---

### 七、常见场景

#### 7.1 SSO 单点登录

SSO（Single Sign-On）利用 OIDC Session 实现统一认证。关键配置：

```yaml
spring:
  security:
    oauth2:
      client:
        registration:
          # 主 SSO Provider
          sso-primary:
            client-id: portal
            client-secret: ${SSO_CLIENT_SECRET}
            authorization-grant-type: authorization_code
            redirect-uri: "{baseUrl}/login/oauth2/code/{registrationId}"
            scope: openid, profile, email
        provider:
          sso-primary:
            issuer-uri: https://sso.example.com
```

**多应用共享登录态架构：**

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   App A      │     │   App B      │     │   App C      │
│ (dashboard)  │     │ (reports)    │     │  (admin)     │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       │  OAuth2/OIDC       │  OAuth2/OIDC       │  OAuth2/OIDC
       │                    │                    │
       ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────┐
│              SSO Provider (Keycloak)                 │
│  ┌──────────────────────────────────────────────────┐│
│  │  Single OIDC Session (Keycloak SSO Cookie)       ││
│  │  → User authenticates once                       ││
│  │  → All apps share the same session               ││
│  │  → Logout from any app = Global Logout           ││
│  └──────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────┘
```

**全局登出（OpenID Connect RP-Initiated Logout 1.0）：**

```java
@Controller
public class LogoutController {

    @GetMapping("/logout")
    public String logout(HttpServletRequest request,
                         @Value("${spring.security.oauth2.client.provider.sso-primary.issuer-uri}")
                         String issuerUri) {
        var session = request.getSession(false);
        if (session != null) {
            session.invalidate();
        }
        // 重定向到 OIDC Provider 的 end_session_endpoint
        var logoutUrl = issuerUri
            + "/protocol/openid-connect/logout"
            + "?post_logout_redirect_uri=" + URLEncoder.encode("https://app.example.com", StandardCharsets.UTF_8)
            + "&id_token_hint=" + getLastIdToken();
        return "redirect:" + logoutUrl;
    }

    private String getLastIdToken() {
        // 从当前 SecurityContext 获取 id_token
        var auth = (OAuth2AuthenticationToken)
            SecurityContextHolder.getContext().getAuthentication();
        return auth.getPrincipal().getAttribute("id_token");
    }
}
```

#### 7.2 多租户授权

多租户场景下，JWT 中包含 `tenant_id` Claim，权限校验需要同时验证租户隔离。

**自定义租户权限校验器：**

```java
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;

@Component("tenantAuth")
public class TenantAccessValidator {

    /** 验证用户是否可以访问指定租户 */
    public boolean canAccessTenant(String requestTenantId, Authentication auth) {
        if (auth instanceof JwtAuthenticationToken jwtAuth) {
            var claims = jwtAuth.getToken().getClaims();
            var userTenantId = (String) claims.get("tenant_id");

            // 超级管理员可以跨租户访问
            var roles = (List<String>) claims.get("roles");
            if (roles != null && roles.contains("SUPER_ADMIN")) {
                return true;
            }

            // 普通用户只能访问自己的租户
            return requestTenantId.equals(userTenantId);
        }
        return false;
    }

    /** 验证资源所有权 + 租户隔离 */
    public boolean ownsResourceInTenant(String tenantId, String resourceOwnerId,
                                         Authentication auth) {
        if (!canAccessTenant(tenantId, auth)) {
            return false;
        }
        var userId = auth.getName();
        return userId.equals(resourceOwnerId);
    }
}

// 在 Controller 中使用:
// @PreAuthorize("@tenantAuth.canAccessTenant(#tenantId, authentication)")
// @PreAuthorize("@tenantAuth.ownsResourceInTenant(#tenantId, #ownerId, authentication)")
```

**JWT Claims 中嵌入租户信息的最佳实践：**

```json
{
  "sub": "user-884a2f9b",
  "tenant_id": "tenant-xyz-001",
  "tenant_ids": ["tenant-xyz-001"],      // 多租户用户 → 数组
  "tenant_role": "TENANT_ADMIN",
  "roles": ["ROLE_USER", "ROLE_MANAGER"],
  "permissions": ["order:read", "order:write", "report:read"],
  "scope": "openid profile email"
}
```

#### 7.3 API Key + JWT 混合认证

某些场景（如第三方 API 集成、IoT 设备）需要同时支持 API Key 和 JWT Bearer Token。

**自定义复合认证过滤器：**

```java
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.web.filter.OncePerRequestFilter;
import java.io.IOException;
import java.util.Base64;
import java.util.List;

public class ApiKeyAuthenticationFilter extends OncePerRequestFilter {

    private static final String API_KEY_HEADER = "X-API-Key";
    private static final String API_KEY_PREFIX = "ak_";

    private final ApiKeyService apiKeyService;

    public ApiKeyAuthenticationFilter(ApiKeyService apiKeyService) {
        this.apiKeyService = apiKeyService;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                     HttpServletResponse response,
                                     FilterChain filterChain)
            throws ServletException, IOException {

        var apiKey = request.getHeader(API_KEY_HEADER);

        // 如果请求已经通过 Bearer Token 认证，跳过 API Key 处理
        if (apiKey == null || isAlreadyBearerAuthenticated()) {
            filterChain.doFilter(request, response);
            return;
        }

        // 验证 API Key 格式
        if (!apiKey.startsWith(API_KEY_PREFIX)) {
            filterChain.doFilter(request, response);
            return;
        }

        try {
            // 解析 API Key：ak_base64(clientId:secret)
            var decoded = new String(
                Base64.getDecoder().decode(apiKey.substring(API_KEY_PREFIX.length())));
            var parts = decoded.split(":", 2);
            if (parts.length != 2) {
                filterChain.doFilter(request, response);
                return;
            }

            var clientId = parts[0];
            var secret = parts[1];

            // 验证 API Key
            var apiClient = apiKeyService.validateAndGetClient(clientId, secret);
            if (apiClient == null) {
                filterChain.doFilter(request, response);
                return;
            }

            // 构建 Authentication 对象
            var authorities = apiClient.scopes().stream()
                .map(scope -> new SimpleGrantedAuthority("SCOPE_" + scope))
                .toList();

            var auth = new UsernamePasswordAuthenticationToken(
                "apikey:" + clientId, null, authorities);
            auth.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));

            SecurityContextHolder.getContext().setAuthentication(auth);

        } catch (IllegalArgumentException e) {
            // Invalid Base64，继续过滤器链（不认证）
        }

        filterChain.doFilter(request, response);
    }

    private boolean isAlreadyBearerAuthenticated() {
        var auth = SecurityContextHolder.getContext().getAuthentication();
        return auth != null && auth.isAuthenticated()
            && auth instanceof JwtAuthenticationToken;
    }
}

// API Key 实体与服务
public record ApiClient(
    String clientId,
    String secretHash,
    java.util.List<String> scopes,
    String tenantId,
    boolean active
) {}

@Component
public class ApiKeyService {

    private final ApiClientRepository repository;
    private final PasswordEncoder passwordEncoder;

    public ApiKeyService(ApiClientRepository repository, PasswordEncoder passwordEncoder) {
        this.repository = repository;
        this.passwordEncoder = passwordEncoder;
    }

    public ApiClient validateAndGetClient(String clientId, String secret) {
        var client = repository.findByClientId(clientId);
        if (client == null || !client.active()) {
            return null;
        }
        if (!passwordEncoder.matches(secret, client.secretHash())) {
            return null;
        }
        return client;
    }
}
```

**SecurityFilterChain 注册混合过滤器：**

```java
@Bean
public SecurityFilterChain hybridAuthFilterChain(
        HttpSecurity http, ApiKeyService apiKeyService) throws Exception {
    http
        .csrf(csrf -> csrf.disable())
        .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
        // 在 Bearer Token 认证之前执行 API Key 过滤器
        .addFilterBefore(
            new ApiKeyAuthenticationFilter(apiKeyService),
            BearerTokenAuthenticationFilter.class  // 如果 Bearer 已存在则 API Key 不生效
        )
        .authorizeHttpRequests(auth -> auth
            .requestMatchers("/api/v1/public/**").permitAll()
            .requestMatchers("/api/v1/iot/**").hasAuthority("SCOPE_iot:write")  // API Key scope
            .requestMatchers("/api/v1/admin/**").hasRole("ADMIN")               // JWT role
            .anyRequest().authenticated()
        )
        .oauth2ResourceServer(oauth2 -> oauth2.jwt(Customizer.withDefaults()));
    return http.build();
}
```

**认证优先级策略：**

1. 先检查 JWT Bearer Token（`BearerTokenAuthenticationFilter`）—— 适用于浏览器/移动用户。
2. 如无 Bearer Token，检查 `X-API-Key` Header（`ApiKeyAuthenticationFilter`）—— 适用于第三方集成/IoT。
3. 两者均无时，由 `AnonymousAuthenticationFilter` 填充匿名用户。

#### 7.4 完整的 Spring Security 排障指南

| 问题 | 检查项 |
|------|--------|
| 401 Unauthorized | 检查 Token 是否过期、`iss` 是否与配置匹配、签名算法是否在白名单中 |
| 403 Forbidden | 检查 `hasRole()` 是否缺少 `ROLE_` 前缀；`hasAuthority()` 是否 scope 前缀正确 |
| JWK Set 获取失败 | 检查 `jwk-set-uri` 可访问性；Provider 是否支持 `certs` 端点 |
| Token 解析正常但权限为空 | 检查 `JwtGrantedAuthoritiesConverter` 的 Claim 名称和前缀配置 |
| CORS 错误 | 添加 `http.cors()` 配置；确保 `allowedOrigins` 包含前端域名 |
| CSRF Token 缺失 | API 服务器使用 JWT 时关闭 CSRF；SSR 应用使用 Cookie 时需要 CSRF |
| OAuth2 登录无限重定向 | 检查 `redirect-uri` 是否与 Provider 注册的一致；Cookie SameSite 设置 |

---

## 代码示例

### 完整 SecurityConfig（生产级模板）

```java
package com.example.security;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.convert.converter.Converter;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.*;
import java.util.stream.Collectors;
import java.util.stream.Stream;

@Configuration
@EnableWebSecurity
@EnableMethodSecurity
public class ProductionSecurityConfig {

    @Value("${auth.jwks-uri}")
    private String jwksUri;

    @Value("${auth.allowed-origins}")
    private String allowedOrigins;

    // ── JWT Decoder ──
    @Bean
    public JwtDecoder jwtDecoder() {
        return NimbusJwtDecoder
            .withJwkSetUri(jwksUri)
            .jwsAlgorithms(algs -> algs.addAll(List.of("RS256", "ES256")))
            .build();
    }

    // ── 自定义 JWT → Authentication 转换器 ──
    @Bean
    public Converter<Jwt, AbstractAuthenticationToken> jwtAuthenticationConverter() {
        return jwt -> {
            // 从 JWT Claims 提取权限
            var roles = extractClaimList(jwt, "roles");
            var permissions = extractClaimList(jwt, "permissions");

            var authorities = Stream.concat(
                roles.stream().map(r -> new SimpleGrantedAuthority("ROLE_" + r)),
                permissions.stream().map(SimpleGrantedAuthority::new)
            ).collect(Collectors.toUnmodifiableSet());

            return new JwtAuthenticationToken(jwt, authorities);
        };
    }

    @SuppressWarnings("unchecked")
    private List<String> extractClaimList(Jwt jwt, String claimName) {
        var claim = jwt.getClaims().get(claimName);
        if (claim instanceof List<?> list) {
            return list.stream()
                .filter(String.class::isInstance)
                .map(String.class::cast)
                .toList();
        }
        return List.of();
    }

    // ── CORS 配置 ──
    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        var configuration = new CorsConfiguration();
        configuration.setAllowedOrigins(List.of(allowedOrigins.split(",")));
        configuration.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS"));
        configuration.setAllowedHeaders(List.of("Authorization", "Content-Type", "X-API-Key"));
        configuration.setExposedHeaders(List.of("X-Request-Id"));
        configuration.setAllowCredentials(true);
        configuration.setMaxAge(3600L);

        var source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }

    // ── SecurityFilterChain ──
    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
            // CORS
            .cors(cors -> cors.configurationSource(corsConfigurationSource()))
            // CSRF — API 服务器禁用
            .csrf(csrf -> csrf.disable())
            // Session — 无状态
            .sessionManagement(session ->
                session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            // 路由授权
            .authorizeHttpRequests(auth -> auth
                .requestMatchers(
                    "/actuator/health",
                    "/actuator/info",
                    "/api/public/**"
                ).permitAll()
                .requestMatchers("/api/admin/**").hasRole("ADMIN")
                .requestMatchers("/api/tenant/{tenantId}/**")
                    .access("@tenantAuth.canAccessTenant(#tenantId, authentication)")
                .anyRequest().authenticated()
            )
            // OAuth2 资源服务器
            .oauth2ResourceServer(oauth2 -> oauth2
                .jwt(jwt -> jwt
                    .decoder(jwtDecoder())
                    .jwtAuthenticationConverter(jwtAuthenticationConverter())
                )
            );

        return http.build();
    }
}
```

### JWT Token 生成与验证测试

```java
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import javax.crypto.SecretKey;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.Date;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.*;

class JwtTokenServiceTest {

    private static SecretKey secretKey;
    private static JwtTokenService tokenService;

    @BeforeAll
    static void setUp() {
        // 生成 HS256 对称密钥用于测试
        var keyBytes = new byte[32];
        new java.security.SecureRandom().nextBytes(keyBytes);
        secretKey = Keys.hmacShaKeyFor(keyBytes);
    }

    @Test
    void shouldGenerateAndValidateToken() {
        // Given
        var now = Instant.now();
        var token = Jwts.builder()
            .issuer("test-issuer")
            .subject("user-123")
            .audience().add("test-audience").and()
            .issuedAt(Date.from(now))
            .expiration(Date.from(now.plus(5, ChronoUnit.MINUTES)))
            .id(UUID.randomUUID().toString())
            .claim("roles", new String[]{"USER", "MANAGER"})
            .claim("tenant_id", "tenant-abc")
            .signWith(secretKey)
            .compact();

        // When
        var claims = Jwts.parser()
            .verifyWith(secretKey)
            .requireIssuer("test-issuer")
            .requireAudience("test-audience")
            .build()
            .parseSignedClaims(token)
            .getPayload();

        // Then
        assertThat(claims.getSubject()).isEqualTo("user-123");
        assertThat(claims.get("roles", String[].class)).containsExactly("USER", "MANAGER");
        assertThat(claims.get("tenant_id", String.class)).isEqualTo("tenant-abc");
    }

    @Test
    void shouldRejectExpiredToken() {
        // Given: token that expired 1 hour ago
        var past = Instant.now().minus(2, ChronoUnit.HOURS);
        var token = Jwts.builder()
            .issuer("test-issuer")
            .subject("user-123")
            .issuedAt(Date.from(past))
            .expiration(Date.from(past.plus(1, ChronoUnit.HOURS)))
            .signWith(secretKey)
            .compact();

        // When/Then
        assertThatThrownBy(() ->
            Jwts.parser()
                .verifyWith(secretKey)
                .build()
                .parseSignedClaims(token)
        ).isInstanceOf(io.jsonwebtoken.ExpiredJwtException.class);
    }

    @Test
    void shouldRejectTokenWithWrongAudience() {
        var token = Jwts.builder()
            .issuer("test-issuer")
            .subject("user-123")
            .audience().add("wrong-audience").and()
            .issuedAt(new Date())
            .expiration(Date.from(Instant.now().plus(5, ChronoUnit.MINUTES)))
            .signWith(secretKey)
            .compact();

        assertThatThrownBy(() ->
            Jwts.parser()
                .verifyWith(secretKey)
                .requireAudience("expected-audience")
                .build()
                .parseSignedClaims(token)
        ).isInstanceOf(io.jsonwebtoken.security.SignatureException.class)
         .or()
         .isInstanceOf(io.jsonwebtoken.MissingClaimException.class);
    }
}
```

---

## 常见问题

**Q1: JWT 和 OAuth 2.0 的关系是什么？**

OAuth 2.0 是授权框架（框架），JWT 是令牌格式（格式）。OAuth 2.0 不规定 Access Token 的格式——可以是随机字符串、JWT 或 SAML Assertion。JWT 凭借自包含特性（Token 自身包含 Claims，无需每次查询数据库）成为最常用的 OAuth 2.0 Token 格式。

**Q2: Access Token 应该放在哪里传输？Cookie 还是 Authorization Header？**

对于 Server-side Web App（有后端），推荐使用 HttpOnly + Secure + SameSite=Strict Cookie 搭配 BFF 模式，Cookie 仅存储 session ID，Token 存在服务端（Redis）。对于 SPA 调用 REST API，使用 `Authorization: Bearer` Header 是唯一标准方式。对于移动 App，使用设备的 Secure Keystore 存储 Token。

**Q3: 什么时候用 `@PreAuthorize`，什么时候用 `@PostAuthorize`？**

`@PreAuthorize` 在方法执行前检查（默认选择），用于基于请求参数的路由级授权。`@PostAuthorize` 在方法执行后检查，用于需要基于返回值做决策的场景（如"用户只能查看自己的订单"），但要注意已被拒绝的请求仍然执行了数据库查询——考虑性能影响。

**Q4: 如何安全地存储 JWT 签名私钥？**

生产环境绝对不要将私钥硬编码或放在配置文件中。推荐方案：(1) 使用云 KMS（AWS KMS / Azure Key Vault / HashiCorp Vault）存储私钥，JWT 签名时通过 SDK 请求签名；(2) 使用硬件安全模块（HSM）；(3) 至少使用环境变量 + 文件权限 0600 保护 `keystore.jks` 或 `pkcs12` 文件。

**Q5: Refresh Token Rotation 一定会防止令牌被盗吗？**

不绝对。如果攻击者先于合法用户使用了被盗的 Refresh Token，攻击者会获取新的 Token Pair，而合法用户下次刷新失败。关键在于检测"Refresh Token 重用"——合法用户刷新失败意味着有异常，应立即触发安全事件、撤销该用户的所有 Refresh Token，并通知用户。标准规范：OAuth 2.0 Security Best Current Practice（RFC 6819 的继承者）。

---

## 相关条目

- [[03-SpringBoot4深度解析]] — Spring Core IoC/AOP 基础（前置依赖）
- [[03-SpringBoot4深度解析]] — Spring Boot 自动配置原理
- [[15-AI安全全面防护体系]] — AI 安全场景中的 OAuth2/OIDC 应用
- [[05-熔断限流与弹性设计]] — 弹性设计（与安全层协同）
- [[02-现代Java25深度解析]] — Virtual Threads（安全上下文传播）
