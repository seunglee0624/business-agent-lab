package com.seunghyeon.harbortrade.trade;

import net.minecraft.world.item.Item;
import net.minecraft.world.item.Items;

/** The foreign ports the trader can ship to. Each round every city rolls a secret return rate at the results. */
public enum TradeCity {
	VENICE("venice", "베네치아", Items.RED_BANNER),
	GENOA("genoa", "제노바", Items.BLUE_BANNER),
	ALEXANDRIA("alexandria", "알렉산드리아", Items.YELLOW_BANNER);

	private final String id;
	private final String displayName;
	private final Item icon;

	TradeCity(String id, String displayName, Item icon) {
		this.id = id;
		this.displayName = displayName;
		this.icon = icon;
	}

	public String id() {
		return id;
	}

	public String displayName() {
		return displayName;
	}

	public Item icon() {
		return icon;
	}
}
