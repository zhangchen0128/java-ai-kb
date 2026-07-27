---
domain: "08-模型接入与推理"
title: "JVM内嵌推理：DJL与ONNX Runtime"
status: "draft"
level: "intermediate"
sources:
  - level: "L1"
    url: "https://djl.ai/"
    description: "DJL (Deep Java Library) 官方文档"
  - level: "L1"
    url: "https://onnxruntime.ai/docs/get-started/with-java.html"
    description: "ONNX Runtime Java API 官方文档"
  - level: "L2"
    url: "https://github.com/deepjavalibrary/djl"
    description: "DJL GitHub 仓库源码"
relations:
  prerequisite: ["07-Transformer架构深度解析", "07-Embedding与Tokenization"]
  related: ["08-模型能力矩阵与路由策略", "08-本地推理与Ollama", "08-云模型API与SDK使用"]
tags: ["djl", "onnx-runtime", "jvm-inference", "embedding", "sentiment-analysis", "token-count"]
created: "2026-07-20"
updated: "2026-07-20"
---

# JVM内嵌推理：DJL与ONNX Runtime

## 概述

并非所有AI推理都需要GPU集群或云端API。许多场景——如小型Embedding模型、文本分类、情感分析、关键词提取——完全可以在JVM进程内高效完成。JVM内嵌推理避免了网络延迟、序列化开销和外部服务依赖，是实现低延迟、高隐私AI功能的关键技术。本节深入介绍DJL（Deep Java Library）和ONNX Runtime Java两大JVM推理方案，以及它们的适用场景和选型决策。

## 一、DJL (Deep Java Library) 架构

### 1.1 引擎无关设计

DJL的核心设计哲学是"Write Once, Run Anywhere with Any Engine"。它提供统一的Java API，底层可以切换不同的深度学习引擎（PyTorch、TensorFlow、MXNet、ONNX Runtime），而业务代码无需修改。

```
┌─────────────────────────────────────────────────┐
│               DJL Unified API                    │
│   (Model、Predictor、Translator、Criteria...)     │
├──────────┬──────────┬──────────┬────────────────┤
│ PyTorch  │TensorFlow│  MXNet   │ ONNX Runtime   │
│ Engine   │ Engine   │  Engine  │    Engine      │
└──────────┴──────────┴──────────┴────────────────┘
```

**引擎切换示例**：只需在依赖中替换引擎，业务代码零改动。

```java
// 使用PyTorch引擎
// pom.xml: djl-pytorch-engine
var criteria = Criteria.builder()
    .setTypes(Image.class, Classifications.class)
    .optEngine("PyTorch")    // 只需在此处指定引擎
    .optModelPath(Paths.get("/models/resnet18.pt"))
    .build();

// 切换到ONNX Runtime引擎
// pom.xml: djl-onnxruntime-engine
// 代码不变，只改 optEngine("OnnxRuntime")
```

### 1.2 ModelZoo — 预训练模型市场

DJL的ModelZoo提供了开箱即用的预训练模型，覆盖图像识别、目标检测、NLP等场景。常用的ModelZoo包括：

| ModelZoo | 模型类型 | 典型模型 |
|----------|---------|---------|
| **Basic ModelZoo** (内置) | 图像分类 | ResNet-50、MobileNet、DenseNet |
| **MXNet ModelZoo** | 目标检测 | SSD、YOLO v3 |
| **PyTorch Hub** | NLP、图像 | BERT、GPT-2、YOLO v5 |
| **HuggingFace ModelZoo** | 通用NLP | BERT、Sentence Transformers、RoBERTa |

**从ModelZoo加载模型**：

```java
// 方式一：通过 Criteria 加载预训练模型
var criteria = Criteria.builder()
    .setTypes(Image.class, Classifications.class)
    .optArtifactId("ai.djl.mxnet:resnet")  // 自动下载预训练模型
    .build();

var model = ModelZoo.loadModel(criteria);

// 方式二：加载HuggingFace的Sentence Transformer模型
var criteria = Criteria.builder()
    .optEngine("PyTorch")
    .setTypes(String.class, float[].class)
    .optModelUrls("djl://ai.djl.huggingface.pytorch/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2")
    .build();

var embedder = ModelZoo.loadModel(criteria);
```

