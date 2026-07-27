---
domain: "07-AI基础"
title: "Transformer Architecture In Depth"
status: "draft"
level: "advanced"
sources:
  - level: "L4"
    url: "https://arxiv.org/abs/1706.03762"
    description: "Attention Is All You Need (Vaswani et al., 2017)"
  - level: "L4"
    url: "https://arxiv.org/abs/1810.04805"
    description: "BERT: Pre-training of Deep Bidirectional Transformers"
  - level: "L4"
    url: "https://arxiv.org/abs/2302.13971"
    description: "LLaMA: Open and Efficient Foundation Language Models"
  - level: "L4"
    url: "https://arxiv.org/abs/2104.09864"
    description: "RoPE: Rotary Position Embedding (Su et al.)"
  - level: "L5"
    url: "https://jalammar.github.io/illustrated-transformer/"
    description: "The Illustrated Transformer — community reference"
relations:
  prerequisite: []
  related: ["07-Embedding与Tokenization", "07-推理策略与评估方法"]
tags: ["transformer", "self-attention", "multi-head-attention", "positional-encoding", "decoder-only", "gpt", "llama"]
created: "2026-07-17"
updated: "2026-07-17"
---

# Transformer Architecture In Depth

## 概述

Transformer 是当代大语言模型（LLM）的基石架构。从 2017 年 Vaswani 等人发表《Attention Is All You Need》至今，Transformer 已经完全重塑了 NLP 和 AI 的格局。本条目从数学原理、工程实现到现代变体，全面深入剖析 Transformer 架构。

## 背景：为什么需要 Transformer

### Seq2Seq 与 RNN 时代

在 Transformer 出现之前，序列到序列（Seq2Seq）任务（翻译、摘要）主要由 RNN/LSTM/GRU 加注意力机制完成。

```
传统 Seq2Seq 架构：
┌──────────────┐         ┌──────────────┐
│   Encoder    │ context │   Decoder    │
│  (LSTM/GRU)  │────────►│  (LSTM/GRU)  │
└──────────────┘ vector  └──────────────┘
     ▲                        │
     │                        ▼
  "I love AI"            "我 爱 AI"
```

**RNN 的根本缺陷：**

1. **顺序计算瓶颈**：RNN 必须逐步处理序列，t 时刻依赖 t-1 时刻的隐状态，无法并行。一个长度为 1000 的序列需要 1000 步才能完成前向传播。
2. **长程依赖问题**：尽管 LSTM/GRU 引入了门控机制，但梯度消失/爆炸依然限制了有效捕捉长距离依赖的能力。信息在第 1 个 token 要传播到第 500 个 token，路径极长。
3. **注意力机制的早期形式受限**：Bahdanau Attention（加性注意力）虽然缓解了部分问题，但仍是 RNN 的"附加组件"。

### Transformer 的突破

Transformer 的核心理念：**完全抛弃循环结构，用 Self-Attention 机制处理序列中任意两个位置的关系。**

这带来三个根本性优势：
- **并行计算**：所有位置同时计算，训练速度提升数十倍
- **O(1) 的交互路径**：任意两个 token 之间的信息交互只需要一步（经过 attention 矩阵）
- **可扩展性**：为 GPT-3/4、LLaMA 等千亿参数模型铺平道路

## Self-Attention 机制详解

Self-Attention 是整个 Transformer 的心脏。它的核心直觉是：让序列中的每个 token "看到"所有其他 token，并根据它们之间的相关性（注意力权重）聚合信息。

### Q(Query) / K(Key) / V(Value) 矩阵的物理含义

这三个矩阵来自信息检索的类比：

```
┌────────────────────────────────────────────────────────────┐
│                    Self-Attention 直觉                      │
│                                                            │
│   数据库查询类比：                                          │
│   Query (Q): "我想找什么？"    ← 当前 token 的"搜索意图"    │
│   Key (K):   "我有什么标签？"  ← 每个 token 的"索引标识"    │
│   Value (V): "我的内容是什么？" ← 每个 token 的"实际信息"   │
│                                                            │
│   计算过程：                                                │
│   1. Q 与每个 K 做点积 → 得到"匹配度分数"（注意力权重）      │
│   2. Softmax 归一化 → 得到概率分布                          │
│   3. 用概率分布加权求和 V → 得到"这个位置应该关注什么"       │
└────────────────────────────────────────────────────────────┘
```

**数学形式**：对于输入序列 X ∈ R^{n × d_model}（n 个 token，每个 d_model 维）：

```
Q = X · W_Q      W_Q ∈ R^{d_model × d_k}
K = X · W_K      W_K ∈ R^{d_model × d_k}
V = X · W_V      W_V ∈ R^{d_model × d_v}
```

其中 d_k 是每个注意力头的维度（通常 d_k = d_v = d_model / num_heads）。

### 缩放点积注意力公式

$$\text{Attention}(Q, K, V) = \text{softmax}\left(\frac{QK^T}{\sqrt{d_k}}\right)V$$

**逐步拆解：**

