---
domain: 08-模型接入与推理
title: Multimodal API in Practice
status: draft
level: intermediate
sources:
  - level: L1
    url: https://platform.openai.com/docs/guides/vision
    description: OpenAI Vision API 文档
  - level: L1
    url: https://docs.anthropic.com/en/docs/vision
    description: Anthropic Claude Vision API 文档
  - level: L1
    url: https://platform.openai.com/docs/guides/images
    description: OpenAI DALL-E Image Generation API
  - level: L1
    url: https://platform.openai.com/docs/guides/speech-to-text
    description: OpenAI Whisper Speech-to-Text API
  - level: L1
    url: https://platform.openai.com/docs/guides/text-to-speech
    description: OpenAI TTS API
relations:
  prerequisite:
    - 07-Transformer架构深度解析
    - 08-OpenAI兼容协议详解
  related:
    - 08-云模型API与SDK使用
    - 08-模型能力矩阵与路由策略
    - 12-ToolCalling完整剖析
tags:
  - multimodal
  - vision
  - dall-e
  - whisper
  - tts
  - stt
  - image-generation
  - video
created: 2026-07-20
updated: 2026-07-28
content_type: practice
---

# 多模态API实战

## 概述

多模态API是AI应用从"文本助手"进化为"感知系统"的关键技术。通过Vision API理解图像、Whisper识别语音、TTS生成语音、DALL-E创造图像，Java应用可以构建更自然、更全面的人机交互体验。本条目全面覆盖Vision理解、图片生成、语音识别、语音合成和视频理解五大类多模态API，并提供统一的Java封装实现。

## 一、Vision理解

### 1.1 GPT-4V / Claude Vision API

现代大模型的Vision能力允许模型直接"看到"图片内容，并进行理解、分析和推理。

**支持的图片格式与限制**：

| Provider | 支持格式 | 最大尺寸 | 多图支持 |
|----------|---------|---------|---------|
| GPT-4V/4o | PNG, JPEG, WebP, GIF(非动画) | 20MB/张 | 最多10张 |
| Claude Vision | PNG, JPEG, WebP, GIF(非动画) | 10MB/张 | 最多100张(Claude Sonnet 4) |
| Google Gemini | PNG, JPEG, WebP, HEIC | 20MB/张 | 最多16张 |

**图片编码**：所有Vision API使用Base64编码将图片嵌入请求体中，不需要上传到外部URL（增强隐私和数据安全）。

### 1.2 Java实现：图片转Base64并调用Vision API

