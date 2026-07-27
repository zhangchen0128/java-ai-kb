---
domain: "06-云原生与SRE"
title: "Docker 与 Kubernetes — Java 应用云原生部署"
status: "verified"
verification:
  reviewed_at: "2026-07-27"
  version_anchor: "JDK 25 / Spring Boot 4.x / Spring AI 2.x"
level: "advanced"
sources:
  - level: "L1"
    url: "https://docs.docker.com/reference/"
    description: "Docker 官方文档"
  - level: "L1"
    url: "https://kubernetes.io/docs/home/"
    description: "Kubernetes 官方文档"
  - level: "L1"
    url: "https://helm.sh/docs/"
    description: "Helm 官方文档"
  - level: "L3"
    url: "https://www.oreilly.com/library/view/kubernetes-up-and/"
    description: "《Kubernetes: Up and Running》— Brendan Burns 等"
relations:
  prerequisite: ["05-分布式一致性与事务方案"]
  related: ["06-OpenTelemetry可观测性体系", "06-CICD与基础设施即代码"]
tags: ["docker", "kubernetes", "helm", "java-container", "distroless", "health-check", "hpa", "gpu-scheduling", "kserve"]
created: "2026-07-17"
updated: "2026-07-17"
---

# Docker 与 Kubernetes — Java 应用云原生部署

## 概述

容器化和编排是现代 Java 应用部署的标准方式。对于 AI 应用，容器化还涉及 GPU 资源调度、模型推理服务的 K8s 集成、大镜像优化等额外挑战。

本文覆盖 Docker 核心原理与 Java 镜像最佳实践、Kubernetes 核心资源、Java 应用 K8s 部署策略、Helm 包管理，以及 AI 服务部署的特殊考量。

---

## 一、Docker 核心

### 1.1 镜像分层（UnionFS）

Docker 镜像由多个只读层叠加而成，使用 UnionFS（Overlay2）技术：

```
┌──────────────────────┐
│ writable layer (R/W)  │ ← 容器层（临时，容器删除即丢失）
├──────────────────────┤
│ COPY --from=builder   │ ← 构建产物层 (10 MB)
├──────────────────────┤
│ COPY app.jar          │ ← 应用层 (50 MB)
├──────────────────────┤
│ RUN apt-get install   │ ← 依赖安装层 (200 MB)
├──────────────────────┤
│ FROM eclipse-temurin  │ ← 基础镜像层 (200 MB)
├──────────────────────┤
│ FROM ubuntu:24.04     │ ← OS 层 (70 MB)
└──────────────────────┘
```

**分层复用：** 如果多个镜像共享相同的基础层，Docker 只存储一份（Content-Addressable Storage）。

### 1.2 Java Dockerfile 最佳实践

```dockerfile
# ============================================
# Stage 1: Build
# ============================================
FROM eclipse-temurin:25-jdk-alpine AS builder

WORKDIR /workspace

# 1. 先复制依赖描述文件（利用 Docker 层缓存）
COPY pom.xml mvnw ./
COPY .mvn .mvn

# 2. 下载依赖（此层在 pom.xml 不变时可缓存）
RUN --mount=type=cache,target=/root/.m2 \
    ./mvnw dependency:go-offline -B

# 3. 复制源码并构建
COPY src src
RUN --mount=type=cache,target=/root/.m2 \
    ./mvnw package -DskipTests -B

# 4. 使用 Spring Boot layertools 提取分层 JAR
RUN java -Djarmode=layertools -jar target/*.jar extract \
    --destination /extracted

# ============================================
# Stage 2: Runtime（最小化镜像）
# ============================================
FROM eclipse-temurin:25-jre-alpine AS runtime

# 安全：创建非 root 用户
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# 按变更频率分层复制，最大化缓存利用
COPY --from=builder /extracted/dependencies/ ./
COPY --from=builder /extracted/spring-boot-loader/ ./
COPY --from=builder /extracted/snapshot-dependencies/ ./
COPY --from=builder /extracted/application/ ./

# JVM 容器感知参数
ENV JAVA_OPTS="-XX:+UseZGC \
 -XX:MaxRAMPercentage=75.0 \
 -XX:+ExitOnOutOfMemoryError \
 -XX:+HeapDumpOnOutOfMemoryError \
 -XX:HeapDumpPath=/tmp/heapdump.hprof"

USER appuser
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost:8080/actuator/health/liveness || exit 1

ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS org.springframework.boot.loader.launch.JarLauncher"]
```