```
输入: Q ∈ R^{n×d_k}, K ∈ R^{n×d_k}, V ∈ R^{n×d_v}

Step 1: 计算注意力分数
    scores = Q @ K^T          ← 形状: (n, n)
    scores[i][j] = Q_i · K_j  ← token i 对 token j 的"原始注意力"

Step 2: 缩放
    scores = scores / sqrt(d_k)
    原因: 防止点积过大导致 softmax 梯度消失

Step 3: Softmax 归一化
    weights = softmax(scores, dim=-1)  ← 形状: (n, n)
    每一行权重和为 1

Step 4: 加权聚合
    output = weights @ V       ← 形状: (n, d_v)
    output[i] = Σ_j weights[i][j] · V[j]
```

### √d_k 缩放的原因

这是面试中最常被问到的问题之一。需要从方差分析入手：

假设 Q 和 K 的每个分量独立，均值为 0，方差为 1。则点积 Q·K = Σ_{i=1}^{d_k} q_i · k_i。

每个乘积项 q_i · k_i 的方差为 Var(q_i) × Var(k_i) = 1。
所以 Q·K 的方差为 d_k（d_k 个无关项的方差求和）。

因此点积的值为 N(0, d_k) 分布。随着 d_k 增大：
- 点积的绝对值很大 → softmax 的输入进入"饱和区"
- softmax 输出极度尖锐（接近 one-hot）
- 梯度 → 0，模型无法学习

除以 √d_k 将方差从 d_k 拉回 1：
$$Var\left(\frac{QK^T}{\sqrt{d_k}}\right) = \frac{d_k}{d_k} = 1$$

**Java 代码演示：**

```java
import java.util.Random;

public class ScalingDemonstration {
    public static void main(String[] args) {
        var random = new Random(42);
        int dk = 64;  // 典型值
        int trials = 10000;

        // 演示点积方差
        double sumSquared = 0;
        for (int t = 0; t < trials; t++) {
            double dotProduct = 0;
            for (int i = 0; i < dk; i++) {
                double q = random.nextGaussian();
                double k = random.nextGaussian();
                dotProduct += q * k;
            }
            sumSquared += dotProduct * dotProduct;
        }

        double variance = sumSquared / trials;
        System.out.println("点积方差 (d_k=" + dk + "): " + variance);
        System.out.println("理论值 d_k: " + dk);
        // 输出：点积方差 ≈ 64 = d_k

        // 缩放后方差
        sumSquared = 0;
        double scale = Math.sqrt(dk);
        for (int t = 0; t < trials; t++) {
            double dotProduct = 0;
            for (int i = 0; i < dk; i++) {
                dotProduct += random.nextGaussian() * random.nextGaussian();
            }
            double scaled = dotProduct / scale;
            sumSquared += scaled * scaled;
        }
        variance = sumSquared / trials;
        System.out.println("缩放后点积方差: " + variance);
        System.out.println("期望值 1.0: " + (Math.abs(variance - 1.0) < 0.1));
    }
}
```

**Softmax 梯度分析：**

当 d_k 很大且不缩放时：
```
原始分数: QK^T 的某些元素 >> 其他元素
softmax([100, 1, 2]) ≈ [1.0, ~0, ~0]   ← 梯度几乎为零
softmax 的梯度 ∝ softmax(x_i) * (1 - softmax(x_i))

缩放后分数落入合理范围（~[-3, 3]）：
softmax([1.2, -0.5, 0.8]) ≈ [0.48, 0.09, 0.43]  ← 梯度健康
```

### 注意力权重可视化

注意力权重矩阵是一个 n×n 的热力图。对因果语言模型（Decoder-only），使用**因果注意力掩码（Causal Mask）**：

```
因果掩码矩阵（下三角）：
    t1  t2  t3  t4  t5
t1  ✓   ✗   ✗   ✗   ✗      token 1 只能看到自己
t2  ✓   ✓   ✗   ✗   ✗      token 2 能看到 1,2
t3  ✓   ✓   ✓   ✗   ✗      token 3 能看到 1,2,3
t4  ✓   ✓   ✓   ✓   ✗
t5  ✓   ✓   ✓   ✓   ✓
```

**Java 实现因果掩码：**

```java
public class CausalMask {
    /**
     * 创建因果注意力掩码
     * @param seqLen 序列长度
     * @return 掩码矩阵，true 表示允许关注，false 表示屏蔽
     */
    public static boolean[][] createCausalMask(int seqLen) {
        var mask = new boolean[seqLen][seqLen];
        for (int i = 0; i < seqLen; i++) {
            for (int j = 0; j < seqLen; j++) {
                mask[i][j] = j <= i;  // 下三角为 true
            }
        }
        return mask;
    }

    /**
     * 应用掩码到注意力分数
     * 被屏蔽的位置设为 -inf，这样 softmax 后权重为 0
     */
    public static float[][] applyMask(float[][] scores, boolean[][] mask) {
        int n = scores.length;
        var masked = new float[n][n];
        for (int i = 0; i < n; i++) {
            for (int j = 0; j < n; j++) {
                masked[i][j] = mask[i][j] ? scores[i][j] : Float.NEGATIVE_INFINITY;
            }
        }
        return masked;
    }
}
```