### 1.3 Translator — 前后处理抽象

Translator是DJL最核心的抽象之一，封装了模型的输入预处理和输出后处理逻辑：

```java
/**
 * 图像分类Translator：处理图像输入->分类输出
 */
var translator = new Translator<Image, Classifications>() {

    @Override
    public NDList processInput(TranslatorContext ctx, Image input) {
        // 预处理：调整大小、归一化、转换为NDArray
        var array = input.toNDArray(ctx.getNDManager(), Image.Flag.COLOR);
        array = NDImageUtils.resize(array, 224, 224);    // ResNet标准尺寸
        array = NDImageUtils.toTensor(array)              // (H,W,C) -> (C,H,W)
            .div(255.0f);                                 // 归一化到[0,1]
        array = NDImageUtils.normalize(array,             // 标准化
            new float[]{0.485f, 0.456f, 0.406f},        // ImageNet均值
            new float[]{0.229f, 0.224f, 0.225f});       // ImageNet标准差
        return new NDList(array);
    }

    @Override
    public Classifications processOutput(TranslatorContext ctx, NDList list) {
        // 后处理：logits -> softmax概率 -> 标签映射
        var probabilities = list.get(0).softmax(0);
        return new Classifications(
            List.of("cat", "dog", "bird"),              // 标签列表
            probabilities.toFloatArray()                 // 对应概率
        );
    }
};
```

**Translator的生命周期管理**：DJL在每次推理时调用`processInput`和`processOutput`，Translator实例可跨请求复用（线程安全由DJL保证）。对于复杂的NLP预处理（如Tokenizer），应在Translator中缓存Tokenizer实例。

### 1.4 Criteria — 声明式模型加载

Criteria采用Builder模式提供声明式的模型加载配置：

```java
var criteria = Criteria.builder()
    .setTypes(Input.class, Output.class)    // 输入/输出类型
    .optEngine("PyTorch")                   // 推理引擎
    .optModelName("bert-base-chinese")      // 模型名称
    .optModelPath(Paths.get("/models"))     // 本地模型路径
    .optModelUrls("https://...")            // 或远程模型URL
    .optTranslator(translator)              // 自定义Translator
    .optOption("optLevel", "3")             // 引擎特定优化选项
    .optDevice(Device.cpu())                // 设备选择(CPU/GPU)
    .build();
```

## 二、DJL常见场景实战

### 2.1 图像分类（ResNet）

```java
import ai.djl.Application;
import ai.djl.ModelException;
import ai.djl.inference.Predictor;
import ai.djl.modality.Classifications;
import ai.djl.modality.cv.Image;
import ai.djl.modality.cv.ImageFactory;
import ai.djl.repository.zoo.Criteria;
import ai.djl.repository.zoo.ModelZoo;
import ai.djl.repository.zoo.ZooModel;

import java.io.IOException;
import java.nio.file.Paths;

public class ImageClassifier {

    private final ZooModel<Image, Classifications> model;
    private final Predictor<Image, Classifications> predictor;

    public ImageClassifier() throws IOException, ModelException {
        // 从ModelZoo加载ResNet-50
        var criteria = Criteria.builder()
            .optApplication(Application.CV.IMAGE_CLASSIFICATION)
            .setTypes(Image.class, Classifications.class)
            .optArtifactId("ai.djl.mxnet:resnet")
            .optFilter("layers", "50")
            .optProgress(true)  // 显示下载进度
            .build();

        this.model = ModelZoo.loadModel(criteria);
        this.predictor = model.newPredictor();
    }

    public Classifications classify(String imagePath)
            throws IOException, ModelException {
        var img = ImageFactory.getInstance()
            .fromFile(Paths.get(imagePath));
        return predictor.predict(img);
    }

    public void close() {
        model.close();
    }

    public static void main(String[] args) throws Exception {
        var classifier = new ImageClassifier();
        var result = classifier.classify("cat.jpg");
        System.out.println("Best: " + result.best());
        // Output: Best: {"className": "tabby cat", "probability": 0.854}
        result.topK(5).forEach(System.out::println);
        classifier.close();
    }
}
```

