package com.javaai.kb.labs.tools;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

class SafeToolRegistryTest {

    @Test
    void discoversAndInvokesAllowedSpringAiTool() {
        var registry = new SafeToolRegistry(
            new SafeToolRegistry.DemoTools(),
            Set.of("weather")
        );
        assertTrue(registry.toolNames().containsAll(Set.of("weather", "deleteAccount")));
        assertEquals("Shanghai: 22C, sunny", registry.call("weather", Map.of("city", "Shanghai")));
    }

    @Test
    void enforcesArgumentsAndLeastPrivilege() {
        var registry = new SafeToolRegistry(
            new SafeToolRegistry.DemoTools(),
            Set.of("weather")
        );
        assertThrows(SecurityException.class,
            () -> registry.call("deleteAccount", Map.of("accountId", "42")));
        assertThrows(IllegalArgumentException.class,
            () -> registry.call("weather", Map.of("city", " ")));
    }
}
