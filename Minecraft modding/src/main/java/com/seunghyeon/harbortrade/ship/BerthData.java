package com.seunghyeon.harbortrade.ship;

import com.seunghyeon.harbortrade.trade.TradeCity;
import java.util.EnumMap;
import java.util.Map;
import net.minecraft.core.HolderLookup;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.level.saveddata.SavedData;
import net.minecraft.world.phys.Vec3;

/** World-saved ship berths, one per city (overworld only). */
public class BerthData extends SavedData {
	private static final String NAME = "harbortrade_berths";
	private static final SavedData.Factory<BerthData> FACTORY = new SavedData.Factory<>(BerthData::new, BerthData::load, null);

	final Map<TradeCity, Berth> berths = new EnumMap<>(TradeCity.class);

	public static BerthData get(MinecraftServer server) {
		return server.overworld().getDataStorage().computeIfAbsent(FACTORY, NAME);
	}

	private static BerthData load(CompoundTag tag, HolderLookup.Provider registries) {
		BerthData data = new BerthData();
		for (TradeCity city : TradeCity.values()) {
			if (tag.contains(city.id())) {
				CompoundTag b = tag.getCompound(city.id());
				data.berths.put(city, new Berth(new Vec3(b.getDouble("x"), b.getDouble("y"), b.getDouble("z")),
						b.getFloat("sea_yaw"), b.getInt("distance")));
			}
		}
		return data;
	}

	@Override
	public CompoundTag save(CompoundTag tag, HolderLookup.Provider registries) {
		berths.forEach((city, berth) -> {
			CompoundTag b = new CompoundTag();
			b.putDouble("x", berth.position().x);
			b.putDouble("y", berth.position().y);
			b.putDouble("z", berth.position().z);
			b.putFloat("sea_yaw", berth.seaYaw());
			b.putInt("distance", berth.distance());
			tag.put(city.id(), b);
		});
		return tag;
	}
}