## Multi-Head Attention

单头注意力的表达容量有限 -- 一个 token 只能以"一种视角"看待其他 token。Multi-Head Attention 让模型可以**同时从多个不同的表示子空间**学习注意力。

```
Multi-Head Attention 结构：

输入 X (n × d_model)
    │
    ├──► Head 1: Q1,K1,V1 = X·W_Q1, X·W_K1, X·W_V1  → Attention_1
    ├──► Head 2: Q2,K2,V2 = X·W_Q2, X·W_K2, X·W_V2  → Attention_2
    ├──► ...
    └──► Head h: Qh,Kh,Vh = X·W_Qh, X·W_Kh, X·W_Vh  → Attention_h
    │
    ▼ Concat + Linear Projection
    MultiHead(Q,K,V) = Concat(head_1, ..., head_h) · W_O
```

**每个头的维度**：d_k = d_v = d_model / h。常见配置：
- Original Transformer: d_model=512, h=8, d_k=64
- GPT-3: d_model=12288, h=96, d_k=128
- LLaMA 70B: d_model=8192, h=64, d_k=128

**头的分工**：不同头倾向于学习不同模式：
- 语法头：关注句法结构（主谓关系、修饰关系）
- 语义头：关注语义关联（同义、反义）
- 位置头：关注相对位置
- 稀有头：专门处理特殊符号和低频模式

**Java 模拟 Multi-Head Attention：**

```java
import java.util.Arrays;

public record MultiHeadAttention(
    int numHeads,
    int dModel,
    int dK,
    int dV
) {
    public MultiHeadAttention {
        if (dModel % numHeads != 0) {
            throw new IllegalArgumentException(
                "dModel 必须能被 numHeads 整除");
        }
    }

    /**
     * 模拟：将多头结果拼接后通过 W_O 投影
     */
    public float[][] forward(float[][] Q, float[][] K, float[][] V) {
        int n = Q.length;  // seq_len

        // 模拟 h 个头的结果 concat
        float[][] allHeads = new float[n][dModel];

        for (int h = 0; h < numHeads; h++) {
            // 每个头独立做 Scaled Dot-Product Attention
            float[][] headOutput = scaledDotProductAttention(
                extractHead(Q, h), extractHead(K, h), extractHead(V, h));

            // 放入对应的维度位置
            int offset = h * dV;
            for (int i = 0; i < n; i++) {
                System.arraycopy(headOutput[i], 0,
                    allHeads[i], offset, dV);
            }
        }
        return allHeads;  // 简化为省略 W_O 投影
    }

    private float[][] extractHead(float[][] matrix, int head) {
        int n = matrix.length;
        int offset = head * dK;
        var headMatrix = new float[n][dK];
        for (int i = 0; i < n; i++) {
            System.arraycopy(matrix[i], offset, headMatrix[i], 0, dK);
        }
        return headMatrix;
    }

    private float[][] scaledDotProductAttention(
            float[][] Q, float[][] K, float[][] V) {
        int n = Q.length;
        var scores = new float[n][n];
        // Q @ K^T
        for (int i = 0; i < n; i++) {
            for (int j = 0; j < n; j++) {
                float dot = 0;
                for (int d = 0; d < dK; d++) {
                    dot += Q[i][d] * K[j][d];
                }
                scores[i][j] = dot / (float) Math.sqrt(dK);
            }
        }
        // softmax + 加权求和（省略实现）
        return scores; // 简化
    }
}
```

## Positional Encoding

Transformer 自身没有循环结构，因此完全看不到 token 的顺序信息。"A loves B"和"B loves A"的 token 集合完全相同，但语义截然不同。Positional Encoding 就是为了向模型注入位置信息。

### 正弦位置编码

原始 Transformer 使用正弦/余弦函数生成位置编码：

$$PE_{(pos, 2i)} = \sin\left(\frac{pos}{10000^{2i/d_{model}}}\right)$$
$$PE_{(pos, 2i+1)} = \cos\left(\frac{pos}{10000^{2i/d_{model}}}\right)$$

其中 pos 是位置，i 是维度索引。

**为什么使用正弦/余弦？**

1. **相对位置的线性关系**：PE(pos+k) 可以表示为 PE(pos) 的线性函数，因为：
   $$\sin(pos+k) = \sin(pos)\cos(k) + \cos(pos)\sin(k)$$
   这让模型更容易学习相对位置关系。

2. **外推能力**：理论上可以推广到训练时未见过的序列长度。

3. **波长多样性**：不同维度的正弦函数有不同频率（波长从 2π 到 10000·2π），类似不同粒度的"位置刻度尺"。

**Java 实现正弦位置编码：**

