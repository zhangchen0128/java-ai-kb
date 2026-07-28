package com.javaai.kb.labs.a2a;

import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.a2aproject.sdk.server.tasks.InMemoryTaskStore;
import org.a2aproject.sdk.spec.MessageSendParams;
import org.a2aproject.sdk.spec.Task;
import org.a2aproject.sdk.spec.TaskQueryParams;
import org.a2aproject.sdk.spec.TaskState;
import org.a2aproject.sdk.spec.TaskStatus;

/**
 * Deterministic in-process A2A server boundary backed by the official SDK task
 * store and protocol model.
 */
public final class InProcessA2aAgent {

    public static final String VERSION_HEADER = "A2A-Version";
    public static final String PROTOCOL_VERSION = "1.0";

    private final AtomicInteger taskSequence = new AtomicInteger();
    private final InMemoryTaskStore taskStore = new InMemoryTaskStore();

    public Task sendMessage(MessageSendParams params, Map<String, String> headers) {
        requireProtocolVersion(headers);
        if (params == null || params.message() == null) {
            throw new IllegalArgumentException("message is required");
        }

        var taskId = "task-" + taskSequence.incrementAndGet();
        var contextId = params.message().contextId() == null
            ? "context-" + taskId
            : params.message().contextId();
        var task = Task.builder()
            .id(taskId)
            .contextId(contextId)
            .status(new TaskStatus(TaskState.TASK_STATE_COMPLETED))
            .history(List.of(params.message()))
            .metadata(Map.of("protocolVersion", PROTOCOL_VERSION))
            .build();
        taskStore.save(task, false);
        return task;
    }

    public Task getTask(TaskQueryParams params, Map<String, String> headers) {
        requireProtocolVersion(headers);
        if (params == null || params.id() == null || params.id().isBlank()) {
            throw new IllegalArgumentException("task id is required");
        }
        var task = taskStore.get(params.id());
        if (task == null) throw new IllegalArgumentException("task not found: " + params.id());
        return task;
    }

    private static void requireProtocolVersion(Map<String, String> headers) {
        var supplied = headers == null ? null : headers.entrySet().stream()
            .filter(entry -> VERSION_HEADER.equalsIgnoreCase(entry.getKey()))
            .map(Map.Entry::getValue)
            .findFirst()
            .orElse(null);
        if (!PROTOCOL_VERSION.equals(supplied)) {
            throw new IllegalArgumentException(
                VERSION_HEADER + " must be " + PROTOCOL_VERSION
            );
        }
    }
}