```java
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;

/**
 * 统一的Vision API调用服务。
 * 支持OpenAI GPT-4V/4o和Anthropic Claude Vision。
 */
public class VisionApiService {

    private final HttpClient httpClient = HttpClient.newHttpClient();
    private final String openaiKey;
    private final String anthropicKey;

    public VisionApiService(String openaiKey, String anthropicKey) {
        this.openaiKey = openaiKey;
        this.anthropicKey = anthropicKey;
    }

    /**
     * 将本地图片文件转换为Base64 Data URL。
     */
    public static String imageToBase64Url(Path imagePath) throws IOException {
        var bytes = Files.readAllBytes(imagePath);
        var base64 = Base64.getEncoder().encodeToString(bytes);
        // 根据文件扩展名推断MIME类型
        var mimeType = Files.probeContentType(imagePath);
        if (mimeType == null) {
            var name = imagePath.getFileName().toString().toLowerCase();
            mimeType = name.endsWith(".png") ? "image/png"
                : name.endsWith(".jpg") || name.endsWith(".jpeg") ? "image/jpeg"
                : name.endsWith(".webp") ? "image/webp"
                : name.endsWith(".gif") ? "image/gif"
                : "image/png";  // 默认
        }
        return STR."data:\{mimeType};base64,\{base64}";
    }

    /**
     * OpenAI GPT-4V Vision调用。
     */
    public String openaiVision(String prompt, List<Path> imagePaths,
                                String model) throws Exception {
        // 构建多模态消息内容
        var content = new ArrayList<Map<String, Object>>();
        content.add(Map.of("type", "text", "text", prompt));

        for (var imagePath : imagePaths) {
            var base64Url = imageToBase64Url(imagePath);
            content.add(Map.of(
                "type", "image_url",
                "image_url", Map.of("url", base64Url, "detail", "auto")
            ));
        }

        var body = Map.of(
            "model", model != null ? model : "gpt-4o",
            "messages", List.of(
                Map.of("role", "user", "content", content)
            ),
            "max_tokens", 2000
        );

        var request = HttpRequest.newBuilder()
            .uri(URI.create("https://api.openai.com/v1/chat/completions"))
            .header("Authorization", "Bearer " + openaiKey)
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(toJson(body)))
            .build();

        var response = httpClient.send(request,
            HttpResponse.BodyHandlers.ofString());
        return parseOpenAiResponse(response.body());
    }

    /**
     * Anthropic Claude Vision调用。
     */
    public String claudeVision(String prompt, List<Path> imagePaths,
                                String model) throws Exception {
        // 构建Claude消息格式
        var content = new ArrayList<Map<String, Object>>();

        for (var imagePath : imagePaths) {
            var bytes = Files.readAllBytes(imagePath);
            var base64 = Base64.getEncoder().encodeToString(bytes);
            var mimeType = Files.probeContentType(imagePath);
            if (mimeType == null) mimeType = "image/png";

            content.add(Map.of(
                "type", "image",
                "source", Map.of(
                    "type", "base64",
                    "media_type", mimeType,
                    "data", base64
                )
            ));
        }

        content.add(Map.of("type", "text", "text", prompt));

        var body = Map.of(
            "model", model != null ? model : "claude-sonnet-4-20250514",
            "max_tokens", 2000,
            "messages", List.of(Map.of("role", "user", "content", content))
        );

        var request = HttpRequest.newBuilder()
            .uri(URI.create("https://api.anthropic.com/v1/messages"))
            .header("x-api-key", anthropicKey)
            .header("anthropic-version", "2023-06-01")
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(toJson(body)))
            .build();

        var response = httpClient.send(request,
            HttpResponse.BodyHandlers.ofString());
        return parseClaudeResponse(response.body());
    }

    private String toJson(Object obj) {
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper()
                .writeValueAsString(obj);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private String parseOpenAiResponse(String body) {
        try {
            var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
            var root = mapper.readTree(body);
            return root.path("choices").get(0)
                .path("message").path("content").asText();
        } catch (Exception e) {
            return "Parse error: " + e.getMessage();
        }
    }

    private String parseClaudeResponse(String body) {
        try {
            var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
            var root = mapper.readTree(body);
            var content = root.path("content");
            if (content.isArray() && content.size() > 0) {
                return content.get(0).path("text").asText();
            }
            return root.path("error").path("message").asText();
        } catch (Exception e) {
            return "Parse error: " + e.getMessage();
        }
    }
}
```

### 1.3 Google Gemini Vision

```java
/**
 * Google Gemini Vision API调用。
 */
public class GeminiVisionService {

    private final HttpClient httpClient = HttpClient.newHttpClient();
    private final String apiKey;

    public GeminiVisionService(String apiKey) {
        this.apiKey = apiKey;
    }

    /**
     * Gemini多模态调用（支持图片+视频+音频）。
     */
    public String analyzeImage(String prompt, Path imagePath) throws Exception {
        var base64 = Base64.getEncoder()
            .encodeToString(Files.readAllBytes(imagePath));
        var mimeType = Files.probeContentType(imagePath);

        var body = Map.of(
            "contents", List.of(
                Map.of("parts", List.of(
                    Map.of("text", prompt),
                    Map.of("inline_data", Map.of(
                        "mime_type", mimeType != null ? mimeType : "image/png",
                        "data", base64
                    ))
                ))
            )
        );

        var request = HttpRequest.newBuilder()
            .uri(URI.create(STR."https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=\{apiKey}"))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(toJson(body)))
            .build();

        var response = httpClient.send(request,
            HttpResponse.BodyHandlers.ofString());
        return parseResponse(response.body());
    }

    private String toJson(Object obj) {
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper()
                .writeValueAsString(obj);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private String parseResponse(String body) {
        try {
            var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
            var root = mapper.readTree(body);
            return root.path("candidates").get(0)
                .path("content").path("parts").get(0)
                .path("text").asText();
        } catch (Exception e) {
            return "Parse error: " + e.getMessage();
        }
    }
}
```

### 1.4 多图对比对话

当需要模型比较两张或多张图片时：