```java
public class SinusoidalPositionalEncoding {

    /**
     * @param maxLen 最大序列长度
     * @param dModel 模型维度
     * @return PE[maxLen][dModel]
     */
    public static float[][] encode(int maxLen, int dModel) {
        var pe = new float[maxLen][dModel];
        for (int pos = 0; pos < maxLen; pos++) {
            for (int i = 0; i < dModel; i++) {
                double angle = pos / Math.pow(10000.0, (2.0 * (i / 2)) / dModel);
                pe[pos][i] = (i % 2 == 0)
                    ? (float) Math.sin(angle)
                    : (float) Math.cos(angle);
            }
        }
        return pe;
    }

    /**
     * 验证：PE(pos+k) 可以通过旋转矩阵从 PE(pos) 得到
     */
    public static boolean verifyRelativeProperty() {
        int dModel = 128;
        var pe = encode(100, dModel);
        // 对于任何位置偏移 k，存在线性变换使得 PE(pos+k) = PE(pos) * M
        // 这对于偶数维度的 2×2 块成立
        return true; // 理论验证
    }
}
```

### 可学习位置编码

与正弦编码不同，将位置编码作为可训练参数：

```java
// 伪代码：可学习位置编码
public class LearnablePositionalEmbedding {
    private final float[][] embeddings; // [maxLen][dModel]
    // 在训练过程中通过反向传播更新
    // 优点：灵活性更高
    // 缺点：无法外推到更长序列
}
```

GPT 系列使用可学习的位置嵌入。BERT 也使用可学习的位置嵌入。

### RoPE（Rotary Position Embedding）

2021 年由 Su 等人提出，已成为 LLaMA、Qwen、Mistral 等主流开源模型的标准选择。

**核心思想**：不是将位置信息加到 token embedding 上，而是**通过旋转矩阵将位置信息编码到 attention 计算中的 Q 和 K 上**。

$$f_{\{q,k\}}(x_m, m) = R^d_{\Theta,m} \cdot W_{\{q,k\}} \cdot x_m$$

其中 R^d_{\Theta,m} 是一个块对角旋转矩阵：

```
R^d_{Θ,m} =
┌                                          ┐
│ cos(mθ₁) -sin(mθ₁)    0        0    ... │
│ sin(mθ₁)  cos(mθ₁)    0        0    ... │
│   0         0    cos(mθ₂) -sin(mθ₂) ... │
│   0         0    sin(mθ₂)  cos(mθ₂) ... │
│  ...       ...       ...      ...  ...  │
└                                          ┘
```

其中 θ_i = 10000^{-2(i-1)/d}, i = 1, 2, ..., d/2。

**计算简化**：实际实现中不需要构造完整矩阵，而是：

```
对于向量 x = [x₀, x₁, x₂, x₃, ...]
RoPE(x, m)[2i]   = x[2i]·cos(mθᵢ) - x[2i+1]·sin(mθᵢ)
RoPE(x, m)[2i+1] = x[2i]·sin(mθᵢ) + x[2i+1]·cos(mθᵢ)
```

**RoPE 的核心优势：**

1. **相对位置天然编码**：attention 分数 q_m^T·k_n 只依赖于相对位置 (m - n)，而不是绝对位置。
2. **远程衰减**：随着相对距离增加，attention 分数自然衰减，这符合语言中"距离越远关系越弱"的直觉。
3. **外推友好**：配合 NTK-aware 插值等技巧，可以在推理时扩展上下文窗口。
4. **训练稳定性**：不需要额外学习位置参数。

**Java 实现 RoPE：**

```java
public class RotaryPositionEmbedding {

    /**
     * 对 Q 或 K 应用 RoPE
     * @param x 输入向量 [seqLen][numHeads][headDim]
     * @param pos 当前位置
     */
    public static void applyRoPE(float[][][] x, int pos, int headDim) {
        for (int h = 0; h < x[0].length; h++) {
            for (int i = 0; i < headDim; i += 2) {
                double theta = Math.pow(10000.0, -2.0 * (i / 2.0) / headDim);
                float cos = (float) Math.cos(pos * theta);
                float sin = (float) Math.sin(pos * theta);

                float x0 = x[0][h][i];
                float x1 = x[0][h][i + 1];

                x[0][h][i] = x0 * cos - x1 * sin;
                x[0][h][i + 1] = x0 * sin + x1 * cos;
            }
        }
    }

    /**
     * 批量对序列应用 RoPE
     * @param x [seqLen][numHeads][headDim]
     */
    public static void applyRoPEBatch(float[][][] x) {
        for (int pos = 0; pos < x.length; pos++) {
            applyRoPE(new float[][][]{x[pos]}, pos, x[pos][0].length);
        }
    }

    /**
     * 验证：内积 q_i^T k_j 只依赖于 (i-j) 的 cos 值
     */
    public static boolean verifyRelativeProperty(
            float[] q, float[] k, int posI, int posJ, int headDim) {
        // 理论：
        // (RoPE(q,i)·RoPE(k,j)) 不含绝对位置 i 或 j
        // 只含 cos((i-j)·θ) 项
        return true;
    }
}
```

### ALiBi (Attention with Linear Biases)

2021 年由 Press 等人提出，是一种极其简洁的位置编码方法：直接给 attention 分数加一个线性衰减的偏置。

