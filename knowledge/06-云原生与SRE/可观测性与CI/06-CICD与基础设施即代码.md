---
domain: "06-云原生与SRE"
title: "CI/CD 与基础设施即代码（IaC）"
status: "verified"
level: "advanced"
sources:
  - level: "L1"
    url: "https://docs.github.com/en/actions"
    description: "GitHub Actions 官方文档"
  - level: "L1"
    url: "https://argo-cd.readthedocs.io/"
    description: "ArgoCD 官方文档"
  - level: "L1"
    url: "https://developer.hashicorp.com/terraform/docs"
    description: "Terraform 官方文档"
  - level: "L3"
    url: "https://www.oreilly.com/library/view/terraform-up-and/"
    description: "《Terraform: Up & Running》— Yevgeniy Brikman"
relations:
  prerequisite: ["06-Docker与Kubernetes云原生部署", "06-OpenTelemetry可观测性体系"]
  related: ["05-熔断限流与弹性设计"]
tags: ["cicd", "github-actions", "argocd", "terraform", "gitops", "container-security", "trivy", "deployment-strategies"]
created: "2026-07-17"
updated: "2026-07-17"
---

# CI/CD 与基础设施即代码（IaC）

## 概述

CI/CD 流水线是现代软件交付的动脉，IaC 则是基础设施管理的声明式范式。对于 AI 应用，CI/CD 不仅要处理传统 Java 应用的构建和部署，还需考虑模型文件管理、GPU 资源调度和推理服务的特殊部署策略。

本文覆盖 GitHub Actions 流水线设计、Docker 镜像构建优化、容器安全扫描、GitOps（ArgoCD）、部署策略和 Terraform IaC 基础。

---

## 一、CI/CD 流水线设计

### 1.1 标准流水线阶段

```
┌────────┐  ┌────────┐  ┌────────┐  ┌─────────┐  ┌──────────┐  ┌──────────┐
│ Build  │─▶│  Test  │─▶│  Scan  │─▶│ Package │─▶│  Deploy  │─▶│  Verify  │
└────────┘  └────────┘  └────────┘  └─────────┘  └──────────┘  └──────────┘

Build:    编译 + 单元测试
Test:     集成测试 + 安全测试
Scan:     代码扫描(SonarQube) + 依赖扫描(Trivy) + 镜像扫描
Package:  构建 Docker 镜像 + 推送 Registry
Deploy:   部署到目标环境
Verify:   冒烟测试 + 健康检查 + 回滚验证
```

### 1.2 AI 应用的特殊考量

```
额外的流水线阶段：
┌──────────────┐  ┌───────────────┐  ┌──────────────────┐
│ Model Verify │─▶│ Embed Test    │─▶│ Retrieval Eval   │
└──────────────┘  └───────────────┘  └──────────────────┘

Model Verify:     模型文件完整性校验（SHA256）+ 模型加载测试
Embed Test:       Embedding 质量回归测试（Golden Dataset）
Retrieval Eval:   RAG 检索质量评估（MRR/NDCG/召回率）
```

---

## 二、GitHub Actions 深入

### 2.1 完整 CI 流水线

