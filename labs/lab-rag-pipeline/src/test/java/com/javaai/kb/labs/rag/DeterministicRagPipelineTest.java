package com.javaai.kb.labs.rag;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class DeterministicRagPipelineTest {

    private DeterministicRagPipeline pipeline;

    @BeforeEach
    void setUp() {
        pipeline = new DeterministicRagPipeline();
        pipeline.index(new DeterministicRagPipeline.Document("java", "tenant-a", "Java virtual threads improve IO concurrency"));
        pipeline.index(new DeterministicRagPipeline.Document("rag", "tenant-a", "RAG combines retrieval and generation"));
        pipeline.index(new DeterministicRagPipeline.Document("secret", "tenant-b", "private tenant document"));
    }

    @Test
    void fusesVectorAndLexicalRanksDeterministically() {
        assertEquals("rag", pipeline.search("RAG retrieval", "tenant-a", 2).getFirst().document().id());
    }

    @Test
    void filtersTenantsBeforeRanking() {
        var results = pipeline.search("private tenant document", "tenant-a", 10);
        assertTrue(results.stream().noneMatch(result -> result.document().id().equals("secret")));
    }

    @Test
    void deduplicatesByDocumentIdAndReturnsCitations() {
        pipeline.index(new DeterministicRagPipeline.Document("rag", "tenant-a", "RAG retrieval with citations"));
        var answer = pipeline.answer("RAG citations", "tenant-a");
        assertEquals(answer.citations().size(), answer.citations().stream().distinct().count());
        assertTrue(answer.citations().contains("rag"));
    }

    @Test
    void returnsGroundedEmptyAnswer() {
        assertTrue(pipeline.answer("anything", "unknown").citations().isEmpty());
    }

    @Test
    void chunksDocumentsWithBoundedOverlapBeforeIndexing() {
        var chunks = ChunkerDemo.fixedSize("abcdefghij", 4, 1);
        assertEquals(java.util.List.of("abcd", "defg", "ghij", "j"), chunks);
        assertTrue(chunks.stream().allMatch(chunk -> chunk.length() <= 4));
    }

    @Test
    void rejectsChunkingParametersThatCannotMakeProgress() {
        assertThrows(IllegalArgumentException.class,
            () -> ChunkerDemo.fixedSize("text", 4, 4));
        assertThrows(IllegalArgumentException.class,
            () -> ChunkerDemo.fixedSize("text", 0, 0));
    }
}
