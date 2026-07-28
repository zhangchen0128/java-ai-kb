package com.javaai.kb.labs.mcp;

import io.modelcontextprotocol.spec.McpSchema;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;

/**
 * An in-memory MCP 2025-11-25 client/server handshake and tool exchange using
 * the official MCP Java SDK schema types.
 */
public final class InMemoryMcpLab {

    public static final String PROTOCOL_VERSION = "2025-11-25";

    private final Map<String, Function<Map<String, Object>, String>> handlers = new LinkedHashMap<>();
    private final Map<String, McpSchema.Tool> tools = new LinkedHashMap<>();

    public InMemoryMcpLab() {
        register(
            McpSchema.Tool.builder("lookup_policy", Map.of(
                    "type", "object",
                    "properties", Map.of("policyId", Map.of("type", "string")),
                    "required", List.of("policyId")
                ))
                .description("Look up an insurance policy by id")
                .build(),
            arguments -> "policy:" + requireString(arguments, "policyId")
        );
    }

    public McpSchema.InitializeRequest initializeRequest() {
        return McpSchema.InitializeRequest.builder(
            PROTOCOL_VERSION,
            McpSchema.ClientCapabilities.builder().roots(false).build(),
            McpSchema.Implementation.builder("java-ai-kb-lab", "1.0.0").build()
        ).build();
    }

    public List<McpSchema.Tool> listTools() {
        return List.copyOf(tools.values());
    }

    public McpSchema.CallToolResult call(McpSchema.CallToolRequest request) {
        var handler = handlers.get(request.name());
        if (handler == null) {
            return McpSchema.CallToolResult.builder(
                List.of(McpSchema.TextContent.builder("Unknown tool: " + request.name()).build())
            ).isError(true).build();
        }
        try {
            var result = handler.apply(request.arguments());
            return McpSchema.CallToolResult.builder(
                List.of(McpSchema.TextContent.builder(result).build())
            ).isError(false).structuredContent(Map.of("result", result)).build();
        } catch (IllegalArgumentException error) {
            return McpSchema.CallToolResult.builder(
                List.of(McpSchema.TextContent.builder(error.getMessage()).build())
            ).isError(true).build();
        }
    }

    private void register(
        McpSchema.Tool tool,
        Function<Map<String, Object>, String> handler
    ) {
        tools.put(tool.name(), tool);
        handlers.put(tool.name(), handler);
    }

    private static String requireString(Map<String, Object> arguments, String name) {
        var value = arguments.get(name);
        if (!(value instanceof String text) || text.isBlank()) {
            throw new IllegalArgumentException("Missing argument: " + name);
        }
        return text;
    }
}
