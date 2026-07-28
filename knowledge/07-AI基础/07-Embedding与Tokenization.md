---
domain: 07-AI基础
title: Embeddings and Tokenization
status: draft
level: intermediate
sources:
  - level: L1
    url: https://platform.openai.com/docs/guides/embeddings
    description: OpenAI Embeddings API 官方文档
  - level: L3
    description: "Speech and Language Processing 3rd ed. - Jurafsky and Martin (Chapter 6: Vector Semantics)"
  - level: L4
    url: https://arxiv.org/abs/1508.07909
    description: Neural Machine Translation of Rare Words with Subword Units (Sennrich et al., BPE for NLP)
  - level: L4
    url: https://arxiv.org/abs/1609.08144
    description: Google's Neural Machine Translation System (WordPiece)
  - level: L4
    url: https://arxiv.org/abs/1804.10959
    description: SentencePiece (Kudo & Richardson)
  - level: L4
    url: https://arxiv.org/abs/2201.12023
    description: Matryoshka Representation Learning (Kusupati et al.)
  - level: L5
    url: https://platform.openai.com/tokenizer
    description: OpenAI Tokenizer — 在线 Token 计数工具
  - level: L4
    url: https://arxiv.org/abs/2103.00020
    description: "CLIP: Learning Transferable Visual Models (Radford et al.)"
relations:
  prerequisite:
    - 07-Transformer架构深度解析
  related:
    - 07-推理策略与评估方法
    - 11-向量检索与混合检索
tags:
  - tokenization
  - bpe
  - wordpiece
  - sentencepiece
  - embedding
  - matryoshka
  - contrastive-learning
  - bge
created: 2026-07-17
updated: 2026-07-28
content_type: concept
---

# Embeddings and Tokenization

## 概述

Tokenization（分词）和 Embedding（嵌入）是 LLM 的"入口"和"感知层"。Tokenization 决定了模型如何看待文本的最小单位，Embedding 决定了模型如何将离散的符号转换为可计算的连续向量。本条目深入两方面的原理、算法和工程实践。

## Tokenization 深入

### 为什么需要子词分词

直接将原始文本输入模型是不可行的。需要将文本转换为离散的 token ID。最简单的方案——按单词或按字符分词——都有致命缺陷：

```
按单词分词：
"I love NLP" → [I, love, NLP]
问题：词汇表爆炸（英语50万+词，中文/日语无天然分词边界），OOV（Out-of-Vocabulary）问题

按字符分词：
"I love NLP" → [I, ' ', l, o, v, e, ' ', N, L, P]
问题：序列过长（同等语义内容需要5-10倍长度），单个字符语义密度极低

子词分词（最优平衡）：
"I love NLP" → [I, _love, _N, LP]  （BPE示例）
优势：常见词不拆分（I, love），罕见词拆分为有意义的子词单元（NLP→N+LP）
```

### BPE (Byte-Pair Encoding)

BPE 是最广泛使用的子词分词算法，GPT 系列采用。

**算法流程：**

```
阶段1: 训练（从语料学习合并规则）
1. 初始化：词汇表 = 所有唯一字符
2. 统计所有相邻符号对的频率
3. 合并频率最高的符号对 → 新符号
4. 重复步骤2-3直到词汇表达到目标大小（如50,000）

阶段2: 编码（将文本转为token id）
1. 将文本拆分为基础字符序列
2. 从最高优先级的合并规则开始应用
3. 无法继续合并时输出 token id

阶段3: 解码（将token id转回文本）
1. 将token id映射回子词字符串
2. 拼接后做后处理（如去空格）
```

**Java BPE 训练模拟：**

