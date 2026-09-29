package com.seunghyeon.harbortrade.gem;

import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;

/** Gem types from cheapest to most expensive. Gems are the only way to move money between players. */
public enum Gem {
	AMETHYST("amethyst", "자수정", 100),
	TOPAZ("topaz", "토파즈", 1_000),
	PEARL("pearl", "진주", 5_000),
	SAPPHIRE("sapphire", "사파이어", 20_000),
	RUBY("ruby", "루비", 100_000),
	DIAMOND("diamond", "금강석", 1_000_000);

	private final String id;
	private final String displayName;
	private final long basePrice;

	Gem(String id, String displayName, long basePrice) {
		this.id = id;
		this.displayName = displayName;
		this.basePrice = basePrice;
	}

	public String id() {
		return id;
	}

	public String displayName() {
		return displayName;
	}

	public long basePrice() {
		return basePrice;
	}

	public Item item() {
		return GemItems.get(this);
	}

	/** Returns the gem type of the stack, or null if it is not a gem. */
	public static Gem of(ItemStack stack) {
		for (Gem gem : values()) {
			if (stack.is(gem.item())) {
				return gem;
			}
		}
		return null;
	}
}