### 1.3 JVM 容器感知配置

JDK 10+ 默认启用 `UseContainerSupport`，JVM 自动读取 cgroup 限制而非宿主机配置。

```ini
# 核心参数
-XX:+UseContainerSupport           # 自动检测 cgroup 限制（默认开启）
-XX:MaxRAMPercentage=75.0          # 使用容器内存的 75% 作为最大堆
-XX:InitialRAMPercentage=50.0      # 初始堆为容器内存的 50%

# GC 选择
-XX:+UseZGC                        # ZGC：低延迟（<1ms），大堆（TB 级别）
-XX:+UseG1GC                       # G1：均衡选择（默认）
-XX:+UseSerialGC                   # Serial：小内存容器（<512MB）

# Spring Boot 配合
-XX:+ExitOnOutOfMemoryError        # OOM 时退出而非僵死（K8s 重启）
```

```yaml
# K8s 资源配置（与 JVM 参数匹配）
resources:
  requests:
    memory: "1Gi"
    cpu: "500m"
  limits:
    memory: "2Gi"    # JVM 检测到 limits=2Gi
    cpu: "2000m"     # MaxRAMPercentage=75 → max heap = 1.5Gi
```

### 1.4 最小化基础镜像选择

| 基础镜像 | 大小 | JRE 包含 | 安全扫描 | 推荐场景 |
|----------|------|----------|----------|----------|
| `eclipse-temurin:25-jre-alpine` | ~180 MB | OpenJDK JRE | 定期 | 通用场景 |
| `eclipse-temurin:25-jre` (Ubuntu) | ~220 MB | OpenJDK JRE | 定期 | glibc 依赖 |
| `distroless/java17-debian12` | ~150 MB | OpenJDK JRE | Google 维护 | 安全敏感（无 Shell） |
| `azul/zulu-openjdk-alpine:25-jre` | ~180 MB | Zulu JRE | 定期 | 商业支持 |

**distroless 镜像注意：** 没有 Shell（不能 exec 进去调试），没有包管理器。通过 K8s ephemeral containers 进行调试。

```dockerfile
# Distroless 多阶段构建
FROM eclipse-temurin:25-jdk-alpine AS builder
# ... 构建步骤 ...

FROM gcr.io/distroless/java25-debian12
COPY --from=builder /app /app
WORKDIR /app
USER 65532:65532
CMD ["Main.jar"]
```

### 1.5 Docker Compose 本地开发

```yaml
# docker-compose.yml
services:
  postgres:
    image: pgvector/pgvector:pg17
    environment:
      POSTGRES_DB: ai_knowledge
      POSTGRES_USER: app
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    ports: ["5432:5432"]
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d ai_knowledge"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7.4-alpine
    ports: ["6379:6379"]
    command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD}
    volumes:
      - redisdata:/data

  ollama:
    image: ollama/ollama:latest
    ports: ["11434:11434"]
    volumes:
      - ollama_data:/root/.ollama
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]

  ai-rag-service:
    build:
      context: .
      dockerfile: Dockerfile
    ports: ["8080:8080"]
    environment:
      SPRING_DATASOURCE_URL: jdbc:postgresql://postgres:5432/ai_knowledge
      SPRING_DATASOURCE_USERNAME: app
      SPRING_DATASOURCE_PASSWORD: ${DB_PASSWORD}
      SPRING_DATA_REDIS_HOST: redis
      SPRING_DATA_REDIS_PASSWORD: ${REDIS_PASSWORD}
      SPRING_AI_OLLAMA_BASE_URL: http://ollama:11434
      JAVA_OPTS: "-XX:+UseZGC -XX:MaxRAMPercentage=75.0"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started

volumes:
  pgdata:
  redisdata:
  ollama_data:
```

