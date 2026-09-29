package com.seunghyeon.harbortrade.bank;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import net.minecraft.core.HolderLookup;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.level.saveddata.SavedData;

/** World-saved bank balances. */
public class BankData extends SavedData {
	private static final String NAME = "harbortrade_bank";
	private static final SavedData.Factory<BankData> FACTORY = new SavedData.Factory<>(BankData::new, BankData::load, null);

	final Map<UUID, Long> balances = new HashMap<>();

	public static BankData get(MinecraftServer server) {
		return server.overworld().getDataStorage().computeIfAbsent(FACTORY, NAME);
	}

	private static BankData load(CompoundTag tag, HolderLookup.Provider registries) {
		BankData data = new BankData();
		CompoundTag balances = tag.getCompound("balances");
		for (String key : balances.getAllKeys()) {
			data.balances.put(UUID.fromString(key), balances.getLong(key));
		}
		return data;
	}

	@Override
	public CompoundTag save(CompoundTag tag, HolderLookup.Provider registries) {
		CompoundTag balances = new CompoundTag();
		this.balances.forEach((uuid, amount) -> balances.putLong(uuid.toString(), amount));
		tag.put("balances", balances);
		return tag;
	}
}