### 2.2 文本Embedding（Sentence Transformers，小型BERT）

这是JVM内嵌推理最重要的应用场景之一。使用小型BERT模型（如paraphrase-multilingual-MiniLM-L12-v2，约118MB）在JVM中直接生成Embedding：

```java
import ai.djl.ModelException;
import ai.djl.huggingface.translator.TextEmbeddingTranslator;
import ai.djl.inference.Predictor;
import ai.djl.repository.zoo.Criteria;
import ai.djl.repository.zoo.ZooModel;
import ai.djl.training.util.ProgressBar;

import java.io.IOException;
import java.util.Arrays;

/**
 * JVM内嵌Sentence Embedding服务。
 * 模型大小约118MB，推理速度约5-10ms/句(CPU)。
 * 输出384维向量，适用于RAG索引、语义搜索、文本聚类。
 */
public class JvmEmbeddingService {

    private final ZooModel<String, float[]> model;
    private final Predictor<String, float[]> predictor;

    public JvmEmbeddingService() throws IOException, ModelException {
        var criteria = Criteria.builder()
            .setTypes(String.class, float[].class)
            .optEngine("PyTorch")
            .optModelUrls(
                "djl://ai.djl.huggingface.pytorch/" +
                "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2")
            .optTranslatorFactory(new TextEmbeddingTranslatorFactory())
            .optProgress(new ProgressBar())
            .build();

        this.model = criteria.loadModel();
        this.predictor = model.newPredictor();
    }

    /**
     * 对单条文本生成384维向量
     */
    public float[] embed(String text) throws ModelException {
        return predictor.predict(text);
    }

    /**
     * 批量Embedding（利用模型内部的batch优化）
     */
    public float[][] embedBatch(String[] texts) throws ModelException {
        return Arrays.stream(texts)
            .map(t -> {
                try {
                    return predictor.predict(t);
                } catch (Exception e) {
                    throw new RuntimeException(e);
                }
            })
            .toArray(float[][]::new);
    }

    /**
     * 余弦相似度计算
     */
    public static float cosineSimilarity(float[] a, float[] b) {
        float dot = 0, normA = 0, normB = 0;
        for (int i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        return dot / (float) (Math.sqrt(normA) * Math.sqrt(normB));
    }

    public void close() {
        model.close();
    }

    // 使用示例
    public static void main(String[] args) throws Exception {
        var service = new JvmEmbeddingService();

        var emb1 = service.embed("Java is a powerful programming language");
        var emb2 = service.embed("Java是一种强大的编程语言");
        var emb3 = service.embed("The weather is nice today");

        System.out.printf("Similarity (en-en): %.4f%n",
            cosineSimilarity(emb1, emb2));  // 约0.75 - 语义相似
        System.out.printf("Similarity (diff): %.4f%n",
            cosineSimilarity(emb1, emb3));  // 约0.30 - 语义不同

        service.close();
    }
}
```

### 2.3 文本分类与情感分析

