package com.javaai.kb.labs.rag;

import java.util.ArrayList;
import java.util.List;

/**
 * 文档切片策略示例.
 *
 * 对应知识库：10-AI数据工程/文档处理/10-切片策略深度剖析.md
 */
public class ChunkerDemo {

    /** 固定大小切片 */
    public static List<String> fixedSize(String text, int size, int overlap) {
        var chunks = new ArrayList<String>();
        int i = 0;
        while (i < text.length()) {
            int end = Math.min(i + size, text.length());
            chunks.add(text.substring(i, end));
            i += (size - overlap);
        }
        return chunks;
    }

    /** 段落切片 — 按双换行分割 */
    public static List<String> byParagraph(String text) {
        return List.of(text.split("\n\n"));
    }

    /** 递归字符切片 — 按分隔符优先级分割 */
    public static List<String> recursive(String text, int maxLen, String[] separators, int sepIdx) {
        if (text.length() <= maxLen) return List.of(text);
        if (sepIdx >= separators.length) return fixedSize(text, maxLen, 0);

        var parts = text.split(separators[sepIdx], -1);
        var result = new ArrayList<String>();
        var buf = new StringBuilder();
        for (var p : parts) {
            if (buf.length() + p.length() <= maxLen) {
                if (!buf.isEmpty()) buf.append(separators[sepIdx]);
                buf.append(p);
            } else {
                if (!buf.isEmpty()) {
                    result.addAll(recursive(buf.toString(), maxLen, separators, sepIdx + 1));
                    buf.setLength(0);
                }
                if (p.length() > maxLen) result.addAll(recursive(p, maxLen, separators, sepIdx + 1));
                else buf.append(p);
            }
        }
        if (!buf.isEmpty()) result.addAll(recursive(buf.toString(), maxLen, separators, sepIdx + 1));
        return result;
    }

    public static void main(String[] args) {
        var text = """
            # 第一章 引言

            这是第一章的内容。它包含了一些有用的信息。

            ## 1.1 背景

            背景小节介绍了相关的工作和理论基础。

            # 第二章 方法

            第二章描述了实验方法。""";

        System.out.println("固定大小 (size=50, overlap=10):");
        fixedSize(text, 50, 10).forEach(c -> System.out.println("  [" + c + "]"));

        System.out.println("\n段落切片:");
        byParagraph(text).forEach(c -> System.out.println("  [" + c.trim() + "]"));

        System.out.println("\n递归切片 (maxLen=80):");
        recursive(text, 80, new String[]{"\n\n", "\n", "。", " "}, 0)
            .forEach(c -> System.out.println("  [" + c.trim() + "]"));
    }
}
