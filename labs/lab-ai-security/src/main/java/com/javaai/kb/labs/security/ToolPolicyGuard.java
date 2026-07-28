package com.javaai.kb.labs.security;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** OWASP 2025-aligned policy boundary for agent tool execution. */
public final class ToolPolicyGuard {

    public enum Risk {
        LLM01_PROMPT_INJECTION,
        LLM02_SENSITIVE_INFORMATION_DISCLOSURE,
        LLM05_IMPROPER_OUTPUT_HANDLING,
        LLM06_EXCESSIVE_AGENCY,
        LLM07_SYSTEM_PROMPT_LEAKAGE
    }

    public record Decision(boolean allowed, Set<Risk> risks, Instant timestamp) {}

    private final Set<String> allowedTools;
    private final List<Map<String, Object>> auditLog = new ArrayList<>();

    public ToolPolicyGuard(Set<String> allowedTools) {
        this.allowedTools = Set.copyOf(allowedTools);
    }

    public Decision evaluate(String tool, String argument) {
        var risks = new java.util.LinkedHashSet<Risk>();
        if (!allowedTools.contains(tool)) risks.add(Risk.LLM06_EXCESSIVE_AGENCY);
        if (InputSanitizer.containsInjection(argument)) risks.add(Risk.LLM01_PROMPT_INJECTION);
        if (!InputSanitizer.maskPII(argument).equals(argument)) risks.add(Risk.LLM02_SENSITIVE_INFORMATION_DISCLOSURE);
        var decision = new Decision(risks.isEmpty(), Set.copyOf(risks), Instant.now());
        auditLog.add(Map.of(
            "tool", tool,
            "allowed", decision.allowed(),
            "riskCount", risks.size(),
            "timestamp", decision.timestamp().toString()
        ));
        return decision;
    }

    public List<Map<String, Object>> auditLog() {
        return List.copyOf(auditLog);
    }
}