```java
import java.util.*;
import java.util.stream.Collectors;

public class BPETokenizer {

    record MergeRule(String left, String right, String merged) {}

    private final Map<String, Integer> tokenToId = new HashMap<>();
    private final Map<Integer, String> idToToken = new HashMap<>();
    private final List<MergeRule> mergeRules = new ArrayList<>();
    private final int vocabSize;

    public BPETokenizer(int vocabSize) {
        this.vocabSize = vocabSize;
        // 初始化基础字符（简化：ASCII可打印字符）
        for (int c = 32; c < 127; c++) {
            var token = String.valueOf((char) c);
            addToken(token);
        }
    }

    private void addToken(String token) {
        if (!tokenToId.containsKey(token)) {
            int id = tokenToId.size();
            tokenToId.put(token, id);
            idToToken.put(id, token);
        }
    }

    /**
     * 从语料训练 BPE 合并规则
     */
    public void train(List<String> corpus) {
        while (tokenToId.size() < vocabSize) {
            // 统计所有相邻符号对的频率
            var pairFreq = new HashMap<String, Integer>();

            for (var text : corpus) {
                var tokens = new ArrayList<>(tokenizeToChars(text));
                for (int i = 0; i < tokens.size() - 1; i++) {
                    var pair = tokens.get(i) + " " + tokens.get(i + 1);
                    pairFreq.merge(pair, 1, Integer::sum);
                }
            }

            if (pairFreq.isEmpty()) break;

            // 找最高频的 pair
            var bestPair = Collections.max(
                pairFreq.entrySet(), Map.Entry.comparingByValue());
            var parts = bestPair.getKey().split(" ");
            String left = parts[0], right = parts[1];
            String merged = left + right.replace("##", "");  // 简化

            // 创建合并规则
            mergeRules.add(new MergeRule(left, right, merged));
            addToken(merged);

            System.out.println("Add token: " + merged +
                " (vocab size: " + tokenToId.size() + ")");
        }
    }

    /**
     * 编码：将文本转为 token ID 列表
     */
    public List<Integer> encode(String text) {
        var tokens = tokenizeToChars(text);
        for (var rule : mergeRules) {
            tokens = applyMerge(tokens, rule);
        }
        return tokens.stream()
            .map(t -> tokenToId.getOrDefault(t, 0))  // 0 = UNK
            .collect(Collectors.toList());
    }

    private List<String> tokenizeToChars(String text) {
        var chars = new ArrayList<String>();
        for (char c : text.toCharArray()) {
            chars.add(String.valueOf(c));
        }
        return chars;
    }

    private List<String> applyMerge(List<String> tokens, MergeRule rule) {
        var result = new ArrayList<String>();
        int i = 0;
        while (i < tokens.size()) {
            if (i + 1 < tokens.size() &&
                tokens.get(i).equals(rule.left()) &&
                tokens.get(i + 1).equals(rule.right())) {
                result.add(rule.merged());
                i += 2;
            } else {
                result.add(tokens.get(i));
                i++;
            }
        }
        return result;
    }

    /**
     * 解码：将 token ID 列表转回文本
     */
    public String decode(List<Integer> ids) {
        return ids.stream()
            .map(id -> idToToken.getOrDefault(id, "<?>"))
            .collect(Collectors.joining())
            .replace("##", "");
    }

    public static void main(String[] args) {
        var bpe = new BPETokenizer(300);
        bpe.train(List.of(
            "low lower lowest",
            "new newer newest",
            "wide wider widest"
        ));
        var encoded = bpe.encode("lowest");
        System.out.println("Input: lowest");
        System.out.println("Tokens: " + encoded);
        System.out.println("Decoded: " + bpe.decode(encoded));
    }
}
```

### WordPiece

Google 的 BERT 使用的分词算法。与 BPE 的核心区别在于**合并策略**：

```
BPE 合并策略：
  选频率最高的 pair → 纯频率驱动

WordPiece 合并策略：
  选分数最高的 pair
  分数 = pair_freq / (left_freq × right_freq)
  目的：优先合并"互相依赖"的 pair，而非频率最高的
```

**与 BPE 的关键区别 — `##` 前缀：**

WordPiece 使用 `##` 标记非词首的 token。这解决了歧义问题：

```
"unbelievable" →
  BPE:      [un, bel, ie, vable]      ← 无法区分词首
  WordPiece: [un, ##bel, ##ie, ##vable] ← 明确区分词首/非词首
```

**为什么 `##` 重要**：在预训练时，同一个子词在词首和词中位置可能含义不同。`##` 标记让模型学习不同的 embedding。

**WordPiece 训练 Java 示例：**