---

## 二、Kubernetes 核心概念

### 2.1 核心资源关系

```
┌─────────────────────────────────────────────────────────┐
│                       Namespace                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │                    Deployment                     │   │
│  │  ┌────────┐  ┌────────┐  ┌────────┐             │   │
│  │  │  Pod   │  │  Pod   │  │  Pod   │             │   │
│  │  │(容器们) │  │(容器们) │  │(容器们) │             │   │
│  │  └────────┘  └────────┘  └────────┘             │   │
│  └──────────────────┬───────────────────────────────┘   │
│                     │                                    │
│              ┌──────▼──────┐                            │
│              │   Service    │  (ClusterIP/LoadBalancer) │
│              └──────┬──────┘                            │
│                     │                                    │
│              ┌──────▼──────┐                            │
│              │   Ingress    │  (外部流量入口)             │
│              └─────────────┘                            │
│                                                         │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐          │
│  │ ConfigMap │  │  Secret   │  │    PVC    │          │
│  └───────────┘  └───────────┘  └───────────┘          │
└─────────────────────────────────────────────────────────┘
```

### 2.2 Pod 生命周期与健康检查

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: ai-rag-service
spec:
  terminationGracePeriodSeconds: 60  # 优雅关闭时间

  containers:
  - name: app
    image: registry.example.com/ai-rag-service:1.0.0
    ports:
    - containerPort: 8080

    # Startup Probe（启动探测）
    # 仅在容器启动阶段执行，通过后才执行 Liveness/Readiness
    startupProbe:
      httpGet:
        path: /actuator/health/readiness
        port: 8080
      initialDelaySeconds: 10
      periodSeconds: 5
      failureThreshold: 30  # 最多 150 秒启动时间

    # Liveness Probe（存活探测）
    # 失败 → Kubelet 重启容器
    livenessProbe:
      httpGet:
        path: /actuator/health/liveness
        port: 8080
      initialDelaySeconds: 0    # Startup Probe 通过后立即开始
      periodSeconds: 15
      timeoutSeconds: 3
      failureThreshold: 3       # 连续 3 次失败 → 重启

    # Readiness Probe（就绪探测）
    # 失败 → 从 Service Endpoints 移除，不接收流量
    readinessProbe:
      httpGet:
        path: /actuator/health/readiness
        port: 8080
      initialDelaySeconds: 0
      periodSeconds: 10
      timeoutSeconds: 3
      failureThreshold: 3

    # 优雅关闭：preStop Hook + Spring graceful shutdown
    lifecycle:
      preStop:
        exec:
          command: ["/bin/sh", "-c", "sleep 10"] # 等待 Endpoints 更新传播

    env:
    - name: SERVER_SHUTDOWN
      value: "graceful"
    - name: SPRING_LIFECYCLE_TIMEOUT_PER_SHUTDOWN_PHASE
      value: "30s"

    # 资源限制
    resources:
      requests:           # 调度保证
        memory: "1Gi"
        cpu: "500m"
      limits:             # 硬限制
        memory: "2Gi"
        cpu: "2000m"
```

### 2.3 Deployment 与滚动更新

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ai-rag-service
spec:
  replicas: 3
  revisionHistoryLimit: 5

  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1         # 允许超出 replicas 的 Pod 数
      maxUnavailable: 0   # 更新期间不可用 Pod 数（0=先启动新 Pod 再停止旧 Pod）

  selector:
    matchLabels:
      app: ai-rag-service

  template:
    metadata:
      labels:
        app: ai-rag-service
        version: "1.0.0"
    spec:
      # Pod 反亲和：尽量分布到不同节点
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 100
            podAffinityTerm:
              labelSelector:
                matchLabels:
                  app: ai-rag-service
              topologyKey: kubernetes.io/hostname

      containers:
      - name: app
        image: registry.example.com/ai-rag-service:1.0.0
        # ... (Pod 配置同上)
```

### 2.4 Service 与 Ingress

