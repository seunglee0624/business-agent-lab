package com.seunghyeon.harbortrade.command;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.LongArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.mojang.brigadier.exceptions.CommandSyntaxException;
import com.seunghyeon.harbortrade.HarborTrade;
import com.seunghyeon.harbortrade.gem.Gem;
import com.seunghyeon.harbortrade.shop.Offer;
import com.seunghyeon.harbortrade.shop.MerchantEntity;
import com.seunghyeon.harbortrade.shop.ModEntities;
import com.seunghyeon.harbortrade.shop.ShopConfig;
import com.seunghyeon.harbortrade.shop.ShopType;
import java.io.IOException;
import java.util.Comparator;
import java.util.List;
import net.minecraft.commands.CommandBuildContext;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.commands.arguments.item.ItemArgument;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.level.ServerPlayer;

import static com.seunghyeon.harbortrade.bank.MoneyFormat.format;

/** /상점 command (admin only): place and remove merchants, edit regular-shop items, reload shops.json. */
public final class ShopCommand {
	private static final double REMOVE_RANGE = 4;
	private static final long MAX_PRICE = 1_000_000_000_000L;
	private static final String ITEM = "아이템";
	private static final String PRICE = "가격";

	private ShopCommand() {
	}

	public static void register(CommandDispatcher<CommandSourceStack> dispatcher, CommandBuildContext buildContext) {
		LiteralArgumentBuilder<CommandSourceStack> place = Commands.literal("설치");
		for (ShopType type : ShopType.values()) {
			place.then(Commands.literal(type.displayName()).executes(ctx -> place(ctx.getSource(), type)));
		}

		// /상점 상품 추가|제거|목록 <상점> ... — regular shops only; the jeweler's gems come from the market.
		LiteralArgumentBuilder<CommandSourceStack> add = Commands.literal("추가");
		LiteralArgumentBuilder<CommandSourceStack> remove = Commands.literal("제거");
		LiteralArgumentBuilder<CommandSourceStack> list = Commands.literal("목록");
		for (ShopType type : ShopType.values()) {
			if (type == ShopType.JEWELER) {
				continue;
			}
			add.then(Commands.literal(type.displayName())
					.then(Commands.argument(ITEM, ItemArgument.item(buildContext))
							.then(Commands.argument(PRICE, LongArgumentType.longArg(1, MAX_PRICE))
									.executes(ctx -> addItem(ctx.getSource(), type,
											ItemArgument.getItem(ctx, ITEM).getItem(), LongArgumentType.getLong(ctx, PRICE))))));
			remove.then(Commands.literal(type.displayName())
					.then(Commands.argument(ITEM, ItemArgument.item(buildContext))
							.executes(ctx -> removeItem(ctx.getSource(), type, ItemArgument.getItem(ctx, ITEM).getItem()))));
			list.then(Commands.literal(type.displayName()).executes(ctx -> listItems(ctx.getSource(), type)));
		}

		dispatcher.register(Commands.literal("상점")
				.requires(source -> source.hasPermission(2))
				.then(place)
				.then(Commands.literal("제거").executes(ctx -> remove(ctx.getSource())))
				.then(Commands.literal("상품").then(add).then(remove).then(list))
				.then(Commands.literal("새로고침").executes(ctx -> reload(ctx.getSource()))));
	}

	private static int place(CommandSourceStack source, ShopType type) throws CommandSyntaxException {
		ServerPlayer player = source.getPlayerOrException();
		MerchantEntity merchant = ModEntities.MERCHANT.create(player.serverLevel());
		if (merchant == null) {
			return 0;
		}
		merchant.moveTo(player.getX(), player.getY(), player.getZ(), player.getYRot(), 0);
		merchant.setYHeadRot(player.getYRot());
		merchant.setYBodyRot(player.getYRot());
		merchant.setShopType(type);
		player.serverLevel().addFreshEntity(merchant);
		source.sendSuccess(() -> Component.literal(type.displayName() + "을(를) 설치했습니다."), true);
		return 1;
	}

	/** Removes the merchant closest to the player within a few blocks. */
	private static int remove(CommandSourceStack source) throws CommandSyntaxException {
		ServerPlayer player = source.getPlayerOrException();
		var nearest = player.serverLevel()
				.getEntitiesOfClass(MerchantEntity.class, player.getBoundingBox().inflate(REMOVE_RANGE))
				.stream()
				.min(Comparator.comparingDouble(player::distanceToSqr));
		if (nearest.isEmpty()) {
			source.sendFailure(Component.literal("근처에 상인이 없습니다."));
			return 0;
		}
		nearest.get().discard();
		source.sendSuccess(() -> Component.literal("상인을 제거했습니다."), true);
		return 1;
	}

	private static int addItem(CommandSourceStack source, ShopType type, Item item, long price) {
		if (Gem.of(new ItemStack(item)) != null) {
			source.sendFailure(Component.literal("보석은 보석상에서만 거래합니다."));
			return 0;
		}
		List<Offer> offers = ShopConfig.offers(type);
		boolean isNew = offers.stream().noneMatch(offer -> offer.item() == item);
		if (isNew && offers.size() >= ShopConfig.MAX_OFFERS) {
			source.sendFailure(Component.literal(type.displayName() + "의 상품이 가득 찼습니다. (최대 " + ShopConfig.MAX_OFFERS + "개)"));
			return 0;
		}
		try {
			long previous = ShopConfig.put(type, item, price);
			Component message = previous == -1
					? Component.literal(type.displayName() + "에 ").append(item.getDescription())
							.append("을(를) 추가했습니다. 판매가: " + format(price))
					: Component.literal(type.displayName() + "의 ").append(item.getDescription())
							.append(" 판매가를 " + format(previous) + " → " + format(price) + "(으)로 바꿨습니다.");
			source.sendSuccess(() -> message, true);
			return 1;
		} catch (IOException e) {
			return saveFailed(source, e);
		}
	}

	private static int removeItem(CommandSourceStack source, ShopType type, Item item) {
		try {
			if (!ShopConfig.remove(type, item)) {
				source.sendFailure(Component.literal(type.displayName() + "에 그 상품이 없습니다."));
				return 0;
			}
			source.sendSuccess(() -> Component.literal(type.displayName() + "에서 ").append(item.getDescription()).append("을(를) 제거했습니다."), true);
			return 1;
		} catch (IOException e) {
			return saveFailed(source, e);
		}
	}

	private static int listItems(CommandSourceStack source, ShopType type) {
		List<Offer> offers = ShopConfig.offers(type);
		MutableComponent message = Component.literal("[" + type.displayName() + "] 상품 " + offers.size() + "개");
		for (Offer offer : offers) {
			message.append("\n").append(offer.item().getDescription())
					.append(" (" + BuiltInRegistries.ITEM.getKey(offer.item()) + "): " + format(offer.price()));
		}
		source.sendSuccess(() -> message, false);
		return 1;
	}

	private static int saveFailed(CommandSourceStack source, IOException e) {
		HarborTrade.LOGGER.error("Failed to save shops.json", e);
		source.sendFailure(Component.literal("shops.json을 저장하지 못했습니다: " + e.getMessage()));
		return 0;
	}

	private static int reload(CommandSourceStack source) {
		try {
			int count = ShopConfig.load();
			source.sendSuccess(() -> Component.literal("shops.json을 다시 읽었습니다. 상품 " + count + "개"), true);
			return 1;
		} catch (IOException | RuntimeException e) {
			HarborTrade.LOGGER.error("Failed to load shops.json", e);
			source.sendFailure(Component.literal("shops.json을 읽지 못했습니다: " + e.getMessage()));
			return 0;
		}
	}
}
