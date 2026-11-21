# MCPMC - Model Context Protocol Bridge for Minecraft Fabric 1.21.11

Hệ thống cầu nối 2 tầng (2-Tier MCP Bridge) cho phép AI Agent đọc toàn bộ dữ liệu thế giới, chỉ số người chơi thời gian thực và thực thi các hành động điều khiển trong **Minecraft Fabric 1.21.11**.

---

## 📌 Kiến trúc 2 tầng độc lập

```
+-------------------------------------------------------------+
|                     AI Agent (Client)                       |
|          (Claude Desktop, Antigravity, Cursor, etc.)        |
+-------------------------------------------------------------+
                              |
                              | stdio (JSON-RPC 2.0)
                              v
+-------------------------------------------------------------+
|             Tầng 2: Standalone Node.js MCP Server           |
|                Thư mục: ./mcp-server/                       |
|   - Triển khai @modelcontextprotocol/sdk                    |
|   - Định tuyến tool calls sang WebSocket loopback           |
|   - Tự động thử lại kết nối vô hạn (exponential backoff)    |
|   - Vệ sinh tuyệt đối stdio (chỉ JSON-RPC, logs ra stderr)  |
+-------------------------------------------------------------+
                              |
                              | ws://127.0.0.1:8765
                              v
+-------------------------------------------------------------+
|            Tầng 1: Embedded Fabric Mod (mcpmc.jar)          |
|   - WebSocket Server gắn kết 127.0.0.1:8765 (Java-WebSocket)|
|   - Điều phối đồng bộ luồng chính (MinecraftClient.execute) |
|   - Timeout cứng 3000ms bảo vệ tránh treo connection        |
|   - 7 công cụ đọc (Telemetry) + 6 công cụ ghi (Action)      |
+-------------------------------------------------------------+
```

---

## 🛠 Danh sách 13 Công cụ MCP

### Nhóm Telemetry (Đọc trạng thái thời gian thực)
1. `get_player_status`: Tọa độ x, y, z, máu, thanh đói, cấp độ kinh nghiệm, chiều không gian, góc nhìn (yaw, pitch).
2. `get_inventory`: Đọc chi tiết 36 ô túi đồ chính + 4 ô giáp + 1 ô tay phụ.
3. `get_open_container`: Trạng thái và vật phẩm trong rương hoặc giao diện GUI đang mở.
4. `get_nearby_entities`: Quét các thực thể sống trong bán kính (mặc định 16 block).
5. `scan_block_entities`: Quét các BlockEntity chức năng (rương, lò nung, hopper) lân cận.
6. `get_block_context`: Lấy thông tin khối tại tọa độ cụ thể (tên khối, độ cứng, trạng thái va chạm).
7. `get_recent_chat`: Đọc tối đa 100 dòng chat gần nhất (kênh CHAT người chơi hoặc GAME hệ thống).

### Nhóm Action (Thực thi hành động)
8. `send_chat_or_command`: Gửi tin nhắn chat hoặc thực thi lệnh (`/command`).
9. `select_hotbar_slot`: Chọn ô trên thanh hotbar (0 đến 8).
10. `click_container_slot`: Thao tác click ô trong giao diện GUI đang mở.
11. `close_current_screen`: Đóng GUI rương/kho đồ đang mở.
12. `look_at`: Xoay góc nhìn yaw và pitch của nhân vật.
13. `interact_block`: Chuột phải tương tác với khối trong phạm vi 4.5 block.

---

## 📦 Biên dịch Mod (mcpmc.jar)

Yêu cầu môi trường: **Java 21** trở lên.

```bash
# Biên dịch mod jar
.\gradlew build
```

Sau khi hoàn tất, file mod thành phẩm nằm tại:
`./build/libs/mcpmc.jar`

Copy file `mcpmc.jar` vào thư mục `mods` của Minecraft Fabric 1.21.11.

---

## 🚀 Khởi chạy MCP Server (Node.js)

Yêu cầu: **Node.js LTS** (hỗ trợ ES Modules).

```bash
cd mcp-server
npm install
node index.js
```

### Cấu hình trong MCP Client (Claude Desktop / Antigravity / Cursor)
```json
{
  "mcpServers": {
    "mcpmc": {
      "command": "node",
      "args": ["D:/mcpmc/mcp-server/index.js"],
      "env": {
        "MC_WS_URL": "ws://127.0.0.1:8765"
      }
    }
  }
}
```

---

## 🔄 Tự động đồng bộ lên GitHub
Mỗi khi có cập nhật, bạn có thể chạy:
```powershell
.\auto_push.bat
# hoặc
.\auto_push.ps1 "Nội dung cập nhật"
```
Mã nguồn sẽ được tự động đồng bộ lên: https://github.com/shopwarlergen/MCPMC
