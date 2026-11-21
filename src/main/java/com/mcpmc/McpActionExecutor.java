package com.mcpmc;

import com.google.gson.JsonObject;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.ingame.HandledScreen;
import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.entity.player.PlayerInventory;
import net.minecraft.item.ItemStack;
import net.minecraft.screen.ScreenHandler;
import net.minecraft.screen.slot.SlotActionType;
import net.minecraft.util.ActionResult;
import net.minecraft.util.Hand;
import net.minecraft.util.hit.BlockHitResult;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Direction;
import net.minecraft.util.math.Vec3d;

import java.util.Locale;

public class McpActionExecutor {

    public static JsonObject sendChatOrCommand(MinecraftClient mc, JsonObject params) {
        if (params == null || !params.has("message")) {
            throw new McpException(McpProtocol.ERR_INVALID_PARAMS, "Thiếu tham số 'message'.");
        }

        String message = params.get("message").getAsString().trim();
        if (message.isEmpty() || message.length() > 256) {
            throw new McpException(McpProtocol.ERR_INVALID_PARAMS, "Độ dài tin nhắn phải từ 1 đến 256 ký tự.");
        }

        if (mc.getNetworkHandler() == null) {
            throw new McpException(McpProtocol.ERR_NOT_IN_WORLD, "ClientPlayNetworkHandler không khả dụng.");
        }

        boolean isCommand = message.startsWith("/");
        if (isCommand) {
            mc.getNetworkHandler().sendChatCommand(message.substring(1));
        } else {
            mc.getNetworkHandler().sendChatMessage(message);
        }

        JsonObject res = new JsonObject();
        res.addProperty("sent", true);
        res.addProperty("isCommand", isCommand);
        res.addProperty("message", message);
        return res;
    }

    public static JsonObject selectHotbarSlot(MinecraftClient mc, JsonObject params) {
        if (params == null || !params.has("slot")) {
            throw new McpException(McpProtocol.ERR_INVALID_PARAMS, "Thiếu tham số 'slot'.");
        }

        int slot;
        try {
            slot = params.get("slot").getAsInt();
        } catch (Exception e) {
            throw new McpException(McpProtocol.ERR_INVALID_PARAMS, "Tham số 'slot' phải là số nguyên.");
        }

        if (slot < 0 || slot > 8) {
            throw new McpException(McpProtocol.ERR_INVALID_PARAMS, "Chỉ số slot hotbar phải trong khoảng từ 0 đến 8.");
        }

        ClientPlayerEntity player = mc.player;
        if (player == null) {
            throw new McpException(McpProtocol.ERR_NOT_IN_WORLD, "Người chơi chưa tham gia thế giới.");
        }

        PlayerInventory inv = player.getInventory();
        inv.setSelectedSlot(slot);

        ItemStack currentStack = inv.getStack(slot);

        JsonObject res = new JsonObject();
        res.addProperty("selectedSlot", slot);
        res.add("item", McpTelemetryService.formatItemStack(currentStack));
        return res;
    }

    public static JsonObject clickContainerSlot(MinecraftClient mc, JsonObject params) {
        if (mc.player == null) {
            throw new McpException(McpProtocol.ERR_NOT_IN_WORLD, "Người chơi chưa tham gia thế giới.");
        }

        if (!(mc.currentScreen instanceof HandledScreen<?> handledScreen) || mc.interactionManager == null) {
            throw new McpException(McpProtocol.ERR_NO_OPEN_SCREEN, "Hiện tại không có giao diện rương hoặc container nào đang mở.");
        }

        if (params == null || !params.has("slotIndex")) {
            throw new McpException(McpProtocol.ERR_INVALID_PARAMS, "Thiếu tham số 'slotIndex'.");
        }

        ScreenHandler handler = handledScreen.getScreenHandler();
        int slotIndex;
        try {
            slotIndex = params.get("slotIndex").getAsInt();
        } catch (Exception e) {
            throw new McpException(McpProtocol.ERR_INVALID_PARAMS, "Tham số 'slotIndex' phải là số nguyên.");
        }

        int totalSlots = handler.slots.size();
        if (slotIndex < 0 || slotIndex >= totalSlots) {
            throw new McpException(McpProtocol.ERR_SLOT_OUT_OF_BOUNDS,
                "Chỉ số slot " + slotIndex + " nằm ngoài phạm vi container (0.." + (totalSlots - 1) + ").");
        }

        String actionStr = params.has("action") ? params.get("action").getAsString().toUpperCase(Locale.ROOT) : "PICKUP";
        int button = params.has("button") ? params.get("button").getAsInt() : 0;
        if (button != 0 && button != 1) {
            throw new McpException(McpProtocol.ERR_INVALID_PARAMS, "Tham số 'button' chỉ nhận giá trị 0 hoặc 1.");
        }

        SlotActionType actionType;
        switch (actionStr) {
            case "PICKUP" -> actionType = SlotActionType.PICKUP;
            case "QUICK_MOVE" -> actionType = SlotActionType.QUICK_MOVE;
            case "THROW" -> actionType = SlotActionType.THROW;
            default -> throw new McpException(McpProtocol.ERR_INVALID_PARAMS,
                "Hành động không hợp lệ: '" + actionStr + "'. Hỗ trợ: 'PICKUP', 'QUICK_MOVE', 'THROW'.");
        }

        mc.interactionManager.clickSlot(handler.syncId, slotIndex, button, actionType, mc.player);

        JsonObject res = new JsonObject();
        res.addProperty("success", true);
        res.addProperty("syncId", handler.syncId);
        res.addProperty("slotIndex", slotIndex);
        res.addProperty("action", actionStr);
        res.addProperty("button", button);
        return res;
    }

