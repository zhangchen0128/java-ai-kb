package com.javaai.kb.labs.tools;

import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.messages.ToolResponseMessage;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.prompt.ChatOptions;
import org.springframework.ai.chat.model.Generation;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.model.tool.DefaultToolCallingChatOptions;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;

/**
 * A real two-round Spring AI {@link ChatClient} tool-calling flow.
 *
 * <p>The deterministic model first requests a tool call and then consumes the
 * resulting {@link ToolResponseMessage}. No provider account or API key is
 * involved.</p>
 */
public final class ToolCallingDemo {

    private final ChatClient chatClient;
    private final DeterministicToolCallingModel model;

    public ToolCallingDemo() {
        this.model = new DeterministicToolCallingModel();
        this.chatClient = ChatClient.create(model);
    }

    public String askWeather(String city) {
        if (city == null || city.isBlank()) {
            throw new IllegalArgumentException("city must not be blank");
        }
        return chatClient.prompt()
            .user("What is the weather in " + city + "?")
            .tools(new WeatherTools())
            .call()
            .content();
    }

    public int modelRounds() {
        return model.rounds();
    }

    public static final class WeatherTools {

        @Tool(description = "Return deterministic weather for one city")
        public String weather(@ToolParam(description = "City name") String city) {
            if (city == null || city.isBlank()) {
                throw new IllegalArgumentException("city must not be blank");
            }
            return city + ": 22C, sunny";
        }
    }

    static final class DeterministicToolCallingModel implements ChatModel {

        private final AtomicInteger rounds = new AtomicInteger();

        @Override
        public ChatOptions getOptions() {
            return DefaultToolCallingChatOptions.builder().build();
        }

        @Override
        public ChatResponse call(Prompt prompt) {
            rounds.incrementAndGet();
            var toolResponse = prompt.getInstructions().stream()
                .filter(ToolResponseMessage.class::isInstance)
                .map(ToolResponseMessage.class::cast)
                .findFirst();

            if (toolResponse.isPresent()) {
                var result = toolResponse.orElseThrow().getResponses().getFirst().responseData();
                return response(new AssistantMessage("Tool result: " + result));
            }

            var call = new AssistantMessage.ToolCall(
                "weather-call-1",
                "function",
                "weather",
                "{\"city\":\"Shanghai\"}"
            );
            return response(AssistantMessage.builder()
                .content("")
                .toolCalls(List.of(call))
                .build());
        }

        int rounds() {
            return rounds.get();
        }

        private static ChatResponse response(AssistantMessage message) {
            return new ChatResponse(List.of(new Generation(message)));
        }
    }
}
