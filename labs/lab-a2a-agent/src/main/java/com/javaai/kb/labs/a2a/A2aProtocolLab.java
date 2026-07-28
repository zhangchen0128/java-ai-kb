package com.javaai.kb.labs.a2a;

import java.util.List;
import java.util.Map;
import org.a2aproject.sdk.spec.AgentCapabilities;
import org.a2aproject.sdk.spec.AgentCard;
import org.a2aproject.sdk.spec.AgentInterface;
import org.a2aproject.sdk.spec.Message;
import org.a2aproject.sdk.spec.MessageSendParams;
import org.a2aproject.sdk.spec.TextPart;

/** Official A2A Java SDK models for the 1.0 protocol binding. */
public final class A2aProtocolLab {

    public static AgentCard agentCard() {
        return AgentCard.builder()
            .name("java-ai-kb-agent")
            .description("Deterministic Java A2A lab")
            .version("1.0.0")
            .capabilities(AgentCapabilities.builder()
                .streaming(true)
                .pushNotifications(false)
                .extendedAgentCard(false)
                .build())
            .defaultInputModes(List.of("text/plain"))
            .defaultOutputModes(List.of("text/plain"))
            .skills(List.of())
            .supportedInterfaces(List.of(
                new AgentInterface("HTTP+JSON", "https://example.test/a2a/v1", "1.0"),
                new AgentInterface("JSONRPC", "https://example.test/a2a/jsonrpc", "1.0")
            ))
            .build();
    }

    public static MessageSendParams sendMessage(String text) {
        var message = Message.builder()
            .role(Message.Role.ROLE_USER)
            .messageId("message-1")
            .parts(new TextPart(text))
            .build();
        return MessageSendParams.builder()
            .message(message)
            .metadata(Map.of("operation", "SendMessage"))
            .build();
    }

    public static String restEndpoint() {
        return "/message:send";
    }

    public static String jsonRpcMethod() {
        return "SendMessage";
    }
}
