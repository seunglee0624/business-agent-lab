package com.seunghyeon.harbortrade.command;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.mojang.brigadier.exceptions.CommandSyntaxException;
import com.seunghyeon.harbortrade.ship.Berth;
import com.seunghyeon.harbortrade.ship.ShipManager;
import com.seunghyeon.harbortrade.trade.TradeCity;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.util.Mth;

/**
 * /무역선 (admin only): set up where each city's ship docks. Stand where the ship should float and look out to
 * sea; the ship comes in from that direction.
 */
public final class ShipCommand {
	private static final String BLOCKS = "블록";

	private ShipCommand() {
	}

	public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
		LiteralArgumentBuilder<CommandSourceStack> set = Commands.literal("정박지");
		LiteralArgumentBuilder<CommandSourceStack> distance = Commands.literal("거리");
		LiteralArgumentBuilder<CommandSourceStack> remove = Commands.literal("제거");
		LiteralArgumentBuilder<CommandSourceStack> test = Commands.literal("시험");
		for (TradeCity city : TradeCity.values()) {
			set.then(Commands.literal(city.displayName()).executes(ctx -> setBerth(ctx.getSource(), city)));
			distance.then(Commands.literal(city.displayName())
					.then(Commands.argument(BLOCKS, IntegerArgumentType.integer(10, 200))
							.executes(ctx -> setDistance(ctx.getSource(), city, IntegerArgumentType.getInteger(ctx, BLOCKS)))));
			remove.then(Commands.literal(city.displayName()).executes(ctx -> removeBerth(ctx.getSource(), city)));
			test.then(Commands.literal(city.displayName()).executes(ctx -> test(ctx.getSource(), city)));
		}
		dispatcher.register(Commands.literal("무역선")
				.requires(source -> source.hasPermission(2))
				.then(set).then(distance).then(remove).then(test)
				.then(Commands.literal("목록").executes(ctx -> list(ctx.getSource()))));
	}

	private static int setBerth(CommandSourceStack source, TradeCity city) throws CommandSyntaxException {
		ServerPlayer player = source.getPlayerOrException();
		Berth old = ShipManager.berths(source.getServer()).get(city);
		int distance = old != null ? old.distance() : Berth.DEFAULT_DISTANCE;
		Berth berth = new Berth(player.position(), Mth.wrapDegrees(player.getYRot()), distance);
		ShipManager.setBerth(source.getServer(), city, berth);
		source.sendSuccess(() -> Component.literal("정박지 설정 · " + city.displayName() + " · 바다 방향 "
				+ compass(berth.seaYaw()) + " · 입항 거리 " + distance + "블록"), true);
		return 1;
	}

	private static int setDistance(CommandSourceStack source, TradeCity city, int distance) {
		Berth old = ShipManager.berths(source.getServer()).get(city);
		if (old == null) {
			source.sendFailure(Component.literal(city.displayName() + " 정박지가 없습니다. 먼저 /무역선 정박지 " + city.displayName()));
			return 0;
		}
		ShipManager.setBerth(source.getServer(), city, new Berth(old.position(), old.seaYaw(), distance));
		source.sendSuccess(() -> Component.literal("입항 거리 변경 · " + city.displayName() + " = " + distance + "블록"), true);
		return 1;
	}

	private static int removeBerth(CommandSourceStack source, TradeCity city) {
		if (!ShipManager.removeBerth(source.getServer(), city)) {
			source.sendFailure(Component.literal(city.displayName() + " 정박지가 없습니다."));
			return 0;
		}
		source.sendSuccess(() -> Component.literal("정박지 제거 · " + city.displayName()), true);
		return 1;
	}

	private static int test(CommandSourceStack source, TradeCity city) {
		if (!ShipManager.test(source.getServer(), city)) {
			source.sendFailure(Component.literal(city.displayName() + " 정박지가 없거나 아직 불러오지 않은 곳입니다."));
			return 0;
		}
		source.sendSuccess(() -> Component.literal("시험 운항 · " + city.displayName() + " (입항 → 5초 정박 → 출항)"), false);
		return 1;
	}

	private static int list(CommandSourceStack source) {
		MutableComponent message = Component.literal("[무역선 정박지]");
		for (TradeCity city : TradeCity.values()) {
			Berth berth = ShipManager.berths(source.getServer()).get(city);
			message.append("\n" + city.displayName() + ": ");
			if (berth == null) {
				message.append("없음");
			} else {
				message.append(String.format("%.0f, %.0f, %.0f · 바다 방향 %s · 입항 거리 %d블록",
						berth.position().x, berth.position().y, berth.position().z, compass(berth.seaYaw()), berth.distance()));
			}
		}
		source.sendSuccess(() -> message, false);
		return 1;
	}

	/** Yaw as a direction word (Minecraft: 0 = south, 90 = west, 180 = north, -90 = east). */
	private static String compass(float yaw) {
		String[] names = {"남", "남서", "서", "북서", "북", "북동", "동", "남동"};
		int index = Math.floorMod(Math.round(yaw / 45f), 8);
		return names[index] + "쪽";
	}
}
