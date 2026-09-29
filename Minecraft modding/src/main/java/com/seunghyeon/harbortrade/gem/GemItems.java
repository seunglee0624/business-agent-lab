package com.seunghyeon.harbortrade.gem;

import com.seunghyeon.harbortrade.HarborTrade;
import java.util.EnumMap;
import java.util.Map;
import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.item.Item;

public final class GemItems {
	private static final Map<Gem, Item> ITEMS = new EnumMap<>(Gem.class);

	private GemItems() {
	}

	public static void register() {
		for (Gem gem : Gem.values()) {
			ITEMS.put(gem, Registry.register(BuiltInRegistries.ITEM, HarborTrade.id(gem.id()), new Item(new Item.Properties())));
		}
	}

	static Item get(Gem gem) {
		return ITEMS.get(gem);
	}
}