```java
import ai.djl.ModelException;
import ai.djl.inference.Predictor;
import ai.djl.modality.nlp.bert.BertFullTokenizer;
import ai.djl.ndarray.NDArray;
import ai.djl.ndarray.NDList;
import ai.djl.ndarray.NDManager;
import ai.djl.repository.zoo.Criteria;
import ai.djl.repository.zoo.ZooModel;
import ai.djl.translate.Translator;
import ai.djl.translate.TranslatorContext;

import java.io.IOException;
import java.nio.file.Paths;

/**
 * JVM内嵌情感分析器。
 * 使用经过微调的BERT模型进行3分类：积极/消极/中性。
 */
public class SentimentAnalyzer {

    private final ZooModel<String, ClassificationResult> model;
    private final Predictor<String, ClassificationResult> predictor;

    private static final String[] LABELS = {"negative", "neutral", "positive"};

    public SentimentAnalyzer(String modelPath) throws IOException, ModelException {
        var criteria = Criteria.builder()
            .setTypes(String.class, ClassificationResult.class)
            .optEngine("PyTorch")
            .optModelPath(Paths.get(modelPath))
            .optTranslator(new SentimentTranslator())
            .build();

        this.model = criteria.loadModel();
        this.predictor = model.newPredictor();
    }

    public record ClassificationResult(
        String label,
        float confidence,
        float[] probabilities
    ) {}

    static class SentimentTranslator
            implements Translator<String, ClassificationResult> {

        private BertFullTokenizer tokenizer;
        private static final int MAX_LEN = 128;

        @Override
        public NDList processInput(TranslatorContext ctx, String input) {
            if (tokenizer == null) {
                // 加载与模型匹配的词汇表
                var vocabPath = Paths.get("bert-chinese-vocab.txt");
                tokenizer = new BertFullTokenizer(vocabPath);
            }

            var encoding = tokenizer.encode(input, MAX_LEN);
            var manager = ctx.getNDManager();

            var inputIds = manager.create(encoding.getIds());
            var attentionMask = manager.create(encoding.getAttentionMask());
            var tokenTypeIds = manager.create(encoding.getTypeIds());

            return new NDList(
                inputIds.expandDims(0),
                attentionMask.expandDims(0),
                tokenTypeIds.expandDims(0)
            );
        }

        @Override
        public ClassificationResult processOutput(
                TranslatorContext ctx, NDList list) {
            var logits = list.get(0).softmax(1);
            var probs = logits.toFloatArray();
            int bestIdx = 0;
            for (int i = 1; i < probs.length; i++) {
                if (probs[i] > probs[bestIdx]) bestIdx = i;
            }
            return new ClassificationResult(LABELS[bestIdx], probs[bestIdx], probs);
        }
    }

    public ClassificationResult predict(String text) throws ModelException {
        return predictor.predict(text);
    }
}
```

### 2.4 Token计数

在不需要完整NLP模型的情况下，使用DJL自带的HuggingFace Tokenizer进行精确的Token计数——这是AI网关计量计费的刚需：

```java
import ai.djl.huggingface.tokenizers.HuggingFaceTokenizer;

import java.nio.file.Paths;

/**
 * JVM内嵌Token计数器。不加载完整模型，仅加载tokenizer文件。
 * 支持多种模型词表：GPT-2(BPE)、LLaMA(SentencePiece)、BERT(WordPiece)。
 */
public class JvmTokenCounter {

    private final HuggingFaceTokenizer tokenizer;

    /**
     * @param tokenizerPath tokenizer.json 或 vocab.json 路径
     */
    public JvmTokenCounter(String tokenizerPath) {
        this.tokenizer = HuggingFaceTokenizer.newInstance(
            Paths.get(tokenizerPath));
    }

    /**
     * 精确计算文本的Token数量
     */
    public int countTokens(String text) {
        var encoding = tokenizer.encode(text);
        return encoding.getIds().length;
    }

    /**
     * 分批计数（用于大文本，避免OOM）
     */
    public long countTokensLarge(String text, int batchSize) {
        long total = 0;
        for (int i = 0; i < text.length(); i += batchSize) {
            var end = Math.min(i + batchSize, text.length());
            total += countTokens(text.substring(i, end));
            // BPE Tokenizer 在分段处可能有少量误差（< 0.5%）
        }
        return total;
    }

    /**
     * 获取Token ID序列（用于分析）
     */
    public long[] tokenIds(String text) {
        return tokenizer.encode(text).getIds();
    }

    /**
     * 基于Token计数的文本截断
     */
    public String truncateByTokens(String text, int maxTokens) {
        var encoding = tokenizer.encode(text);
        var ids = encoding.getIds();
        if (ids.length <= maxTokens) return text;

        // 解码前maxTokens个Token
        var truncatedIds = java.util.Arrays.copyOf(ids, maxTokens);
        return tokenizer.decode(truncatedIds);
    }

    public static void main(String[] args) {
        // 加载LLaMA 3的tokenizer（SentencePiece模型）
        var counter = new JvmTokenCounter("/models/llama3-tokenizer.json");

        var text = "Java虚拟线程(Virtual Threads)是JDK 21引入的革命性特性。";
        System.out.println("Tokens: " + counter.countTokens(text));
        // Output: Tokens: ~28 (具体取决于tokenizer)
    }
}
```

