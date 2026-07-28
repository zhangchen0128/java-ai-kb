package com.javaai.kb.labs.chat;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.model.Generation;
import org.springframework.ai.chat.prompt.Prompt;
import reactor.core.publisher.Flux;

class SpringAiChatAdapterTest {

    @Test
    void mapsSynchronousResponseWithoutLeakingProviderTypes() {
        var model = new DeterministicChatModel("sync-answer", List.of());
        var adapter = new SpringAiChatAdapter(model, "deterministic-model");

        var response = adapter.chat(new ChatModelPort.ChatRequest(
            "You are a Java expert", "Explain virtual threads"
        ));

        assertEquals("sync-answer", response.content());
        assertEquals("deterministic-model", response.modelId());
        assertTrue(model.lastPrompt.getContents().contains("Java expert"));
        assertTrue(model.lastPrompt.getContents().contains("virtual threads"));
    }

    @Test
    void mapsStreamingChunksInOrder() {
        var model = new DeterministicChatModel(
            "unused", List.of("first", " second")
        );
        var adapter = new SpringAiChatAdapter(model, "stream-model");

        var chunks = adapter.chatStream(new ChatModelPort.ChatRequest(
            "system", "stream please"
        )).map(ChatModelPort.ChatChunk::delta).collectList().block();

        assertEquals(List.of("first", " second"), chunks);
        assertTrue(model.lastPrompt.getContents().contains("stream please"));
    }

    @Test
    void validatesAdapterAndRequestBoundaries() {
        var model = new DeterministicChatModel("answer", List.of());
        assertThrows(IllegalArgumentException.class,
            () -> new SpringAiChatAdapter(model, " "));

        var adapter = new SpringAiChatAdapter(model, "model");
        assertThrows(NullPointerException.class, () -> adapter.chat(null));
        assertThrows(IllegalArgumentException.class,
            () -> adapter.chat(new ChatModelPort.ChatRequest("", "question")));
        assertThrows(IllegalArgumentException.class,
            () -> adapter.chatStream(new ChatModelPort.ChatRequest("system", " ")));
    }

    private static final class DeterministicChatModel implements ChatModel {
        private final String syncResponse;
        private final List<String> streamResponses;
        private Prompt lastPrompt;

        private DeterministicChatModel(
                String syncResponse,
                List<String> streamResponses) {
            this.syncResponse = syncResponse;
            this.streamResponses = List.copyOf(streamResponses);
        }

        @Override
        public org.springframework.ai.chat.model.ChatResponse call(Prompt prompt) {
            lastPrompt = prompt;
            return response(syncResponse);
        }

        @Override
        public Flux<org.springframework.ai.chat.model.ChatResponse> stream(Prompt prompt) {
            lastPrompt = prompt;
            return Flux.fromIterable(streamResponses).map(this::response);
        }

        private org.springframework.ai.chat.model.ChatResponse response(String content) {
            return new org.springframework.ai.chat.model.ChatResponse(List.of(
                new Generation(new AssistantMessage(content))
            ));
        }
    }
}
