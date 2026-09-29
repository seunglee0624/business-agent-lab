package com.seunghyeon.harbortrade.bank;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import net.minecraft.core.HolderLookup;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.level.saveddata.SavedData;

/** World-saved bank balances, plus coins held for players who died and have not respawned yet. */
public class BankData extends SavedData {
	private static final String NAME = "harbortrade_bank";
	private static final SavedData.Factory<BankData> FACTORY = new SavedData.Factory<>(BankData::new, BankData::load, null);

	final Map<UUID, Long> balances = new HashMap<>();
	final Map<UUID, long[]> deathStash = new HashMap<>();

	public static BankData get(MinecraftServer server) {
		return server.overworld().getDataStorage().computeIfAbsent(FACTORY, NAME);
	}

	private static BankData load(CompoundTag tag, HolderLookup.Provider registries) {
		BankData data = new BankData();
		CompoundTag balances = tag.getCompound("balances");
		for (String key : balances.getAllKeys()) {
			data.balances.put(UUID.fromString(key), balances.getLong(key));
		}
		CompoundTag stash = tag.getCompound("death_stash");
		for (String key : stash.getAllKeys()) {
			data.deathStash.put(UUID.fromString(key), stash.getLongArray(key));
		}
		return data;
	}

	@Override
	public CompoundTag save(CompoundTag tag, HolderLookup.Provider registries) {
		CompoundTag balances = new CompoundTag();
		this.balances.forEach((uuid, amount) -> balances.putLong(uuid.toString(), amount));
		tag.put("balances", balances);

		CompoundTag stash = new CompoundTag();
		deathStash.forEach((uuid, counts) -> stash.putLongArray(uuid.toString(), counts));
		tag.put("death_stash", stash);
		return tag;
	}
}