## 三、ONNX Runtime Java

### 3.1 ONNX格式简介

ONNX（Open Neural Network Exchange）是由Microsoft和Meta联合推出的开放神经网络交换格式。它的核心价值在于**跨框架互操作性**：

```
PyTorch模型  ──export──►  ONNX格式  ◄──import──  TensorFlow模型
                              │
                   ONNX Runtime推理引擎
                    (跨平台、高性能)
```

ONNX格式的优势：
- **框架无关**：任何训练框架导出的ONNX模型都可以用ONNX Runtime推理
- **硬件优化**：ONNX Runtime内置CPU/GPU优化（Intel MKL、NVIDIA TensorRT、AMD ROCm）
- **生态丰富**：HuggingFace、vLLM、Triton等生态工具都支持ONNX导出
- **格式成熟**：已成为AI模型互操作的事实标准

### 3.2 OrtSession与OrtEnvironment

ONNX Runtime Java SDK的核心API：

```java
import ai.onnxruntime.*;

import java.nio.FloatBuffer;
import java.nio.LongBuffer;
import java.nio.file.Paths;
import java.util.*;

/**
 * ONNX Runtime Java 推理示例。
 * Maven依赖: com.microsoft.onnxruntime:onnxruntime:1.18+
 */
public class OnnxBertClassifier {

    private final OrtEnvironment env;
    private final OrtSession session;

    public OnnxBertClassifier(String modelPath) throws OrtException {
        // 创建ONNX Runtime环境（全局单例）
        this.env = OrtEnvironment.getEnvironment();

        // 创建推理会话
        var sessionOptions = new OrtSession.SessionOptions();
        sessionOptions.setOptimizationLevel(
            OrtSession.SessionOptions.OptLevel.BASIC_OPT);
        sessionOptions.setCPUArenaAllocator(true);

        this.session = env.createSession(modelPath, sessionOptions);
    }

    /**
     * BERT文本分类推理
     * @param inputIds Token ID数组 [1, seq_len]
     * @param attentionMask 注意力掩码 [1, seq_len]
     * @param tokenTypeIds Token类型ID [1, seq_len]
     * @return logits [1, num_labels]
     */
    public float[] predict(long[] inputIds, long[] attentionMask,
                           long[] tokenTypeIds) throws OrtException {
        var batchSize = 1;
        var seqLen = inputIds.length;
        var shape = new long[]{batchSize, seqLen};

        // 准备输入Tensor
        var inputIdsTensor = OnnxTensor.createTensor(env,
            LongBuffer.wrap(inputIds), shape);
        var attentionMaskTensor = OnnxTensor.createTensor(env,
            LongBuffer.wrap(attentionMask), shape);
        var tokenTypeIdsTensor = OnnxTensor.createTensor(env,
            LongBuffer.wrap(tokenTypeIds), shape);

        var inputs = Map.of(
            "input_ids", inputIdsTensor,
            "attention_mask", attentionMaskTensor,
            "token_type_ids", tokenTypeIdsTensor
        );

        // 推理
        try (var results = session.run(inputs)) {
            var logits = (OnnxTensor) results.get(0);
            var logitsBuffer = logits.getFloatBuffer();
            var logitsArray = new float[(int) results.get(0)
                .getInfo().getShape()[1]];
            logitsBuffer.get(logitsArray);

            // 应用Softmax
            softmax(logitsArray);
            return logitsArray;
        } finally {
            inputIdsTensor.close();
            attentionMaskTensor.close();
            tokenTypeIdsTensor.close();
        }
    }

    private void softmax(float[] arr) {
        float max = Float.NEGATIVE_INFINITY;
        for (var v : arr) max = Math.max(max, v);
        double sum = 0;
        for (int i = 0; i < arr.length; i++) {
            arr[i] = (float) Math.exp(arr[i] - max);
            sum += arr[i];
        }
        for (int i = 0; i < arr.length; i++) {
            arr[i] = (float) (arr[i] / sum);
        }
    }

    /**
     * 获取模型元数据
     */
    public void printModelInfo() {
        System.out.println("Input names: " + session.getInputNames());
        System.out.println("Output names: " + session.getOutputNames());

        for (var name : session.getInputNames()) {
            var info = session.getInputInfo(name);
            System.out.printf("Input[%s]: %s%n", name, info);
        }
    }

    public void close() throws OrtException {
        session.close();
        env.close();
    }
}
```

