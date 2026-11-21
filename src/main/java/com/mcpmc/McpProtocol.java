package com.mcpmc;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;

public class McpProtocol {
    public static final Gson GSON = new GsonBuilder().disableHtmlEscaping().create();

    // Standard error codes
    public static final String ERR_NOT_IN_WORLD = "ERR_NOT_IN_WORLD";
    public static final String ERR_MAIN_THREAD_TIMEOUT = "ERR_MAIN_THREAD_TIMEOUT";
    public static final String ERR_BAD_REQUEST = "ERR_BAD_REQUEST";
    public static final String ERR_INVALID_PARAMS = "ERR_INVALID_PARAMS";
    public static final String ERR_NO_OPEN_SCREEN = "ERR_NO_OPEN_SCREEN";
    public static final String ERR_SLOT_OUT_OF_BOUNDS = "ERR_SLOT_OUT_OF_BOUNDS";
    public static final String ERR_OUT_OF_RANGE = "ERR_OUT_OF_RANGE";
    public static final String ERR_UNKNOWN_METHOD = "ERR_UNKNOWN_METHOD";
    public static final String ERR_INTERNAL = "ERR_INTERNAL";

    public static String success(String id, JsonObject data) {
        JsonObject res = new JsonObject();
        res.addProperty("id", id != null ? id : "");
        res.addProperty("ok", true);
        res.add("data", data != null ? data : new JsonObject());
        return GSON.toJson(res);
    }

    public static String error(String id, String code, String message) {
        JsonObject res = new JsonObject();
        res.addProperty("id", id != null ? id : "");
        res.addProperty("ok", false);
        JsonObject err = new JsonObject();
        err.addProperty("code", code != null ? code : ERR_INTERNAL);
        err.addProperty("message", message != null ? message : "Đã xảy ra lỗi không xác định.");
        res.add("error", err);
        return GSON.toJson(res);
    }

    public static String stripColor(String input) {
        if (input == null) return "";
        return input.replaceAll("§[0-9a-fk-orA-FK-OR]", "").replaceAll("§x(§[0-9a-fA-F]){6}", "");
    }
}
