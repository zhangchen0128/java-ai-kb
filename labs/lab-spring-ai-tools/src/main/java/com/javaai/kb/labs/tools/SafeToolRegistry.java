package com.javaai.kb.labs.tools;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import org.springframework.ai.tool.annotation.Tool;

/**
 * Minimal deterministic tool runtime demonstrating discovery, validation and
 * least-privilege execution around Spring AI's {@link Tool} annotation.
 */
public final class SafeToolRegistry {

    private final Map<String, Method> tools = new LinkedHashMap<>();
    private final Object target;
    private final Set<String> allowedTools;

    public SafeToolRegistry(Object target, Set<String> allowedTools) {
        this.target = target;
        this.allowedTools = Set.copyOf(allowedTools);
        for (var method : target.getClass().getDeclaredMethods()) {
            var annotation = method.getAnnotation(Tool.class);
            if (annotation != null) tools.put(method.getName(), method);
        }
    }

    public Set<String> toolNames() {
        return Set.copyOf(tools.keySet());
    }

    public Object call(String name, Map<String, Object> arguments) {
        var method = tools.get(name);
        if (method == null) throw new IllegalArgumentException("Unknown tool: " + name);
        if (!allowedTools.contains(name)) throw new SecurityException("Tool is not allowed: " + name);
        if (method.getParameterCount() != 1) {
            throw new IllegalStateException("Lab tools must accept one String parameter");
        }
        var parameterName = method.getParameters()[0].getName();
        var value = arguments.get(parameterName);
        if (!(value instanceof String text) || text.isBlank()) {
            throw new IllegalArgumentException("Missing non-blank argument: " + parameterName);
        }
        try {
            return method.invoke(target, text);
        } catch (IllegalAccessException | InvocationTargetException error) {
            throw new IllegalStateException("Tool execution failed", error);
        }
    }

    public static final class DemoTools {
        @Tool(description = "Return a deterministic weather report for a city")
        public String weather(String city) {
            return city + ": 22C, sunny";
        }

        @Tool(description = "Delete an account; intentionally denied in this lab")
        public String deleteAccount(String accountId) {
            return "deleted:" + accountId;
        }
    }
}
