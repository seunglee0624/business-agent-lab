package com.seunghyeon.harbortrade.command;

import static com.seunghyeon.harbortrade.bank.MoneyFormat.format;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.LongArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.suggestion.SuggestionProvider;
import com.seunghyeon.harbortrade.HarborTrade;
import com.seunghyeon.harbortrade.gem.Gem;
import com.seunghyeon.harbortrade.round.RoundManager;
import com.seunghyeon.harbortrade.shop.Offer;
import com.seunghyeon.harbortrade.trade.TradeConfig;
import java.io.IOException;
import java.util.List;
import net.minecraft.commands.CommandBuildContext;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.commands.SharedSuggestionProvider;
import net.minecraft.commands.arguments.item.ItemArgument;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;

/**
 * /무역 command (admin only): edit trade categories and their goods in trade.json. The category name comes last
 * so Korean names and spaces need no quotes.
 */
public final class TradeCommand {
	private static final long MAX_PRICE = 1_000_000_000_000L;
	private static final String CATEGORY = "카테고리";
	private static final String ITEM = "아이템";
	private static final String PRICE = "기준가";
	private static final SuggestionProvider<CommandSourceStack> CATEGORIES =
			(ctx, builder) -> SharedSuggestionProvider.suggest(TradeConfig.categories(), builder);

	private TradeCommand() {
	}

	public static void register(CommandDispatcher<CommandSourceStack> dispatcher, CommandBuildContext buildContext) {
		dispatcher.register(Commands.literal("무역")
				.requires(source -> source.hasPermission(2))
				.then(Commands.literal("카테고리")
						.then(Commands.literal("추가").then(Commands.argument(CATEGORY, StringArgumentType.greedyString())
								.executes(ctx -> addCategory(ctx.getSource(), StringArgumentType.getString(ctx, CATEGORY)))))
						.then(Commands.literal("제거").then(Commands.argument(CATEGORY, StringArgumentType.greedyString())
								.suggests(CATEGORIES)
								.executes(ctx -> removeCategory(ctx.getSource(), StringArgumentType.getString(ctx, CATEGORY))))))
				.then(Commands.literal("상품")
						.then(Commands.literal("추가").then(Commands.argument(ITEM, ItemArgument.item(buildContext))
								.then(Commands.argument(PRICE, LongArgumentType.longArg(1, MAX_PRICE))
										.then(Commands.argument(CATEGORY, StringArgumentType.greedyString()).suggests(CATEGORIES)
												.executes(ctx -> addItem(ctx.getSource(), StringArgumentType.getString(ctx, CATEGORY),
														ItemArgument.getItem(ctx, ITEM).getItem(), LongArgumentType.getLong(ctx, PRICE)))))))
						.then(Commands.literal("제거").then(Commands.argument(ITEM, ItemArgument.item(buildContext))
								.then(Commands.argument(CATEGORY, StringArgumentType.greedyString()).suggests(CATEGORIES)
										.executes(ctx -> removeItem(ctx.getSource(), StringArgumentType.getString(ctx, CATEGORY),
												ItemArgument.getItem(ctx, ITEM).getItem()))))))
				.then(Commands.literal("목록")
						.executes(ctx -> listCategories(ctx.getSource()))
						.then(Commands.argument(CATEGORY, StringArgumentType.greedyString()).suggests(CATEGORIES)
								.executes(ctx -> listItems(ctx.getSource(), StringArgumentType.getString(ctx, CATEGORY)))))
				.then(Commands.literal("새로고침").executes(ctx -> reload(ctx.getSource()))));
	}

	private static int addCategory(CommandSourceStack source, String category) {
		try {
			if (!TradeConfig.addCategory(category)) {
				source.sendFailure(Component.literal("이미 있는 카테고리입니다: " + category));
				return 0;
			}
			source.sendSuccess(() -> Component.literal("무역 카테고리 '" + category + "'을(를) 추가했습니다. 상품을 넣어야 회차에서 뽑힙니다."), true);
			return 1;
		} catch (IOException e) {
			return saveFailed(source, e);
		}
	}

