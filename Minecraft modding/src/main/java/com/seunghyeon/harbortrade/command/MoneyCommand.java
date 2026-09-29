package com.seunghyeon.harbortrade.command;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.LongArgumentType;
import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.exceptions.CommandSyntaxException;
import com.seunghyeon.harbortrade.bank.Bank;
import com.seunghyeon.harbortrade.currency.Wallet;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.commands.arguments.EntityArgument;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;

import static com.seunghyeon.harbortrade.currency.MoneyFormat.format;

/** /돈 command: balance, deposit, withdraw, transfer, and admin tools. */
public final class MoneyCommand {
	/** Upper bound for a single amount argument (1억 금화), well below overflow. */
	private static final long MAX_AMOUNT = 1_000_000_000_000L;
	private static final String AMOUNT = "금액";
	private static final String TARGET = "플레이어";

	private MoneyCommand() {
	}

	public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
		dispatcher.register(Commands.literal("돈")
				.executes(ctx -> balance(ctx.getSource()))
				.then(Commands.literal("입금")
						.executes(ctx -> deposit(ctx.getSource(), -1))
						.then(Commands.argument(AMOUNT, LongArgumentType.longArg(1, MAX_AMOUNT))
								.executes(ctx -> deposit(ctx.getSource(), amount(ctx)))))
				.then(Commands.literal("출금")
						.then(Commands.argument(AMOUNT, LongArgumentType.longArg(1, MAX_AMOUNT))
								.executes(ctx -> withdraw(ctx.getSource(), amount(ctx)))))
				.then(Commands.literal("송금")
						.then(Commands.argument(TARGET, EntityArgument.player())
								.then(Commands.argument(AMOUNT, LongArgumentType.longArg(1, MAX_AMOUNT))
										.executes(ctx -> transfer(ctx.getSource(), target(ctx), amount(ctx))))))
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
		MinecraftServer server = source.getServer();
		source.sendSuccess(() -> Component.literal("은행 잔액: " + format(Bank.balance(server, player.getUUID()))
				+ " / 보유 현금: " + format(Wallet.total(player))), false);
		return 1;
	}

	/** Deposits the amount from inventory coins, or all coins when amount is -1; change is given back as coins. */
	private static int deposit(CommandSourceStack source, long amount) throws CommandSyntaxException {
		ServerPlayer player = source.getPlayerOrException();
		long cash = Wallet.total(player);
		if (amount == -1) {
			amount = cash;
		}
		if (amount == 0) {
			source.sendFailure(Component.literal("입금할 현금이 없습니다."));
			return 0;
		}
		if (cash < amount) {
			source.sendFailure(Component.literal("현금이 부족합니다. 보유 현금: " + format(cash)));
			return 0;
		}

		Wallet.takeAll(player);
		Wallet.give(player, cash - amount);
		Bank.deposit(source.getServer(), player.getUUID(), amount);
		long deposited = amount;
		source.sendSuccess(() -> Component.literal(format(deposited) + "을(를) 입금했습니다. 은행 잔액: "
				+ format(Bank.balance(source.getServer(), player.getUUID()))), false);
		return 1;
	}

	private static int withdraw(CommandSourceStack source, long amount) throws CommandSyntaxException {
		ServerPlayer player = source.getPlayerOrException();
		if (!Bank.withdraw(source.getServer(), player.getUUID(), amount)) {
			source.sendFailure(Component.literal("잔액이 부족합니다. 은행 잔액: "
					+ format(Bank.balance(source.getServer(), player.getUUID()))));
			return 0;
		}

		Wallet.give(player, amount);
		source.sendSuccess(() -> Component.literal(format(amount) + "을(를) 출금했습니다. 은행 잔액: "
				+ format(Bank.balance(source.getServer(), player.getUUID()))), false);
		return 1;
	}

	private static int transfer(CommandSourceStack source, ServerPlayer target, long amount) throws CommandSyntaxException {
		ServerPlayer player = source.getPlayerOrException();
		if (player == target) {
			source.sendFailure(Component.literal("자기 자신에게는 송금할 수 없습니다."));
			return 0;
		}

		long fee = Bank.transferFee(amount);
		if (!Bank.transfer(source.getServer(), player.getUUID(), target.getUUID(), amount)) {
			source.sendFailure(Component.literal("잔액이 부족합니다. 필요 금액: " + format(amount + fee)
					+ " (수수료 " + Bank.TRANSFER_FEE_PERCENT + "% 포함)"));
			return 0;
		}

		source.sendSuccess(() -> Component.literal(target.getName().getString() + "님에게 " + format(amount)
				+ "을(를) 송금했습니다. 수수료: " + format(fee) + ", 은행 잔액: "
				+ format(Bank.balance(source.getServer(), player.getUUID()))), false);
		target.sendSystemMessage(Component.literal(player.getName().getString() + "님이 " + format(amount)
				+ "을(를) 송금했습니다."));
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
