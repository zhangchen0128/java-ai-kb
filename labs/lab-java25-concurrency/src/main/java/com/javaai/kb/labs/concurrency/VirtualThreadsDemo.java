package com.javaai.kb.labs.concurrency;

import java.time.Duration;
import java.util.ArrayList;
import java.util.concurrent.*;
import java.util.concurrent.locks.ReentrantLock;

/**
 * 虚拟线程示例 — JDK 25 Virtual Threads (JEP 444).
 *
 * 对应知识库：02-Java平台/语言特性/02-现代Java25深度解析.md §1
 */
public class VirtualThreadsDemo {

    /** 百万并发：每个任务一个虚拟线程 */
    public static long runMillionTasks(int count) throws Exception {
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var futures = new ArrayList<Future<Long>>();
            var start = System.currentTimeMillis();
            for (int i = 0; i < count; i++) {
                final int id = i;
                futures.add(executor.submit(() -> {
                    Thread.sleep(Duration.ofMillis(10)); // 模拟I/O
                    return Thread.currentThread().threadId();
                }));
            }
            for (var f : futures) f.get();
            return System.currentTimeMillis() - start;
        }
    }

    /** 直接创建虚拟线程 */
    public static void createVirtualThread() throws InterruptedException {
        var vt = Thread.ofVirtual()
            .name("demo-vt-", 1)
            .start(() -> System.out.println("VT: " + Thread.currentThread()));
        vt.join();
    }

    /** 避免 pinning：用 ReentrantLock 替代 synchronized */
    public static void avoidPinning() throws Exception {
        var lock = new ReentrantLock();
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            for (int i = 0; i < 10; i++) {
                executor.submit(() -> {
                    lock.lock();
                    try {
                        Thread.sleep(Duration.ofMillis(100)); // 不会pinning
                    } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
                    finally { lock.unlock(); }
                });
            }
        }
    }

    public static void main(String[] args) throws Exception {
        System.out.println("Virtual Threads Demo\n");
        createVirtualThread();
        long ms = runMillionTasks(1_000);
        System.out.printf("1,000 tasks: %dms%n", ms);
        avoidPinning();
        System.out.println("Done — no pinning.");
    }
}