```java
public class WordPieceTrainer {

    record Candidate(String left, String right, String merged, double score) {}

    public Optional<Candidate> findBestMerge(
            Map<String, Integer> tokenFreq,
            Map<String, Integer> pairFreq) {

        double bestScore = -1;
        Candidate bestCandidate = null;

        for (var entry : pairFreq.entrySet()) {
            var parts = entry.getKey().split(" ");
            String left = parts[0], right = parts[1];
            int pairCount = entry.getValue();
            int leftCount = tokenFreq.getOrDefault(left, 1);
            int rightCount = tokenFreq.getOrDefault(right, 1);

            // WordPiece 分数 = pair_freq / (left_freq × right_freq)
            double score = (double) pairCount / (leftCount * rightCount);

            if (score > bestScore) {
                bestScore = score;
                String merged = left + right.replace("##", "");
                bestCandidate = new Candidate(left, right, merged, score);
            }
        }
        return Optional.ofNullable(bestCandidate);
    }

    // 词首 token 不加 ##，非词首 token 加 ##
    public static boolean isWordStart(String token) {
        return !token.startsWith("##");
    }
}
```

### SentencePiece / Unigram

Google 开发的与语言无关的分词器，被 LLaMA、Mistral 等使用。

**核心特点：**

1. **直接在原始文本上训练**：不需要预分词（pre-tokenization），直接处理 Unicode 字符
2. **将空格视为普通字符**：用 `_` (U+2581) 代表空格，实现可逆分词
3. **Unigram 语言模型**：不是贪心合并，而是通过概率模型选择最优分词

```
输入: "Hello World"
SentencePiece: [▁Hello, ▁World]
              （▁ 是空格占位符）

可逆性：
  encode("Hello World") → [▁Hello, ▁World]
  decode([▁Hello, ▁World]) → "Hello World"
  （空格完美恢复，因为空格被编码为▁）
```

**Unigram 算法核心：**

```
1. 从一个大的种子词汇表开始（如所有子串）
2. 训练 Unigram 语言模型（每个 token 有概率 p(token)）
3. 重复以下直到词汇表大小合适：
   a. 对每个 token，计算删除它后总损失增加多少
   b. 删除损失增加最少的 token（最不重要）
   c. 重新训练 Unigram 模型
4. 最终词汇表 + Viterbi 算法做分词
```

**Viterbi 分词（前向-后向）：**

```java
public class UnigramTokenizer {
    private final Map<String, Double> tokenProb;  // token → log probability

    public UnigramTokenizer(Map<String, Double> tokenProb) {
        this.tokenProb = tokenProb;
    }

    /**
     * Viterbi 算法找最优分词路径
     * dp[i] = 到位置 i 的最优分词的最高累计 log 概率
     */
    public List<String> tokenize(String text) {
        int n = text.length();
        var dp = new double[n + 1];
        var prev = new int[n + 1];
        Arrays.fill(dp, Double.NEGATIVE_INFINITY);
        dp[0] = 0;

        for (int i = 0; i < n; i++) {
            if (dp[i] == Double.NEGATIVE_INFINITY) continue;
            for (int j = i + 1; j <= Math.min(n, i + 20); j++) {  // 限制最长 token
                var sub = text.substring(i, j);
                var prob = tokenProb.get(sub);
                if (prob != null) {
                    double newScore = dp[i] + prob;
                    if (newScore > dp[j]) {
                        dp[j] = newScore;
                        prev[j] = i;
                    }
                }
            }
        }

        // 回溯
        var tokens = new ArrayList<String>();
        int pos = n;
        while (pos > 0) {
            int start = prev[pos];
            tokens.add(0, text.substring(start, pos));
            pos = start;
        }
        return tokens;
    }
}
```

### Tokenizer 对比

| 特性 | GPT-4 (cl100k_base) | Claude (Anthropic) | LLaMA (SentencePiece) |
|------|---------------------|---------------------|------------------------|
| 算法 | BPE | BPE (改良) | SentencePiece / BPE |
| 词汇表大小 | 100,256 | ~100,000 | 32,000 (LLaMA 2) / 128,000 (LLaMA 3) |
| 中文效率 | 中等（1.5-2 token/字） | 中等 | 低（2-3 token/字，小词表） |
| 代码效率 | 高 | 高 | 中等 |
| 多语言 | 优秀 | 优秀 | LLaMA 2 一般，LLaMA 3 大幅改善 |
| 特殊编码 | 自动处理 | 自动处理 | 需注意空格处理 |

### Special Tokens

