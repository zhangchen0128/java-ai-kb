package com.javaai.kb.labs.mcp;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.modelcontextprotocol.spec.McpSchema;
import java.util.Map;
import org.junit.jupiter.api.Test;

class InMemoryMcpLabTest {

    private final InMemoryMcpLab lab = new InMemoryMcpLab();

    @Test
    void negotiatesPinnedProtocolAndDiscoversTools() {
        assertEquals(InMemoryMcpLab.PROTOCOL_VERSION, lab.initializeRequest().protocolVersion());
        assertEquals("lookup_policy", lab.listTools().getFirst().name());
    }

    @Test
    void callsToolAndReturnsStructuredResult() {
        var request = McpSchema.CallToolRequest.builder("lookup_policy")
            .arguments(Map.of("policyId", "P-100"))
            .build();
        var result = lab.call(request);
        assertFalse(result.isError());
        assertEquals(Map.of("result", "policy:P-100"), result.structuredContent());
    }

    @Test
    void reportsUnknownOrInvalidCallsAsProtocolErrors() {
        assertTrue(lab.call(McpSchema.CallToolRequest.builder("missing").arguments(Map.of()).build()).isError());
        assertTrue(lab.call(McpSchema.CallToolRequest.builder("lookup_policy").arguments(Map.of()).build()).isError());
    }
}
