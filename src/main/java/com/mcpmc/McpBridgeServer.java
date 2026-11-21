package com.mcpmc;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.logging.LogUtils;
import net.minecraft.client.MinecraftClient;
import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;
import org.slf4j.Logger;

import java.net.InetSocketAddress;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

public class McpBridgeServer extends WebSocketServer {
    private static final Logger LOG = LogUtils.getLogger();
    private static McpBridgeServer INSTANCE;

    static {
        Runtime.getRuntime().addShutdownHook(new Thread(McpBridgeServer::stopServer, "MCP-Bridge-ShutdownHook"));
    }

    public static synchronized McpBridgeServer getInstance() {
        return INSTANCE;
    }

    public static synchronized void startServer() {
        if (INSTANCE != null) {
            LOG.warn("[MCP-Bridge] WebSocket Server đã đang chạy.");
            return;
        }

        int port = 8765;
        String portProp = System.getProperty("mc.mcp.port");
        if (portProp != null) {
            try {
                port = Integer.parseInt(portProp.trim());
            } catch (NumberFormatException ignored) {}
        }

        try {
            INSTANCE = new McpBridgeServer(new InetSocketAddress("127.0.0.1", port));
            INSTANCE.setDaemon(true);
            INSTANCE.start();
            LOG.info("[MCP-Bridge] Đã khởi động WebSocket Server thành công tại 127.0.0.1:{}", port);
        } catch (Exception e) {
            LOG.error("[MCP-Bridge] Không thể khởi động WebSocket Server: ", e);
            INSTANCE = null;
        }
    }

    public static synchronized void stopServer() {
        if (INSTANCE != null) {
            try {
                LOG.info("[MCP-Bridge] Đang dừng WebSocket Server và giải phóng kết nối...");
                INSTANCE.stop(1000);
            } catch (Exception e) {
                LOG.error("[MCP-Bridge] Lỗi khi dừng WebSocket Server: ", e);
            } finally {
                INSTANCE = null;
            }
        }
    }

    private McpBridgeServer(InetSocketAddress address) {
        super(address);
    }

    @Override
    public void onStart() {
        LOG.info("[MCP-Bridge] WebSocket Server đã bắt đầu lắng nghe kết nối.");
    }

    @Override
    public void onOpen(WebSocket conn, ClientHandshake handshake) {
        LOG.info("[MCP-Bridge] AI Agent MCP Client đã kết nối từ {}", conn.getRemoteSocketAddress());
    }

    @Override
    public void onClose(WebSocket conn, int code, String reason, boolean remote) {
        LOG.info("[MCP-Bridge] AI Agent MCP Client đã đóng kết nối (mã: {}, lý do: {})", code, reason);
    }

    @Override
    public void onError(WebSocket conn, Exception ex) {
        LOG.error("[MCP-Bridge] Sự cố WebSocket: ", ex);
    }

    @Override
    public void onMessage(WebSocket conn, String message) {
        if (conn == null || message == null || message.isBlank()) return;

        String reqId = "";
        String method = "";
        JsonObject params = null;

        try {
            JsonObject req = JsonParser.parseString(message).getAsJsonObject();
            reqId = req.has("id") ? req.get("id").getAsString() : "";
            if (!req.has("method")) {
                conn.send(McpProtocol.error(reqId, McpProtocol.ERR_BAD_REQUEST, "Yêu cầu thiếu trường 'method'."));
                return;
            }
            method = req.get("method").getAsString();
            if (req.has("params") && req.get("params").isJsonObject()) {
                params = req.getAsJsonObject("params");
            } else {
                params = new JsonObject();
            }
        } catch (Exception e) {
            conn.send(McpProtocol.error(reqId, McpProtocol.ERR_BAD_REQUEST, "Gói tin JSON không hợp lệ: " + e.getMessage()));
            return;
        }

        final String finalId = reqId;
        final String finalMethod = method;
        final JsonObject finalParams = params;

        // Dispatch asynchronously to Minecraft main thread
        MinecraftClient mc = MinecraftClient.getInstance();
        if (mc == null) {
            conn.send(McpProtocol.error(finalId, McpProtocol.ERR_NOT_IN_WORLD, "MinecraftClient chưa sẵn sàng."));
            return;
        }

        CompletableFuture<String> future = new CompletableFuture<>();

        mc.execute(() -> {
            try {
                if (mc.player == null || mc.world == null) {
                    future.complete(McpProtocol.error(finalId, McpProtocol.ERR_NOT_IN_WORLD, "Người chơi chưa tham gia thế giới hoặc server."));
                    return;
                }
                JsonObject result = dispatch(mc, finalMethod, finalParams);
                future.complete(McpProtocol.success(finalId, result));
            } catch (McpException me) {
                future.complete(McpProtocol.error(finalId, me.getCode(), me.getMessage()));
            } catch (Throwable t) {
                LOG.error("[MCP-Bridge] Lỗi thực thi lệnh {}: ", finalMethod, t);
                future.complete(McpProtocol.error(finalId, McpProtocol.ERR_INTERNAL, "Lỗi nội bộ phát sinh: " + t.getMessage()));
            }
        });

        // 3000ms hard timeout limit
        future.orTimeout(3000, TimeUnit.MILLISECONDS)
            .whenComplete((responseStr, throwable) -> {
                try {
                    if (throwable instanceof TimeoutException) {
                        conn.send(McpProtocol.error(finalId, McpProtocol.ERR_MAIN_THREAD_TIMEOUT,
                            "Luồng chính Minecraft không phản hồi trong 3000ms."));
                    } else if (throwable != null) {
                        conn.send(McpProtocol.error(finalId, McpProtocol.ERR_INTERNAL,
                            "Lỗi timeout/thực thi: " + throwable.getMessage()));
                    } else if (responseStr != null && conn.isOpen()) {
                        conn.send(responseStr);
                    }
                } catch (Exception sendEx) {
                    LOG.error("[MCP-Bridge] Không thể gửi phản hồi về client: ", sendEx);
                }
            });
    }

    private JsonObject dispatch(MinecraftClient mc, String method, JsonObject params) {
        if (params == null) params = new JsonObject();
        return switch (method) {
            case "get_player_status" -> McpTelemetryService.getPlayerStatus(mc);
            case "get_inventory" -> McpTelemetryService.getInventory(mc);
            case "get_open_container" -> McpTelemetryService.getOpenContainer(mc);
            case "get_nearby_entities" -> McpTelemetryService.getNearbyEntities(mc, params);
            case "scan_block_entities" -> McpTelemetryService.scanBlockEntities(mc, params);
            case "get_block_context" -> McpTelemetryService.getBlockContext(mc, params);
            case "get_recent_chat" -> McpTelemetryService.getRecentChat(params);
            case "send_chat_or_command" -> McpActionExecutor.sendChatOrCommand(mc, params);
            case "select_hotbar_slot" -> McpActionExecutor.selectHotbarSlot(mc, params);
            case "click_container_slot" -> McpActionExecutor.clickContainerSlot(mc, params);
            case "close_current_screen" -> McpActionExecutor.closeCurrentScreen(mc);
            case "look_at" -> McpActionExecutor.lookAt(mc, params);
            case "interact_block" -> McpActionExecutor.interactBlock(mc, params);
            default -> throw new McpException(McpProtocol.ERR_UNKNOWN_METHOD, "Phương thức không được hỗ trợ: " + method);
        };
    }
}