```
常见特殊 Token：
┌──────────┬─────────────────────────────────────────────┐
│ Token    │ 用途                                       │
├──────────┼─────────────────────────────────────────────┤
│ BOS      │ Beginning of Sequence (序列开始)            │
│ EOS      │ End of Sequence (序列结束，停止生成)        │
│ PAD      │ Padding (批处理时对齐长度)                  │
│ UNK      │ Unknown (词汇表外的 token)                  │
│ SEP      │ Separator (分隔两个句子/段落)               │
│ CLS      │ Classification (BERT 分类任务标记)          │
│ MASK     │ Mask (MLM 中被遮蔽的 token)                 │
├──────────┼─────────────────────────────────────────────┤
│ 控制Token │ <|system|>, <|user|>, <|assistant|>        │
│          │ <|function_call|>, <|endoftext|>            │
└──────────┴─────────────────────────────────────────────┘
```

### Token 计数与成本估算

在实际调用 API 之前估算 token 数非常重要——直接关系到成本和延迟。

```java
import java.util.List;
import java.util.Map;

/**
 * Token 计数与成本估算工具
 */
public class TokenCostEstimator {

    // 大致的 token 换算规则（中文约 1.5-2 token/字，英文约 0.75 token/词）
    public static final double CHARS_PER_TOKEN_EN = 4.0;     // 英文字符/token
    public static final double CHARS_PER_TOKEN_ZH = 1.5;     // 中文字符/token
    public static final double TOKENS_PER_ZH_CHAR = 1.8;     // token/中文字

    // 模型定价 (2026年参考，实际需查最新价格)
    public record ModelPricing(
        String model,
        double inputPricePer1M,   // $/1M input tokens
        double outputPricePer1M,  // $/1M output tokens
        int contextWindow
    ) {}

    public static final Map<String, ModelPricing> PRICING = Map.of(
        "gpt-4o", new ModelPricing("gpt-4o", 2.50, 10.00, 128_000),
        "gpt-4o-mini", new ModelPricing("gpt-4o-mini", 0.15, 0.60, 128_000),
        "claude-3.5-sonnet", new ModelPricing("claude-3.5-sonnet", 3.00, 15.00, 200_000),
        "deepseek-v3", new ModelPricing("deepseek-v3", 0.27, 1.10, 128_000)
    );

    /**
     * 粗略估算 token 数
     */
    public static int estimateTokens(String text) {
        int zhChars = 0;
        int enChars = 0;

        for (char c : text.toCharArray()) {
            if (Character.UnicodeScript.of(c) == Character.UnicodeScript.HAN) {
                zhChars++;
            } else if (!Character.isWhitespace(c)) {
                enChars++;
            }
        }

        return (int) Math.ceil(
            zhChars * TOKENS_PER_ZH_CHAR +
            enChars / CHARS_PER_TOKEN_EN
        );
    }

    /**
     * 计算成本
     */
    public record CostEstimate(double inputCost, double outputCost, double totalCost) {
        @Override
        public String toString() {
            return String.format("Input: $%.6f | Output: $%.6f | Total: $%.6f",
                inputCost, outputCost, totalCost);
        }
    }

    public static CostEstimate estimateCost(
            String modelId, int inputTokens, int estimatedOutputTokens) {
        var pricing = PRICING.getOrDefault(modelId,
            new ModelPricing(modelId, 5.0, 15.0, 128_000));

        double inputCost = inputTokens / 1_000_000.0 * pricing.inputPricePer1M();
        double outputCost = estimatedOutputTokens / 1_000_000.0 * pricing.outputPricePer1M();

        return new CostEstimate(inputCost, outputCost, inputCost + outputCost);
    }

    public static void main(String[] args) {
        var prompt = """
            你是一位资深Java架构师。请详细解释Virtual Threads的工作原理，
            包括调度机制、与平台线程的区别、以及在实际项目中的最佳实践。
            """;

        int tokens = estimateTokens(prompt);
        System.out.println("Prompt token 估算: " + tokens);

        for (var entry : PRICING.entrySet()) {
            var cost = estimateCost(entry.getKey(), tokens, 500);
            System.out.println(entry.getKey() + ": " + cost);
        }
    }
}
```

## Embedding 原理

### 从 Word2Vec 到 Sentence Embedding

