package com.javaai.kb.labs.chat;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.model.Generation;
import org.springframework.ai.chat.prompt.Prompt;

class ChatDemoTest {

    @Test
    void invokesRealChatClientWithSystemAndUserMessages() {
        var model = new DeterministicChatModel();
        var chat = new ChatDemo(model);

        var result = chat.answer("You are a Java expert", "Explain virtual threads");

        assertEquals("deterministic-answer", result);
        assertTrue(model.lastPrompt.getContents().contains("Java expert"));
        assertTrue(model.lastPrompt.getContents().contains("virtual threads"));
    }

    @Test
    void rejectsBlankPromptsBeforeCallingModel() {
        var chat = new ChatDemo(new DeterministicChatModel());
        assertThrows(IllegalArgumentException.class, () -> chat.answer("", "question"));
        assertThrows(IllegalArgumentException.class, () -> chat.answer("system", " "));
    }

    @Test
    void convertsStructuredJsonThroughChatClient() {
        var chat = new ChatDemo(new DeterministicChatModel(
            """
            {"answer":"Use a virtual thread per blocking task","confidence":98}
            """
        ));

        var result = chat.structuredAnswer("Return JSON", "How should blocking IO run?");

        assertEquals("Use a virtual thread per blocking task", result.answer());
        assertEquals(98, result.confidence());
    }

    private static final class DeterministicChatModel implements ChatModel {
        private Prompt lastPrompt;
        private final String response;

        private DeterministicChatModel() {
            this("deterministic-answer");
        }

        private DeterministicChatModel(String response) {
            this.response = response;
        }

        @Override
        public ChatResponse call(Prompt prompt) {
            this.lastPrompt = prompt;
            return new ChatResponse(List.of(
                new Generation(new AssistantMessage(response))
            ));
        }
    }
}
