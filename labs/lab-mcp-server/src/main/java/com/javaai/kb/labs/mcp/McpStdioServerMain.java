package com.javaai.kb.labs.mcp;

import io.modelcontextprotocol.json.McpJsonMapper;
import io.modelcontextprotocol.json.McpJsonMapperSupplier;
import io.modelcontextprotocol.server.McpServer;
import io.modelcontextprotocol.server.transport.StdioServerTransportProvider;
import io.modelcontextprotocol.spec.McpSchema;
import java.util.List;
import java.util.Map;
import java.util.ServiceLoader;
import java.util.concurrent.CountDownLatch;

/** A real provider-free MCP server process using the official STDIO transport. */
public final class McpStdioServerMain {

    private McpStdioServerMain() {
    }

    public static void main(String[] args) throws InterruptedException {
        var transport = new StdioServerTransportProvider(jsonMapper());
        var tool = McpSchema.Tool.builder("lookup_policy", Map.of(
                "type", "object",
                "properties", Map.of("policyId", Map.of("type", "string")),
                "required", List.of("policyId")
            ))
            .description("Look up an insurance policy by id")
            .build();

        var server = McpServer.sync(transport)
            .serverInfo("java-ai-kb-stdio", "1.0.0")
            .capabilities(McpSchema.ServerCapabilities.builder().tools(false).build())
            .validateToolInputs(true)
            .toolCall(tool, (exchange, request) -> {
                var value = request.arguments().get("policyId");
                if (!(value instanceof String policyId) || policyId.isBlank()) {
                    return McpSchema.CallToolResult.builder(
                        List.of(McpSchema.TextContent.builder("policyId is required").build())
                    ).isError(true).build();
                }
                var result = "policy:" + policyId;
                return McpSchema.CallToolResult.builder(
                    List.of(McpSchema.TextContent.builder(result).build())
                ).structuredContent(Map.of("result", result)).isError(false).build();
            })
            .build();

        Runtime.getRuntime().addShutdownHook(new Thread(server::close));
        new CountDownLatch(1).await();
    }

    static McpJsonMapper jsonMapper() {
        return ServiceLoader.load(McpJsonMapperSupplier.class)
            .findFirst()
            .orElseThrow(() -> new IllegalStateException("No MCP JSON mapper on the classpath"))
            .get();
    }
}
