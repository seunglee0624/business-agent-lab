package com.seunghyeon.harbortrade.command;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.mojang.brigadier.exceptions.CommandSyntaxException;
import com.seunghyeon.harbortrade.HarborTrade;
import com.seunghyeon.harbortrade.shop.MerchantEntity;
import com.seunghyeon.harbortrade.shop.ModEntities;
import com.seunghyeon.harbortrade.shop.ShopConfig;
import com.seunghyeon.harbortrade.shop.ShopType;
import java.io.IOException;
import java.util.Comparator;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;

/** /상점 command (admin only): place and remove merchants, reload shops.json. */
public final class ShopCommand {
	private static final double REMOVE_RANGE = 4;

	private ShopCommand() {
	}

	public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
		LiteralArgumentBuilder<CommandSourceStack> place = Commands.literal("설치");
		for (ShopType type : ShopType.values()) {
			place.then(Commands.literal(type.displayName()).executes(ctx -> place(ctx.getSource(), type)));
		}

		dispatcher.register(Commands.literal("상점")
				.requires(source -> source.hasPermission(2))
				.then(place)
				.then(Commands.literal("제거").executes(ctx -> remove(ctx.getSource())))
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
