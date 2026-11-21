package com.mcpmc;

import com.mojang.logging.LogUtils;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientLifecycleEvents;
import net.fabricmc.fabric.api.client.message.v1.ClientReceiveMessageEvents;
import org.slf4j.Logger;

public class McpClientMod implements ClientModInitializer {
    private static final Logger LOG = LogUtils.getLogger();

    @Override
    public void onInitializeClient() {
        LOG.info("[MCPMC] Khởi tạo Fabric Client MCP Bridge cho Minecraft 1.21.11...");

        // Khởi động WebSocket server
        McpBridgeServer.startServer();

        // Đăng ký sự kiện tắt game để dừng WebSocket Server êm ái
        ClientLifecycleEvents.CLIENT_STOPPING.register(client -> {
            LOG.info("[MCPMC] Client đang dừng, giải phóng WebSocket Server...");
            McpBridgeServer.stopServer();
        });

        // Đăng ký bộ đệm tin nhắn chat người chơi
        ClientReceiveMessageEvents.CHAT.register((message, signedMessage, sender, params, receptionTimestamp) -> {
            if (message != null) {
                McpChatBuffer.addMessage("CHAT", message.getString());
            }
        });

        // Đăng ký bộ đệm thông báo hệ thống / plugin từ server
        ClientReceiveMessageEvents.GAME.register((message, overlay) -> {
            if (message != null) {
                McpChatBuffer.addMessage("GAME", message.getString());
            }
        });

        LOG.info("[MCPMC] Đã sẵn sàng phục vụ AI Agent trên cổng loopback.");
    }
}