```java
/**
 * 多图对比分析。例如："这两张UI设计稿有什么不同？"
 */
public String compareImages(String prompt, Path image1, Path image2)
        throws Exception {
    var service = new VisionApiService(
        System.getenv("OPENAI_API_KEY"), null);
    return service.openaiVision(
        STR."请仔细对比这两张图片，\{prompt}",
        List.of(image1, image2),
        "gpt-4o"
    );
}
```

## 二、图片生成

### 2.1 DALL-E 3 API

```java
/**
 * DALL-E 3 图片生成服务。
 */
public class DalleService {

    private final HttpClient httpClient = HttpClient.newHttpClient();
    private final String apiKey;

    public DalleService(String apiKey) {
        this.apiKey = apiKey;
    }

    /**
     * 生成图片。
     * @param prompt 图片描述（支持中文，但英文效果更好）
     * @param size 图片尺寸：1024x1024, 1792x1024(宽幅), 1024x1792(竖幅)
     * @param quality standard | hd（hd细节更丰富，但生成时间更长）
     * @param style vivid（生动）| natural（自然）
     */
    public record GenerationResult(
        String imageUrl,        // 生成的图片URL（有效期1小时）
        String revisedPrompt    // DALL-E自动优化的提示词
    ) {}

    public List<GenerationResult> generate(String prompt, String size,
            String quality, String style, int n) throws Exception {
        var body = Map.of(
            "model", "dall-e-3",
            "prompt", prompt,
            "n", n,                  // 生成数量（DALL-E 3仅支持1）
            "size", size != null ? size : "1024x1024",
            "quality", quality != null ? quality : "standard",
            "style", style != null ? style : "vivid"
        );

        var request = HttpRequest.newBuilder()
            .uri(URI.create("https://api.openai.com/v1/images/generations"))
            .header("Authorization", "Bearer " + apiKey)
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(toJson(body)))
            .build();

        var response = httpClient.send(request,
            HttpResponse.BodyHandlers.ofString());

        var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
        var root = mapper.readTree(response.body());
        var data = root.path("data");
        var results = new ArrayList<GenerationResult>();

        for (var node : data) {
            results.add(new GenerationResult(
                node.path("url").asText(),
                node.has("revised_prompt")
                    ? node.path("revised_prompt").asText() : prompt
            ));
        }
        return results;
    }

    /**
     * 下载生成的图片到本地。
     */
    public Path downloadImage(String imageUrl, Path targetPath)
            throws Exception {
        var request = HttpRequest.newBuilder()
            .uri(URI.create(imageUrl))
            .GET()
            .build();

        var response = httpClient.send(request,
            HttpResponse.BodyHandlers.ofByteArray());
        Files.write(targetPath, response.body());
        return targetPath;
    }

    private String toJson(Object obj) {
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper()
                .writeValueAsString(obj);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}
```

### 2.2 Stable Diffusion（自部署）

对于需要私有化部署或大批量生成的场景，可以通过自部署Stable Diffusion WebUI或Diffusers服务：

```java
/**
 * Stable Diffusion (自部署) API调用。
 * 使用 Automatic1111 WebUI 的 txt2img 端点。
 */
public class StableDiffusionService {

    private final HttpClient httpClient = HttpClient.newHttpClient();
    private final String sdBaseUrl;  // http://localhost:7860

    public StableDiffusionService(String sdBaseUrl) {
        this.sdBaseUrl = sdBaseUrl;
    }

    /**
     * 文生图。
     */
    public String txt2img(String prompt, String negativePrompt,
            int width, int height, int steps, double cfgScale, long seed)
            throws Exception {
        var body = Map.of(
            "prompt", prompt,
            "negative_prompt", negativePrompt != null ? negativePrompt : "",
            "width", width,
            "height", height,
            "steps", steps,
            "cfg_scale", cfgScale,
            "seed", seed != -1 ? seed : -1,
            "sampler_name", "Euler a"
        );

        var request = HttpRequest.newBuilder()
            .uri(URI.create(sdBaseUrl + "/sdapi/v1/txt2img"))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(toJson(body)))
            .build();

        var response = httpClient.send(request,
            HttpResponse.BodyHandlers.ofString());

        var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
        var root = mapper.readTree(response.body());
        // 返回Base64编码的PNG图片
        return root.path("images").get(0).asText();
    }

    /**
     * 保存Base64图片到文件。
     */
    public void saveImage(String base64Image, Path path)
            throws IOException {
        var bytes = Base64.getDecoder().decode(base64Image);
        Files.write(path, bytes);
    }
}
```

### 2.3 Midjourney（概念性集成）

