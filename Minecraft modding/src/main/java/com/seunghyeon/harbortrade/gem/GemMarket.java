package com.seunghyeon.harbortrade.gem;

import static com.seunghyeon.harbortrade.bank.MoneyFormat.format;

import com.seunghyeon.harbortrade.Chat;
import java.util.ArrayList;
import java.util.List;
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

	/** Starts this round's price record from the current prices. */
	public static void startRound(MinecraftServer server) {
		GemMarketData data = GemMarketData.get(server);
		data.history.clear();
		data.history.add(data.prices.clone());
		data.setDirty();
	}

	/** This round's prices for the gem, oldest first; just the current price if nothing is recorded. */
	public static List<Long> history(MinecraftServer server, Gem gem) {
		GemMarketData data = GemMarketData.get(server);
		List<Long> prices = new ArrayList<>();
		for (long[] snapshot : data.history) {
			prices.add(snapshot[gem.ordinal()]);
		}
		if (prices.isEmpty()) {
			prices.add(price(server, gem));
		}
		return prices;
	}

	/** Moves every gem price once; players see the new prices in the jeweler, chat only says they changed. */
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
		data.history.add(data.prices.clone());
		data.setDirty();

		Chat.announce(server, "보석", "시세가 변동되었습니다. 보석상에서 확인하세요.");
	}

	/** One line like "루비 104,200 KD (▲4.2%)". */
	public static Component priceLine(MinecraftServer server, Gem gem) {
		double change = changePercent(server, gem);
		String arrow = change > 0 ? "▲" : change < 0 ? "▼" : "";
		return Component.literal(String.format("%s %s (%s%.1f%%)", gem.displayName(), format(price(server, gem)), arrow, Math.abs(change)));
	}
}
