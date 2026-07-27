package com.javaai.kb.labs.concurrency;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.DisplayName;
import static org.junit.jupiter.api.Assertions.*;

import java.util.concurrent.*;
import java.time.Duration;

class VirtualThreadsTest {

    @Test @DisplayName("虚拟线程创建和运行")
    void createAndRun() throws Exception {
        VirtualThreadsDemo.createVirtualThread();
    }

    @Test @DisplayName("100任务并发完成")
    void hundredTasks() throws Exception {
        long ms = VirtualThreadsDemo.runMillionTasks(100);
        assertTrue(ms < 10_000, "100 tasks should complete quickly");
    }

    @Test @DisplayName("避免pinning")
    void noPinning() throws Exception {
        VirtualThreadsDemo.avoidPinning();
    }

    @Test @DisplayName("虚拟线程 isVirtual()")
    void isVirtual() throws Exception {
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var future = executor.submit(() -> Thread.currentThread().isVirtual());
            assertTrue(future.get(), "should be virtual thread");
        }
    }

    @Test @DisplayName("平台线程 isVirtual() = false")
    void platformThread() {
        assertFalse(Thread.currentThread().isVirtual());
    }
}
