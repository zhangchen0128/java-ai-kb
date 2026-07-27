package com.javaai.kb.labs.security;

import java.util.regex.Pattern;

/**
 * Prompt注入检测 — 输入安全.
 *
 * 对应知识库：15-AI安全与治理/15-AI安全全面防护体系.md §LLM01
 */
public class InputSanitizer {

    private static final Pattern[] INJECTION_PATTERNS = {
        Pattern.compile("(?i)ignore (all )?(previous|above) (instructions|prompts?)"),
        Pattern.compile("(?i)you are now\\b"),
        Pattern.compile("(?i)system prompt:"),
        Pattern.compile("(?i)new instructions?:?"),
        Pattern.compile("(?i)\\[INST\\]"),
        Pattern.compile("(?i)<\\|im_start\\|>"),
    };

    /** 检测输入中是否有注入模式 */
    public static boolean containsInjection(String input) {
        for (var p : INJECTION_PATTERNS) {
            if (p.matcher(input).find()) return true;
        }
        return false;
    }

    /** 用不可猜测的UUID分隔符包裹用户输入 */
    public static String wrapUserInput(String userInput) {
        var sep = "---USER-START-" + java.util.UUID.randomUUID() + "---";
        return sep + "\n" + userInput + "\n" + sep;
    }

    /** 简单PII脱敏 */
    public static String maskPII(String text) {
        return text
            .replaceAll("1[3-9]\\d{9}", "[PHONE]")
            .replaceAll("\\d{17}[\\dXx]", "[ID_CARD]")
            .replaceAll("[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}", "[EMAIL]");
    }
}
