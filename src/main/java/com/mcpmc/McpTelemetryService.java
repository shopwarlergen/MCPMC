package com.mcpmc;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import net.minecraft.block.BlockState;
import net.minecraft.block.entity.*;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.screen.ingame.HandledScreen;
import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.entity.Entity;
import net.minecraft.entity.ItemEntity;
import net.minecraft.entity.LivingEntity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.entity.player.PlayerInventory;
import net.minecraft.item.ItemStack;
import net.minecraft.registry.Registries;
import net.minecraft.screen.ScreenHandler;
import net.minecraft.screen.slot.Slot;
import net.minecraft.state.property.Property;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Box;
import net.minecraft.util.math.ChunkPos;
import net.minecraft.util.math.Vec3d;
import net.minecraft.world.chunk.ChunkStatus;
import net.minecraft.world.chunk.WorldChunk;

import java.util.*;

public class McpTelemetryService {

    public static JsonObject getPlayerStatus(MinecraftClient mc) {
        ClientPlayerEntity player = mc.player;
        if (player == null || mc.world == null) {
            throw new McpException(McpProtocol.ERR_NOT_IN_WORLD, "Người chơi chưa tham gia thế giới.");
        }

        JsonObject status = new JsonObject();

        // Coordinates
        JsonObject coords = new JsonObject();
        coords.addProperty("x", round2(player.getX()));
        coords.addProperty("y", round2(player.getY()));
        coords.addProperty("z", round2(player.getZ()));
        coords.addProperty("blockX", player.getBlockX());
        coords.addProperty("blockY", player.getBlockY());
        coords.addProperty("blockZ", player.getBlockZ());
        status.add("position", coords);

        // Rotation & Compass
        JsonObject rotation = new JsonObject();
        rotation.addProperty("yaw", round2(player.getYaw()));
        rotation.addProperty("pitch", round2(player.getPitch()));
        rotation.addProperty("facing", player.getHorizontalFacing().asString().toUpperCase(Locale.ROOT));
        status.add("rotation", rotation);

        // Survival Metrics
        JsonObject survival = new JsonObject();
        survival.addProperty("health", round2(player.getHealth()));
        survival.addProperty("maxHealth", round2(player.getMaxHealth()));
        survival.addProperty("food", player.getHungerManager().getFoodLevel());
        survival.addProperty("saturation", round2(player.getHungerManager().getSaturationLevel()));
        survival.addProperty("armor", player.getArmor());
        survival.addProperty("air", player.getAir());
        survival.addProperty("experienceLevel", player.experienceLevel);
        status.add("survival", survival);

        // Motion State
        JsonObject motion = new JsonObject();
        motion.addProperty("onGround", player.isOnGround());
        motion.addProperty("sneaking", player.isSneaking());
        motion.addProperty("sprinting", player.isSprinting());
        motion.addProperty("swimming", player.isSwimming());
        motion.addProperty("touchingWater", player.isTouchingWater());
        motion.addProperty("fallFlying", player.isGliding());
        status.add("motion", motion);

        // Environment & Client Context
        status.addProperty("dimension", mc.world.getRegistryKey().getValue().toString());
        status.addProperty("fps", mc.getCurrentFps());
        status.addProperty("currentScreen", mc.currentScreen != null ? mc.currentScreen.getClass().getSimpleName() : "NONE");
        status.add("mainHandItem", formatItemStack(player.getMainHandStack()));
        status.add("offHandItem", formatItemStack(player.getOffHandStack()));

        return status;
    }

    public static JsonObject getInventory(MinecraftClient mc) {
        ClientPlayerEntity player = mc.player;
        if (player == null) {
            throw new McpException(McpProtocol.ERR_NOT_IN_WORLD, "Người chơi chưa tham gia thế giới.");
        }

        PlayerInventory inv = player.getInventory();
        int totalSize = inv.size(); // usually 41

        JsonArray items = new JsonArray();
        int usedSlots = 0;
        int emptySlots = 0;

        for (int i = 0; i < totalSize; i++) {
            ItemStack stack = inv.getStack(i);
            String section;
            if (i >= 0 && i <= 8) {
                section = "HOTBAR";
            } else if (i >= 9 && i <= 35) {
                section = "MAIN";
            } else if (i >= 36 && i <= 39) {
                section = "ARMOR";
            } else {
                section = "OFFHAND";
            }

            // Count main inventory slots (0..35)
            if (i < 36) {
                if (stack == null || stack.isEmpty()) {
                    emptySlots++;
                } else {
                    usedSlots++;
                }
            }

            if (stack != null && !stack.isEmpty()) {
                JsonObject itemObj = formatItemStack(stack);
                itemObj.addProperty("slot", i);
                itemObj.addProperty("section", section);
                items.add(itemObj);
            }
        }

        JsonObject result = new JsonObject();
        result.addProperty("selectedHotbarSlot", inv.getSelectedSlot());
        result.addProperty("usedSlots", usedSlots);
        result.addProperty("emptySlots", emptySlots);
        result.addProperty("totalMainCapacity", 36);
        result.add("items", items);

        return result;
    }