```yaml
# .github/workflows/ci.yml
name: CI Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  # ============================================
  # Job 1: Build & Unit Test
  # ============================================
  build:
    name: Build and Unit Test
    runs-on: ubuntu-latest
    outputs:
      artifact-name: ${{ steps.upload.outputs.artifact-name }}

    strategy:
      matrix:
        java: ['25']

    steps:
      - uses: actions/checkout@v4

      - name: Set up JDK ${{ matrix.java }}
        uses: actions/setup-java@v4
        with:
          java-version: ${{ matrix.java }}
          distribution: 'temurin'
          cache: 'maven'

      - name: Build with Maven
        run: ./mvnw verify -B -DskipITs

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: test-results-${{ matrix.java }}
          path: '**/target/surefire-reports/*.xml'

      - name: Upload JAR artifact
        uses: actions/upload-artifact@v4
        with:
          name: app-jar
          path: target/*.jar

  # ============================================
  # Job 2: Integration Tests
  # ============================================
  integration-test:
    name: Integration Tests
    runs-on: ubuntu-latest
    needs: build
    services:
      postgres:
        image: pgvector/pgvector:pg17
        env:
          POSTGRES_DB: testdb
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
        ports: ['5432:5432']
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      redis:
        image: redis:7.4-alpine
        ports: ['6379:6379']
        options: --health-cmd "redis-cli ping" --health-interval 10s

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          java-version: '25'
          distribution: 'temurin'
          cache: 'maven'

      - name: Run integration tests
        run: ./mvnw verify -Pintegration-test -B
        env:
          SPRING_DATASOURCE_URL: jdbc:postgresql://localhost:5432/testdb
          SPRING_DATASOURCE_USERNAME: test
          SPRING_DATASOURCE_PASSWORD: test
          SPRING_DATA_REDIS_HOST: localhost

  # ============================================
  # Job 3: Code Analysis
  # ============================================
  code-analysis:
    name: Code Quality & Security
    runs-on: ubuntu-latest
    needs: build
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # SonarQube 需要完整 Git 历史

      - uses: actions/setup-java@v4
        with:
          java-version: '25'
          distribution: 'temurin'

      - name: SonarQube Scan
        env:
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
        run: |
          ./mvnw sonar:sonar \
            -Dsonar.projectKey=ai-rag-service \
            -Dsonar.host.url=${{ vars.SONAR_HOST_URL }}

      - name: Dependency Check (OWASP)
        run: ./mvnw org.owasp:dependency-check-maven:check -B

      - name: SpotBugs
        run: ./mvnw spotbugs:check -B

  # ============================================
  # Job 4: Docker Build & Push
  # ============================================
  docker:
    name: Build and Push Docker Image
    runs-on: ubuntu-latest
    needs: [build, integration-test, code-analysis]
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    permissions:
      contents: read
      packages: write
      id-token: write

    steps:
      - uses: actions/checkout@v4

      - uses: actions/download-artifact@v4
        with:
          name: app-jar
          path: target/

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=sha,prefix=,format=short
            type=ref,event=branch
            type=semver,pattern={{version}}

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          platforms: linux/amd64,linux/arm64  # 多平台
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          provenance: true
          sbom: true
```

### 2.2 Matrix Build（多环境）

```yaml
deploy:
  name: Deploy to ${{ matrix.environment }}
  runs-on: ubuntu-latest
  needs: docker
  strategy:
    matrix:
      environment: [dev, staging]
    fail-fast: false  # 不因一个环境失败取消其他

  environment:
    name: ${{ matrix.environment }}
    url: https://${{ matrix.environment }}.example.com

  steps:
    - name: Checkout Helm chart
      uses: actions/checkout@v4
      with:
        repository: myorg/helm-charts

    - name: Deploy with Helm
      run: |
        helm upgrade --install ai-rag-service ./ai-rag-service \
          --namespace ${{ matrix.environment }} \
          --values values-${{ matrix.environment }}.yaml \
          --set image.tag=${{ github.sha }} \
          --wait --timeout 5m
```

### 2.3 缓存策略优化

```yaml
# Maven 依赖缓存
- uses: actions/setup-java@v4
  with:
    java-version: '25'
    distribution: 'temurin'
    cache: 'maven'  # 自动缓存 ~/.m2/repository

# Docker Layer 缓存（GitHub Actions Cache）
- uses: docker/build-push-action@v6
  with:
    cache-from: type=gha      # 从 GitHub Actions Cache 恢复
    cache-to: type=gha,mode=max  # 写入最大缓存（所有中间层）

# Gradle 缓存
- uses: actions/setup-java@v4
  with:
    java-version: '25'
    distribution: 'temurin'
    cache: 'gradle'
```

### 2.4 环境保护规则（Environment Protection）

在 GitHub Repository Settings > Environments 中配置：

```
Production Environment:
  - Required reviewers: 2 (deployment protection rule)
  - Wait timer: 0 minutes
  - Deployment branches: main
  - Secrets:
    - KUBE_CONFIG: restricted to production environment
    - OPENAI_API_KEY_PROD: restricted to production environment
```

```yaml
# 使用生产环境时的审批规则
deploy-prod:
  name: Deploy to Production
  runs-on: ubuntu-latest
  needs: docker
  environment:
    name: production
    url: https://api.example.com
  steps:
    # 需要 2 人审批 → GitHub UI 中审批后才能执行
    - name: Deploy
      run: |
        helm upgrade --install ai-rag-service ./chart \
          --namespace production \
          --values values-prod.yaml \
          --set image.tag=${{ github.sha }} \
          --wait --timeout 10m
```

### 2.5 Secrets 管理