```yaml
# Service
apiVersion: v1
kind: Service
metadata:
  name: ai-rag-service
spec:
  type: ClusterIP
  selector:
    app: ai-rag-service
  ports:
  - name: http
    port: 8080
    targetPort: 8080
  sessionAffinity: None   # AI 推理服务通常无状态，不需要 Session 亲和

---
# Ingress
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ai-api-ingress
  annotations:
    nginx.ingress.kubernetes.io/proxy-body-size: "50m"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "300"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "300"
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  ingressClassName: nginx
  tls:
  - hosts:
    - ai-api.example.com
    secretName: ai-api-tls
  rules:
  - host: ai-api.example.com
    http:
      paths:
      - path: /api/v1/rag
        pathType: Prefix
        backend:
          service:
            name: ai-rag-service
            port:
              number: 8080
      - path: /api/v1/agent
        pathType: Prefix
        backend:
          service:
            name: ai-agent-service
            port:
              number: 8080
```

### 2.5 ConfigMap 与 Secret

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: ai-service-config
data:
  application.yml: |
    spring:
      ai:
        ollama:
          base-url: http://ollama-service:11434
          chat:
            options:
              model: qwen3:14b
              temperature: 0.7
        openai:
          base-url: https://api.openai.com
      datasource:
        hikari:
          maximum-pool-size: 20
          minimum-idle: 5
    logging:
      level:
        com.example.ai: DEBUG

---
apiVersion: v1
kind: Secret
metadata:
  name: ai-service-secrets
type: Opaque
stringData:
  openai-api-key: "sk-..."        # 生产环境使用 External Secrets Operator
  db-password: "secure-password"
```

```yaml
# Deployment 中使用
spec:
  containers:
  - name: app
    envFrom:
    - configMapRef:
        name: ai-service-config
    - secretRef:
        name: ai-service-secrets
    volumeMounts:
    - name: config
      mountPath: /app/config
      readOnly: true
  volumes:
  - name: config
    configMap:
      name: ai-service-config
```

### 2.6 HPA（水平自动伸缩）

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: ai-rag-service-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: ai-rag-service
  minReplicas: 2
  maxReplicas: 10
  metrics:
  # CPU 利用率
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70

  # 自定义指标（如请求延迟 P95）
  - type: Pods
    pods:
      metric:
        name: http_request_duration_milliseconds_p95
      target:
        type: AverageValue
        averageValue: "500"   # P95 延迟超过 500ms 时扩展

  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300  # 稳定窗口 5 分钟
      policies:
      - type: Percent
        value: 50
        periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 30
      policies:
      - type: Percent
        value: 100
        periodSeconds: 15
      - type: Pods
        value: 4
        periodSeconds: 15
      selectPolicy: Max
```

---

## 三、Helm

### 3.1 Chart 结构

```
ai-rag-service/
├── Chart.yaml            # Chart 元数据
├── values.yaml           # 默认配置值
├── values-prod.yaml      # 生产环境覆盖
├── templates/
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── ingress.yaml
│   ├── configmap.yaml
│   ├── secret.yaml
│   ├── hpa.yaml
│   └── _helpers.tpl      # 模板辅助函数
└── charts/               # 子 Chart 依赖
```

### 3.2 Chart.yaml

```yaml
apiVersion: v2
name: ai-rag-service
description: AI RAG Knowledge Service
type: application
version: 1.0.0
appVersion: "1.0.0"
dependencies:
  - name: postgresql
    version: "15.x.x"
    repository: "https://charts.bitnami.com/bitnami"
    condition: postgresql.enabled
  - name: redis
    version: "19.x.x"
    repository: "https://charts.bitnami.com/bitnami"
    condition: redis.enabled
```

### 3.3 values.yaml 模板

