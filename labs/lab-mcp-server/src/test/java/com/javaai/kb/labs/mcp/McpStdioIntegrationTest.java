package com.javaai.kb.labs.mcp;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.modelcontextprotocol.client.McpClient;
import io.modelcontextprotocol.client.transport.ServerParameters;
import io.modelcontextprotocol.client.transport.StdioClientTransport;
import io.modelcontextprotocol.spec.McpSchema;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Map;
import org.junit.jupiter.api.Test;

class McpStdioIntegrationTest {

    @Test
    void initializesDiscoversAndCallsToolOverRealStdioTransport() {
        var java = Path.of(System.getProperty("java.home"), "bin", "java").toString();
        var server = ServerParameters.builder(java)
            .args(
                "-cp",
                System.getProperty("java.class.path"),
                McpStdioServerMain.class.getName()
            )
            .build();
        var transport = new StdioClientTransport(server, McpStdioServerMain.jsonMapper());
        transport.setStdErrorHandler(line -> {
            if (!line.isBlank()) System.err.println("[mcp-server] " + line);
        });

        try (var client = McpClient.sync(transport)
            .clientInfo(McpSchema.Implementation.builder("java-ai-kb-client", "1.0.0").build())
            .initializationTimeout(Duration.ofSeconds(10))
            .requestTimeout(Duration.ofSeconds(5))
            .build()) {

            var initialized = client.initialize();
            assertEquals("2025-11-25", initialized.protocolVersion());
            assertTrue(client.isInitialized());

            var tools = client.listTools().tools();
            assertEquals("lookup_policy", tools.getFirst().name());

            var result = client.callTool(McpSchema.CallToolRequest.builder("lookup_policy")
                .arguments(Map.of("policyId", "P-100"))
                .build());
            assertFalse(result.isError());
            assertEquals(Map.of("result", "policy:P-100"), result.structuredContent());
        }
    }
}
