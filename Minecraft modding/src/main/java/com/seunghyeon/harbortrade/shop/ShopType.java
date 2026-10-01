package com.seunghyeon.harbortrade.shop;

/**
 * The kinds of merchant. Regular shops take their item lists from shops.json; the jeweler trades gems at market
 * price, the fame shop sells fame points, and
 * the trader ships today's trade goods abroad.
 */
public enum ShopType {
	GROCER("grocer", "식료품상"),
	BLACKSMITH("blacksmith", "대장장이"),
	FISHER("fisher", "어부"),
	JEWELER("jeweler", "보석상"),
	FAME("fame", "명성상점"),
	TRADER("trader", "무역상");

	private final String id;
	private final String displayName;

	ShopType(String id, String displayName) {
		this.id = id;
		this.displayName = displayName;
	}

	public String id() {
		return id;
	}

	public String displayName() {
		return displayName;
	}

	/** Regular shops sell from the shops.json item list. */
	public boolean usesItemList() {
		return this != JEWELER && this != FAME && this != TRADER;
	}

	/**
	 * Shops an admin edits by shift+right clicking: regular shops (with the item in hand) and the fame shop
	 * (its price). Trade goods cannot be edited in game.
	 */
	public boolean adminEditable() {
		return usesItemList() || this == FAME;
	}

	public static ShopType byId(String id) {
		for (ShopType type : values()) {
			if (type.id.equals(id)) {
				return type;
			}
		}
		return null;
	}
}
