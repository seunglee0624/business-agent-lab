package com.seunghyeon.harbortrade.currency;

import com.seunghyeon.harbortrade.HarborTrade;
import java.util.EnumMap;
import java.util.Map;
import net.fabricmc.fabric.api.itemgroup.v1.ItemGroupEvents;
import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.item.CreativeModeTabs;
import net.minecraft.world.item.Item;

public final class ModItems {
	private static final Map<Coin, Item> COINS = new EnumMap<>(Coin.class);

	private ModItems() {
	}

	public static void register() {
		for (Coin coin : Coin.values()) {
			Item item = Registry.register(BuiltInRegistries.ITEM, HarborTrade.id(coin.id()), new Item(new Item.Properties()));
			COINS.put(coin, item);
		}

		ItemGroupEvents.modifyEntriesEvent(CreativeModeTabs.INGREDIENTS).register(entries -> {
			for (Coin coin : Coin.values()) {
				entries.accept(coin.item());
			}
		});
	}

	static Item get(Coin coin) {
		return COINS.get(coin);
	}
}