$$\text{ALiBi}(Q, K, V) = \text{softmax}\left(\frac{QK^T}{\sqrt{d_k}} + m \cdot B\right)V$$

其中 B 是一个固定的矩阵，B_{i,j} = -|i - j|（负值，距离越远惩罚越大），m 是每个头独立的斜率。

**ALiBi 的优势：**
- **零参数**：不引入任何可学习参数
- **极简实现**：只需在 attention 计算前加一个固定偏置
- **优异的外推**：在超长序列上表现稳定（Bloom 模型采用）
- **训练效率**：不需要计算位置编码

**Java 实现 ALiBi：**

```java
public class ALiBiMask {

    /**
     * 生成 ALiBi 偏置矩阵
     */
    public static float[][] generateBiases(int seqLen, int numHeads, int headDim) {
        var slopes = computeSlopes(numHeads);
        var biases = new float[seqLen][seqLen];

        for (int i = 0; i < seqLen; i++) {
            for (int j = 0; j < seqLen; j++) {
                // 对因果注意力：只惩罚"向前看"
                if (j <= i) {
                    biases[i][j] = slopes[0] * (j - i);  // 距离惩罚
                } else {
                    biases[i][j] = Float.NEGATIVE_INFINITY;
                }
            }
        }
        return biases;
    }

    /**
     * 计算每个头的斜率。遵循几何级数
     */
    private static float[] computeSlopes(int numHeads) {
        var slopes = new float[numHeads];
        for (int i = 0; i < numHeads; i++) {
            slopes[i] = (float) Math.pow(2, -8.0 * i / numHeads);
        }
        return slopes;
    }
}
```

## Feed-Forward Network (FFN)

每个 Transformer 层在 Attention 之后还有一个 FFN（也称 MLP 层）：

$$\text{FFN}(x) = W_2 \cdot \sigma(W_1 \cdot x + b_1) + b_2$$

其中 σ 是激活函数。FFN 的维度通常是 d_model 的 4 倍（d_ff = 4 × d_model）。

**激活函数演进：**

| 激活函数 | 公式 | 使用模型 | 特点 |
|----------|------|----------|------|
| ReLU | max(0, x) | 原始 Transformer | 简单，但死亡神经元和零梯度问题 |
| GELU | x·Φ(x) | BERT, GPT-2 | 比 ReLU 平滑，处处可导 |
| SwiGLU | x·σ(βx) ⊙ (xW₁+b₁) | LLaMA, PaLM | GLU 变体，效果显著优于 ReLU |

**SwiGLU 详细说明：**

SwiGLU 是 Swish-gated Linear Unit 的缩写：

$$\text{SwiGLU}(x) = (\text{Swish}(xW_1 + b_1)) \odot (xW_2 + b_2)$$

其中 Swish(x) = x · σ(x)（σ 是 sigmoid），⊙ 是逐元素乘法。

由于有额外的门控矩阵，SwiGLU 的三维通常设置为：
- d_ff = 8/3 × d_model × 2 ≈ round(8/3 × d_model) × 2
- 实际常用的 d_ff 大小约为 2.7 × d_model

**Java 示例：FFN 层模拟：**

```java
import java.util.function.Function;

public class FeedForwardNetwork {
    private final int dModel;
    private final int dFf;
    private final Function<Float, Float> activation;

    public FeedForwardNetwork(int dModel, ActivationType activationType) {
        this.dModel = dModel;
        this.activation = activationType.getFunction();
        // 标准 ReLU/GELU FFN
        this.dFf = activationType == ActivationType.SWIGLU
            ? (int) Math.ceil(8.0 / 3 * dModel)  // SwiGLU 更大
            : 4 * dModel;                         // 标准 FFN
    }

    /**
     * 前向传播 (简化，省略实际权重乘法)
     */
    public float[] forward(float[] x) {
        // W1 投影 + 激活
        var hidden = new float[dFf];
        for (int i = 0; i < dFf; i++) {
            hidden[i] = activation.apply(x[i % dModel]);
        }
        // W2 投影回 dModel
        var output = new float[dModel];
        for (int i = 0; i < dModel; i++) {
            for (int j = 0; j < dFf; j++) {
                output[i] += hidden[j] * 0.01f;  // 模拟权重
            }
        }
        return output;
    }

    public enum ActivationType {
        RELU(x -> Math.max(0, x)),
        GELU(x -> {
            // GELU 近似: 0.5 * x * (1 + tanh(sqrt(2/pi) * (x + 0.044715 * x^3)))
            double xd = x;
            return (float) (0.5 * xd * (1 + Math.tanh(
                Math.sqrt(2.0 / Math.PI) * (xd + 0.044715 * xd * xd * xd))));
        }),
        SWIGLU(x -> (float) (x / (1 + Math.exp(-x))));  // Swish(x) = x * sigmoid(x)

        private final Function<Float, Float> function;
        ActivationType(Function<Float, Float> f) { this.function = f; }
        Function<Float, Float> getFunction() { return function; }
    }
}
```

## Layer Normalization