```yaml
# GitHub Actions Secrets 使用示例
steps:
  # 方式1：环境变量
  - name: Build with secrets
    env:
      DB_PASSWORD: ${{ secrets.DB_PASSWORD }}
      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}

  # 方式2：文件挂载（敏感配置文件）
  - name: Create Google credentials
    run: |
      echo '${{ secrets.GCP_SA_KEY }}' > /tmp/gcp-key.json

  # 方式3：Vault 集成（推荐）
  - name: Import secrets from Vault
    uses: hashicorp/vault-action@v3
    with:
      url: ${{ vars.VAULT_ADDR }}
      method: jwt
      role: github-actions
      secrets: |
        secret/data/ci db-username | DB_USERNAME ;
        secret/data/ci db-password | DB_PASSWORD
```

---

## 三、Docker 镜像构建优化

### 3.1 BuildKit 特性

```dockerfile
# syntax=docker/dockerfile:1

# 1. --mount=type=cache: 缓存依赖
RUN --mount=type=cache,target=/root/.m2 \
    ./mvnw dependency:go-offline -B

# 2. --mount=type=secret: 安全传递密钥（不留在镜像层）
RUN --mount=type=secret,id=maven-settings,dst=/root/.m2/settings.xml \
    --mount=type=cache,target=/root/.m2 \
    ./mvnw deploy -B

# 3. --mount=type=bind: 从构建上下文挂载
RUN --mount=type=bind,source=config,target=/tmp/config \
    cp /tmp/config/app.yml /app/config/

# 4. HEREDOC 语法（多行 RUN）
RUN <<EOF
  apk add --no-cache curl ca-certificates
  addgroup -S appgroup
  adduser -S appuser -G appgroup
EOF
```

```bash
# BuildKit 启用（docker build 默认）
DOCKER_BUILDKIT=1 docker build -t app .

# 传递 Secret
docker build --secret id=maven-settings,src=settings.xml -t app .

# Buildx 多平台构建
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --push -t registry.example.com/app:latest .
```

### 3.2 分层缓存优化策略

```
Dockerfile 层顺序（从最不易变到最易变）：
1. FROM 基础镜像          ← 几乎不变
2. RUN 系统工具安装        ← 偶尔变
3. COPY pom.xml           ← 依赖变更时才变
4. RUN 下载依赖           ← 依赖变更时才变（缓存重点）
5. COPY src               ← 每次代码变更都变
6. RUN 编译               ← 每次代码变更都变
7. COPY 构建产物           ← 每次代码变更都变
```

---

## 四、容器镜像安全

### 4.1 Trivy 扫描

```yaml
# GitHub Actions 中集成 Trivy
container-scan:
  name: Container Security Scan
  runs-on: ubuntu-latest
  needs: docker
  steps:
    - name: Scan image for vulnerabilities
      uses: aquasecurity/trivy-action@master
      with:
        image-ref: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}
        format: 'sarif'
        output: 'trivy-results.sarif'
        severity: 'CRITICAL,HIGH'
        exit-code: '1'  # CRITICAL 存在时使流水线失败

    - name: Upload Trivy results to GitHub Security
      uses: github/codeql-action/upload-sarif@v3
      with:
        sarif_file: 'trivy-results.sarif'

    # 扫描 IaC 文件
    - name: Scan IaC files
      uses: aquasecurity/trivy-action@master
      with:
        scan-type: 'config'
        scan-ref: './infra/terraform'
        format: 'table'
        exit-code: '1'
```

### 4.2 SBOM 生成 (syft)

```yaml
- name: Generate SBOM
  uses: anchore/sbom-action@v0
  with:
    image: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}
    format: spdx-json
    output-file: sbom.spdx.json

- name: Upload SBOM
  uses: actions/upload-artifact@v4
  with:
    name: sbom
    path: sbom.spdx.json
```

### 4.3 镜像签名 (cosign)

```yaml
- name: Install Cosign
  uses: sigstore/cosign-installer@v3

- name: Sign image
  run: |
    cosign sign --yes \
      ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}@${{ steps.build.outputs.digest }}
  env:
    COSIGN_PRIVATE_KEY: ${{ secrets.COSIGN_PRIVATE_KEY }}
    COSIGN_PASSWORD: ${{ secrets.COSIGN_PASSWORD }}

- name: Verify signature
  run: |
    cosign verify \
      --certificate-identity ${{ github.repository }} \
      ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}@${{ steps.build.outputs.digest }}
```

