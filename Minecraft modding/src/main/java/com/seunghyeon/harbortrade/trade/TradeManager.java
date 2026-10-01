package com.seunghyeon.harbortrade.trade;

import static com.seunghyeon.harbortrade.bank.MoneyFormat.format;

import com.seunghyeon.harbortrade.bank.Bank;
import com.seunghyeon.harbortrade.round.RoundManager;
import com.seunghyeon.harbortrade.shop.Offer;
import com.seunghyeon.harbortrade.shop.Trade;
import com.seunghyeon.harbortrade.network.AmountPrompt;
import com.seunghyeon.harbortrade.network.AmountPromptPayload;
import com.seunghyeon.harbortrade.shop.MerchantEntity;
import java.util.Map;
import java.util.UUID;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.util.RandomSource;

/**
 * The trader's voyage. While the trader is in port, players pick a city for today's trade good, type an
 * amount, and the goods leave their inventory at once. At the results each city rolls a return rate between
 * -5% and +20% that nobody, admins included, can see beforehand, and every shipment is paid out to the bank.
 */
public final class TradeManager {
	private static final int MIN_RATE = -5;
	private static final int MAX_RATE = 20;
	private static final RandomSource RANDOM = RandomSource.create();

	private TradeManager() {
	}

	/** Closes the trader screen and asks the client how many to ship. */
	public static void prompt(ServerPlayer player, MerchantEntity merchant, Offer offer, TradeCity city) {
		int available = Trade.countSellable(player, offer);
		if (available == 0) {
			player.sendSystemMessage(Component.empty().append(offer.item().getDescription())
					.append("이(가) 인벤토리에 없습니다. (손상된 물건은 선적할 수 없습니다)"));
			return;
		}
		AmountPromptPayload prompt = new AmountPromptPayload(
				Component.literal(city.displayName() + "(으)로 선적"),
				Component.empty().append(offer.item().getDescription())
						.append(" · 기준가 " + format(offer.price()) + " · 보유 " + available + "개"),
				available, offer.price(), false);
		AmountPrompt.open(player, prompt, (p, count) -> {
			if (count > 0) {
				ship(p, city, offer, (int) count);
			}
			// Back to the trader screen to keep shipping.
			if (merchant.isAlive() && p.distanceToSqr(merchant) < 64) {
				merchant.openTrader(p);
			}
		});
	}

	public static void arrive(MinecraftServer server) {
		server.getPlayerList().broadcastSystemMessage(Component.literal("[무역] 무역상이 항구에 도착했습니다! 10분 동안 오늘의 무역상품(")
				.append(RoundManager.tradeItemName(server)).append(")을 선적할 수 있습니다."), false);
	}

	public static void depart(MinecraftServer server) {
		broadcast(server, "무역상이 출항했습니다. 5분 뒤 무역 결과가 발표됩니다.");
	}

	/** Loads goods onto the ship for a city. The player must have them undamaged in the inventory. */
	public static void ship(ServerPlayer player, TradeCity city, Offer offer, int count) {
		MinecraftServer server = player.server;
		if (!RoundManager.isTraderHere(server)) {
			player.sendSystemMessage(Component.literal("무역상이 항구에 없습니다."));
			return;
		}
		if (Trade.countSellable(player, offer) < count) {
			player.sendSystemMessage(Component.literal("선적할 물건이 부족합니다. (손상된 물건은 선적할 수 없습니다)"));
			return;
		}

		Trade.removeSellable(player, offer, count);
		long value = offer.price() * count;
		TradeData data = TradeData.get(server);
		data.of(player.getUUID())[city.ordinal()] += value;
		data.setDirty();
		player.sendSystemMessage(Component.empty().append(offer.item().getDescription()).append(" " + count + "개를 "
				+ city.displayName() + "행 배에 실었습니다. (기준가 " + format(value) + ", " + city.displayName()
				+ " 누적 " + format(shipped(server, player.getUUID(), city)) + ")"));
	}

	/** Base value the player has sent to the city this round. */
	public static long shipped(MinecraftServer server, UUID player, TradeCity city) {
		long[] values = TradeData.get(server).shipments.get(player);
		return values == null ? 0 : values[city.ordinal()];
	}

	public static boolean hasShipments(MinecraftServer server) {
		return !TradeData.get(server).shipments.isEmpty();
	}

	/** Rolls each city's return rate, pays every shipment into the bank, and clears the ships. */
	public static void settle(MinecraftServer server) {
		TradeCity[] cities = TradeCity.values();
		int[] rates = new int[cities.length];
		StringBuilder summary = new StringBuilder("무역 결과 발표! ");
		for (int i = 0; i < cities.length; i++) {
			rates[i] = MIN_RATE + RANDOM.nextInt(MAX_RATE - MIN_RATE + 1);
			summary.append(i == 0 ? "" : ", ").append(cities[i].displayName()).append(" ")
					.append(rates[i] > 0 ? "+" : "").append(rates[i]).append("%");
		}
		broadcast(server, summary.toString());

		TradeData data = TradeData.get(server);
		for (Map.Entry<UUID, long[]> entry : data.shipments.entrySet()) {
			long sent = 0;
			long received = 0;
			for (int i = 0; i < cities.length; i++) {
				long value = entry.getValue()[i];
				sent += value;
				received += value * (100 + rates[i]) / 100;
			}
			if (received > 0) {
				Bank.deposit(server, entry.getKey(), received);
			}
			ServerPlayer player = server.getPlayerList().getPlayer(entry.getKey());
			if (player != null && sent > 0) {
				player.sendSystemMessage(Component.literal("[무역] 선적 기준가 " + format(sent) + " → 수령액 "
						+ format(received) + " (" + (received >= sent ? "+" : "") + format(received - sent) + ")"));
			}
		}
		data.shipments.clear();
		data.setDirty();
	}

	/** Pays every shipment back at its base value, with no profit or loss, and clears the ships. */
	public static void refund(MinecraftServer server) {
		TradeData data = TradeData.get(server);
		for (Map.Entry<UUID, long[]> entry : data.shipments.entrySet()) {
			long sent = 0;
			for (long value : entry.getValue()) {
				sent += value;
			}
			if (sent > 0) {
				Bank.deposit(server, entry.getKey(), sent);
				ServerPlayer player = server.getPlayerList().getPlayer(entry.getKey());
				if (player != null) {
					player.sendSystemMessage(Component.literal("[무역] 회차가 다시 시작되어 선적한 물건값 " + format(sent)
							+ "을(를) 기준가 그대로 돌려받았습니다."));
				}
			}
		}
		data.shipments.clear();
		data.setDirty();
	}

	/** Drops anything left over from an earlier round. */
	public static void clear(MinecraftServer server) {
		TradeData data = TradeData.get(server);
		data.shipments.clear();
		data.setDirty();
	}

	private static void broadcast(MinecraftServer server, String message) {
		server.getPlayerList().broadcastSystemMessage(Component.literal("[무역] " + message), false);
	}
}
