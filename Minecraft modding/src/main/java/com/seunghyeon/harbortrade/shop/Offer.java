package com.seunghyeon.harbortrade.shop;

import com.seunghyeon.harbortrade.gem.Gem;
import com.seunghyeon.harbortrade.gem.GemMarket;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.item.Item;

/**
 * One item a shop trades. Regular shops only buy from players, at a fixed price;
 * gems trade both ways at the current market price.
 */
public record Offer(Item item, Gem gem, long price) {
	public static Offer fixed(Item item, long price) {
		return new Offer(item, null, price);
	}

	public static Offer gem(Gem gem) {
		return new Offer(gem.item(), gem, 0);
	}

	/** Only gems can be bought from a shop. */
	public boolean playerCanBuy() {
		return gem != null;
	}

	/** What the player pays for one gem. */
	public long buyPrice(MinecraftServer server) {
		return GemMarket.price(server, gem);
	}

	/** What the player receives for one. */
	public long sellPrice(MinecraftServer server) {
		return gem != null ? GemMarket.price(server, gem) : price;
	}
}