---

## 五、部署策略

### 5.1 四大策略对比

| 策略 | 原理 | 回滚速度 | 资源需求 | 用户影响 |
|------|------|----------|----------|----------|
| 滚动更新 | 逐步替换实例 | 慢（反方向滚动） | 正常 | 部分用户受影响 |
| 蓝绿部署 | 两套完整环境，切换流量 | 瞬间 | 2x | 无感 |
| 金丝雀发布 | 逐步增加新版本流量比例 | 快（调整比例） | 略高 | 逐影响 |
| A/B 测试 | 按用户特征分流 | 快 | 略高 | 特定用户 |

### 5.2 金丝雀发布 (Argo Rollouts)

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: ai-rag-service
spec:
  replicas: 5
  strategy:
    canary:
      steps:
      - setWeight: 10      # 10% 流量到新版本
      - pause:
          duration: 5m     # 观察 5 分钟
      - setWeight: 30      # 30%
      - pause:
          duration: 10m
      - setWeight: 50      # 50%
      - pause:
          duration: 20m
      - setWeight: 100     # 100%

      # 自动回滚条件
      analysis:
        templates:
        - templateName: error-rate-check
        startingStep: 2

  template:
    spec:
      containers:
      - name: app
        image: registry.example.com/ai-rag-service:canary

---
# 自动回滚分析模板
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata:
  name: error-rate-check
spec:
  metrics:
  - name: error-rate
    interval: 30s
    failureLimit: 2
    successCondition: result[0] < 0.01  # 错误率 < 1%
    provider:
      prometheus:
        address: http://prometheus:9090
        query: |
          sum(rate(http_server_requests_total{
            application="ai-rag-service",
            status=~"5.*"
          }[1m]))
          /
          sum(rate(http_server_requests_total{
            application="ai-rag-service"
          }[1m]))
```

### 5.3 蓝绿部署 Service 切换

```yaml
# Blue Service (当前生产)
apiVersion: v1
kind: Service
metadata:
  name: ai-rag-service
spec:
  selector:
    app: ai-rag-service
    version: blue

---
# 部署 Green (新版本)
# ... Deployment version: green ...

---
# 切换流量到 Green
apiVersion: v1
kind: Service
metadata:
  name: ai-rag-service
spec:
  selector:
    app: ai-rag-service
    version: green  # 一键切换
```

---

## 六、GitOps (ArgoCD)

### 6.1 核心概念

```
Git Repository (单一事实来源)
│
├── app-of-apps/
│   └── root-app.yaml         # ArgoCD Application 定义
├── ai-rag-service/
│   ├── base/                  # 基础配置
│   │   ├── deployment.yaml
│   │   ├── service.yaml
│   │   └── kustomization.yaml
│   └── overlays/
│       ├── dev/
│       │   └── kustomization.yaml
│       └── prod/
│           └── kustomization.yaml
```

### 6.2 Application 定义

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: ai-rag-service
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/myorg/gitops-config.git
    targetRevision: main
    path: ai-rag-service/overlays/prod

  destination:
    server: https://kubernetes.default.svc
    namespace: production

  syncPolicy:
    automated:
      prune: true          # 自动删除 Git 中不存在的资源
      selfHeal: true       # 自动修复手动修改
      allowEmpty: false
    syncOptions:
    - CreateNamespace=true
    - PruneLast=true       # 先部署再删除旧资源
    retry:
      limit: 5
      backoff:
        duration: 5s
        factor: 2
        maxDuration: 3m

  # 健康检查
  ignoreDifferences:
  - group: apps
    kind: Deployment
    jsonPointers:
    - /spec/replicas  # HPA 管理的 replicas，不触发 OutOfSync
```

### 6.3 ArgoCD Image Updater

```yaml
# 自动更新镜像（配合 CI 流水线）
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  annotations:
    argocd-image-updater.argoproj.io/image-list: >
      app=registry.example.com/ai-rag-service
    argocd-image-updater.argoproj.io/app.update-strategy: semver
    argocd-image-updater.argoproj.io/write-back-method: git
spec:
  # ... rest of application spec
```

---

## 七、Terraform IaC

### 7.1 核心概念

```
Terraform 工作流：
Write → Plan → Apply → (State)

Write:   编写 .tf 配置文件（声明期望状态）
Plan:    terraform plan — 预览变更
Apply:   terraform apply — 执行变更
State:   terraform.tfstate — 记录实际状态（远程存储）
```

