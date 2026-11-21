# Minecraft Fabric 1.21.11 - Model Context Protocol (MCP) Server

Standalone Node.js MCP Server kết nối với Embedded WebSocket Server bên trong Fabric Mod Minecraft 1.21.11.

## 📌 Kiến trúc 2 tầng
- **Tầng 1 (Java 21):** Embedded WebSocket Server (`ws://127.0.0.1:8765`) nhúng trong client Fabric 1.21.11. Thu thập dữ liệu thế giới, chỉ số người chơi, túi đồ, tin nhắn chat và điều phối hành động điều khiển an toàn trên main-thread (`CompletableFuture`).
- **Tầng 2 (Node.js):** MCP Server giao tiếp qua chuẩn `stdio` (`@modelcontextprotocol/sdk`) với AI Agent, định tuyến công cụ sang WebSocket loopback.

## 🛠 Danh sách 13 Công cụ MCP

### Nhóm Telemetry (Đọc trạng thái thời gian thực)
1. `get_player_status`: Tọa độ, máu, thanh đói, cấp độ kinh nghiệm, chiều không gian, hướng nhìn.
2. `get_inventory`: Danh sách 36 ô túi đồ chính + 4 ô giáp + 1 ô tay phụ.
3. `get_open_container`: Trạng thái và vật phẩm trong rương/giao diện GUI đang mở.
4. `get_nearby_entities`: Quét thực thể sống trong bán kính (mặc định 16 block).
5. `scan_block_entities`: Quét rương, lò nung, hopper lân cận.
6. `get_block_context`: Thông tin khối tại tọa độ cụ thể (tên, độ cứng, trạng thái va chạm).
7. `get_recent_chat`: Lấy tối đa 100 dòng chat gần nhất (kênh CHAT hoặc GAME).

### Nhóm Action (Thực thi hành động)
8. `send_chat_or_command`: Gửi tin nhắn chat hoặc lệnh game (`/command`).
9. `select_hotbar_slot`: Chọn slot trên thanh hotbar (0 đến 8).
10. `click_container_slot`: Tương tác click ô trong giao diện GUI đang mở.
11. `close_current_screen`: Đóng GUI rương/kho đồ đang mở.
12. `look_at`: Xoay góc nhìn yaw / pitch của nhân vật.
13. `interact_block`: Chuột phải tương tác với khối trong phạm vi 4.5 block.

## 🚀 Hướng dẫn cài đặt & Khởi chạy

```bash
cd mcp-server
npm install
node index.js
```

### Cấu hình MCP Client (Claude Desktop / Antigravity / Cursor)
```json
{
  "mcpServers": {
    "minecraft": {
      "command": "node",
      "args": ["D:/meteor-cobble-addon/mcp-server/index.js"],
      "env": {
        "MC_WS_URL": "ws://127.0.0.1:8765"
      }
    }
  }
}
```
