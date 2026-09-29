package com.seunghyeon.harbortrade.shop;

import com.seunghyeon.harbortrade.gem.Gem;
import com.seunghyeon.harbortrade.gem.GemMarket;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.item.Item;

/**
 * One item a shop trades. Regular items have a fixed price and the shop pays half of it when buying back;
 * gems trade both ways at the current market price.
 */
public record Offer(Item item, Gem gem, long price, boolean playerCanBuy, boolean playerCanSell) {
	public static final int SELL_PERCENT = 50;

	public static Offer fixed(Item item, long price, boolean playerCanBuy, boolean playerCanSell) {
		return new Offer(item, null, price, playerCanBuy, playerCanSell);
	}

	public static Offer gem(Gem gem) {
		return new Offer(gem.item(), gem, 0, true, true);
	}

	/** What the player pays for one. */
	public long buyPrice(MinecraftServer server) {
		return gem != null ? GemMarket.price(server, gem) : price;
	}

	/** What the player receives for one. */
	public long sellPrice(MinecraftServer server) {
		return gem != null ? GemMarket.price(server, gem) : price * SELL_PERCENT / 100;
	}
}
