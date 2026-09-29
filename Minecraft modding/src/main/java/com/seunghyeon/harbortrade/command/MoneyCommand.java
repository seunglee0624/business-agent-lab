package com.seunghyeon.harbortrade.command;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.LongArgumentType;
import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.exceptions.CommandSyntaxException;
import com.seunghyeon.harbortrade.bank.Bank;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.commands.arguments.EntityArgument;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;

import static com.seunghyeon.harbortrade.bank.MoneyFormat.format;

/** /돈 command: balance and admin tools. */
public final class MoneyCommand {
	/** Upper bound for a single amount argument, well below overflow. */
	private static final long MAX_AMOUNT = 1_000_000_000_000L;
	private static final String AMOUNT = "금액";
	private static final String TARGET = "플레이어";

	private MoneyCommand() {
	}

	public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
		dispatcher.register(Commands.literal("돈")
				.executes(ctx -> balance(ctx.getSource()))
				.then(Commands.literal("관리")
						.requires(source -> source.hasPermission(2))
						.then(Commands.literal("설정")
								.then(Commands.argument(TARGET, EntityArgument.player())
										.then(Commands.argument(AMOUNT, LongArgumentType.longArg(0, MAX_AMOUNT))
												.executes(ctx -> adminSet(ctx.getSource(), target(ctx), amount(ctx))))))
						.then(Commands.literal("지급")
								.then(Commands.argument(TARGET, EntityArgument.player())
										.then(Commands.argument(AMOUNT, LongArgumentType.longArg(1, MAX_AMOUNT))
												.executes(ctx -> adminGive(ctx.getSource(), target(ctx), amount(ctx))))))));
	}

	private static long amount(CommandContext<CommandSourceStack> ctx) {
		return LongArgumentType.getLong(ctx, AMOUNT);
	}

	private static ServerPlayer target(CommandContext<CommandSourceStack> ctx) throws CommandSyntaxException {
		return EntityArgument.getPlayer(ctx, TARGET);
	}

	private static int balance(CommandSourceStack source) throws CommandSyntaxException {
		ServerPlayer player = source.getPlayerOrException();
		source.sendSuccess(() -> Component.literal("은행 잔액: " + format(Bank.balance(source.getServer(), player.getUUID()))), false);
		return 1;
	}

	private static int adminSet(CommandSourceStack source, ServerPlayer target, long amount) {
		Bank.set(source.getServer(), target.getUUID(), amount);
		source.sendSuccess(() -> Component.literal(target.getName().getString() + "님의 은행 잔액을 "
				+ format(amount) + "(으)로 설정했습니다."), true);
		return 1;
	}

	private static int adminGive(CommandSourceStack source, ServerPlayer target, long amount) {
		Bank.deposit(source.getServer(), target.getUUID(), amount);
		source.sendSuccess(() -> Component.literal(target.getName().getString() + "님에게 "
				+ format(amount) + "을(를) 지급했습니다."), true);
		return 1;
	}
}
