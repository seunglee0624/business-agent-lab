package com.seunghyeon.harbortrade.gem;

import static com.seunghyeon.harbortrade.bank.MoneyFormat.format;

import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.util.RandomSource;

/**
 * Gem prices move like stocks: at each change (scheduled by the round timeline) every gem moves by up to ±15%,
 * rounded to a whole KD and kept within 50%–200% of its base price. Gem shops buy and sell at this same price.
 */
public final class GemMarket {
	private static final double MAX_CHANGE = 0.15;
	private static final double MIN_RATIO = 0.5;
	private static final double MAX_RATIO = 2.0;

	private static final RandomSource RANDOM = RandomSource.create();

	private GemMarket() {
	}

	public static long price(MinecraftServer server, Gem gem) {
		return GemMarketData.get(server).prices[gem.ordinal()];
	}

	/** Change since the previous price update, in percent. */
	public static double changePercent(MinecraftServer server, Gem gem) {
		GemMarketData data = GemMarketData.get(server);
		long previous = data.previousPrices[gem.ordinal()];
		return (data.prices[gem.ordinal()] - previous) * 100.0 / previous;
	}

	/** Moves every gem price once and announces the new prices to all players. */
	public static void changePrices(MinecraftServer server) {
		GemMarketData data = GemMarketData.get(server);
		for (Gem gem : Gem.values()) {
			int i = gem.ordinal();
			double factor = 1 + (RANDOM.nextDouble() * 2 - 1) * MAX_CHANGE;
			long min = Math.max(1, Math.round(gem.basePrice() * MIN_RATIO));
			long max = Math.round(gem.basePrice() * MAX_RATIO);
			data.previousPrices[i] = data.prices[i];
			data.prices[i] = Math.clamp(Math.round(data.prices[i] * factor), min, max);
		}
		data.setDirty();

		server.getPlayerList().broadcastSystemMessage(Component.literal("[보석 시세] 가격이 변동되었습니다."), false);
		for (Gem gem : Gem.values()) {
			server.getPlayerList().broadcastSystemMessage(priceLine(server, gem), false);
		}
	}

	/** One line like "루비 104,200 KD (▲4.2%)". */
	public static Component priceLine(MinecraftServer server, Gem gem) {
		double change = changePercent(server, gem);
		String arrow = change > 0 ? "▲" : change < 0 ? "▼" : "";
		return Component.literal(String.format("%s %s (%s%.1f%%)", gem.displayName(), format(price(server, gem)), arrow, Math.abs(change)));
	}
}