	private static int removeCategory(CommandSourceStack source, String category) {
		try {
			if (!TradeConfig.removeCategory(category)) {
				source.sendFailure(Component.literal("없는 카테고리입니다: " + category));
				return 0;
			}
			source.sendSuccess(() -> Component.literal("무역 카테고리 '" + category + "'을(를) 제거했습니다."), true);
			if (RoundManager.isActive(source.getServer()) && category.equals(RoundManager.tradeCategory(source.getServer()))) {
				source.sendFailure(Component.literal("주의: 이번 회차의 무역상품이었습니다. 이번 회차엔 무역상이 거래하지 않습니다."));
			}
			return 1;
		} catch (IOException e) {
			return saveFailed(source, e);
		}
	}

	private static int addItem(CommandSourceStack source, String category, Item item, long price) {
		if (!TradeConfig.categories().contains(category)) {
			source.sendFailure(Component.literal("없는 카테고리입니다: " + category + " (먼저 /무역 카테고리 추가)"));
			return 0;
		}
		if (Gem.of(new ItemStack(item)) != null) {
			source.sendFailure(Component.literal("보석은 무역할 수 없습니다."));
			return 0;
		}
		List<Offer> offers = TradeConfig.items(category);
		boolean isNew = offers.stream().noneMatch(offer -> offer.item() == item);
		if (isNew && offers.size() >= TradeConfig.MAX_ITEMS) {
			source.sendFailure(Component.literal(category + "의 상품이 가득 찼습니다. (최대 " + TradeConfig.MAX_ITEMS + "개)"));
			return 0;
		}
		try {
			long previous = TradeConfig.put(category, item, price);
			Component message = previous == -1
					? Component.literal(category + "에 ").append(item.getDescription()).append("을(를) 추가했습니다. 기준가: " + format(price))
					: Component.literal(category + "의 ").append(item.getDescription())
							.append(" 기준가를 " + format(previous) + " → " + format(price) + "(으)로 바꿨습니다.");
			source.sendSuccess(() -> message, true);
			return 1;
		} catch (IOException e) {
			return saveFailed(source, e);
		}
	}

	private static int removeItem(CommandSourceStack source, String category, Item item) {
		try {
			if (!TradeConfig.remove(category, item)) {
				source.sendFailure(Component.literal(category + "에 그 상품이 없습니다."));
				return 0;
			}
			source.sendSuccess(() -> Component.literal(category + "에서 ").append(item.getDescription()).append("을(를) 제거했습니다."), true);
			return 1;
		} catch (IOException e) {
			return saveFailed(source, e);
		}
	}

	private static int listCategories(CommandSourceStack source) {
		List<String> categories = TradeConfig.categories();
		MutableComponent message = Component.literal("[무역] 카테고리 " + categories.size() + "개");
		for (String category : categories) {
			message.append("\n" + category + ": 상품 " + TradeConfig.items(category).size() + "개");
		}
		source.sendSuccess(() -> message, false);
		return 1;
	}

	private static int listItems(CommandSourceStack source, String category) {
		if (!TradeConfig.categories().contains(category)) {
			source.sendFailure(Component.literal("없는 카테고리입니다: " + category));
			return 0;
		}
		List<Offer> offers = TradeConfig.items(category);
		MutableComponent message = Component.literal("[" + category + "] 상품 " + offers.size() + "개");
		for (Offer offer : offers) {
			message.append("\n").append(offer.item().getDescription())
					.append(" (" + BuiltInRegistries.ITEM.getKey(offer.item()) + "): " + format(offer.price()));
		}
		source.sendSuccess(() -> message, false);
		return 1;
	}

	private static int reload(CommandSourceStack source) {
		try {
			int count = TradeConfig.load();
			source.sendSuccess(() -> Component.literal("trade.json을 다시 읽었습니다. 카테고리 " + count + "개"), true);
			return 1;
		} catch (IOException | RuntimeException e) {
			HarborTrade.LOGGER.error("Failed to load trade.json", e);
			source.sendFailure(Component.literal("trade.json을 읽지 못했습니다: " + e.getMessage()));
			return 0;
		}
	}

	private static int saveFailed(CommandSourceStack source, IOException e) {
		HarborTrade.LOGGER.error("Failed to save trade.json", e);
		source.sendFailure(Component.literal("trade.json을 저장하지 못했습니다: " + e.getMessage()));
		return 0;
	}
}
