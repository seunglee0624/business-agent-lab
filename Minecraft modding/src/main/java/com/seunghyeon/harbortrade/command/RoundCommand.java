package com.seunghyeon.harbortrade.command;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.seunghyeon.harbortrade.round.RoundManager;
import java.util.function.Predicate;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;

/** /회차 command: round status for everyone, round control for admins. */
public final class RoundCommand {
	private static final String MINUTES = "분";

	private RoundCommand() {
	}

	public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
		Predicate<CommandSourceStack> admin = source -> source.hasPermission(2);
		dispatcher.register(Commands.literal("회차")
				.executes(ctx -> {
					ctx.getSource().sendSuccess(() -> RoundManager.status(ctx.getSource().getServer()), false);
					return 1;
				})
				.then(Commands.literal("시작").requires(admin)
						.executes(ctx -> result(ctx.getSource(), RoundManager.start(ctx.getSource().getServer()), "이미 진행 중인 회차가 있습니다.")))
				.then(Commands.literal("종료").requires(admin)
						.executes(ctx -> result(ctx.getSource(), RoundManager.end(ctx.getSource().getServer()), "진행 중인 회차가 없습니다.")))
				.then(Commands.literal("일시정지").requires(admin)
						.executes(ctx -> result(ctx.getSource(), RoundManager.setPaused(ctx.getSource().getServer(), true), "진행 중이거나 일시정지되지 않은 회차가 없습니다.")))
				.then(Commands.literal("재개").requires(admin)
						.executes(ctx -> result(ctx.getSource(), RoundManager.setPaused(ctx.getSource().getServer(), false), "일시정지된 회차가 없습니다.")))
				.then(Commands.literal("건너뛰기").requires(admin)
						.then(Commands.argument(MINUTES, IntegerArgumentType.integer(1, 180))
								.executes(ctx -> {
									int minutes = IntegerArgumentType.getInteger(ctx, MINUTES);
									boolean ok = RoundManager.skip(ctx.getSource().getServer(), minutes);
									if (ok) {
										ctx.getSource().sendSuccess(() -> RoundManager.status(ctx.getSource().getServer()), true);
									}
									return result(ctx.getSource(), ok, "진행 중인 회차가 없습니다.");
								}))));
	}

	private static int result(CommandSourceStack source, boolean ok, String failure) {
		if (!ok) {
			source.sendFailure(Component.literal(failure));
			return 0;
		}
		return 1;
	}
}
