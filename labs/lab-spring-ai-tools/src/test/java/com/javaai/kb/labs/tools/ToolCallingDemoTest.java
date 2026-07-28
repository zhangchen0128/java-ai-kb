package com.javaai.kb.labs.tools;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

class ToolCallingDemoTest {

    @Test
    void executesARealTwoRoundChatClientToolCall() {
        var demo = new ToolCallingDemo();
        var result = demo.askWeather("Shanghai");

        assertEquals(2, demo.modelRounds());
        assertEquals("Tool result: \"Shanghai: 22C, sunny\"", result);
    }

    @Test
    void validatesArgumentsBeforeModelOrToolExecution() {
        var demo = new ToolCallingDemo();
        assertThrows(IllegalArgumentException.class, () -> demo.askWeather(" "));
        assertEquals(0, demo.modelRounds());
    }
}
