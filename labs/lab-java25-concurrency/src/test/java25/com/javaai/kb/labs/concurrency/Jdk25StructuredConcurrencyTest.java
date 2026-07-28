package com.javaai.kb.labs.concurrency;

import java.util.concurrent.atomic.AtomicBoolean;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertTrue;

class Jdk25StructuredConcurrencyTest {

    @Test
    void scopedValueIsInheritedByBothSubtasks() throws Exception {
        var pair = Jdk25StructuredConcurrencyDemo.runPair("req-25");
        assertEquals("left:req-25", pair.left());
        assertEquals("right:req-25", pair.right());
    }

    @Test
    void failurePropagatesAndCancelsSibling() throws Exception {
        var interrupted = new AtomicBoolean();
        var cause = Jdk25StructuredConcurrencyDemo.runFailureAndObserveCancellation(interrupted);
        assertInstanceOf(IllegalStateException.class, cause);
        assertEquals("deterministic failure", cause.getMessage());
        assertTrue(interrupted.get(), "unfinished sibling should observe cancellation");
    }
}