### 7.2 Provider 与 Resource

```hcl
# main.tf
terraform {
  required_version = ">= 1.8"
  required_providers {
    postgresql = {
      source  = "cyrilgdn/postgresql"
      version = "~> 1.23"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.30"
    }
  }

  backend "s3" {
    bucket = "terraform-state"
    key    = "ai-rag-service/terraform.tfstate"
    region = "us-east-1"
  }
}

# PostgreSQL 数据库
resource "postgresql_database" "ai_knowledge" {
  name  = "ai_knowledge"
  owner = postgresql_role.app.name
}

resource "postgresql_extension" "pgvector" {
  name     = "vector"
  database = postgresql_database.ai_knowledge.name
}

# Redis 实例
resource "rediscloud_subscription" "cache" {
  name           = "ai-rag-cache"
  memory_storage = "ram"
  cloud_provider {
    provider = "AWS"
    region {
      region = "us-east-1"
    }
  }
  # ...
}

# K8s Namespace
resource "kubernetes_namespace" "ai_rag" {
  metadata {
    name = "ai-rag-production"
  }
}

# K8s Secret
resource "kubernetes_secret" "db_credentials" {
  metadata {
    name      = "db-credentials"
    namespace = kubernetes_namespace.ai_rag.metadata[0].name
  }

  data = {
    username = postgresql_role.app.name
    password = postgresql_role.app.password
  }
}

output "database_url" {
  value     = "jdbc:postgresql://${postgresql_database.ai_knowledge.host}:5432/${postgresql_database.ai_knowledge.name}"
  sensitive = true
}
```

### 7.3 状态管理与远程存储

```hcl
# 远程状态存储（S3 + DynamoDB 锁）
terraform {
  backend "s3" {
    bucket         = "my-terraform-state"
    key            = "ai-rag/production/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "terraform-locks"  # 状态锁，防止并发修改
  }
}
```

**Plan-Apply 流程：**

```bash
# 1. 初始化（下载 provider，配置 backend）
terraform init

# 2. 格式化
terraform fmt -recursive

# 3. 验证语法
terraform validate

# 4. 预览变更
terraform plan -out=tfplan

# 5. 应用变更
terraform apply tfplan

# 6. 查看输出
terraform output
```

---

## 八、完整 CI/CD 流程（AI 应用）

### 8.1 流水线总览

```
Git Push (main)
    │
    ▼
┌─────────────────────┐
│ GitHub Actions CI    │
│ ├ Build & Test       │
│ ├ Code Scan          │
│ ├ Docker Build+Push  │
│ ├ Image Scan (Trivy) │
│ └ Cosign Sign        │
└─────────┬───────────┘
          │ Image Tag Update
          ▼
┌─────────────────────┐
│ ArgoCD               │
│ ├ Auto Sync (dev)    │
│ └ Manual Sync (prod) │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ K8s (dev/prod)       │
│ ├ Canary Deploy      │
│ ├ Health Checks      │
│ └ Auto Rollback      │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│ OTel + Grafana       │
│ ├ Metrics Dashboard  │
│ ├ Alerting           │
│ └ Trace Analysis     │
└─────────────────────┘
```

---

## 常见问题

**Q: 制品管理用什么？**
A: Docker 镜像用 Container Registry (ghcr.io/ECR/ACR)；Maven 制品用 Nexus/Artifactory；Helm Chart 用 ChartMuseum/OCI Registry。

**Q: ArgoCD 的 Prune 和 SelfHeal 有什么区别？**
A: Prune = 删除 Git 中不存在的 K8s 资源；SelfHeal = 修复被手动修改的 K8s 资源回 Git 定义的状态。

**Q: 如何管理 Terraform 状态的安全问题？**
A: 远程存储（S3/GCS）+ 加密 + 状态锁（DynamoDB）。状态文件可能包含明文密码等敏感信息，禁止提交到 Git。

**Q: 多环境如何管理？**
A: Terraform Workspace 或目录分离（`env/dev`, `env/prod`）。Kustomize Overlay + Helm values per environment。GitHub Actions Environment + Protection Rules。

---

## 相关条目

- [[06-Docker与Kubernetes云原生部署]] — Docker 镜像构建与 K8s 部署
- [[06-OpenTelemetry可观测性体系]] — 部署后可观测性
- [[05-熔断限流与弹性设计]] — 部署后的弹性保障
