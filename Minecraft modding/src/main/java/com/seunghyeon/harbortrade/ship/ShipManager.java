package com.seunghyeon.harbortrade.ship;

import com.seunghyeon.harbortrade.HarborTrade;
import com.seunghyeon.harbortrade.round.RoundManager;
import com.seunghyeon.harbortrade.trade.TradeCity;
import java.util.ArrayList;
import java.util.Collections;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Random;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.MobCategory;

/**
 * Keeps each city's ship in step with the round: while the trader is in port the ship is at its berth (sailing
 * in if it just arrived), otherwise it sails away. Checked every second, so restarts and time skips fix themselves.
 */
public final class ShipManager {
	public static final EntityType<TradeShipEntity> TRADE_SHIP = Registry.register(BuiltInRegistries.ENTITY_TYPE,
			HarborTrade.id("trade_ship"),
			EntityType.Builder.<TradeShipEntity>of(TradeShipEntity::new, MobCategory.MISC)
					.sized(3f, 3f).clientTrackingRange(16).updateInterval(1).build("trade_ship"));

	private static final int CHECK_TICKS = 20;
	/** Ships come in one after another, this far apart, in an order drawn per round. */
	private static final long ARRIVAL_GAP_MILLIS = 5_000;
	private static final Map<TradeCity, TradeShipEntity> SHIPS = new EnumMap<>(TradeCity.class);

	private ShipManager() {
	}

	public static void register() {
		ServerTickEvents.END_SERVER_TICK.register(server -> {
			if (server.getTickCount() % CHECK_TICKS == 0) {
				update(server);
			}
		});
		ServerLifecycleEvents.SERVER_STOPPED.register(server -> SHIPS.clear());
	}

	private static void update(MinecraftServer server) {
		boolean inPort = RoundManager.isTraderHere(server);
		Map<TradeCity, Berth> berths = BerthData.get(server).berths;
		List<TradeCity> order = arrivalOrder(server);
		for (TradeCity city : TradeCity.values()) {
			TradeShipEntity ship = SHIPS.get(city);
			if (ship != null && ship.isRemoved()) {
				SHIPS.remove(city);
				ship = null;
			}
			Berth berth = berths.get(city);
			if (inPort && berth != null) {
				long sinceTurn = RoundManager.millisSinceTraderArrival(server) - order.indexOf(city) * ARRIVAL_GAP_MILLIS;
				if (ship == null && sinceTurn >= 0) {
					float progress = (float) sinceTurn / (TradeShipEntity.ARRIVE_TICKS * 50);
					spawn(server, city, berth, Math.min(1, progress), false).ifPresent(s -> SHIPS.put(city, s));
				}
			} else if (ship != null && !ship.isLeaving()) {
				ship.depart();
			}
		}
	}

	/** The same shuffled order for the whole round, so a restart mid-arrival keeps it. */
	private static List<TradeCity> arrivalOrder(MinecraftServer server) {
		List<TradeCity> order = new ArrayList<>(List.of(TradeCity.values()));
		Collections.shuffle(order, new Random(RoundManager.round(server) * 7_919L));
		return order;
	}

	/** Plays the whole visit right away for checking a berth: sail in, wait a few seconds, sail out. */
	public static boolean test(MinecraftServer server, TradeCity city) {
		Berth berth = BerthData.get(server).berths.get(city);
		return berth != null && spawn(server, city, berth, 0, true).isPresent();
	}

	public static void setBerth(MinecraftServer server, TradeCity city, Berth berth) {
		BerthData data = BerthData.get(server);
		data.berths.put(city, berth);
		data.setDirty();
		// Move a ship already in port to the new spot.
		TradeShipEntity ship = SHIPS.remove(city);
		if (ship != null) {
			ship.discard();
		}
	}

	public static boolean removeBerth(MinecraftServer server, TradeCity city) {
		BerthData data = BerthData.get(server);
		if (data.berths.remove(city) == null) {
			return false;
		}
		data.setDirty();
		TradeShipEntity ship = SHIPS.remove(city);
		if (ship != null) {
			ship.discard();
		}
		return true;
	}

	public static Map<TradeCity, Berth> berths(MinecraftServer server) {
		return BerthData.get(server).berths;
	}

	private static Optional<TradeShipEntity> spawn(MinecraftServer server, TradeCity city, Berth berth, float progress, boolean test) {
		ServerLevel level = server.overworld();
		// Wait until someone is near enough for the berth to be loaded.
		if (!level.isLoaded(BlockPos.containing(berth.position()))) {
			return Optional.empty();
		}
		TradeShipEntity ship = TRADE_SHIP.create(level);
		if (ship == null) {
			return Optional.empty();
		}
		ship.setup(city, berth, progress, test);
		level.addFreshEntity(ship);
		return Optional.of(ship);
	}
}