    public static JsonObject closeCurrentScreen(MinecraftClient mc) {
        if (mc.player != null) {
            mc.player.closeHandledScreen();
        }
        JsonObject res = new JsonObject();
        res.addProperty("closed", true);
        return res;
    }

    public static JsonObject lookAt(MinecraftClient mc, JsonObject params) {
        ClientPlayerEntity player = mc.player;
        if (player == null) {
            throw new McpException(McpProtocol.ERR_NOT_IN_WORLD, "Người chơi chưa tham gia thế giới.");
        }

        if (params == null || !params.has("x") || !params.has("y") || !params.has("z")) {
            throw new McpException(McpProtocol.ERR_INVALID_PARAMS, "Thiếu tham số tọa độ 'x', 'y' hoặc 'z'.");
        }

        double targetX = params.get("x").getAsDouble();
        double targetY = params.get("y").getAsDouble();
        double targetZ = params.get("z").getAsDouble();

        Vec3d eyePos = player.getEyePos();
        double dx = targetX - eyePos.x;
        double dy = targetY - eyePos.y;
        double dz = targetZ - eyePos.z;
        double distXZ = Math.sqrt(dx * dx + dz * dz);

        float yaw = (float) Math.toDegrees(Math.atan2(-dx, dz));
        float pitch = (float) Math.toDegrees(-Math.atan2(dy, distXZ));

        player.setYaw(yaw);
        player.setPitch(pitch);

        JsonObject res = new JsonObject();
        res.addProperty("yaw", Math.round(yaw * 100.0) / 100.0);
        res.addProperty("pitch", Math.round(pitch * 100.0) / 100.0);
        return res;
    }

    public static JsonObject interactBlock(MinecraftClient mc, JsonObject params) {
        ClientPlayerEntity player = mc.player;
        if (player == null || mc.interactionManager == null) {
            throw new McpException(McpProtocol.ERR_NOT_IN_WORLD, "Người chơi chưa tham gia thế giới.");
        }

        if (params == null || !params.has("x") || !params.has("y") || !params.has("z")) {
            throw new McpException(McpProtocol.ERR_INVALID_PARAMS, "Thiếu tham số tọa độ 'x', 'y' hoặc 'z'.");
        }

        int x = params.get("x").getAsInt();
        int y = params.get("y").getAsInt();
        int z = params.get("z").getAsInt();
        BlockPos pos = new BlockPos(x, y, z);

        Vec3d eyePos = player.getEyePos();
        Vec3d center = Vec3d.ofCenter(pos);
        double dist = eyePos.distanceTo(center);

        if (dist > 4.5) {
            throw new McpException(McpProtocol.ERR_OUT_OF_RANGE,
                "Khoảng cách tới khối (" + Math.round(dist * 10.0) / 10.0 + "m) vượt quá tầm với cho phép 4.5 block.");
        }

        Direction face = null;
        if (params.has("direction")) {
            try {
                face = Direction.valueOf(params.get("direction").getAsString().toUpperCase(Locale.ROOT));
            } catch (Exception ignored) {}
        }
        if (face == null) {
            face = Direction.getFacing(eyePos.x - center.x, eyePos.y - center.y, eyePos.z - center.z);
        }

        // Rotate gaze toward block center
        double dx = center.x - eyePos.x;
        double dy = center.y - eyePos.y;
        double dz = center.z - eyePos.z;
        double distXZ = Math.sqrt(dx * dx + dz * dz);
        float yaw = (float) Math.toDegrees(Math.atan2(-dx, dz));
        float pitch = (float) Math.toDegrees(-Math.atan2(dy, distXZ));
        player.setYaw(yaw);
        player.setPitch(pitch);

        BlockHitResult hitResult = new BlockHitResult(center, face, pos, false);
        ActionResult result = mc.interactionManager.interactBlock(player, Hand.MAIN_HAND, hitResult);

        JsonObject res = new JsonObject();
        res.addProperty("success", true);
        res.addProperty("result", result.toString());
        res.addProperty("direction", face.asString().toUpperCase(Locale.ROOT));
        JsonObject posObj = new JsonObject();
        posObj.addProperty("x", x);
        posObj.addProperty("y", y);
        posObj.addProperty("z", z);
        res.add("pos", posObj);
        return res;
    }
}
