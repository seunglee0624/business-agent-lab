package com.seunghyeon.harbortrade.fame;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import net.minecraft.core.HolderLookup;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.level.saveddata.SavedData;

/** World-saved fame points. Each change gets a sequence number so ties go to whoever reached the score first. */
public class FameData extends SavedData {
	private static final String NAME = "harbortrade_fame";
	private static final SavedData.Factory<FameData> FACTORY = new SavedData.Factory<>(FameData::new, FameData::load, null);

	/** fame: points; reachedAt: sequence number of the last change; name: last known player name. */
	record Entry(long fame, long reachedAt, String name) {
	}

	final Map<UUID, Entry> entries = new HashMap<>();
	long nextSequence;

	public static FameData get(MinecraftServer server) {
		return server.overworld().getDataStorage().computeIfAbsent(FACTORY, NAME);
	}

	private static FameData load(CompoundTag tag, HolderLookup.Provider registries) {
		FameData data = new FameData();
		data.nextSequence = tag.getLong("next_sequence");
		CompoundTag players = tag.getCompound("players");
		for (String key : players.getAllKeys()) {
			CompoundTag entry = players.getCompound(key);
			data.entries.put(UUID.fromString(key), new Entry(entry.getLong("fame"), entry.getLong("reached_at"), entry.getString("name")));
		}
		return data;
	}

	@Override
	public CompoundTag save(CompoundTag tag, HolderLookup.Provider registries) {
		tag.putLong("next_sequence", nextSequence);
		CompoundTag players = new CompoundTag();
		entries.forEach((uuid, entry) -> {
			CompoundTag e = new CompoundTag();
			e.putLong("fame", entry.fame());
			e.putLong("reached_at", entry.reachedAt());
			e.putString("name", entry.name());
			players.put(uuid.toString(), e);
		});
		tag.put("players", players);
		return tag;
	}
}
