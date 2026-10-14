package com.seunghyeon.harbortrade.shop;

/**
 * The kinds of merchant. A general shop is set up by an admin on the NPC itself (name and goods); the jeweler
 * trades gems at market price, the fame shop sells fame points, and the trader ships today's trade goods abroad.
 */
public enum ShopType {
	GENERAL("general", "상점"),
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

	/** The word used in /상점 설치. */
	public String installName() {
		return this == GENERAL ? "일반" : displayName;
	}

	/** Shops an admin edits by shift+right clicking: general shops (goods and name) and the fame shop (its price). */
	public boolean adminEditable() {
		return this == GENERAL || this == FAME;
	}

	public static ShopType byId(String id) {
		// The fixed grocer/blacksmith/fisher shops became general shops; their old goods are not carried over.
		if (id.equals("grocer") || id.equals("blacksmith") || id.equals("fisher")) {
			return GENERAL;
		}
		for (ShopType type : values()) {
			if (type.id.equals(id)) {
				return type;
			}
		}
		return null;
	}
}
