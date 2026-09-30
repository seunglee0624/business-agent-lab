package com.seunghyeon.harbortrade.trade;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import net.minecraft.core.HolderLookup;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.level.saveddata.SavedData;

/**
 * World-saved shipments for the current round: for each player, the total base value sent to each city
 * (indexed by {@link TradeCity#ordinal()}). Return rates are never stored; they are rolled at the results.
 */
public class TradeData extends SavedData {
	private static final String NAME = "harbortrade_trade";
	private static final SavedData.Factory<TradeData> FACTORY = new SavedData.Factory<>(TradeData::new, TradeData::load, null);

	final Map<UUID, long[]> shipments = new HashMap<>();

	public static TradeData get(MinecraftServer server) {
		return server.overworld().getDataStorage().computeIfAbsent(FACTORY, NAME);
	}

	long[] of(UUID player) {
		return shipments.computeIfAbsent(player, id -> new long[TradeCity.values().length]);
	}

	private static TradeData load(CompoundTag tag, HolderLookup.Provider registries) {
		TradeData data = new TradeData();
		CompoundTag shipments = tag.getCompound("shipments");
		for (String key : shipments.getAllKeys()) {
			long[] saved = shipments.getLongArray(key);
			long[] values = new long[TradeCity.values().length];
			System.arraycopy(saved, 0, values, 0, Math.min(saved.length, values.length));
			data.shipments.put(UUID.fromString(key), values);
		}
		return data;
	}

	@Override
	public CompoundTag save(CompoundTag tag, HolderLookup.Provider registries) {
		CompoundTag shipments = new CompoundTag();
		this.shipments.forEach((player, values) -> shipments.putLongArray(player.toString(), values));
		tag.put("shipments", shipments);
		return tag;
	}
}
