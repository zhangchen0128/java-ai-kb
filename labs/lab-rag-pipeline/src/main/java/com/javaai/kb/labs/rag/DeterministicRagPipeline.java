package com.javaai.kb.labs.rag;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * A provider-free RAG pipeline with deterministic embeddings, tenant filtering,
 * vector/lexical retrieval, RRF fusion and citation output.
 */
public final class DeterministicRagPipeline {

    public record Document(String id, String tenant, String text) {}
    public record Result(Document document, double score) {}
    public record Answer(String text, List<String> citations) {}

    private final Map<String, Document> documents = new LinkedHashMap<>();

    public void index(Document document) {
        if (document.id() == null || document.id().isBlank()) throw new IllegalArgumentException("id is required");
        if (document.tenant() == null || document.tenant().isBlank()) throw new IllegalArgumentException("tenant is required");
        documents.put(document.id(), document);
    }

    public List<Result> search(String query, String tenant, int limit) {
        if (query == null || query.isBlank() || limit <= 0) return List.of();
        var candidates = documents.values().stream()
            .filter(document -> document.tenant().equals(tenant))
            .toList();
        if (candidates.isEmpty()) return List.of();

        var vectorRank = rank(candidates, document -> cosine(embed(query), embed(document.text())));
        var lexicalRank = rank(candidates, document -> lexical(query, document.text()));
        var scores = new HashMap<String, Double>();
        fuse(scores, vectorRank, 60);
        fuse(scores, lexicalRank, 60);

        return candidates.stream()
            .map(document -> new Result(document, scores.getOrDefault(document.id(), 0.0)))
            .sorted(Comparator.comparingDouble(Result::score).reversed()
                .thenComparing(result -> result.document().id()))
            .limit(limit)
            .toList();
    }

    public Answer answer(String query, String tenant) {
        var results = search(query, tenant, 3);
        if (results.isEmpty()) return new Answer("No grounded answer available.", List.of());
        var citations = results.stream().map(result -> result.document().id()).toList();
        return new Answer(results.getFirst().document().text(), citations);
    }

    private static List<Document> rank(List<Document> documents, java.util.function.ToDoubleFunction<Document> scorer) {
        return documents.stream()
            .sorted(Comparator.comparingDouble(scorer).reversed().thenComparing(Document::id))
            .toList();
    }

    private static void fuse(Map<String, Double> scores, List<Document> ranking, int k) {
        for (int index = 0; index < ranking.size(); index++) {
            scores.merge(ranking.get(index).id(), 1.0 / (k + index + 1), Double::sum);
        }
    }

    private static double[] embed(String text) {
        var vector = new double[16];
        for (var token : tokens(text)) {
            var hash = token.hashCode();
            vector[Math.floorMod(hash, vector.length)] += (hash & 1) == 0 ? 1.0 : -1.0;
        }
        return vector;
    }

    private static double lexical(String query, String text) {
        Set<String> queryTokens = Set.copyOf(tokens(query));
        var documentTokens = tokens(text);
        if (queryTokens.isEmpty() || documentTokens.isEmpty()) return 0;
        var matches = documentTokens.stream().filter(queryTokens::contains).count();
        return (double) matches / documentTokens.size();
    }

    private static List<String> tokens(String text) {
        var normalized = text.toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}]+", " ").trim();
        if (normalized.isEmpty()) return List.of();
        return new ArrayList<>(List.of(normalized.split("\\s+")));
    }

    private static double cosine(double[] left, double[] right) {
        double dot = 0, leftNorm = 0, rightNorm = 0;
        for (int index = 0; index < left.length; index++) {
            dot += left[index] * right[index];
            leftNorm += left[index] * left[index];
            rightNorm += right[index] * right[index];
        }
        if (leftNorm == 0 || rightNorm == 0) return 0;
        return dot / Math.sqrt(leftNorm * rightNorm);
    }
}