    public static JsonObject getOpenContainer(MinecraftClient mc) {
        if (!(mc.currentScreen instanceof HandledScreen<?> handledScreen)) {
            throw new McpException(McpProtocol.ERR_NO_OPEN_SCREEN, "Hiện tại không có giao diện rương hoặc container nào đang mở.");
        }

        ScreenHandler handler = handledScreen.getScreenHandler();
        JsonObject result = new JsonObject();
        result.addProperty("title", McpProtocol.stripColor(handledScreen.getTitle().getString()));
        result.addProperty("syncId", handler.syncId);
        result.addProperty("totalSlots", handler.slots.size());

        JsonArray items = new JsonArray();
        for (int i = 0; i < handler.slots.size(); i++) {
            Slot slot = handler.getSlot(i);
            if (slot != null && slot.hasStack() && !slot.getStack().isEmpty()) {
                ItemStack stack = slot.getStack();
                JsonObject itemObj = formatItemStack(stack);
                itemObj.addProperty("slotIndex", slot.id);
                itemObj.addProperty("isPlayerInventory", slot.inventory instanceof PlayerInventory);
                items.add(itemObj);
            }
        }
        result.add("items", items);

        return result;
    }

    public static JsonObject getNearbyEntities(MinecraftClient mc, JsonObject params) {
        ClientPlayerEntity player = mc.player;
        if (player == null || mc.world == null) {
            throw new McpException(McpProtocol.ERR_NOT_IN_WORLD, "Người chơi chưa tham gia thế giới.");
        }

        double radius = 48.0;
        if (params != null && params.has("radius")) {
            try {
                radius = params.get("radius").getAsDouble();
            } catch (Exception ignored) {}
        }
        radius = Math.max(1.0, Math.min(radius, 128.0));

        Vec3d playerPos = new Vec3d(player.getX(), player.getY(), player.getZ());
        Box box = player.getBoundingBox().expand(radius);

        List<Entity> list = new ArrayList<>();
        for (Entity e : mc.world.getOtherEntities(player, box, entity -> entity != null && entity.isAlive() && entity != player)) {
            if (e.squaredDistanceTo(playerPos) <= radius * radius) {
                list.add(e);
            }
        }
        list.sort(Comparator.comparingDouble(e -> e.squaredDistanceTo(playerPos)));

        JsonArray entities = new JsonArray();
        int limit = Math.min(list.size(), 60);
        for (int i = 0; i < limit; i++) {
            Entity e = list.get(i);
            JsonObject obj = new JsonObject();
            obj.addProperty("id", e.getId());
            obj.addProperty("uuid", e.getUuidAsString());
            obj.addProperty("name", McpProtocol.stripColor(e.getName().getString()));
            obj.addProperty("entityType", Registries.ENTITY_TYPE.getId(e.getType()).toString());

            String category = "OTHER";
            if (e instanceof PlayerEntity) {
                category = "PLAYER";
            } else if (e instanceof ItemEntity) {
                category = "ITEM";
            } else if (e instanceof LivingEntity) {
                category = "LIVING";
            }
            obj.addProperty("category", category);

            double dist = Math.sqrt(e.squaredDistanceTo(playerPos));
            obj.addProperty("distance", Math.round(dist * 10.0) / 10.0);

            JsonObject pos = new JsonObject();
            pos.addProperty("x", round2(e.getX()));
            pos.addProperty("y", round2(e.getY()));
            pos.addProperty("z", round2(e.getZ()));
            obj.add("position", pos);

            if (e instanceof LivingEntity living) {
                obj.addProperty("health", round2(living.getHealth()));
                obj.addProperty("maxHealth", round2(living.getMaxHealth()));
            }

            if (e instanceof ItemEntity itemEntity) {
                obj.add("item", formatItemStack(itemEntity.getStack()));
            }

            entities.add(obj);
        }

        JsonObject result = new JsonObject();
        result.addProperty("radius", radius);
        result.addProperty("totalFound", list.size());
        result.addProperty("returnedCount", entities.size());
        result.add("entities", entities);
        return result;
    }