Midjourney没有官方API，但可以通过以下方式间接集成：
- 使用Midjourney Discord Bot + 自动化工具（Discord Bot API → imagine命令 → 定期检查消息获取图片URL）
- 使用第三方Midjourney代理API服务
- 一般不推荐在生产环境中使用——延迟高、稳定性差、缺乏SLA保障

## 三、语音识别（STT）

### 3.1 OpenAI Whisper API

```java
/**
 * OpenAI Whisper语音识别服务。
 */
public class WhisperService {

    private final HttpClient httpClient = HttpClient.newHttpClient();
    private final String apiKey;

    public WhisperService(String apiKey) {
        this.apiKey = apiKey;
    }

    /**
     * 语音转文本（文件上传方式）。
     * @param audioPath 音频文件路径（支持 mp3, mp4, mpeg, mpga, m4a, wav, webm）
     * @param language 语言代码（如 "zh"），null则自动检测
     * @param responseFormat 响应格式：json, text, srt, verbose_json, vtt
     */
    public record TranscriptionResult(
        String text,              // 完整转录文本
        String language,          // 检测到的语言
        double duration,          // 音频时长（秒）
        List<Segment> segments    // 带时间戳的分段（verbose_json格式）
    ) {
        public record Segment(
            int id, double start, double end,
            String text, List<Double> tokens
        ) {}
    }

    public String transcribe(Path audioPath, String language)
            throws Exception {
        var audioBytes = Files.readAllBytes(audioPath);
        var fileName = audioPath.getFileName().toString();

        // 构建Multipart请求
        var boundary = "----WhisperBoundary" + System.currentTimeMillis();
        var body = buildMultipartBody(audioBytes, fileName,
            language, boundary);

        var request = HttpRequest.newBuilder()
            .uri(URI.create("https://api.openai.com/v1/audio/transcriptions"))
            .header("Authorization", "Bearer " + apiKey)
            .header("Content-Type", "multipart/form-data; boundary=" + boundary)
            .POST(HttpRequest.BodyPublishers.ofByteArray(body))
            .build();

        var response = httpClient.send(request,
            HttpResponse.BodyHandlers.ofString());
        var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
        var root = mapper.readTree(response.body());
        return root.path("text").asText();
    }

    private byte[] buildMultipartBody(byte[] audioBytes, String fileName,
            String language, String boundary) throws IOException {
        var baos = new java.io.ByteArrayOutputStream();

        // model 字段
        writeField(baos, boundary, "model", "whisper-1");

        // language 字段
        if (language != null && !language.isBlank()) {
            writeField(baos, boundary, "language", language);
        }

        // response_format 字段
        writeField(baos, boundary, "response_format", "verbose_json");

        // file 字段
        var header = STR."""
            --\{boundary}\r
            Content-Disposition: form-data; name="file"; filename="\{fileName}"\r
            Content-Type: audio/mpeg\r
            \r
            """;
        baos.write(header.getBytes());
        baos.write(audioBytes);
        baos.write("\r\n".getBytes());

        // 结束标记
        baos.write(STR."--\{boundary}--\r\n".getBytes());
        return baos.toByteArray();
    }

    private void writeField(java.io.ByteArrayOutputStream baos,
            String boundary, String name, String value) throws IOException {
        var field = STR."""
            --\{boundary}\r
            Content-Disposition: form-data; name="\{name}"\r
            \r
            \{value}\r
            """;
        baos.write(field.getBytes());
    }
}
```

### 3.2 实时语音转写（流式）

对于实时语音识别场景（如客服通话实时转录），使用WebSocket连接Whisper的实时流式端点：

