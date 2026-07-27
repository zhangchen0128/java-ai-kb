package com.javaai.kb.labs.chat;

/**
 * Spring AI ChatClient 示例 (Mock 模式，无需真实 API Key).
 *
 * 对应知识库：09-Java AI框架/09-SpringAI2深度解析.md
 *
 * 运行需要设置环境变量: export SPRING_AI_OPENAI_API_KEY=test-key
 * 或使用 mock profile: spring.profiles.active=mock
 */
public class ChatDemo {

    /** 构建 ChatClient 请求示例 */
    public static String buildRequest(String systemPrompt, String userMessage) {
        return """
            ChatClient.create(chatModel)
                .prompt()
                .system("%s")
                .user("%s")
                .call()
                .content();
            """.formatted(systemPrompt, userMessage);
    }

    public static void main(String[] args) {
        System.out.println("Spring AI ChatClient Demo");
        System.out.println(buildRequest("你是Java专家", "什么是Virtual Threads?"));
        System.out.println("\n⚠️ 运行需要 Spring Boot Starter + API Key.");
        System.out.println("   export SPRING_AI_OPENAI_API_KEY=sk-xxx");
        System.out.println("   mvn spring-boot:run");
    }
}
