package com.seunghyeon.harbortrade.shop;

/** The kinds of merchant. Item lists come from shops.json, except the jeweler which trades gems at market price. */
public enum ShopType {
	GROCER("grocer", "식료품상"),
	BLACKSMITH("blacksmith", "대장장이"),
	FISHER("fisher", "어부"),
	JEWELER("jeweler", "보석상");

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

	public static ShopType byId(String id) {
		for (ShopType type : values()) {
			if (type.id.equals(id)) {
				return type;
			}
		}
		return null;
	}
}