```java
import java.net.URI;
import java.net.http.WebSocket;
import java.nio.ByteBuffer;
import java.util.concurrent.CompletionStage;

/**
 * 实时语音转写（WebSocket流式）。
 * 支持OpenAI Realtime API的音频流式识别。
 */
public class RealtimeWhisperClient {

    private WebSocket webSocket;
    private final StringBuilder transcript = new StringBuilder();
    private final java.util.function.Consumer<String> onPartialResult;

    public RealtimeWhisperClient(
            java.util.function.Consumer<String> onPartialResult) {
        this.onPartialResult = onPartialResult;
    }

    public void connect(String apiKey) throws Exception {
        var wsUri = URI.create(
            "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview");

        this.webSocket = HttpClient.newHttpClient()
            .newWebSocketBuilder()
            .header("Authorization", "Bearer " + apiKey)
            .header("OpenAI-Beta", "realtime=v1")
            .buildAsync(wsUri, new WebSocket.Listener() {

                @Override
                public CompletionStage<?> onText(WebSocket webSocket,
                        CharSequence data, boolean last) {
                    // 解析实时文本增量
                    try {
                        var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
                        var root = mapper.readTree(data.toString());
                        var type = root.path("type").asText();

                        if ("response.audio_transcript.delta".equals(type)) {
                            var delta = root.path("delta").asText();
                            transcript.append(delta);
                            onPartialResult.accept(delta);
                        }
                    } catch (Exception e) {
                        // 忽略解析错误
                    }
                    return WebSocket.Listener.super.onText(webSocket, data, last);
                }
            })
            .get();
    }

    /**
     * 发送音频数据块（PCM16格式）。
     */
    public void sendAudioChunk(byte[] pcm16Data) {
        if (webSocket != null) {
            webSocket.sendBinary(ByteBuffer.wrap(pcm16Data), true);
        }
    }

    /**
     * 获取完整转录文本。
     */
    public String getFullTranscript() {
        return transcript.toString();
    }

    public void close() {
        if (webSocket != null) {
            webSocket.sendClose(1000, "done");
        }
    }
}
```

## 四、语音合成（TTS）

### 4.1 OpenAI TTS API

OpenAI提供两种TTS模型：`tts-1`（速度快、适合实时场景）和`tts-1-hd`（质量高、适合离线生成）。

```java
/**
 * OpenAI TTS语音合成服务。
 */
public class TtsService {

    private final HttpClient httpClient = HttpClient.newHttpClient();
    private final String apiKey;

    /**
     * 可用的声音选项。
     */
    public enum Voice {
        ALLOY, ECHO, FABLE, ONYX, NOVA, SHIMMER
    }

    public TtsService(String apiKey) {
        this.apiKey = apiKey;
    }

    /**
     * 文本转语音，返回音频字节。
     * @param text 要合成的文本（最大4096字符）
     * @param model tts-1（低延迟）或 tts-1-hd（高质量）
     * @param voice 声音选项
     * @param speed 语速（0.25-4.0，默认1.0）
     * @param format 输出格式：mp3, opus, aac, flac, wav, pcm
     */
    public byte[] synthesize(String text, String model, Voice voice,
            double speed, String format) throws Exception {
        var body = Map.of(
            "model", model != null ? model : "tts-1",
            "input", text,
            "voice", (voice != null ? voice : Voice.ALLOY).name().toLowerCase(),
            "speed", speed > 0 ? speed : 1.0,
            "response_format", format != null ? format : "mp3"
        );

        var request = HttpRequest.newBuilder()
            .uri(URI.create("https://api.openai.com/v1/audio/speech"))
            .header("Authorization", "Bearer " + apiKey)
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(toJson(body)))
            .build();

        var response = httpClient.send(request,
            HttpResponse.BodyHandlers.ofByteArray());
        return response.body();
    }

    /**
     * 合成并保存到文件。
     */
    public Path synthesizeToFile(String text, Voice voice, Path outputPath)
            throws Exception {
        var audio = synthesize(text, "tts-1-hd", voice, 1.0, "mp3");
        Files.write(outputPath, audio);
        return outputPath;
    }

    private String toJson(Object obj) {
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper()
                .writeValueAsString(obj);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}
```

### 4.2 多语言和声音选择

| 声音 | 风格 | 适合场景 |
|------|------|----------|
| Alloy | 中性、友善 | 通用播报、导航 |
| Echo | 温暖、柔和 | 有声书、故事 |
| Fable | 英式口音、富有表现力 | 叙事、品牌配音 |
| Onyx | 深沉、权威 | 新闻播报、正式场合 |
| Nova | 女性、专业 | 客服、助手回复 |
| Shimmer | 清晰、轻快 | 年轻化品牌、短视频 |

**多语言支持**：TTS模型自动检测输入文本语言并选择合适的发音。支持50+语言，包括中文、英文、日语、韩语等。

## 五、视频理解

### 5.1 视频帧提取 + Vision API

视频理解的标准方案：使用FFmpeg提取关键帧，然后作为图片序列发送给Vision API。

