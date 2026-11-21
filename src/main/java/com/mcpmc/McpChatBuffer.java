package com.mcpmc;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentLinkedDeque;

public class McpChatBuffer {
    public static class Entry {
        public final String timestamp;
        public final long epochMs;
        public final String channel;
        public final String text;

        public Entry(String channel, String text) {
            this.timestamp = Instant.now().toString();
            this.epochMs = System.currentTimeMillis();
            this.channel = channel != null ? channel : "GAME";
            this.text = text != null ? McpProtocol.stripColor(text) : "";
        }

        public JsonObject toJson() {
            JsonObject obj = new JsonObject();
            obj.addProperty("timestamp", timestamp);
            obj.addProperty("epochMs", epochMs);
            obj.addProperty("channel", channel);
            obj.addProperty("text", text);
            return obj;
        }
    }

    private static final int MAX_ENTRIES = 100;
    private static final ConcurrentLinkedDeque<Entry> BUFFER = new ConcurrentLinkedDeque<>();

    public static void addMessage(String channel, String text) {
        if (text == null || text.isBlank()) return;
        BUFFER.addLast(new Entry(channel, text));
        while (BUFFER.size() > MAX_ENTRIES) {
            BUFFER.pollFirst();
        }
    }

    public static JsonArray getRecent(int limit) {
        int clampedLimit = Math.max(1, Math.min(limit, MAX_ENTRIES));
        List<Entry> all = new ArrayList<>(BUFFER);
        int size = all.size();
        int startIndex = Math.max(0, size - clampedLimit);

        JsonArray arr = new JsonArray();
        for (int i = startIndex; i < size; i++) {
            arr.add(all.get(i).toJson());
        }
        return arr;
    }

    public static void clear() {
        BUFFER.clear();
    }
}
