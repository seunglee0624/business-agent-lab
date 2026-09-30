package com.seunghyeon.harbortrade.round;

import com.seunghyeon.harbortrade.HarborTrade;
import com.seunghyeon.harbortrade.bank.Bank;
import com.seunghyeon.harbortrade.fame.Fame;
import com.seunghyeon.harbortrade.gem.GemMarket;
import com.seunghyeon.harbortrade.network.HudPayload;
import com.seunghyeon.harbortrade.trade.TradeConfig;
import com.seunghyeon.harbortrade.trade.TradeManager;
import java.util.List;
import java.util.function.Consumer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import net.fabricmc.fabric.api.networking.v1.ServerPlayNetworking;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.util.RandomSource;

/**
 * Runs a round: a 3-hour timeline counted only while the server is up. Admins start and end rounds;
 * the events below fire automatically as time passes.
 */
public final class RoundManager {
	public static final long ROUND_MILLIS = hours(3);
	private static final long JEWELER_OPEN_MILLIS = minutes(30);

	private static final long TRADER_ARRIVE_MILLIS = minutes(90);
	private static final long TRADER_DEPART_MILLIS = minutes(100);

	private record Event(long atMillis, String name, Consumer<MinecraftServer> action) {
	}

	private static final List<Event> TIMELINE = List.of(
			new Event(0, "회차 시작", RoundManager::onStart),
			new Event(JEWELER_OPEN_MILLIS, "보석상 개장", server -> broadcast(server, "보석상이 문을 열었습니다.")),
			new Event(minutes(60), "보석 시세 변동", GemMarket::changePrices),
			new Event(minutes(90), "보석 시세 변동", GemMarket::changePrices),
			new Event(TRADER_ARRIVE_MILLIS, "무역상 도착", TradeManager::arrive),
			new Event(TRADER_DEPART_MILLIS, "무역상 출항", TradeManager::depart),
			new Event(minutes(105), "무역 결과 발표", TradeManager::settle),
			new Event(minutes(120), "보석 시세 변동", GemMarket::changePrices),
			new Event(minutes(150), "보석 시세 변동", GemMarket::changePrices),
			new Event(ROUND_MILLIS, "회차 종료", RoundManager::onEnd));

	private static final RandomSource RANDOM = RandomSource.create();
	private static final int HUD_SYNC_TICKS = 20;
	private static long lastTickNanos;
	private static int ticks;

	private RoundManager() {
	}

	public static void register() {
		ServerLifecycleEvents.SERVER_STARTED.register(server -> lastTickNanos = System.nanoTime());
		ServerTickEvents.END_SERVER_TICK.register(RoundManager::tick);
		ServerPlayConnectionEvents.JOIN.register((handler, sender, server) -> sendHud(server, handler.getPlayer()));
	}

	private static long minutes(long minutes) {
		return minutes * 60_000;
	}

	private static long hours(long hours) {
		return minutes(hours * 60);
	}

	public static boolean isActive(MinecraftServer server) {
		return RoundData.get(server).active;
	}

	public static boolean isJewelerOpen(MinecraftServer server) {
		RoundData data = RoundData.get(server);
		return data.active && data.elapsedMillis >= JEWELER_OPEN_MILLIS;
	}

	public static boolean isTraderHere(MinecraftServer server) {
		RoundData data = RoundData.get(server);
		return data.active && data.elapsedMillis >= TRADER_ARRIVE_MILLIS && data.elapsedMillis < TRADER_DEPART_MILLIS;
	}

	public static String tradeCategory(MinecraftServer server) {
		return RoundData.get(server).tradeCategory;
	}

	private static void tick(MinecraftServer server) {
		long now = System.nanoTime();
		long elapsed = (now - lastTickNanos) / 1_000_000;
		lastTickNanos += elapsed * 1_000_000;

		RoundData data = RoundData.get(server);
		if (data.active && !data.paused && elapsed > 0) {
			data.elapsedMillis += elapsed;
			data.setDirty();
			runDueEvents(server);
		}

		if (++ticks % HUD_SYNC_TICKS == 0) {
			for (ServerPlayer player : server.getPlayerList().getPlayers()) {
				sendHud(server, player);
			}
		}
	}

	/** Runs every event whose time has come, in order. */
	private static void runDueEvents(MinecraftServer server) {
		RoundData data = RoundData.get(server);
		while (data.active && data.nextEvent < TIMELINE.size() && TIMELINE.get(data.nextEvent).atMillis() <= data.elapsedMillis) {
			Event event = TIMELINE.get(data.nextEvent++);
			data.setDirty();
			HarborTrade.LOGGER.info("Round {} event: {}", data.round, event.name());
			event.action().accept(server);
		}
	}

