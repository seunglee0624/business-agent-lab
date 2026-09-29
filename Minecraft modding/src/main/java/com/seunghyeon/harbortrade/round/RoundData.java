package com.seunghyeon.harbortrade.round;

import net.minecraft.core.HolderLookup;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.level.saveddata.SavedData;

/** World-saved round state. Round numbers keep counting up; nothing is ever reset. */
public class RoundData extends SavedData {
	private static final String NAME = "harbortrade_round";
	private static final SavedData.Factory<RoundData> FACTORY = new SavedData.Factory<>(RoundData::new, RoundData::load, null);

	/** Current (or last finished) round; 0 before the first round. */
	int round;
	boolean active;
	boolean paused;
	long elapsedMillis;
	/** Index of the next timeline event to run. */
	int nextEvent;
	String tradeCategory = "";

	public static RoundData get(MinecraftServer server) {
		return server.overworld().getDataStorage().computeIfAbsent(FACTORY, NAME);
	}

	private static RoundData load(CompoundTag tag, HolderLookup.Provider registries) {
		RoundData data = new RoundData();
		data.round = tag.getInt("round");
		data.active = tag.getBoolean("active");
		data.paused = tag.getBoolean("paused");
		data.elapsedMillis = tag.getLong("elapsed_millis");
		data.nextEvent = tag.getInt("next_event");
		data.tradeCategory = tag.getString("trade_category");
		return data;
	}

	@Override
	public CompoundTag save(CompoundTag tag, HolderLookup.Provider registries) {
		tag.putInt("round", round);
		tag.putBoolean("active", active);
		tag.putBoolean("paused", paused);
		tag.putLong("elapsed_millis", elapsedMillis);
		tag.putInt("next_event", nextEvent);
		tag.putString("trade_category", tradeCategory);
		return tag;
	}
}
