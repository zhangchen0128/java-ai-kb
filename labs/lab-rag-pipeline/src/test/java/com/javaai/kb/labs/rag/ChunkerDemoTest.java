package com.javaai.kb.labs.rag;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import java.util.List;

class ChunkerDemoTest {
    @Test void fixedSize() {
        var r = ChunkerDemo.fixedSize("hello world test", 5, 2);
        assertFalse(r.isEmpty());
    }
    @Test void byParagraph() {
        var r = ChunkerDemo.byParagraph("a\n\nb\n\nc");
        assertEquals(3, r.size());
    }
    @Test void recursive() {
        var r = ChunkerDemo.recursive("hello world", 20, new String[]{" "}, 0);
        assertFalse(r.isEmpty());
    }
}
