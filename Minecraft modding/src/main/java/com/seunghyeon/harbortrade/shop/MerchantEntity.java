package com.seunghyeon.harbortrade.shop;

import com.seunghyeon.harbortrade.round.RoundManager;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.InteractionHand;
import net.minecraft.world.InteractionResult;
import net.minecraft.world.SimpleMenuProvider;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.PathfinderMob;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.level.Level;

/** A shopkeeper NPC: stands still, cannot be hurt or pushed, and opens its shop on right click. */
public class MerchantEntity extends PathfinderMob {
	private ShopType shopType = ShopType.GROCER;

	public MerchantEntity(EntityType<? extends MerchantEntity> type, Level level) {
		super(type, level);
		setNoAi(true);
		setInvulnerable(true);
		setPersistenceRequired();
	}

	public void setShopType(ShopType shopType) {
		this.shopType = shopType;
		setCustomName(Component.literal(shopType.displayName()));
		setCustomNameVisible(true);
	}

	@Override
	protected InteractionResult mobInteract(Player player, InteractionHand hand) {
		if (player instanceof ServerPlayer serverPlayer) {
			if (shopType == ShopType.JEWELER && !RoundManager.isJewelerOpen(serverPlayer.server)) {
				serverPlayer.sendSystemMessage(Component.literal("보석상은 지금 영업하지 않습니다. (회차 시작 30분 후부터 회차 종료까지)"));
				return InteractionResult.SUCCESS;
			}
			if (shopType == ShopType.FAME && !RoundManager.isActive(serverPlayer.server)) {
				serverPlayer.sendSystemMessage(Component.literal("명성상점은 회차가 진행 중일 때만 영업합니다."));
				return InteractionResult.SUCCESS;
			}
			var offers = ShopConfig.offers(shopType);
			serverPlayer.openMenu(new SimpleMenuProvider(
					(containerId, inventory, p) -> ShopMenu.create(containerId, inventory, this, offers),
					Component.literal(shopType.displayName())));
		}
		return InteractionResult.sidedSuccess(level().isClientSide);
	}

	@Override
	public void addAdditionalSaveData(CompoundTag tag) {
		super.addAdditionalSaveData(tag);
		tag.putString("ShopType", shopType.id());
	}

	@Override
	public void readAdditionalSaveData(CompoundTag tag) {
		super.readAdditionalSaveData(tag);
		ShopType type = ShopType.byId(tag.getString("ShopType"));
		if (type != null) {
			shopType = type;
		}
	}

	@Override
	public boolean isPushable() {
		return false;
	}

	@Override
	protected void doPush(Entity entity) {
	}
}
