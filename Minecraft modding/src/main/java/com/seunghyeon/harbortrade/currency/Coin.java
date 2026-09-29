package com.seunghyeon.harbortrade.currency;

import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;

/** Coin types, ordered from highest to lowest value. All money is counted in copper. */
public enum Coin {
	GOLD("gold_coin", 10_000),
	SILVER("silver_coin", 100),
	COPPER("copper_coin", 1);

	private final String id;
	private final long value;

	Coin(String id, long value) {
		this.id = id;
		this.value = value;
	}

	public String id() {
		return id;
	}

	public long value() {
		return value;
	}

	public Item item() {
		return ModItems.get(this);
	}

	/** Returns the coin type of the stack, or null if it is not a coin. */
	public static Coin of(ItemStack stack) {
		for (Coin coin : values()) {
			if (stack.is(coin.item())) {
				return coin;
			}
		}
		return null;
	}
}
