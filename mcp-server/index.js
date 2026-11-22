import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import WebSocket from "ws";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { parseSchematic } from "./schematic-parser.js";
import { printSchematic, verifyStructure } from "./schematic-printer.js";

// ==========================================
// CẤU HÌNH & QUẢN LÝ KẾT NỐI WEBSOCKET
// ==========================================
const WS_URL = process.env.MC_MCP_WS_URL || "ws://127.0.0.1:8765";
const REQUEST_TIMEOUT_MS = 4500;
const RECONNECT_INTERVAL_MS = 2500;

let ws = null;
let isConnected = false;
let reconnectTimer = null;
const pendingRequests = new Map();

function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  try {
    ws = new WebSocket(WS_URL);

    ws.on("open", () => {
      isConnected = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      console.error(`[MCP-Bridge] Đã kết nối thành công tới Minecraft WebSocket tại ${WS_URL}`);
    });

    ws.on("message", (raw) => {
      try {
        const res = JSON.parse(raw.toString("utf8"));
        if (!res || !res.id) return;

        const pending = pendingRequests.get(res.id);
        if (!pending) return;

        clearTimeout(pending.timer);
        pendingRequests.delete(res.id);

        if (res.ok) {
          pending.resolve(res.data);
        } else {
          const errObj = res.error || {};
          const msg = errObj.message || errObj.code || "Lỗi không xác định từ Minecraft.";
          pending.reject(new Error(msg));
        }
      } catch (parseErr) {
        console.error(`[MCP-Bridge] Lỗi phân tích gói tin JSON từ Minecraft: ${parseErr.message}`);
      }
    });

    ws.on("close", (code, reason) => {
      if (isConnected) {
        console.error(`[MCP-Bridge] Đã mất kết nối tới Minecraft WebSocket (mã: ${code}). Đang thử kết nối lại...`);
      }
      isConnected = false;

      // Hủy toàn bộ yêu cầu đang chờ khi đứt kết nối
      for (const [id, req] of pendingRequests.entries()) {
        clearTimeout(req.timer);
        req.reject(new Error("Kết nối WebSocket tới Minecraft đã bị đóng."));
      }
      pendingRequests.clear();

      scheduleReconnect();
    });

    ws.on("error", (err) => {
      // Bắt lỗi im lặng, sự kiện close sẽ kích hoạt cơ chế kết nối lại
      if (isConnected) {
        console.error(`[MCP-Bridge] Sự cố WebSocket: ${err.message}`);
      }
    });
  } catch (err) {
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWebSocket();
  }, RECONNECT_INTERVAL_MS);
}

function sendWsRequest(method, params = {}) {
  return new Promise((resolve, reject) => {
    if (!isConnected || !ws || ws.readyState !== WebSocket.OPEN) {
      return reject(
        new Error(
          `Không thể kết nối tới Minecraft client tại ${WS_URL}. Vui lòng đảm bảo Minecraft 1.21.11 đang chạy và mod đã được tải.`
        )
      );
    }

    const id = randomUUID();
    const payload = JSON.stringify({ id, method, params });

    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`Yêu cầu '${method}' tới Minecraft bị quá thời gian chờ (${REQUEST_TIMEOUT_MS}ms).`));
    }, REQUEST_TIMEOUT_MS);

    pendingRequests.set(id, { resolve, reject, timer });

    try {
      ws.send(payload);
    } catch (sendErr) {
      clearTimeout(timer);
      pendingRequests.delete(id);
      reject(new Error(`Không thể gửi gói tin WebSocket: ${sendErr.message}`));
    }
  });
}

async function callBridge(method, params = {}) {
  try {
    const data = await sendWsRequest(method, params);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }]
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: `[Lỗi MCP Bridge] ${err.message}` }],
      isError: true
    };
  }
}

// ==========================================
// KHỞI TẠO MCP SERVER & ĐĂNG KÝ 13 TOOLS
// ==========================================
const server = new McpServer({
  name: "minecraft-mcp-server",
  version: "1.0.0"
});

// Tool 1: mc_get_player_status
server.tool(
  "mc_get_player_status",
  "Lấy trạng thái tổng thể của nhân vật: tọa độ (x, y, z), hướng nhìn (yaw, pitch, hướng la bàn), máu, mức đói, độ bão hòa, giáp, oxy, cấp kinh nghiệm, trạng thái di chuyển (đứng đất, lén, chạy nhanh, bơi, chạm nước, bay cánh cứng), chiều không gian, FPS, GUI đang mở, và vật phẩm trên hai tay.",
  {},
  async () => callBridge("get_player_status")
);

// Tool 2: mc_get_inventory
server.tool(
  "mc_get_inventory",
  "Kiểm kê toàn diện 41 ô hành trang người chơi (Hotbar 0-8, Túi chính 9-35, Giáp 36-39, Tay phụ 40), số lượng, độ bền vật phẩm, số ô trống và ô hotbar đang chọn.",
  {},
  async () => callBridge("get_inventory")
);