### 3.3 从PyTorch/TensorFlow导出ONNX模型

**从PyTorch导出**：

```python
import torch
from transformers import AutoModel, AutoTokenizer

# 加载HuggingFace模型
model = AutoModel.from_pretrained("bert-base-chinese")
tokenizer = AutoTokenizer.from_pretrained("bert-base-chinese")

# 准备示例输入
inputs = tokenizer("测试文本", return_tensors="pt")

# 导出为ONNX
torch.onnx.export(
    model,
    (inputs["input_ids"], inputs["attention_mask"],
     inputs["token_type_ids"]),
    "bert-base-chinese.onnx",
    input_names=["input_ids", "attention_mask", "token_type_ids"],
    output_names=["last_hidden_state"],
    dynamic_axes={
        "input_ids": {0: "batch", 1: "seq_len"},
        "attention_mask": {0: "batch", 1: "seq_len"},
        "token_type_ids": {0: "batch", 1: "seq_len"},
        "last_hidden_state": {0: "batch", 1: "seq_len"}
    },
    opset_version=17
)
```

**从TensorFlow导出**：

```python
import tensorflow as tf
import tf2onnx

# 加载模型
model = tf.keras.models.load_model("model.h5")

# 转换为ONNX
spec = (tf.TensorSpec(model.inputs[0].shape,
                      model.inputs[0].dtype, name="input"),)
model_proto, _ = tf2onnx.convert.from_keras(model,
    input_signature=spec, opset=13)
with open("model.onnx", "wb") as f:
    f.write(model_proto.SerializeToString())
```

## 四、JVM推理适用场景

### 4.1 理想场景矩阵

| 场景 | 模型大小 | 推理延迟 | CPU占用 | JVM适用性 |
|------|---------|---------|---------|-----------|
| Token计数 | < 5MB | < 1ms | 极低 | **理想** |
| 文本分类(3-10类) | 50-200MB | 10-50ms | 低-中 | **理想** |
| 情感分析 | 50-200MB | 10-50ms | 低-中 | **理想** |
| 小型Embedding (384维) | 50-200MB | 5-20ms | 低-中 | **理想** |
| 关键词提取 | 50-200MB | 10-30ms | 低 | **理想** |
| 中型Embedding (768维) | 200-500MB | 20-80ms | 中 | 可行 |
| NER实体识别 | 100-500MB | 30-100ms | 中 | 可行 |
| 大型Embedding (1024+维) | 500MB+ | 50-200ms | 高 | 评估 |
| 7B+ LLM推理 | 5GB+ | >5s | 极高 | 不适用 |

### 4.2 具体适用场景示例

**(a) bge-small-zh (384维中文Embedding)**
- 模型大小：约100MB（ONNX量化后约50MB）
- 推理速度：约8ms/句 (Mac M系列芯片)，约15ms/句 (Intel x86)
- 适用：实时RAG检索、语义去重、FAQ匹配

**(b) 文本分类/审核**
- 新闻分类（20类）、垃圾评论识别、敏感内容过滤
- 推理延迟 < 50ms，满足实时审核需求

**(c) 关键词/摘要提取**
- 使用小型Seq2Seq模型进行关键词提取
- 训练后导出ONNX，在JVM中运行