```
Embedding 技术演进：

2013 ─ Word2Vec (Mikolov)
       ├── CBOW: 上下文 → 中心词
       └── Skip-gram: 中心词 → 上下文
       局限：静态词向量，一词一义

2018 ─ ELMo / BERT
       上下文感知的 Embedding
       同一个词在不同句子中有不同向量

2020 ─ Sentence-BERT
       直接用 BERT 做句子 Embedding
       通过 Pooling + 对比学习优化

2022 ─ Instructor / E5 / BGE
       指令感知的 Embedding
       不同任务用不同 Prompt 前缀

2024 ─ Matryoshka / BGE-M3
       多粒度、多维度
       一个模型，多种用途
```

### 对比学习 (Contrastive Learning)

现代 Embedding 模型（BGE、E5、GTE）的核心训练方法。

**核心思想**：拉近正样本对的距离，拉远负样本对的距离。

```
对比学习训练框架：

Batch 内的每个 sentence 都有：
  - 1 个正样本（语义相关的句子/段落）
  - N-1 个负样本（batch 内其他句子的正样本）

目标：正样本对的余弦相似度 > 负样本对的余弦相似度
```

**InfoNCE Loss：**

$$\mathcal{L} = -\log \frac{\exp(\text{sim}(h_i, h_i^+) / \tau)}{\exp(\text{sim}(h_i, h_i^+) / \tau) + \sum_{j=1}^{K} \exp(\text{sim}(h_i, h_j^-) / \tau)}$$

其中 τ 是温度参数（temperature）。

**温度参数的作用：**

```
温度 τ 控制模型对"困难负样本"的敏感度：
  τ → 0 (低温)：模型更关注最相似的负样本（hard negatives）
  τ → ∞ (高温)：所有负样本权重均匀
  τ ≈ 0.05-0.1：实践经验中的常用值
```

**Java 模拟对比学习 Loss：**

```java
public class ContrastiveLearning {

    /**
     * 计算 InfoNCE Loss
     * @param embeddings [batchSize][dim] 所有样本的 embedding
     * @param positivePairs [batchSize] 每个样本的正样本索引
     * @param temperature 温度参数
     */
    public static double infoNCELoss(
            float[][] embeddings,
            int[] positivePairs,
            float temperature) {

        int batchSize = embeddings.length;
        double totalLoss = 0;

        for (int i = 0; i < batchSize; i++) {
            // 计算与所有样本的相似度
            var sims = new double[batchSize];
            for (int j = 0; j < batchSize; j++) {
                sims[j] = cosineSimilarity(embeddings[i], embeddings[j]) / temperature;
            }

            // 正样本相似度
            double posSim = sims[positivePairs[i]];

            // Log-sum-exp 技巧防止溢出
            double maxSim = Arrays.stream(sims).max().orElse(0);
            double sumExp = 0;
            for (double s : sims) {
                sumExp += Math.exp(s - maxSim);
            }
            totalLoss += -(posSim - maxSim - Math.log(sumExp));
        }

        return totalLoss / batchSize;
    }

    public static double cosineSimilarity(float[] a, float[] b) {
        double dot = 0, normA = 0, normB = 0;
        for (int i = 0; i < a.length; i++) {
            dot += (double) a[i] * b[i];
            normA += (double) a[i] * a[i];
            normB += (double) b[i] * b[i];
        }
        return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8);
    }
}
```

### 常用 Embedding 模型

| 模型 | 维度 | 最大Token | 中文 | MTEB | 特色 |
|------|------|-----------|------|------|------|
| text-embedding-3-large | 256-3072 | 8191 | 一般 | 64.6 | Matryoshka, 多维度 |
| BGE-M3 | 1024 | 8192 | 优秀 | 64.2 | Dense+Sparse+ColBERT |
| GTE-Qwen2-7B | 3584 | 32768 | 优秀 | 67.0+ | 大参数量，超长文本 |
| E5-mistral-7b-instruct | 4096 | 32768 | 一般 | 66.6 | Mistral 底座 |
| jina-embeddings-v3 | 1024 | 8192 | 一般 | 65+ | 多任务 LoRA |

### BGE-M3 特色

BGE-M3 是目前中文场景最推荐的 Embedding 模型之一，由 BAAI 发布。它的核心创新是**三路输出**：

```
BGE-M3 架构：

输入文本
    │
    ▼
BERT-base (XLM-RoBERTa)
    │
    ├──► Dense Embedding (1024维)
    │    标准稠密向量，用于向量检索
    │    输出: [0.02, -0.15, 0.31, ...]
    │
    ├──► Sparse Embedding (词表大小维)
    │    每个 token 的权重（类 BM25）
    │    输出: {"虚拟": 1.2, "线程": 2.1, "并发": 0.8, ...}
    │    用于关键词检索，可解释性强
    │
    └──► ColBERT Embedding (token序列 × 维度)
        每个 token 一个向量（Late Interaction）
        输出: [[tok1_emb], [tok2_emb], ...]
        用于精细匹配（如重排）
```

