package com.seunghyeon.harbortrade.trade;

import static com.seunghyeon.harbortrade.bank.MoneyFormat.format;

import com.seunghyeon.harbortrade.Chat;
import com.seunghyeon.harbortrade.bank.Bank;
import com.seunghyeon.harbortrade.round.RoundManager;
import com.seunghyeon.harbortrade.shop.Offer;
import com.seunghyeon.harbortrade.shop.Trade;
import com.seunghyeon.harbortrade.network.AmountPrompt;
import com.seunghyeon.harbortrade.network.AmountPromptPayload;
import com.seunghyeon.harbortrade.network.NoticePayload;
import com.seunghyeon.harbortrade.shop.MerchantEntity;
import java.util.HashMap;
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
			NoticePayload.fail(player, Component.literal("인벤토리에 없음 · ").append(offer.item().getDescription())
					.append(" (손상된 물건 제외)"));
			return;
		}
		AmountPromptPayload prompt = new AmountPromptPayload(
				Component.literal("선적 · " + city.displayName()),
				Component.empty().append(offer.item().getDescription())
						.append(" · 기준가 " + format(offer.price()) + " · 보유 " + available + "개"),
				available, offer.price(), false);
		AmountPrompt.open(player, prompt, (p, count) -> {
			NoticePayload result = count > 0 ? ship(p, city, offer, (int) count) : null;
			// Back to the trader screen to keep shipping; the result is sent after it so it shows above the window.
			if (merchant.isAlive() && p.distanceToSqr(merchant) < 64) {
				merchant.openTrader(p);
			}
			if (result != null) {
				result.send(p);
			}
		});
	}

	public static void arrive(MinecraftServer server) {
		Chat.announce(server, "무역", Component.literal("무역상이 항구에 도착했습니다! 10분 동안 오늘의 무역상품(")
				.append(RoundManager.tradeItemName(server)).append(")을 선적할 수 있습니다."));
	}

	public static void depart(MinecraftServer server) {
		broadcast(server, "무역상이 출항했습니다. 5분 뒤 무역 결과가 발표됩니다.");
	}

	/**
	 * Loads goods onto the ship for a city. The player must have them undamaged in the inventory. Returns the
	 * notice for the caller to send.
	 */
	private static NoticePayload ship(ServerPlayer player, TradeCity city, Offer offer, int count) {
		MinecraftServer server = player.server;
		if (!RoundManager.isTraderHere(server)) {
			return new NoticePayload(Component.literal("무역상이 항구에 없습니다."), false);
		}
		if (Trade.countSellable(player, offer) < count) {
			return new NoticePayload(Component.literal("선적할 물건 부족 (손상된 물건 제외)"), false);
		}

		Trade.removeSellable(player, offer, count);
		long value = offer.price() * count;
		TradeData data = TradeData.get(server);
		data.of(player.getUUID())[city.ordinal()] += value;
		data.setDirty();
		return new NoticePayload(Component.literal("선적 · ").append(offer.item().getDescription())
				.append(" ×" + count + " → " + city.displayName() + "  기준가 " + format(value)
						+ "  (" + city.displayName() + " 누적 " + format(shipped(server, player.getUUID(), city)) + ")"), true);
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
		Map<UUID, Component> results = new HashMap<>();
		for (int i = 0; i < cities.length; i++) {
			rates[i] = MIN_RATE + RANDOM.nextInt(MAX_RATE - MIN_RATE + 1);
			summary.append(i == 0 ? "" : ", ").append(cities[i].displayName()).append(" ")
					.append(rates[i] > 0 ? "+" : "").append(rates[i]).append("%");
		}
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
			if (sent > 0) {
				results.put(entry.getKey(), Component.literal("내 선적 기준가 " + format(sent) + " → 수령액 "
						+ format(received) + " (" + (received >= sent ? "+" : "") + format(received - sent) + ")"));
			}
		}
		// Everyone sees the city rates; shippers also get their own result in the same block.
		Component headline = Component.literal(summary.toString());
		for (ServerPlayer player : server.getPlayerList().getPlayers()) {
			Component result = results.get(player.getUUID());
			if (result == null) {
				Chat.send(player, "무역", headline);
			} else {
				Chat.send(player, "무역", headline, result);
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
					Chat.send(player, "무역", Component.literal("회차 재시작 · 선적한 물건값 " + format(sent)
							+ " 환불 (기준가 그대로)"));
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
		Chat.announce(server, "무역", message);
	}
}