```yaml
# values.yaml
replicaCount: 3

image:
  repository: registry.example.com/ai-rag-service
  tag: "1.0.0"
  pullPolicy: IfNotPresent

service:
  type: ClusterIP
  port: 8080

ingress:
  enabled: true
  className: nginx
  hosts:
    - host: ai-api.example.com
      paths:
        - path: /api/v1/rag
          pathType: Prefix

resources:
  limits:
    memory: "2Gi"
    cpu: "2000m"
  requests:
    memory: "1Gi"
    cpu: "500m"

autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 10
  targetCPUUtilizationPercentage: 70

jvm:
  gc: "ZGC"
  maxRAMPercentage: 75.0

# 模型服务和 Embedding 配置
ai:
  openai:
    apiKeySecretName: "ai-service-secrets"
    apiKeySecretKey: "openai-api-key"
  ollama:
    baseUrl: "http://ollama-service:11434"
  embedding:
    model: "text-embedding-3-small"
    dimensions: 1536

# 依赖服务配置
postgresql:
  enabled: true
  auth:
    username: app
    database: ai_knowledge
    existingSecret: db-credentials

redis:
  enabled: true
  auth:
    existingSecret: redis-credentials
```

---

## 四、AI 服务部署

### 4.1 vLLM 推理服务 K8s 部署

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: vllm-qwen3
spec:
  replicas: 1
  selector:
    matchLabels:
      app: vllm-qwen3
  template:
    spec:
      containers:
      - name: vllm
        image: vllm/vllm-openai:latest
        command:
        - python
        - -m
        - vllm.entrypoints.openai.api_server
        args:
        - --model
        - Qwen/Qwen3-14B
        - --tensor-parallel-size
        - "1"
        - --max-model-len
        - "32768"
        - --gpu-memory-utilization
        - "0.90"
        ports:
        - containerPort: 8000
        resources:
          limits:
            nvidia.com/gpu: 1
          requests:
            nvidia.com/gpu: 1
        volumeMounts:
        - name: model-cache
          mountPath: /root/.cache/huggingface
        env:
        - name: HF_HOME
          value: /root/.cache/huggingface
      volumes:
      - name: model-cache
        persistentVolumeClaim:
          claimName: hf-model-cache
```

### 4.2 GPU 调度

```yaml
# GPU 节点选择
spec:
  nodeSelector:
    accelerator: nvidia-tesla-t4
  tolerations:
  - key: "nvidia.com/gpu"
    operator: "Exists"
    effect: "NoSchedule"
```

### 4.3 KServe（Serverless 模型推理）

```yaml
apiVersion: serving.kserve.io/v1beta1
kind: InferenceService
metadata:
  name: qwen3-14b
spec:
  predictor:
    pytorch:
      storageUri: "s3://models/qwen3-14b"
      resources:
        limits:
          nvidia.com/gpu: 1
        requests:
          nvidia.com/gpu: 1
      # Scale to zero when idle
      minReplicas: 0
      maxReplicas: 3
      scaleTarget: 1
      scaleMetric: concurrency
```

---

## 常见问题

**Q: JVM 容器内存 OOMKilled 怎么办？**
A: 检查 `limits.memory` 是否大于 `MaxRAMPercentage` 的堆 + Metaspace + 线程栈 + 直接内存 + Native 内存。公式：`总内存 >= 堆(75%) + Metaspace(256MB) + 线程栈(1MB * threads) + 直接内存 + 系统开销(200MB)`。

**Q: Spring Boot 优雅关闭在 K8s 中如何保证？**
A: 启用 `spring.lifecycle.timeout-per-shutdown-phase=30s` + K8s `terminationGracePeriodSeconds=45s` + preStop hook 延迟。顺序：K8s 发 SIGTERM → preStop sleep → Spring 优雅关闭 → Pod 终止。

**Q: K8s Secret 安全性够吗？**
A: 仅 Base64 编码不够。生产环境使用 External Secrets Operator（集成 Vault/AWS Secret Manager）或 Sealed Secrets。

**Q: 为什么用 distroless 基础镜像？**
A: 攻击面最小（无 Shell、无包管理器、无系统工具），CVE 少，镜像更小。但调试依赖 K8s ephemeral containers。

---

## 相关条目

- [[06-OpenTelemetry可观测性体系]] — 可观测性与监控
- [[06-CICD与基础设施即代码]] — CI/CD 流水线和 GitOps
- [[05-熔断限流与弹性设计]] — K8s 中的弹性设计
