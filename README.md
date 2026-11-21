# 🎮 MCPMC — Cầu Nối AI Trợ Lý Cho Minecraft Fabric 1.21.11

[![Minecraft](https://img.shields.io/badge/Minecraft-1.21.11-brightgreen.svg)](https://www.minecraft.net/)
[![Fabric](https://img.shields.io/badge/Modloader-Fabric-blue.svg)](https://fabricmc.net/)
[![MCP](https://img.shields.io/badge/Protocol-Model_Context_Protocol-orange.svg)](https://modelcontextprotocol.io/)
[![Release](https://img.shields.io/github/v/release/shopwarlergen/MCPMC?color=success)](https://github.com/shopwarlergen/MCPMC/releases/latest)

**MCPMC** là cầu nối đưa các **AI Agent** hàng đầu hiện nay (như Claude Desktop, Antigravity, Cursor,...) trực tiếp vào thế giới Minecraft của bạn. 

AI sẽ có **"mắt"** để quan sát trạng thái nhân vật thời gian thực (máu, đói, túi đồ, khối xung quanh, tin nhắn chat) và có **"tay"** để tự động thực thi các hành động trong game theo yêu cầu bằng ngôn ngữ tự nhiên của bạn!

---

## 📥 TẢI VỀ NHANH (Download)

👉 **[Tải file Mod `mcpmc.jar` (Phiên bản mới nhất)](https://github.com/shopwarlergen/MCPMC/releases/download/v1.0.0/mcpmc.jar)**

*(Chỉ cần tải 1 file `.jar` này là đủ để cài vào game, không cần cài thêm thư viện phụ nào khác)*

---

## 🌟 AI có thể làm gì trong Minecraft của bạn?

Khi kết nối với MCPMC, bạn chỉ cần chat bằng tiếng Việt với AI:

- 🗣️ *"Xem hộ tôi máu và độ đói còn bao nhiêu, đang đứng ở tọa độ nào?"* ➔ AI tự kiểm tra và báo cáo.
- 🎒 *"Trong túi đồ có còn bánh mì hoặc đuốc không?"* ➔ AI tự mở túi đồ rà soát và trả lời số lượng.
- 📦 *"Rương trước mặt đang chứa những món gì?"* ➔ AI tự đọc danh sách đồ trong rương.
- 🧟 *"Xung quanh đây có quái vật hoặc người chơi nào không?"* ➔ AI quét radar thực thể trong phạm vi 16 block.
- ⛏️ *"Cầm cúp trên hotbar và đào khối đá trước mặt"* ➔ AI tự chuyển slot hotbar và đập khối.
- 💬 *"Chat vào game nhắc đồng đội tập hợp tọa độ X Y Z"* ➔ AI tự gửi lệnh/tin nhắn vào server.

---

## 🚀 HƯỚNG DẪN CÀI ĐẶT TỪ A ĐẾN Z (Ai cũng làm được)

Chỉ mất **3 phút** để cài đặt theo 3 bước đơn giản dưới đây:

### Bước 1: Cài đặt Mod vào Minecraft
1. Đảm bảo bạn đang chơi Minecraft phiên bản **1.21.11** bằng **Fabric Loader**.
2. Đã có mod **Fabric API (1.21.11)** trong thư mục `mods`.
3. Tải file **[mcpmc.jar](https://github.com/shopwarlergen/MCPMC/releases/download/v1.0.0/mcpmc.jar)** về.
4. Bỏ file `mcpmc.jar` vào thư mục `mods` của game (thường ở `%appdata%\.minecraft\mods`).
5. Khởi động Minecraft và vào chơi (chơi đơn hoặc vào bất kỳ server nào). Khi vào game, mod sẽ tự động mở cổng kết nối nội bộ `127.0.0.1:8765`.

---

### Bước 2: Cài đặt MCP Server trên máy tính
1. Tải và cài đặt **[Node.js](https://nodejs.org/)** (chọn bản LTS).
2. Tải mã nguồn repository này về máy (hoặc dùng `git clone https://github.com/shopwarlergen/MCPMC.git`).
3. Mở terminal / PowerShell tại thư mục `mcp-server` và chạy:
   ```bash
   cd mcp-server
   npm install
   ```

---

### Bước 3: Kết nối với ứng dụng AI của bạn

#### Dành cho Claude Desktop:
Mở file cấu hình `claude_desktop_config.json` của bạn và thêm đoạn mã sau:

```json
{
  "mcpServers": {
    "mcpmc": {
      "command": "node",
      "args": ["<ĐƯỜNG_DẪN_TỚI_THƯ_MỤC>/mcp-server/index.js"]
    }
  }
}
```
*(Thay `<ĐƯỜNG_DẪN_TỚI_THƯ_MỤC>` bằng đường dẫn thực tế trên máy bạn, ví dụ `D:/mcpmc/mcp-server/index.js`)*

#### Dành cho Antigravity / Cursor:
Thêm server MCP kiểu `stdio`:
- **Command:** `node`
- **Args:** `["D:/mcpmc/mcp-server/index.js"]`

Khởi động lại ứng dụng AI, bạn sẽ thấy biểu tượng 13 công cụ của `mcpmc` sẵn sàng phục vụ!

---

## 🛠 Danh sách 13 công cụ có sẵn

| Tên công cụ | Nhóm | Công dụng |
| :--- | :---: | :--- |
| `get_player_status` | 👁️ Mắt (Đọc) | Đọc máu, đói, cấp độ, chiều không gian, hướng nhìn và tọa độ chính xác |
| `get_inventory` | 👁️ Mắt (Đọc) | Đọc toàn bộ 36 ô túi đồ chính, 4 ô giáp và 1 ô tay phụ |
| `get_open_container` | 👁️ Mắt (Đọc) | Đọc danh sách vật phẩm trong rương, lò nung hoặc GUI đang mở |
| `get_nearby_entities` | 👁️ Mắt (Đọc) | Quét người chơi, quái vật, động vật và item rơi lân cận |
| `scan_block_entities` | 👁️ Mắt (Đọc) | Quét vị trí các rương, lò nung, hopper trong bán kính gần |
| `get_block_context` | 👁️ Mắt (Đọc) | Xem chi tiết thông tin của khối tại tọa độ cụ thể |
| `get_recent_chat` | 👁️ Mắt (Đọc) | Đọc lịch sử 100 dòng chat gần nhất từ server hoặc người chơi |
| `send_chat_or_command` | 🖐️ Tay (Hành động) | Gửi tin nhắn chat hoặc gõ lệnh game (ví dụ `/home`, `/spawn`) |
| `select_hotbar_slot` | 🖐️ Tay (Hành động) | Chọn ô hotbar từ 0 đến 8 |
| `click_container_slot` | 🖐️ Tay (Hành động) | Click lấy/chuyển đồ trong kho đồ hoặc rương |
| `close_current_screen` | 🖐️ Tay (Hành động) | Đóng màn hình rương / GUI đang mở |
| `look_at` | 🖐️ Tay (Hành động) | Xoay hướng nhìn của nhân vật sang góc bất kỳ |
| `interact_block` | 🖐️ Tay (Hành động) | Chuột phải tương tác với khối (mở rương, gạt cần gạt, bấm nút) |

---

## 🔒 Tính năng bảo mật & An toàn
- **Chỉ kết nối nội bộ (Loopback only):** WebSocket mod chỉ lắng nghe trên `127.0.0.1`, tuyệt đối không mở ra ngoài Internet, ngăn ngừa hoàn toàn nguy cơ bị can thiệp từ xa.
- **Bảo vệ luồng chính (Thread-safe):** Mọi hành động của AI đều được đồng bộ chặt chẽ với tick chính của Minecraft với cơ chế timeout tự động 3 giây, đảm bảo game không bao giờ bị giật lag hay treo client.

---

## 📄 Bản quyền & Đóng góp
Dự án được phát hành mã nguồn mở theo giấy phép [MIT License](LICENSE). Mọi đóng góp (Pull Request, Issue) đều được hoan nghênh tại [GitHub Repository](https://github.com/shopwarlergen/MCPMC)!
