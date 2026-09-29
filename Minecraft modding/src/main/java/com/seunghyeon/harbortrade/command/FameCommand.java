package com.seunghyeon.harbortrade.command;

import static com.seunghyeon.harbortrade.bank.MoneyFormat.format;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.LongArgumentType;
import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.exceptions.CommandSyntaxException;
import com.seunghyeon.harbortrade.HarborTrade;
import com.seunghyeon.harbortrade.fame.Fame;
import java.io.IOException;
import java.util.List;
import java.util.function.Predicate;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.commands.arguments.EntityArgument;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.network.protocol.game.ClientboundSetSubtitleTextPacket;
import net.minecraft.network.protocol.game.ClientboundSetTitleTextPacket;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;

/** /명성 (own fame, admin tools) and /게임 종료 (final winner announcement). */
public final class FameCommand {
	private static final long MAX = 1_000_000_000_000L;
	private static final String TARGET = "플레이어";
	private static final String AMOUNT = "점수";
	private static final String PRICE = "금액";

	private FameCommand() {
	}

	public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
		Predicate<CommandSourceStack> admin = source -> source.hasPermission(2);
		dispatcher.register(Commands.literal("명성")
				.executes(ctx -> show(ctx.getSource()))
				.then(Commands.literal("순위").requires(admin).executes(ctx -> ranking(ctx.getSource())))
				.then(Commands.literal("관리").requires(admin)
						.then(Commands.literal("설정")
								.then(Commands.argument(TARGET, EntityArgument.player())
										.then(Commands.argument(AMOUNT, LongArgumentType.longArg(0, MAX))
												.executes(ctx -> set(ctx, false)))))
						.then(Commands.literal("지급")
								.then(Commands.argument(TARGET, EntityArgument.player())
										.then(Commands.argument(AMOUNT, LongArgumentType.longArg(1, MAX))
												.executes(ctx -> set(ctx, true)))))
						.then(Commands.literal("가격")
								.then(Commands.argument(PRICE, LongArgumentType.longArg(1, MAX))
										.executes(ctx -> setPrice(ctx.getSource(), LongArgumentType.getLong(ctx, PRICE)))))));

		dispatcher.register(Commands.literal("게임").requires(admin)
				.then(Commands.literal("종료").executes(ctx -> endGame(ctx.getSource()))));
	}

	private static int show(CommandSourceStack source) throws CommandSyntaxException {
		ServerPlayer player = source.getPlayerOrException();
		source.sendSuccess(() -> Component.literal("내 명성: " + Fame.get(source.getServer(), player.getUUID())
				+ " (명성 1 = " + format(Fame.price()) + ")"), false);
		return 1;
	}

	private static int ranking(CommandSourceStack source) {
		List<Fame.Rank> ranking = Fame.ranking(source.getServer());
		MutableComponent message = Component.literal("[명성 순위] " + ranking.size() + "명");
		for (int i = 0; i < ranking.size(); i++) {
			Fame.Rank rank = ranking.get(i);
			message.append("\n" + (i + 1) + "위 " + rank.name() + " - 명성 " + rank.fame());
		}
		source.sendSuccess(() -> message, false);
		return 1;
	}

	private static int set(CommandContext<CommandSourceStack> ctx, boolean add) throws CommandSyntaxException {
		ServerPlayer target = EntityArgument.getPlayer(ctx, TARGET);
		long amount = LongArgumentType.getLong(ctx, AMOUNT);
		MinecraftServer server = ctx.getSource().getServer();
		if (add) {
			Fame.add(server, target, amount);
		} else {
			Fame.set(server, target, amount);
		}
		ctx.getSource().sendSuccess(() -> Component.literal(target.getGameProfile().getName() + "님의 명성: "
				+ Fame.get(server, target.getUUID())), true);
		return 1;
	}

	private static int setPrice(CommandSourceStack source, long price) {
		try {
			Fame.savePrice(price);
			source.sendSuccess(() -> Component.literal("명성 가격을 " + format(price) + "(으)로 바꿨습니다."), true);
			return 1;
		} catch (IOException e) {
			HarborTrade.LOGGER.error("Failed to save fame.json", e);
			source.sendFailure(Component.literal("fame.json을 저장하지 못했습니다: " + e.getMessage()));
			return 0;
		}
	}

	/** Announces the overall winner in chat and as a title on every player's screen. Data is kept. */
	private static int endGame(CommandSourceStack source) {
		MinecraftServer server = source.getServer();
		var leader = Fame.leader(server);
		Component title = Component.literal("게임 종료");
		Component subtitle = leader
				.<Component>map(rank -> Component.literal("우승: " + rank.name() + " (명성 " + rank.fame() + ")"))
				.orElse(Component.literal("명성을 가진 플레이어가 없습니다"));
		server.getPlayerList().broadcastSystemMessage(Component.literal("[게임 종료] ").append(subtitle), false);
		for (ServerPlayer player : server.getPlayerList().getPlayers()) {
			player.connection.send(new ClientboundSetTitleTextPacket(title));
			player.connection.send(new ClientboundSetSubtitleTextPacket(subtitle));
		}
		return 1;
	}
}