**(d) Token计数服务**
- 对于AI网关、成本计量系统，Token计数是高频、低延迟的刚需
- JVM内嵌Token计数避免了每次计费都调用外部服务的开销

## 五、选型决策：JVM vs 推理服务 vs API

### 5.1 三维决策矩阵

```
                    延迟要求
                 低(<50ms)      中(50-500ms)    高(>500ms)
                ┌───────────┬──────────────┬──────────────┐
          小    │  JVM推理  │  JVM推理     │  JVM推理     │
       (<200MB) │  (首选)   │  (首选)      │  (过度)      │
模               ├───────────┼──────────────┼──────────────┤
型         中    │  JVM推理  │  推理服务    │  推理服务    │
大    (200MB-   │  (评估)   │  (vLLM/TGI)  │  (vLLM/TGI)  │
小       1GB)   │           │              │              │
                ├───────────┼──────────────┼──────────────┤
          大    │  推理服务 │  推理服务    │  API调用     │
       (>1GB)   │  (GPU必须)│  (GPU必须)   │  (最省心)    │
                └───────────┴──────────────┴──────────────┘
```

### 5.2 各方案详细对比

| 维度 | JVM内嵌 | 独立推理服务(vLLM/Ollama) | 云API(OpenAI等) |
|------|---------|--------------------------|-----------------|
| **延迟** | 最低（无网络+序列化开销） | 低（localhost网络开销约2-5ms） | 高（公网延迟50-500ms） |
| **吞吐量** | 低（共享JVM CPU） | 高（专用GPU/CPU） | 最高（弹性扩容） |
| **隐私** | 最高（数据不出JVM） | 高（数据不出内网） | 低（数据出网） |
| **运维** | 零（进程内） | 中（需独立部署运维） | 零（SaaS） |
| **模型限制** | 仅小型（< 500MB） | 任意大小 | 任意大小 |
| **成本** | 零（CPU已有） | 中（服务器+GPU） | 高（按量付费） |
| **弹性** | 无（随JVM扩缩） | 有（独立HPA） | 极高（按需） |
| **更新** | 随应用发布 | 独立发布 | 透明升级 |

### 5.3 混合架构建议

最优方案通常不是单一选择，而是分层组合：

```
┌─────────────────────────────────────────────────┐
│               AI 推理分层架构                     │
├─────────────────────────────────────────────────┤
│  L1: JVM内嵌 (Token计数/Embedding/分类)          │
│      DJL + ONNX Runtime                         │
│      → 所有同步、低延迟、高频调用                 │
├─────────────────────────────────────────────────┤
│  L2: 内网推理服务 (Reranker/中等模型)             │
│      vLLM / Ollama / Text Embeddings Inference   │
│      → 需要GPU加速的中型模型                      │
├─────────────────────────────────────────────────┤
│  L3: 云API (大模型/复杂推理)                     │
│      OpenAI / Anthropic / 国产大模型API           │
│      → 大规模LLM的Chat/Reasoning/复杂Agent       │
└─────────────────────────────────────────────────┘
```

**Spring Boot中的统一访问层**：

```java
@Service
public class HybridEmbeddingService {

    // L1: JVM内嵌Embedding（小型模型）
    private final JvmEmbeddingService jvmEmbedder;

    // L2: 内网推理服务（中型模型，通过OpenAI兼容协议）
    private final WebClient remoteEmbedder;

    public HybridEmbeddingService() throws Exception {
        this.jvmEmbedder = new JvmEmbeddingService();
        this.remoteEmbedder = WebClient.builder()
            .baseUrl("http://embedding-service:8080/v1")
            .build();
    }

    /**
     * 根据文本长度自动选择推理层级
     */
    public float[] embed(String text) {
        // 短文本（< 512 tokens）→ JVM内嵌
        if (text.length() < 2000) {
            try {
                return jvmEmbedder.embed(text);
            } catch (Exception e) {
                // 降级：JVM失败时fallback到远程服务
                return embedRemote(text);
            }
        }
        // 长文本 → 远程服务
        return embedRemote(text);
    }

    private float[] embedRemote(String text) {
        // 调用 Ollama/vLLM 的 OpenAI 兼容 embedding API
        return remoteEmbedder.post()
            .uri("/embeddings")
            .bodyValue(Map.of("model", "bge-m3", "input", text))
            .retrieve()
            .bodyToMono(EmbeddingResponse.class)
            .block()
            .data().get(0).embedding();
    }
}
```