```java
/**
 * 视频理解服务：FFmpeg提取帧 + Vision API分析。
 */
public class VideoUnderstandingService {

    private final VisionApiService visionService;

    public VideoUnderstandingService(VisionApiService visionService) {
        this.visionService = visionService;
    }

    /**
     * 从视频中提取关键帧（场景变化检测）。
     */
    public List<Path> extractKeyFrames(Path videoPath, Path outputDir,
            double sceneThreshold) throws Exception {
        Files.createDirectories(outputDir);

        var process = new ProcessBuilder(
            "ffmpeg",
            "-i", videoPath.toString(),
            "-vf", STR."select='gt(scene,\{sceneThreshold})'",
            "-vsync", "vfr",
            "-q:v", "2",
            outputDir.resolve("frame_%04d.jpg").toString()
        )
        .inheritIO()
        .start();

        var exitCode = process.waitFor();
        if (exitCode != 0) {
            throw new RuntimeException("FFmpeg exited with code " + exitCode);
        }

        // 收集提取的帧文件
        try (var stream = Files.list(outputDir)) {
            return stream
                .filter(p -> p.getFileName().toString().endsWith(".jpg"))
                .sorted()
                .toList();
        }
    }

    /**
     * 等间隔抽取帧（每N秒取一帧）。
     */
    public List<Path> extractFramesAtInterval(Path videoPath,
            Path outputDir, int intervalSeconds) throws Exception {
        Files.createDirectories(outputDir);

        var process = new ProcessBuilder(
            "ffmpeg",
            "-i", videoPath.toString(),
            "-vf", STR."fps=1/\{intervalSeconds}",
            outputDir.resolve("frame_%04d.jpg").toString()
        )
        .inheritIO()
        .start();

        process.waitFor();

        try (var stream = Files.list(outputDir)) {
            return stream
                .filter(p -> p.getFileName().toString().endsWith(".jpg"))
                .sorted()
                .toList();
        }
    }

    /**
     * 视频摘要：提取关键帧 -> Vision API分析 -> LLM总结。
     */
    public String summarizeVideo(Path videoPath) throws Exception {
        var tmpDir = Files.createTempDirectory("video-frames-");

        // Step 1: 提取关键帧（最多10帧）
        var frames = extractKeyFrames(videoPath, tmpDir, 0.3);
        if (frames.size() > 10) {
            frames = frames.subList(0, 10);
        }

        // Step 2: 对每帧进行描述
        var frameDescriptions = new ArrayList<String>();
        for (int i = 0; i < frames.size(); i++) {
            var desc = visionService.openaiVision(
                "请用一句话描述这张图片中正在发生的事情。",
                List.of(frames.get(i)),
                "gpt-4o-mini"
            );
            frameDescriptions.add(
                STR."时刻\{i + 1}: \{desc}");
        }

        // Step 3: 综合所有帧描述，生成视频摘要
        var prompt = STR."""
            以下是视频的逐帧描述，请综合这些信息生成一段完整的视频摘要（200-300字）：

            \{String.join("\n", frameDescriptions)}
            """;

        // 这里调用LLM进行总结（省略具体实现）
        return "视频摘要：...";
    }
}
```

### 5.2 Google Gemini视频理解

Google Gemini支持直接传入视频文件进行理解（无需手动提取帧），但视频大小有限制：

```java
public class GeminiVideoService {

    private final HttpClient httpClient = HttpClient.newHttpClient();
    private final String apiKey;

    public GeminiVideoService(String apiKey) {
        this.apiKey = apiKey;
    }

    public String analyzeVideo(String prompt, Path videoPath)
            throws Exception {
        var bytes = Files.readAllBytes(videoPath);
        var base64 = Base64.getEncoder().encodeToString(bytes);
        var mimeType = Files.probeContentType(videoPath);
        if (mimeType == null) mimeType = "video/mp4";

        var body = Map.of(
            "contents", List.of(Map.of("parts", List.of(
                Map.of("text", prompt),
                Map.of("inline_data", Map.of(
                    "mime_type", mimeType,
                    "data", base64
                ))
            )))
        );

        var request = HttpRequest.newBuilder()
            .uri(URI.create(STR."https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=\{apiKey}"))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(toJson(body)))
            .build();

        var response = httpClient.send(request,
            HttpResponse.BodyHandlers.ofString());
        // 解析响应 ...
        return "分析结果";
    }

    private String toJson(Object obj) {
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper()
                .writeValueAsString(obj);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}
```

## 六、MultimodalService统一封装