Layer Normalization 对每个样本的特征维度做归一化：

$$\text{LayerNorm}(x) = \gamma \odot \frac{x - \mu}{\sqrt{\sigma^2 + \epsilon}} + \beta$$

其中 μ 和 σ² 是在 d_model 维度上计算的均值和方差。

### Pre-LN vs Post-LN

这是决定 Transformer 训练稳定性的关键设计选择：

```
Post-LN (原始 Transformer):
    x → Attention → + → LN → FFN → + → LN → output
        |_________|         |______|
        (残差)              (残差)

Pre-LN (GPT-2, LLaMA 等):
    x → LN → Attention → + → LN → FFN → + → output
                       |              |
                    (残差)         (残差)
```

**关键差异：**

| 特性 | Post-LN | Pre-LN |
|------|---------|--------|
| 梯度流 | 残差分支后做 LN，梯度可能不稳定 | LN 在子层之前，梯度流更直接 |
| 训练稳定性 | 大模型容易发散，需要 warmup | 天然稳定，几乎不需要 warmup |
| 收敛速度 | 较快（浅层） | 较慢但更稳定 |
| 使用模型 | 原始 Transformer, BERT | GPT-2/3, LLaMA, 大部分现代 LLM |

**实际建议：** 现代 LLM 几乎都使用 Pre-LN（或 RMSNorm 变体）。只有 BERT 系还在用 Post-LN。

### RMSNorm (Root Mean Square Normalization)

LLaMA 使用的归一化变体：

$$\text{RMSNorm}(x) = \gamma \odot \frac{x}{\sqrt{\frac{1}{d}\sum_{i=1}^{d}x_i^2 + \epsilon}}$$

相比 LayerNorm，RMSNorm 去掉了去均值步骤（μ=0），计算更快，效果相当。

## 架构变体：Encoder-Decoder vs Decoder-only vs Encoder-only

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Transformer 架构三大家族                       │
├─────────────────┬─────────────────────┬─────────────────────────────┤
│  Encoder-only   │ Encoder-Decoder     │     Decoder-only            │
│  (BERT, RoBERTa)│ (T5, BART, 原始)    │  (GPT, LLaMA, Claude)       │
├─────────────────┼─────────────────────┼─────────────────────────────┤
│                 │                     │                             │
│  [IN]→Enc→[OUT] │ [IN]→Enc→Dec→[OUT]  │    [IN]→Dec→Dec→...→[OUT]  │
│                 │                     │                             │
│  双向注意力      │ Enc 双向            │    因果注意力 (单向)        │
│                 │ Dec 因果+交叉注意力  │                             │
│                 │                     │                             │
│  理解任务        │ 生成式任务           │    自回归生成               │
│  分类/标注/NER   │ 翻译/摘要/问答       │    通用语言模型             │
└─────────────────┴─────────────────────┴─────────────────────────────┘
```

### Encoder-only (BERT 系)

```
BERT 结构：
┌──────────────────────┐
│  Token Embeddings    │
│  + Position Encoding │
│  + Segment Encoding  │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  Pre-LN              │
│  Multi-Head          │
│  Attention (双向)     │  ← 关键：可以看到前后所有 token
│  + Residual          │
├──────────────────────┤
│  Post-LN (BERT用     │
│        Post-LN!)     │
│  FFN (GELU)          │
│  + Residual          │
└──────────┬───────────┘
           ▼  重复 N 层
┌──────────────────────┐
│  输出: 每个 token     │
│  的上下文表示         │
└──────────────────────┘
```

### Decoder-only (GPT 系)

现代 LLM 的主流架构：

```
GPT/LLaMA 结构 (Pre-Norm)：
┌──────────────────────┐
│  Token Embeddings    │
│  + Position (RoPE)   │
└──────────┬───────────┘
           ▼  重复 N 层
┌──────────────────────┐
│  RMSNorm (Pre-LN)    │
│  Masked Multi-Head   │
│  Attention (因果)     │  ← 核心：只能看到前面的 token
│  + RoPE 应用到 Q,K   │
│  + Residual          │
├──────────────────────┤
│  RMSNorm (Pre-LN)    │
│  FFN (SwiGLU)        │  ← LLaMA 使用 SwiGLU
│  + Residual          │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  RMSNorm (Final)     │
│  LM Head → logits    │
└──────────────────────┘
```

**Decoder-only 成为主流的三个原因：**

1. **统一性**：任意 NLP 任务都可以表达为"给定前缀预测下一个 token"
2. **缩放性**：没有 Encoder-Decoder 的交互瓶颈，训练更高效
3. **In-Context Learning**：GPT-3 证明了 Decoder-only 模型的惊人 few-shot 能力

### 原始 Encoder-Decoder

原始 Transformer 为机器翻译设计，有完整的 Encoder 和 Decoder 两部分：

```
[源语言] → Encoder (双向，6层) → 编码表示
                                      ↓
[目标语言] → Decoder (因果，6层，每层先做Self-Attn再做Cross-Attn用Encoder输出)
                                      ↓
                                  输出概率 → 翻译结果
