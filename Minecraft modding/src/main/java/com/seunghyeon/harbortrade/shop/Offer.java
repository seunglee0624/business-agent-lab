package com.seunghyeon.harbortrade.shop;

import com.seunghyeon.harbortrade.fame.Fame;
import com.seunghyeon.harbortrade.gem.Gem;
import com.seunghyeon.harbortrade.gem.GemMarket;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.Items;

/**
 * One item a shop trades. Regular shops only buy from players, at a fixed price; gems trade both ways at the
 * current market price; fame (shown as a nether star) can only be bought.
 */
public record Offer(Item item, Gem gem, long price, boolean isFame) {
	public static Offer fixed(Item item, long price) {
		return new Offer(item, null, price, false);
	}

	public static Offer gem(Gem gem) {
		return new Offer(gem.item(), gem, 0, false);
	}

	public static Offer fame() {
		return new Offer(Items.NETHER_STAR, null, 0, true);
	}

	/** Only gems and fame can be bought from a shop. */
	public boolean playerCanBuy() {
		return gem != null || isFame;
	}

	/** What the player pays for one gem or one fame point. */
	public long buyPrice(MinecraftServer server) {
		return isFame ? Fame.price() : GemMarket.price(server, gem);
	}

	/** What the player receives for one. */
	public long sellPrice(MinecraftServer server) {
		return gem != null ? GemMarket.price(server, gem) : price;
	}
}
