package com.seunghyeon.harbortrade.command;

import static com.seunghyeon.harbortrade.bank.MoneyFormat.format;

import com.mojang.brigadier.CommandDispatcher;
import com.seunghyeon.harbortrade.round.RoundManager;
import com.seunghyeon.harbortrade.shop.Offer;
import com.seunghyeon.harbortrade.trade.TradeConfig;
import java.util.List;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;

/**
 * /무역 command (admin only): list the trade goods. Trade goods cannot be changed in game; they come from
 * trade.json, read when the server starts.
 */
public final class TradeCommand {
	private TradeCommand() {
	}

	public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
		dispatcher.register(Commands.literal("무역")
				.requires(source -> source.hasPermission(2))
				.then(Commands.literal("목록").executes(ctx -> list(ctx.getSource()))));
	}

	private static int list(CommandSourceStack source) {
		List<Offer> offers = TradeConfig.items();
		MutableComponent message = Component.literal("[무역] 오늘의 무역상품: ").append(RoundManager.tradeItemName(source.getServer()))
				.append("\n무역상품 후보 " + offers.size() + "개");
		for (Offer offer : offers) {
			message.append("\n").append(offer.item().getDescription())
					.append(" (" + TradeConfig.id(offer.item()) + "): " + format(offer.price()));
		}
		source.sendSuccess(() -> message, false);
		return 1;
	}
}