```

**Cross-Attention 与传统 Self-Attention 的区别：**
- Self-Attention: Q, K, V 都来自同一序列
- Cross-Attention: Q 来自 Decoder，K, V 来自 Encoder 输出

## 训练目标

### 自回归语言模型 (Causal LM / Next Token Prediction)

GPT 系列的标准训练目标。给定前缀 token x_{<t}，预测 x_t：

$$\mathcal{L} = -\sum_{t=1}^{T} \log P(x_t | x_{<t}; \theta)$$

```java
public class CausalLM {
    /**
     * 计算自回归语言模型的交叉熵损失
     * @param logits [seqLen][vocabSize] 模型输出 logits
     * @param targets [seqLen] 目标 token id
     * @return 平均损失
     */
    public static float computeLoss(float[][] logits, int[] targets) {
        float totalLoss = 0;
        int count = 0;
        for (int t = 0; t < targets.length; t++) {
            if (targets[t] < 0) continue;  // 跳过 padding
            // softmax + NLL
            float[] probs = softmax(logits[t]);
            totalLoss -= Math.log(probs[targets[t]] + 1e-9);
            count++;
        }
        return (float) (totalLoss / count);
    }

    private static float[] softmax(float[] logits) {
        float max = Float.NEGATIVE_INFINITY;
        for (float v : logits) max = Math.max(max, v);
        double sum = 0;
        float[] probs = new float[logits.length];
        for (int i = 0; i < logits.length; i++) {
            probs[i] = (float) Math.exp(logits[i] - max);
            sum += probs[i];
        }
        for (int i = 0; i < logits.length; i++) {
            probs[i] = (float) (probs[i] / sum);
        }
        return probs;
    }
}
```

### 掩码语言模型 (MLM)

BERT 的训练目标：随机 mask 掉 15% 的输入 token，让模型预测被 mask 的 token：

```
输入:  "The [MASK] sat on the [MASK]"
目标:  "cat"            "mat"

其中 15% mask 的分解：
  - 80% 替换为 [MASK]
  - 10% 保持原 token（防止训练-推理 mismmatch）
  - 10% 替换为随机 token（防过拟合 [MASK]）
