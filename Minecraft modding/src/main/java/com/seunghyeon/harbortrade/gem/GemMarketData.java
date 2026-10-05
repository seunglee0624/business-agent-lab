package com.seunghyeon.harbortrade.gem;

import java.util.ArrayList;
import java.util.List;
import net.minecraft.core.HolderLookup;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.LongArrayTag;
import net.minecraft.nbt.Tag;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.level.saveddata.SavedData;

/** World-saved gem prices. */
public class GemMarketData extends SavedData {
	private static final String NAME = "harbortrade_gem_market";
	private static final SavedData.Factory<GemMarketData> FACTORY = new SavedData.Factory<>(GemMarketData::new, GemMarketData::load, null);

	final long[] prices = new long[Gem.values().length];
	final long[] previousPrices = new long[Gem.values().length];
	/** Prices at the start of this round and after each change since, oldest first. */
	final List<long[]> history = new ArrayList<>();

	private GemMarketData() {
		for (Gem gem : Gem.values()) {
			prices[gem.ordinal()] = gem.basePrice();
			previousPrices[gem.ordinal()] = gem.basePrice();
		}
	}

	public static GemMarketData get(MinecraftServer server) {
		return server.overworld().getDataStorage().computeIfAbsent(FACTORY, NAME);
	}

	private static GemMarketData load(CompoundTag tag, HolderLookup.Provider registries) {
		GemMarketData data = new GemMarketData();
		CompoundTag prices = tag.getCompound("prices");
		CompoundTag previous = tag.getCompound("previous_prices");
		for (Gem gem : Gem.values()) {
			if (prices.contains(gem.id())) {
				data.prices[gem.ordinal()] = prices.getLong(gem.id());
				data.previousPrices[gem.ordinal()] = previous.getLong(gem.id());
			}
		}
		for (Tag entry : tag.getList("history", Tag.TAG_LONG_ARRAY)) {
			long[] snapshot = ((LongArrayTag) entry).getAsLongArray();
			if (snapshot.length == Gem.values().length) {
				data.history.add(snapshot);
			}
		}
		return data;
	}

	@Override
	public CompoundTag save(CompoundTag tag, HolderLookup.Provider registries) {
		CompoundTag prices = new CompoundTag();
		CompoundTag previous = new CompoundTag();
		for (Gem gem : Gem.values()) {
			prices.putLong(gem.id(), this.prices[gem.ordinal()]);
			previous.putLong(gem.id(), previousPrices[gem.ordinal()]);
		}
		tag.put("prices", prices);
		tag.put("previous_prices", previous);
		ListTag history = new ListTag();
		for (long[] snapshot : this.history) {
			history.add(new LongArrayTag(snapshot));
		}
		tag.put("history", history);
		return tag;
	}
}
