package com.javaai.kb.labs.chat;

import java.util.Objects;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.model.ChatModel;
import reactor.core.publisher.Flux;

/**
 * Keeps provider SDK types behind Spring AI's {@link ChatModel} abstraction.
 */
public final class SpringAiChatAdapter implements ChatModelPort {

    private final ChatClient client;
    private final String modelId;

    public SpringAiChatAdapter(ChatModel model, String modelId) {
        this.client = ChatClient.create(Objects.requireNonNull(model, "model"));
        if (modelId == null || modelId.isBlank()) {
            throw new IllegalArgumentException("modelId must not be blank");
        }
        this.modelId = modelId;
    }

    @Override
    public ChatResponse chat(ChatRequest request) {
        validate(request);
        String content = client.prompt()
            .system(request.systemPrompt())
            .user(request.userPrompt())
            .call()
            .content();
        return new ChatResponse(content, modelId);
    }

    @Override
    public Flux<ChatChunk> chatStream(ChatRequest request) {
        validate(request);
        return client.prompt()
            .system(request.systemPrompt())
            .user(request.userPrompt())
            .stream()
            .content()
            .map(ChatChunk::new);
    }

    private static void validate(ChatRequest request) {
        Objects.requireNonNull(request, "request");
        if (request.systemPrompt() == null || request.systemPrompt().isBlank()
                || request.userPrompt() == null || request.userPrompt().isBlank()) {
            throw new IllegalArgumentException(
                "systemPrompt and userPrompt must not be blank"
            );
        }
    }
}