```

## 上下文窗口扩展

### RoPE 外推问题

标准 RoPE 在超出训练长度时表现急剧下降。原因：高频维度的 θ 值没有在训练中见过对应的角度。

### NTK-aware 插值 (NTK-aware Interpolation)

核心思路：用"神经正切核"视角对 RoPE 的频率进行插值。

不改变物理位置，而是**缩放 θ 的基座**：

$$\theta_i' = \theta_i \cdot \left(\alpha \cdot \frac{\text{new\_ctx}}{\text{orig\_ctx}}\right)^{-2(i-1)/d}$$

其中 α 是缩放因子。NTK-aware 的巧妙之处：**对高频维度少缩放，对低频维度多缩放**，让高频保留局部信息，低频扩展远程信息。

### YaRN (Yet another RoPE extensioN)

在 NTK-aware 基础上增加"温度"参数 t 控制注意力熵：

$$\text{Attention} = \text{softmax}\left(\frac{QK^T}{\sqrt{d_k} \cdot t} + \text{bias}\right)$$

温度 t 控制注意力分布的尖锐程度：
- t > 1：分布更平滑（适合长上下文）
- t < 1：分布更尖锐（适合短上下文）

### LongRoPE

Microsoft 提出的方法，结合了：
1. 非均匀位置插值
2. 渐进式扩展训练
3. 达到 200 万 token 上下文窗口

## 关键论文

| 论文 | 年份 | 核心贡献 |
|------|------|----------|
| Attention Is All You Need | 2017 | 原始 Transformer 架构 |
| BERT | 2018 | 双向 Encoder 预训练 |
| GPT-2 | 2019 | 大规模 Decoder-only + zero-shot |
| GPT-3 | 2020 | In-Context Learning |
| RoPE | 2021 | 旋转位置编码 |
| LLaMA | 2023 | 开源高效 Decoder-only |
| LLaMA 2 | 2023 | 开源商用模型 |
| GPT-4 Technical Report | 2023 | 多模态+Scaling |
| LLaMA 3 | 2024 | 更强开源模型 |

## 最佳实践

1. **新项目优先选择 Decoder-only 架构**，使用 Pre-LN + RMSNorm + RoPE + SwiGLU 的经典组合（LLaMA 配方）
2. **Pre-Norm 比 Post-Norm 更稳定**，在深度 > 12 层时几乎必须使用 Pre-Norm
3. **Multi-Head Attention 的头数选择**：64~128 头常见于大模型，头维度过小（<64）会限制每个头的表示能力
4. **RoPE 是当前最推荐的位置编码**：外推性好，训练稳定，已被 LLaMA/Qwen/Mistral 验证

## 常见问题

**Q: 为什么现在主流都是 Decoder-only？**

A: 三个原因：(1) 统一性：所有任务都可以表达为 next-token prediction；(2) 高效性：比 Encoder-Decoder 少了交叉注意力的计算；(3) 涌现能力：GPT-3 证明了 Decoder-only 在足够大时展现出的 in-context learning 和推理能力。

**Q: Multi-Head Attention 中不同头真的学到了不同模式吗？**

A: 研究表明，虽然有些头确实有明确的"分工"（如语法 vs 语义），但很多头是可剪枝的（冗余）。这就是为什么出现了 GQA/MQA 等优化（在推理章节详述）。

**Q: RoPE 和 ALiBi 哪个更好？**

A: 目前 RoPE 胜出——几乎所有顶级开源模型（LLaMA/Qwen/Mistral/DeepSeek）都用 RoPE。ALiBi 虽然简洁，但在长序列上的效果不如经过 NTK-aware 扩展的 RoPE。

## 反向传播与优化器

反向传播（Backpropagation）是训练 Transformer 的核心算法，基于链式法则（Chain Rule）逐层计算损失函数对各权重的梯度 ∂L/∂W。训练时，前向传播（Forward Pass）构建计算图（Computation Graph），反向传播沿计算图逆序遍历，从损失函数出发，将梯度逐层回传至输入层。每个算子（MatMul、LayerNorm、Softmax）都定义了对应的前向和反向计算。

深度网络训练中，梯度消失（Gradient Vanishing）和梯度爆炸（Gradient Exploding）是经典问题。Sigmoid 和 Tanh 激活函数在饱和区梯度趋近于 0，导致深层参数几乎不更新。Transformer 中的残差连接（Residual Connection）提供了"梯度高速公路"：梯度可直接通过恒等映射路径回传，有效缓解了梯度消失。Layer Normalization 则通过稳定每层输入的分布来辅助梯度流动。

优化器方面，SGD+Momentum、Adam、AdamW 是主流选择：

| 优化器 | 核心公式 | 特点 |
|--------|----------|------|
| SGD+Momentum | v = μ·v + η·∇θ; θ = θ - v | 简单，泛化好，收敛慢 |
| Adam | m = β₁·m + (1-β₁)·∇; v = β₂·v + (1-β₂)·∇²; θ = θ - η·m̂/(√v̂ + ε) | 自适应学习率，收敛快 |
| AdamW | θ = θ - η·m̂/(√v̂ + ε) - η·λ·θ | 权重衰减与梯度更新解耦，泛化更好 |

SGD+Momentum 在图像任务上仍常用，但 Transformer 训练中 AdamW 几乎成为标准。AdamW 的关键改进在于将 L2 正则化（权重衰减）从自适应梯度更新中解耦，避免了 Adam 中大梯度参数正则化不足的问题。

学习率调度（LR Scheduling）对 Transformer 训练至关重要。Warmup 阶段学习率从 0 线性增加至目标值（通常前 4000 步），避免训练初期梯度不稳定导致的发散。之后使用余弦衰减（Cosine Decay）或逐步衰减（Step Decay）将学习率平滑降至接近 0。原版 Transformer 论文使用了 `lr = d_model^(-0.5) * min(step_num^(-0.5), step_num * warmup_steps^(-1.5))` 的定制调度。

```java
// JDK 25 + Spring Boot 4.x: 简化的 Adam 优化器实现（演示用途）
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public class AdamOptimizer {
    private final double learningRate;
    private final double beta1 = 0.9, beta2 = 0.999, epsilon = 1e-8;
    private final int warmupSteps;

    // 每个参数的一阶矩和二阶矩估计
    private final Map<String, double[]> m = new ConcurrentHashMap<>();
    private final Map<String, double[]> v = new ConcurrentHashMap<>();
    private int step = 0;

    public AdamOptimizer(double learningRate, int warmupSteps) {
        this.learningRate = learningRate;
        this.warmupSteps = warmupSteps;
    }

    public void update(String paramName, double[] params, double[] grads) {
        step++;
        var mVec = m.computeIfAbsent(paramName, k -> new double[params.length]);
        var vVec = v.computeIfAbsent(paramName, k -> new double[params.length]);

        // Warmup: 线性增长学习率
        double lr = learningRate * Math.min(1.0, (double) step / warmupSteps);
        // Adam 偏置校正
        double biasCorrection1 = 1.0 - Math.pow(beta1, step);
        double biasCorrection2 = 1.0 - Math.pow(beta2, step);

        for (int i = 0; i < params.length; i++) {
            mVec[i] = beta1 * mVec[i] + (1 - beta1) * grads[i];
            vVec[i] = beta2 * vVec[i] + (1 - beta2) * grads[i] * grads[i];
            double mHat = mVec[i] / biasCorrection1;
            double vHat = vVec[i] / biasCorrection2;
            params[i] -= lr * mHat / (Math.sqrt(vHat) + epsilon);
        }
    }
}
```

## 相关条目

- [[07-Embedding与Tokenization]] — Tokenization 和 Embedding 深入
- [[07-推理策略与评估方法]] — 推理策略和评估方法
- [[08-OpenAI兼容协议详解]] — 模型 API 协议
- [[08-模型能力矩阵与路由策略]] — 模型能力矩阵
