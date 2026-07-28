package com.javaai.kb.labs.security;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Set;

/**
 * Schema and content validation at the model-output boundary.
 *
 * <p>It rejects malformed JSON, unexpected fields, active markup and sensitive
 * data before the output can reach a renderer or downstream tool.</p>
 */
public final class OutputValidator {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Set<String> ALLOWED_FIELDS = Set.of("answer", "citations");

    public record SafeAnswer(String answer, List<String> citations) {
    }

    private OutputValidator() {
    }

    public static SafeAnswer validate(String raw) {
        if (raw == null || raw.isBlank()) throw new IllegalArgumentException("output is required");
        try {
            var tree = JSON.readTree(raw);
            if (!tree.isObject()) throw new IllegalArgumentException("output must be a JSON object");
            var fieldNames = new java.util.HashSet<String>();
            tree.fieldNames().forEachRemaining(fieldNames::add);
            if (!ALLOWED_FIELDS.equals(fieldNames)) {
                throw new IllegalArgumentException("output fields must be exactly " + ALLOWED_FIELDS);
            }

            var answer = tree.path("answer").asText("");
            if (answer.isBlank()) throw new IllegalArgumentException("answer must not be blank");
            if (answer.matches("(?is).*<\\s*(script|iframe|object|embed)\\b.*")) {
                throw new SecurityException("active markup is not allowed");
            }
            if (!InputSanitizer.maskPII(answer).equals(answer)) {
                throw new SecurityException("sensitive output is not allowed");
            }
            if (!tree.path("citations").isArray()) {
                throw new IllegalArgumentException("citations must be an array");
            }
            var citations = new java.util.ArrayList<String>();
            for (var citation : tree.path("citations")) {
                if (!citation.isTextual() || citation.asText().isBlank()) {
                    throw new IllegalArgumentException("citations must contain non-blank strings");
                }
                citations.add(citation.asText());
            }
            return new SafeAnswer(answer, List.copyOf(citations));
        } catch (JsonProcessingException error) {
            throw new IllegalArgumentException("output is not valid JSON", error);
        }
    }
}