    public static JsonObject scanBlockEntities(MinecraftClient mc, JsonObject params) {
        ClientPlayerEntity player = mc.player;
        if (player == null || mc.world == null) {
            throw new McpException(McpProtocol.ERR_NOT_IN_WORLD, "Người chơi chưa tham gia thế giới.");
        }

        int chunkRadius = 3;
        if (params != null && params.has("chunkRadius")) {
            try {
                chunkRadius = params.get("chunkRadius").getAsInt();
            } catch (Exception ignored) {}
        }
        chunkRadius = Math.max(1, Math.min(chunkRadius, 6));

        ChunkPos playerChunk = player.getChunkPos();
        Vec3d playerPos = new Vec3d(player.getX(), player.getY(), player.getZ());

        List<JsonObject> found = new ArrayList<>();

        for (int dx = -chunkRadius; dx <= chunkRadius; dx++) {
            for (int dz = -chunkRadius; dz <= chunkRadius; dz++) {
                int cx = playerChunk.x + dx;
                int cz = playerChunk.z + dz;
                WorldChunk chunk = mc.world.getChunkManager().getChunk(cx, cz, ChunkStatus.FULL, false);
                if (chunk == null) continue;

                for (Map.Entry<BlockPos, BlockEntity> entry : chunk.getBlockEntities().entrySet()) {
                    BlockPos pos = entry.getKey();
                    BlockEntity be = entry.getValue();
                    String type = classifyBlockEntity(be);
                    if (type != null) {
                        double dist = Math.sqrt(pos.getSquaredDistance(playerPos));
                        JsonObject obj = new JsonObject();
                        obj.addProperty("type", type);
                        obj.addProperty("x", pos.getX());
                        obj.addProperty("y", pos.getY());
                        obj.addProperty("z", pos.getZ());
                        obj.addProperty("distance", Math.round(dist * 10.0) / 10.0);
                        found.add(obj);
                    }
                }
            }
        }

        found.sort(Comparator.comparingDouble(o -> o.get("distance").getAsDouble()));

        JsonArray arr = new JsonArray();
        for (JsonObject o : found) {
            arr.add(o);
        }

        JsonObject result = new JsonObject();
        result.addProperty("chunkRadius", chunkRadius);
        result.addProperty("totalCount", found.size());
        result.add("blockEntities", arr);
        return result;
    }

    public static JsonObject getBlockContext(MinecraftClient mc, JsonObject params) {
        ClientPlayerEntity player = mc.player;
        if (player == null || mc.world == null) {
            throw new McpException(McpProtocol.ERR_NOT_IN_WORLD, "Người chơi chưa tham gia thế giới.");
        }

        JsonObject result = new JsonObject();

        BlockPos feetPos = player.getBlockPos();
        BlockPos belowPos = feetPos.down();
        BlockPos eyePos = BlockPos.ofFloored(player.getEyePos());

        result.add("below", inspectBlock(mc, belowPos));
        result.add("feet", inspectBlock(mc, feetPos));
        result.add("eye", inspectBlock(mc, eyePos));

        if (params != null && params.has("x") && params.has("y") && params.has("z")) {
            try {
                int x = params.get("x").getAsInt();
                int y = params.get("y").getAsInt();
                int z = params.get("z").getAsInt();
                result.add("target", inspectBlock(mc, new BlockPos(x, y, z)));
            } catch (Exception ignored) {}
        }

        return result;
    }

    public static JsonObject getRecentChat(JsonObject params) {
        int limit = 25;
        if (params != null && params.has("limit")) {
            try {
                limit = params.get("limit").getAsInt();
            } catch (Exception ignored) {}
        }
        JsonObject result = new JsonObject();
        result.add("messages", McpChatBuffer.getRecent(limit));
        return result;
    }

    private static JsonObject inspectBlock(MinecraftClient mc, BlockPos pos) {
        JsonObject obj = new JsonObject();
        obj.addProperty("x", pos.getX());
        obj.addProperty("y", pos.getY());
        obj.addProperty("z", pos.getZ());

        if (mc.world == null) return obj;

        BlockState state = mc.world.getBlockState(pos);
        obj.addProperty("blockId", Registries.BLOCK.getId(state.getBlock()).toString());
        obj.addProperty("lightLevel", mc.world.getLightLevel(pos));

        JsonObject properties = new JsonObject();
        for (Property<?> prop : state.getProperties()) {
            Comparable<?> val = state.get(prop);
            properties.addProperty(prop.getName(), val != null ? val.toString() : "");
        }
        obj.add("properties", properties);
        return obj;
    }

    private static String classifyBlockEntity(BlockEntity be) {
        if (be instanceof TrappedChestBlockEntity) return "TRAPPED_CHEST";
        if (be instanceof ChestBlockEntity) return "CHEST";
        if (be instanceof BarrelBlockEntity) return "BARREL";
        if (be instanceof ShulkerBoxBlockEntity) return "SHULKER_BOX";
        if (be instanceof EnderChestBlockEntity) return "ENDER_CHEST";
        if (be instanceof HopperBlockEntity) return "HOPPER";
        if (be instanceof AbstractFurnaceBlockEntity) return "FURNACE";
        if (be instanceof DropperBlockEntity) return "DROPPER";
        if (be instanceof DispenserBlockEntity) return "DISPENSER";
        if (be instanceof MobSpawnerBlockEntity) return "SPAWNER";
        return null;
    }

    public static JsonObject formatItemStack(ItemStack stack) {
        JsonObject obj = new JsonObject();
        if (stack == null || stack.isEmpty()) {
            obj.addProperty("empty", true);
            return obj;
        }
        obj.addProperty("empty", false);
        obj.addProperty("itemId", Registries.ITEM.getId(stack.getItem()).toString());
        obj.addProperty("displayName", McpProtocol.stripColor(stack.getName().getString()));
        obj.addProperty("count", stack.getCount());
        obj.addProperty("maxCount", stack.getMaxCount());
        obj.addProperty("damage", stack.getDamage());
        obj.addProperty("maxDamage", stack.getMaxDamage());
        return obj;
    }

    private static double round2(double val) {
        return Math.round(val * 100.0) / 100.0;
    }
}