	/** Starts the next round; returns false if one is already running. */
	public static boolean start(MinecraftServer server) {
		RoundData data = RoundData.get(server);
		if (data.active) {
			return false;
		}
		data.round++;
		data.active = true;
		data.paused = false;
		data.elapsedMillis = 0;
		data.nextEvent = 0;
		List<String> categories = TradeConfig.categories().stream().filter(c -> !TradeConfig.items(c).isEmpty()).toList();
		data.tradeCategory = categories.isEmpty() ? "" : categories.get(RANDOM.nextInt(categories.size()));
		TradeManager.clear(server);
		data.setDirty();
		runDueEvents(server);
		return true;
	}

	/** Ends the current round right away; returns false if none is running. */
	public static boolean end(MinecraftServer server) {
		RoundData data = RoundData.get(server);
		if (!data.active) {
			return false;
		}
		onEnd(server);
		return true;
	}

	public static boolean setPaused(MinecraftServer server, boolean paused) {
		RoundData data = RoundData.get(server);
		if (!data.active || data.paused == paused) {
			return false;
		}
		data.paused = paused;
		data.setDirty();
		broadcast(server, paused ? "회차가 일시정지되었습니다." : "회차가 재개되었습니다.");
		return true;
	}

	/** Moves the round clock forward, running any events passed on the way. */
	public static boolean skip(MinecraftServer server, long minutes) {
		RoundData data = RoundData.get(server);
		if (!data.active) {
			return false;
		}
		data.elapsedMillis = Math.min(data.elapsedMillis + minutes(minutes), ROUND_MILLIS);
		data.setDirty();
		runDueEvents(server);
		return true;
	}

	private static void onStart(MinecraftServer server) {
		RoundData data = RoundData.get(server);
		broadcast(server, data.round + "회차가 시작되었습니다! 오늘의 무역상품: " + data.tradeCategory);
	}

	private static void onEnd(MinecraftServer server) {
		// A round ended early still pays out goods already at sea.
		if (TradeManager.hasShipments(server)) {
			TradeManager.settle(server);
		}
		RoundData data = RoundData.get(server);
		data.active = false;
		data.paused = false;
		data.nextEvent = TIMELINE.size();
		data.setDirty();
		broadcast(server, data.round + "회차가 종료되었습니다. 보석상과 명성상점이 문을 닫았습니다.");
		// Only the leader is announced; the rest of the ranking stays hidden.
		broadcast(server, Fame.leader(server)
				.map(rank -> "현재 명성 1위: " + rank.name() + " (명성 " + rank.fame() + ")")
				.orElse("아직 명성을 가진 플레이어가 없습니다."));
	}

	public static Component status(MinecraftServer server) {
		RoundData data = RoundData.get(server);
		if (data.round == 0) {
			return Component.literal("아직 시작된 회차가 없습니다.");
		}
		if (!data.active) {
			return Component.literal(data.round + "회차가 종료되었습니다. 다음 회차를 기다리는 중입니다.");
		}
		StringBuilder sb = new StringBuilder();
		sb.append(data.round).append("회차 진행 중").append(data.paused ? " (일시정지)" : "")
				.append(" · ").append(formatTime(data.elapsedMillis)).append(" / ").append(formatTime(ROUND_MILLIS))
				.append("\n오늘의 무역상품: ").append(data.tradeCategory);
		if (data.nextEvent < TIMELINE.size()) {
			Event next = TIMELINE.get(data.nextEvent);
			long minutesLeft = (next.atMillis() - data.elapsedMillis + 59_999) / 60_000;
			sb.append("\n다음: ").append(next.name()).append(" (").append(minutesLeft).append("분 후)");
		}
		return Component.literal(sb.toString());
	}

	/** Formats milliseconds as h:mm:ss. */
	public static String formatTime(long millis) {
		long seconds = millis / 1000;
		return String.format("%d:%02d:%02d", seconds / 3600, seconds / 60 % 60, seconds % 60);
	}

	private static void sendHud(MinecraftServer server, ServerPlayer player) {
		RoundData data = RoundData.get(server);
		ServerPlayNetworking.send(player, new HudPayload(data.round, data.active, data.elapsedMillis, ROUND_MILLIS,
				Bank.balance(server, player.getUUID()), Fame.get(server, player.getUUID())));
	}

	private static void broadcast(MinecraftServer server, String message) {
		server.getPlayerList().broadcastSystemMessage(Component.literal("[회차] " + message), false);
	}
}