**三路输出的使用场景：**

```
混合检索策略：
┌──────────────────────────────────────────────────────────┐
│  Query                                                   │
│    │                                                     │
│    ├──► Dense Embedding ──► pgvector ANN 检索            │
│    ├──► Sparse Embedding ─► Elasticsearch 关键词检索     │
│    └──► ColBERT ──────────► 候选结果重排（Late Interaction）
│                              │                           │
│                              ▼                           │
│                        融合排序 (RRF)                     │
│                              │                           │
│                              ▼                           │
│                         最终结果                          │
└──────────────────────────────────────────────────────────┘
```

### Matryoshka Embedding

Matryoshka（俄罗斯套娃）Embedding 是 OpenAI 和学术界都在推广的一项关键技术。它的核心思想：**一个向量，多种维度**。

```
传统 Embedding：
  1024维模型 → 只能用1024维 → 想要512维？重新训练

Matryoshka Embedding：
  1024维模型 → 可以用1024维（最高精度）
            → 也可以用512维（精度稍降，存储减半）
            → 也可以用256维（精度再降，存储再减半）
            → ...

  就像一个俄罗斯套娃，外层包含内层，内层是外层的"粗粒度摘要"
```

**训练方法**：在训练时不仅计算全维度的 Loss，还同时计算截断到各种维度的 Loss：

```
ℒ_total = ℒ_1024 + ℒ_512 + ℒ_256 + ℒ_128 + ℒ_64 + ...

对于每种维度 d，只取 embedding 的前 d 维计算相似度：
sim_d(a, b) = cosine_similarity(a[:d], b[:d])
```

**维度 vs 性能权衡（实际数据参考）：**

```
维度    存储(相对)   检索速度   MTEB Recall  适用场景
1024    1x          基准      100% (max)    高精度需要
512     0.5x        1.5x      ~99%           生产默认
256     0.25x       2x        ~97%           高吞吐场景
128     0.125x      3x        ~93%           初筛/粗排
64      0.0625x     4x        ~85%           粗略过滤
```

**Java 使用 Matryoshka Embedding：**

```java
public class MatryoshkaEmbedding {
    private final float[] fullEmbedding;
    private final int fullDim;

    public MatryoshkaEmbedding(float[] fullEmbedding) {
        this.fullEmbedding = fullEmbedding;
        this.fullDim = fullEmbedding.length;
    }

    /**
     * 截取前 matryoshkaDim 维
     */
    public float[] getEmbedding(int matryoshkaDim) {
        if (matryoshkaDim > fullDim) {
            throw new IllegalArgumentException(
                "matryoshkaDim " + matryoshkaDim + " exceeds fullDim " + fullDim);
        }
        return Arrays.copyOf(fullEmbedding, matryoshkaDim);
    }

    /**
     * 使用前 dim 维计算相似度
     */
    public static double similarity(float[] a, float[] b, int dim) {
        double dot = 0, normA = 0, normB = 0;
        for (int i = 0; i < dim; i++) {
            dot += (double) a[i] * b[i];
            normA += (double) a[i] * a[i];
            normB += (double) b[i] * b[i];
        }
        return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8);
    }

    /**
     * 自适应维度选择：根据目标召回率选择最小维度
     */
    public int selectOptimalDim(double targetRecall) {
        // 基于维度-召回率曲线的启发式规则
        // text-embedding-3-large 的大致对应关系
        if (targetRecall >= 0.99) return 1024;
        if (targetRecall >= 0.97) return 512;
        if (targetRecall >= 0.95) return 256;
        if (targetRecall >= 0.90) return 128;
        return 64;
    }
}
```

### 多模态 Embedding：CLIP

CLIP (Contrastive Language-Image Pre-training) 是 OpenAI 提出的文本-图像对齐模型。

**核心架构：**

