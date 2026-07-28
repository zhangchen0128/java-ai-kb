package com.javaai.kb.labs.chat;

import java.util.Objects;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.model.ChatModel;

/**
 * A real Spring AI {@link ChatClient} flow. Tests inject a deterministic
 * {@link ChatModel}, so no provider account or API key is required.
 */
public final class ChatDemo {

    public record AnswerSummary(String answer, int confidence) {
    }

    private final ChatClient chatClient;

    public ChatDemo(ChatModel chatModel) {
        this.chatClient = ChatClient.create(Objects.requireNonNull(chatModel));
    }

    public String answer(String systemPrompt, String userMessage) {
        validatePrompts(systemPrompt, userMessage);
        return chatClient.prompt()
            .system(systemPrompt)
            .user(userMessage)
            .call()
            .content();
    }

    /** Uses Spring AI's structured-output conversion instead of parsing JSON manually. */
    public AnswerSummary structuredAnswer(String systemPrompt, String userMessage) {
        validatePrompts(systemPrompt, userMessage);
        return chatClient.prompt()
            .system(systemPrompt)
            .user(userMessage)
            .call()
            .entity(AnswerSummary.class);
    }

    private static void validatePrompts(String systemPrompt, String userMessage) {
        if (systemPrompt == null || systemPrompt.isBlank()) {
            throw new IllegalArgumentException("systemPrompt must not be blank");
        }
        if (userMessage == null || userMessage.isBlank()) {
            throw new IllegalArgumentException("userMessage must not be blank");
        }
    }
}