// Tool 3: mc_get_open_container
server.tool(
  "mc_get_open_container",
  "Đọc tiêu đề, mã phiên syncId và toàn bộ danh sách vật phẩm trong Rương, Shulker Box, Thùng hoặc Menu GUI server đang mở.",
  {},
  async () => callBridge("get_open_container")
);

// Tool 4: mc_get_nearby_entities
server.tool(
  "mc_get_nearby_entities",
  "Quét các thực thể xung quanh người chơi (người chơi khác, quái vật, động vật, vật phẩm rơi) trong bán kính chỉ định (1..128 block, mặc định 48), sắp xếp từ gần đến xa.",
  {
    radius: z.number().min(1).max(128).default(48).describe("Bán kính quét theo block (1..128, mặc định 48)")
  },
  async (args) => callBridge("get_nearby_entities", args)
);

// Tool 5: mc_scan_block_entities
server.tool(
  "mc_scan_block_entities",
  "Quét các khối lưu trữ và chức năng (Rương, Thùng, Shulker, Ender Chest, Phễu, Lò nung, Máy phân phát, Máy thả, Lồng spawner) trong bán kính chunk (1..6 chunk, mặc định 3 chunk tương đương 48 block).",
  {
    chunkRadius: z.number().min(1).max(6).default(3).describe("Bán kính quét theo chunk (1..6, mặc định 3)")
  },
  async (args) => callBridge("scan_block_entities", args)
);

// Tool 6: mc_get_block_context
server.tool(
  "mc_get_block_context",
  "Kiểm tra loại khối, thuộc tính khối (hướng quay, đóng/mở, chất lỏng) và độ sáng tại các vị trí tham chiếu quanh nhân vật (dưới chân, tại chân, ngang mắt) hoặc tại tọa độ (x, y, z) chỉ định.",
  {
    x: z.number().optional().describe("Tọa độ X của khối cần kiểm tra (tùy chọn)"),
    y: z.number().optional().describe("Tọa độ Y của khối cần kiểm tra (tùy chọn)"),
    z: z.number().optional().describe("Tọa độ Z của khối cần kiểm tra (tùy chọn)")
  },
  async (args) => callBridge("get_block_context", args)
);

// Tool 7: mc_get_recent_chat
server.tool(
  "mc_get_recent_chat",
  "Truy xuất danh sách tin nhắn chat người chơi và thông báo hệ thống server gần nhất (1..100 tin nhắn, mặc định 25).",
  {
    limit: z.number().min(1).max(100).default(25).describe("Số lượng tin nhắn tối đa cần lấy (1..100, mặc định 25)")
  },
  async (args) => callBridge("get_recent_chat", args)
);

// Tool 8: mc_send_chat_or_command
server.tool(
  "mc_send_chat_or_command",
  "Gửi một tin nhắn vào kênh chat hoặc thực thi lệnh server (bắt đầu bằng ký tự /).",
  {
    message: z.string().min(1).max(256).describe("Nội dung tin nhắn hoặc lệnh (bắt đầu bằng / nếu là lệnh)")
  },
  async (args) => callBridge("send_chat_or_command", args)
);

// Tool 9: mc_select_hotbar_slot
server.tool(
  "mc_select_hotbar_slot",
  "Chuyển đổi ô vật phẩm đang cầm trên thanh Hotbar (chỉ số 0 đến 8).",
  {
    slot: z.number().int().min(0).max(8).describe("Chỉ số ô hotbar cần chọn (0..8)")
  },
  async (args) => callBridge("select_hotbar_slot", args)
);

// Tool 10: mc_click_container_slot
server.tool(
  "mc_click_container_slot",
  "Thao tác click chuột (nhấc/đặt PICKUP, chuyển nhanh QUICK_MOVE, ném THROW) vào một chỉ số slot trong Rương hoặc GUI đang mở.",
  {
    slotIndex: z.number().int().min(0).describe("Chỉ số slot trong giao diện GUI đang mở"),
    action: z
      .enum(["PICKUP", "QUICK_MOVE", "THROW"])
      .default("PICKUP")
      .describe("Loại thao tác: PICKUP (click thường), QUICK_MOVE (shift-click), THROW (ném đồ)"),
    button: z.number().int().min(0).max(1).default(0).describe("Nút chuột: 0 (chuột trái/chính), 1 (chuột phải/phụ)")
  },
  async (args) => callBridge("click_container_slot", args)
);

// Tool 11: mc_close_current_screen
server.tool(
  "mc_close_current_screen",
  "Đóng giao diện rương hoặc menu GUI đang mở trên màn hình.",
  {},
  async () => callBridge("close_current_screen")
);

// Tool 12: mc_look_at
server.tool(
  "mc_look_at",
  "Xoay góc nhìn nhân vật hướng thẳng tới tọa độ đích (x, y, z) trong thế giới.",
  {
    x: z.number().describe("Tọa độ X mục tiêu"),
    y: z.number().describe("Tọa độ Y mục tiêu"),
    z: z.number().describe("Tọa độ Z mục tiêu")
  },
  async (args) => callBridge("look_at", args)
);

