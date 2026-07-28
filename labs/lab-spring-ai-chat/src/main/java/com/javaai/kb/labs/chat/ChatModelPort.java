package com.javaai.kb.labs.chat;

import reactor.core.publisher.Flux;

/**
 * Provider-neutral boundary used by application code.
 */
public interface ChatModelPort {

    ChatResponse chat(ChatRequest request);

    Flux<ChatChunk> chatStream(ChatRequest request);

    record ChatRequest(String systemPrompt, String userPrompt) {
    }

    record ChatResponse(String content, String modelId) {
    }

    record ChatChunk(String delta) {
    }
}