将Vision、图片生成、语音识别、语音合成整合为统一的MultimodalService：

```java
/**
 * 多模态API统一封装。
 * 提供一致的接口，屏蔽不同Provider的差异。
 */
@Service
public class MultimodalService {

    private final VisionApiService visionService;
    private final DalleService imageGenService;
    private final WhisperService sttService;
    private final TtsService ttsService;
    private final VideoUnderstandingService videoService;

    public MultimodalService(
            @Value("${openai.api-key}") String openaiKey,
            @Value("${anthropic.api-key}") String anthropicKey) {
        this.visionService = new VisionApiService(openaiKey, anthropicKey);
        this.imageGenService = new DalleService(openaiKey);
        this.sttService = new WhisperService(openaiKey);
        this.ttsService = new TtsService(openaiKey);
        this.videoService = new VideoUnderstandingService(visionService);
    }

    // === Vision ===
    public String describeImage(Path imagePath) throws Exception {
        return visionService.openaiVision(
            "请详细描述这张图片的内容。", List.of(imagePath), "gpt-4o-mini");
    }

    public String extractTextFromImage(Path imagePath) throws Exception {
        return visionService.openaiVision(
            "请提取这张图片中的所有文字内容，保持原始格式。",
            List.of(imagePath), "gpt-4o");
    }

    // === Image Generation ===
    public String generateImage(String prompt) throws Exception {
        var results = imageGenService.generate(
            prompt, "1024x1024", "standard", "vivid", 1);
        return results.isEmpty() ? null : results.get(0).imageUrl();
    }

    // === STT ===
    public String transcribeAudio(Path audioPath) throws Exception {
        return sttService.transcribe(audioPath, null);
    }

    // === TTS ===
    public byte[] textToSpeech(String text, TtsService.Voice voice)
            throws Exception {
        return ttsService.synthesize(text, "tts-1", voice, 1.0, "mp3");
    }

    // === Video ===
    public String summarizeVideo(Path videoPath) throws Exception {
        return videoService.summarizeVideo(videoPath);
    }
}
```

## 七、最佳实践

1. **图片压缩**：在发送Vision API之前，将图片压缩到合理分辨率（建议最大边长不超过2048px），可以显著降低延迟和Token消耗。高分辨率图片的Vision Token按块计费，大图片可能消耗数千Token。
2. **音频预处理**：Whisper API对音频质量敏感，建议降噪处理后再识别。支持的最大文件大小为25MB。
3. **TTS缓存**：对于固定文本（如系统提示音），生成一次后缓存音频文件，避免重复调用API。
4. **视频帧策略**：场景变化检测（`select='gt(scene,0.3)'`）比等间隔抽取更有效——前者在变化大的地方取更多帧，变化小的地方取更少帧。
5. **并发控制**：图片生成和大文件上传耗时较长，使用Virtual Threads进行异步处理，避免阻塞主线程。
6. **成本管理**：Vision API的Token消耗与图片分辨率和detail参数相关——`detail: low`固定消耗85 Token，`detail: high`按512px块计费。

## 八、常见问题

**Q: Vision API能看到图片里的文字吗（OCR）？**
A: GPT-4V/4o和Claude Vision都具备优秀的OCR能力，可以准确识别图片中的中英文、手写体甚至表格。对于复杂的OCR需求（如扫描件、低质量图片），建议先用专用OCR服务预处理。

**Q: DALL-E生成的图片版权归谁？**
A: 根据OpenAI的服务条款，DALL-E生成的图片版权归用户所有。但版权局对AI生成内容的版权保护政策因地区而异。

**Q: Whisper支持方言识别吗？**
A: Whisper对标准普通话和带轻微口音的普通话识别良好，但对重方言（如粤语、闽南语）的识别效果较差。建议针对特定方言使用专门的语音识别模型。

**Q: 视频帧提取如何平衡成本和效果？**
A: 对于1分钟左右的短视频，提取3-5帧（场景变化最大的几帧）通常足够。对于长视频，先用FFmpeg做场景分割，每场景取1帧，然后用Vision API分析。

## 相关条目

- [[08-OpenAI兼容协议详解]] — Chat Completions API协议
- [[08-云模型API与SDK使用]] — 各Provider Java SDK使用
- [[08-模型能力矩阵与路由策略]] — 多模态模型能力对比
- [[12-ToolCalling完整剖析]] — 在Agent中使用多模态Tool
