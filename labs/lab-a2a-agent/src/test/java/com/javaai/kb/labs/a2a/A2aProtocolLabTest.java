package com.javaai.kb.labs.a2a;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Map;
import org.a2aproject.sdk.spec.TextPart;
import org.a2aproject.sdk.spec.TaskQueryParams;
import org.a2aproject.sdk.spec.TaskState;
import org.junit.jupiter.api.Test;

class A2aProtocolLabTest {

    @Test
    void declaresVersionedInterfacesInOfficialAgentCard() {
        var card = A2aProtocolLab.agentCard();
        assertEquals(2, card.supportedInterfaces().size());
        assertTrue(card.supportedInterfaces().stream()
            .allMatch(agentInterface -> "1.0".equals(agentInterface.protocolVersion())));
    }

    @Test
    void buildsOfficialSendMessageParams() {
        var params = A2aProtocolLab.sendMessage("hello");
        assertEquals("SendMessage", params.metadata().get("operation"));
        assertEquals("hello", ((TextPart) params.message().parts().getFirst()).text());
    }

    @Test
    void doesNotMixRestEndpointAndJsonRpcMethod() {
        assertEquals("/message:send", A2aProtocolLab.restEndpoint());
        assertEquals("SendMessage", A2aProtocolLab.jsonRpcMethod());
    }

    @Test
    void sendsMessageAndGetsTaskThroughOfficialTaskStore() {
        var agent = new InProcessA2aAgent();
        var headers = Map.of(
            InProcessA2aAgent.VERSION_HEADER,
            InProcessA2aAgent.PROTOCOL_VERSION
        );

        var sent = agent.sendMessage(A2aProtocolLab.sendMessage("hello"), headers);
        var loaded = agent.getTask(new TaskQueryParams(sent.id()), headers);

        assertEquals(sent.id(), loaded.id());
        assertEquals(TaskState.TASK_STATE_COMPLETED, loaded.status().state());
        assertEquals("hello", ((TextPart) loaded.history().getFirst().parts().getFirst()).text());
        assertEquals("1.0", loaded.metadata().get("protocolVersion"));
    }

    @Test
    void rejectsMissingOrWrongProtocolVersionHeader() {
        var agent = new InProcessA2aAgent();
        var params = A2aProtocolLab.sendMessage("hello");

        assertThrows(IllegalArgumentException.class, () -> agent.sendMessage(params, Map.of()));
        assertThrows(IllegalArgumentException.class,
            () -> agent.sendMessage(params, Map.of("a2a-version", "0.3")));
    }
}
