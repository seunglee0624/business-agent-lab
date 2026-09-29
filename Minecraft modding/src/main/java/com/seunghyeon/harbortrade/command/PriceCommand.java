package com.seunghyeon.harbortrade.command;

import com.mojang.brigadier.CommandDispatcher;
import com.seunghyeon.harbortrade.gem.Gem;
import com.seunghyeon.harbortrade.gem.GemMarket;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;

/** /가격 command: current gem prices, and an admin tool to force a price change. */
public final class PriceCommand {
	private PriceCommand() {
	}

	public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
		dispatcher.register(Commands.literal("가격")
				.executes(ctx -> show(ctx.getSource()))
				.then(Commands.literal("관리")
						.requires(source -> source.hasPermission(2))
						.then(Commands.literal("변동")
								.executes(ctx -> {
									GemMarket.changePrices(ctx.getSource().getServer());
									return 1;
								}))));
	}

	private static int show(CommandSourceStack source) {
		source.sendSuccess(() -> Component.literal("[보석 시세]"), false);
		for (Gem gem : Gem.values()) {
			source.sendSuccess(() -> GemMarket.priceLine(source.getServer(), gem), false);
		}
		return 1;
	}
}