```
CLIP 双塔模型：

文本塔                         图像塔
  │                              │
  ▼                              ▼
Transformer Encoder          ViT / ResNet
  │                              │
  ▼                              ▼
文本 Embedding (d维)        图像 Embedding (d维)
  │                              │
  └──────── 共享投影空间 ─────────┘
  │                              │
  ▼                              ▼
对比学习：正样本对的余弦相似度最大化
```

```
使用场景：

1. 图像搜索："a dog playing in the park" → 搜索图片库
2. 零样本分类：图片 → 计算与 ["cat", "dog", "car"] 的相似度 → 最高者为类别
3. 多模态 RAG：文本 Query 可以检索相关图片，反之亦然
```

## Embedding 质量评估：MTEB 基准

MTEB (Massive Text Embedding Benchmark) 是 Embedding 模型的标准评测基准，涵盖 7 大类任务：

| 任务类别 | 说明 | 指标 | 示例 |
|----------|------|------|------|
| Classification | 文本分类 | Accuracy, F1 | 情感分析、主题分类 |
| Clustering | 聚类分析 | V-Measure | 新闻聚类 |
| PairClassification | 文本对分类 | AP | 语义相似/重复检测 |
| Reranking | 重排序 | MAP, MRR | 搜索结果重排 |
| Retrieval | 信息检索 | NDCG@10 | 给定 Query 检索相关文档 |
| STS (Semantic Textual Similarity) | 语义相似度 | Spearman | 两个句子的相似度评分 |
| Summarization | 摘要评估 | Spearman | 摘要与原文的语义一致性 |

## Embedding 应用

### 语义搜索

```
构建流程：
文档 → 切片 → Embedding模型 → 向量 → 存入 pgvector/Redis
                                          ↑
查询 → Embedding模型 → 查询向量 ── ANN检索 ──→ Top-K 结果
```

### 聚类分析

```
嵌入聚类流程：
1. 对所有文档生成 embedding
2. 使用 K-means / DBSCAN 聚类
3. 每个簇代表一个主题
4. 分析每个簇的关键词和代表文档
```

### 异常检测

```
1. 对正常数据生成 embedding
2. 新数据的 embedding 如果与所有正常簇的距离都超过阈值 → 标记为异常
3. 应用：客服对话中的异常意图、文档中的异常内容
```

## 最佳实践

1. **选择 Tokenizer**：中文为主选 LLaMA 3 tokenizer 或 Qwen tokenizer，英文为主选 GPT-4 tokenizer（cl100k_base），不要混用
2. **成本预估**：开发阶段就建立 cost estimator，给每个 API 调用预估 token 消耗，避免月底账单爆炸
3. **Embedding 模型选择**：中文场景首选 BGE-M3，英文场景可选 text-embedding-3-large（支持 Matryoshka），超长文本选 GTE-Qwen2
4. **Matryoshka 实践**：生产环境建议存储全维度（1024/3072），查询时按需截取，这是"不增加存储、降低检索延迟"的免费午餐
5. **对比学习的温度参数**：如果用对比学习微调 embedding，温度参数 τ 通常取 0.05-0.1，太大会让模型学不到区分度

## 常见问题

**Q: 中文选哪个 tokenizer 最好？**

A: (1) 如果用闭源 API，GPT-4 的 cl100k_base 对中文支持已经很好（约1.5-2 token/中文字）；(2) 如果用开源模型，Qwen 的 tokenizer 中文效率最高（接近1 token/字），LLaMA 3 也大幅改善了中文（相比 LLaMA 2 的3 token/字）。

**Q: Matryoshka Embedding 会降低全维度质量吗？**

A: 轻微降低（<1% MTEB 分数），但换来了维度灵活性。OpenAI text-embedding-3-large 全维度（3072维）和 text-embedding-ada-002（1536维）相比，即使截取到 256 维也能达到 ada-002 全维度的效果。

**Q: BPE vs WordPiece vs SentencePiece 实际该选哪个？**

A: 不用选——你选的模型已经定了 tokenizer。但从知识角度：BPE 最通用（GPT 系列），WordPiece 适合需要明确词边界（BERT 系），SentencePiece 最语言无关（LLaMA/Mistral/Qwen）。

## 相关条目

- [[07-Transformer架构深度解析]] — Transformer 架构深入
- [[07-推理策略与评估方法]] — 推理和评估
- [[11-向量检索与混合检索]] — 检索与 RAG（Embedding 在 RAG 中的应用）
- [[10-Java文档解析全景]] — 文档切片和 Embedding 索引流水线