// Tool 13: mc_interact_block
server.tool(
  "mc_interact_block",
  "Tương tác chuột phải vào một khối tại tọa độ (x, y, z) trong tầm với (tối đa 4.5 block) để mở rương, bấm nút, gạt cần hoặc kích hoạt khối.",
  {
    x: z.number().int().describe("Tọa độ X của khối"),
    y: z.number().int().describe("Tọa độ Y của khối"),
    z: z.number().int().describe("Tọa độ Z của khối"),
    direction: z
      .enum(["UP", "DOWN", "NORTH", "SOUTH", "EAST", "WEST"])
      .optional()
      .describe("Mặt khối cần tương tác (tùy chọn, mặc định tự chọn mặt quay về phía nhân vật)")
  },
  async (args) => callBridge("interact_block", args)
);

// Tool 14: mc_parse_schematic
server.tool(
  "mc_parse_schematic",
  "Phân tích tệp schematic (.litematic hoặc .schem) và trả về thông tin kích thước, số lượng khối, danh sách palette và số khối không phải không khí.",
  {
    path: z.string().describe("Đường dẫn tuyệt đối hoặc tương đối tới tệp schematic (.litematic hoặc .schem)")
  },
  async ({ path }) => {
    try {
      const parsed = parseSchematic(path);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            format: parsed.format,
            width: parsed.width,
            height: parsed.height,
            length: parsed.length,
            totalBlocks: parsed.totalBlocks,
            nonAirBlocks: parsed.nonAirBlocks,
            palette: parsed.palette
          }, null, 2)
        }]
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `[Lỗi Parse Schematic] ${err.message}` }],
        isError: true
      };
    }
  }
);

// Tool 15: mc_print_schematic
server.tool(
  "mc_print_schematic",
  "Tự động in/xây dựng một schematic (.litematic hoặc .schem) vào thế giới Minecraft tại tọa độ gốc chỉ định (x, y, z) theo thứ tự từ dưới lên trên (Y-ascending) và hỗ trợ tự động thử lại khi gặp lỗi.",
  {
    path: z.string().describe("Đường dẫn tới tệp schematic"),
    x: z.number().int().describe("Tọa độ X gốc trong thế giới (góc nhỏ nhất của cấu trúc)"),
    y: z.number().int().describe("Tọa độ Y gốc trong thế giới (góc nhỏ nhất của cấu trúc)"),
    z: z.number().int().describe("Tọa độ Z gốc trong thế giới (góc nhỏ nhất của cấu trúc)"),
    skip_air: z.boolean().optional().default(true).describe("Bỏ qua việc đặt các khối không khí (mặc định: true)"),
    clear_area: z.boolean().optional().default(false).describe("Dọn sạch không gian xây dựng bằng /fill air trước khi đặt (mặc định: false)"),
    dry_run: z.boolean().optional().default(false).describe("Chạy thử nghiệm không làm thay đổi thế giới, trả về kế hoạch đặt khối (mặc định: false)")
  },
  async ({ path, x, y, z, skip_air, clear_area, dry_run }) => {
    try {
      const printResult = await printSchematic(
        { sendWsRequest },
        path,
        x,
        y,
        z,
        {
          skipAir: skip_air ?? true,
          clearArea: clear_area ?? false,
          dryRun: dry_run ?? false
        }
      );
      return {
        content: [{
          type: "text",
          text: JSON.stringify(printResult, null, 2)
        }]
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `[Lỗi Print Schematic] ${err.message}` }],
        isError: true
      };
    }
  }
);

// Tool 16: mc_verify_structure
server.tool(
  "mc_verify_structure",
  "Kiểm tra và đối chiếu các khối trong thế giới game tại tọa độ chỉ định so với bản vẽ schematic gốc để xác minh độ chính xác 100%.",
  {
    path: z.string().describe("Đường dẫn tới tệp schematic gốc"),
    x: z.number().int().describe("Tọa độ X gốc trong thế giới"),
    y: z.number().int().describe("Tọa độ Y gốc trong thế giới"),
    z: z.number().int().describe("Tọa độ Z gốc trong thế giới")
  },
  async ({ path, x, y, z }) => {
    try {
      const verifyResult = await verifyStructure(
        { sendWsRequest },
        path,
        x,
        y,
        z
      );
      return {
        content: [{
          type: "text",
          text: JSON.stringify(verifyResult, null, 2)
        }]
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `[Lỗi Verify Structure] ${err.message}` }],
        isError: true
      };
    }
  }
);

// ==========================================
// KHỞI ĐỘNG TIẾN TRÌNH STDIO & WEBSOCKET
// ==========================================
async function main() {
  // Khởi động kết nối WebSocket nền
  connectWebSocket();

  // Kết nối giao thức MCP qua stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[MCP-Server] Minecraft MCP Server đã sẵn sàng phục vụ AI Agent qua luồng stdio.");
}

main().catch((err) => {
  console.error(`[MCP-Server] Lỗi nghiêm trọng khi khởi động MCP Server: ${err.message}`);
  process.exit(1);
});