## 六、性能基准测试

使用JMH进行DJL vs ONNX Runtime的微型基准测试：

```java
import org.openjdk.jmh.annotations.*;
import org.openjdk.jmh.runner.Runner;
import org.openjdk.jmh.runner.options.OptionsBuilder;

import java.util.concurrent.TimeUnit;

@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.MILLISECONDS)
@State(Scope.Benchmark)
@Warmup(iterations = 3, time = 3)
@Measurement(iterations = 5, time = 5)
@Fork(1)
public class EmbeddingBenchmark {

    private JvmEmbeddingService djlembedder;
    private OnnxEmbeddingService onnxEmbedder;
    private String testText = "Java AI知识库是一个全面的技术知识体系";

    @Setup
    public void setup() throws Exception {
        this.djlembedder = new JvmEmbeddingService();     // DJL加载
        this.onnxEmbedder = new OnnxEmbeddingService();   // ONNX加载
    }

    @Benchmark
    public float[] djlEmbedding() throws Exception {
        return djlembedder.embed(testText);
    }

    @Benchmark
    public float[] onnxEmbedding() {
        return onnxEmbedder.embed(testText);
    }

    @TearDown
    public void tearDown() {
        djlembedder.close();
        onnxEmbedder.close();
    }

    public static void main(String[] args) throws Exception {
        new Runner(new OptionsBuilder()
            .include(EmbeddingBenchmark.class.getSimpleName())
            .build()).run();
    }
}
```

**典型基准数据**（MacBook Pro M3 Pro, JDK 25, 模型 = MiniLM-L12-v2 118MB）：
- DJL (PyTorch引擎): 8.2ms ± 0.3ms
- ONNX Runtime: 6.1ms ± 0.2ms
- 内存占用：约150MB（含模型）

## 七、生产部署注意事项

1. **模型预热**：首次推理会触发引擎初始化（JIT编译），需要预热请求（warmup），避免首批请求超时
2. **内存管理**：DJL的NDManager使用引用计数管理native内存，务必在try-with-resources或finally中释放NDList
3. **线程安全**：Predictor是非线程安全的，应使用对象池（如Apache Commons Pool）管理Predictor实例；ZooModel是线程安全的
4. **模型版本管理**：将模型文件与应用程序打包，或在启动时从对象存储下载，通过Content Hash校验完整性
5. **优雅关闭**：JVM关闭时确保释放native资源（通过ShutdownHook或Spring的@PreDestroy）
6. **健康检查**：提供/health端点返回模型状态（加载中/就绪/错误）和最近一次推理延迟

## 八、常见问题

**Q: DJL和ONNX Runtime如何选择？**
A: 如果有现成的ONNX模型，优先用ONNX Runtime（性能更好约20-30%）。如果需要HuggingFace生态（Tokenizer/Pipeline等），用DJL更便捷。两者可以共存——DJL也支持ONNX Runtime作为后端引擎。

**Q: JVM内嵌推理会GC压力大吗？**
A: DJL的native内存由NDManager管理，不经过Java堆。主要GC压力来自输入输出的Java对象。对于高频推理，建议对象复用（如重用float[]数组）。

**Q: 模型更新如何不影响线上服务？**
A: 使用灰度加载策略：新模型预热完成后，通过AtomicReference原子切换Predictor引用，旧模型延迟关闭。

## 相关条目

- [[08-本地推理与Ollama]] — 本地推理服务方案
- [[08-模型能力矩阵与路由策略]] — 模型选型决策
- [[08-云模型API与SDK使用]] — 云API调用方案
- [[09-SpringAI2深度解析]] — Spring AI框架中的Embedding集成
- [[02-Java性能诊断全指南]] — JMH基准测试详细指南
