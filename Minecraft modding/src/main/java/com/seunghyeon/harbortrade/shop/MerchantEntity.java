package com.seunghyeon.harbortrade.shop;

import static com.seunghyeon.harbortrade.bank.MoneyFormat.format;

import com.seunghyeon.harbortrade.HarborTrade;
import com.seunghyeon.harbortrade.fame.Fame;
import com.seunghyeon.harbortrade.gem.Gem;
import com.seunghyeon.harbortrade.network.AmountPrompt;
import com.seunghyeon.harbortrade.network.AmountPromptPayload;
import com.seunghyeon.harbortrade.network.NoticePayload;
import com.seunghyeon.harbortrade.round.RoundManager;
import java.io.IOException;
import java.util.List;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import com.seunghyeon.harbortrade.trade.TraderMenu;
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

/**
 * A shopkeeper NPC: stands still, cannot be hurt or pushed, and opens its shop on right click. An admin who
 * shift+right clicks a regular shop while holding an item sets that item's price, and on the fame shop sets the
 * fame price.
 */
public class MerchantEntity extends PathfinderMob {
	private ShopType shopType = ShopType.GROCER;

	public MerchantEntity(EntityType<? extends MerchantEntity> type, Level level) {
		super(type, level);
		setNoAi(true);
		setInvulnerable(true);
		setPersistenceRequired();
	}

	public ShopType shopType() {
		return shopType;
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
				NoticePayload.fail(serverPlayer, "보석상은 지금 영업하지 않습니다. (회차 시작 30분 후부터 회차 종료까지)");
				return InteractionResult.SUCCESS;
			}
			if (shopType == ShopType.FAME && !RoundManager.isActive(serverPlayer.server)) {
				NoticePayload.fail(serverPlayer, "명성상점은 회차가 진행 중일 때만 영업합니다.");
				return InteractionResult.SUCCESS;
			}
			if (shopType.adminEditable() && player.isShiftKeyDown() && serverPlayer.hasPermissions(2)) {
				if (shopType == ShopType.FAME) {
					promptFamePrice(serverPlayer);
					return InteractionResult.SUCCESS;
				}
				if (!player.getItemInHand(hand).isEmpty()) {
					promptPrice(serverPlayer, player.getItemInHand(hand).getItem());
					return InteractionResult.SUCCESS;
				}
			}
			if (shopType == ShopType.TRADER) {
				openTrader(serverPlayer);
				return InteractionResult.SUCCESS;
			}
			var offers = ShopConfig.offers(shopType);
			serverPlayer.openMenu(new SimpleMenuProvider(
					(containerId, inventory, p) -> ShopMenu.create(containerId, inventory, this, offers),
					Component.literal(shopType.displayName())));
		}
		return InteractionResult.sidedSuccess(level().isClientSide);
	}

	/** Admin shortcut: asks for the price of one fame point. */
	private void promptFamePrice(ServerPlayer player) {
		AmountPrompt.open(player, new AmountPromptPayload(Component.literal("명성 가격 설정"),
				Component.literal("현재 명성 1 = " + format(Fame.price())), 0, 0, false), (p, price) -> {
			if (price <= 0) {
				return;
			}
			try {
				Fame.savePrice(price);
				p.sendSystemMessage(Component.literal("명성 가격 변경 · " + format(price)));
			} catch (IOException e) {
				HarborTrade.LOGGER.error("Failed to save fame.json", e);
				p.sendSystemMessage(Component.literal("fame.json을 저장하지 못했습니다: " + e.getMessage()));
			}
		});
	}

	/** Admin shortcut: asks for the sell price of the held item and adds it to this shop (0 removes it). */
	private void promptPrice(ServerPlayer player, Item item) {
		if (Gem.of(new ItemStack(item)) != null) {
			player.sendSystemMessage(Component.literal("보석은 보석상에서만 거래합니다."));
			return;
		}
		List<Offer> offers = ShopConfig.offers(shopType);
		long current = offers.stream().filter(offer -> offer.item() == item).mapToLong(Offer::price).findFirst().orElse(-1);
		if (current == -1 && offers.size() >= ShopConfig.MAX_OFFERS) {
			player.sendSystemMessage(Component.literal(shopType.displayName() + "의 상품이 가득 찼습니다. (최대 " + ShopConfig.MAX_OFFERS + "개)"));
			return;
		}
		Component info = Component.empty().append(item.getDescription()).append(current == -1
				? " · 새 상품, 판매가를 입력하세요"
				: " · 현재 판매가 " + format(current) + " (0 입력 시 제거)");
		AmountPrompt.open(player, new AmountPromptPayload(Component.literal(shopType.displayName() + " 판매가 설정"),
				info, 0, 0, current != -1), (p, price) -> {
			if (price < 0) {
				return;
			}
			try {
				if (price == 0) {
					ShopConfig.remove(shopType, item);
					p.sendSystemMessage(Component.literal("판매 목록 제거 · " + shopType.displayName() + " · ").append(item.getDescription()));
				} else {
					ShopConfig.put(shopType, item, price);
					p.sendSystemMessage(Component.literal("판매가 설정 · " + shopType.displayName() + " · ").append(item.getDescription())
							.append(" = " + format(price)));
				}
			} catch (IOException e) {
				HarborTrade.LOGGER.error("Failed to save shops.json", e);
				p.sendSystemMessage(Component.literal("shops.json을 저장하지 못했습니다: " + e.getMessage()));
			}
		});
	}

	/** Opens the trader screen, or tells the player why it is closed. */
	public void openTrader(ServerPlayer player) {
		if (!RoundManager.isTraderHere(player.server)) {
			NoticePayload.fail(player, "무역상은 지금 항구에 없습니다. (회차 1:30 ~ 1:40)");
			return;
		}
		Offer offer = RoundManager.tradeOffer(player.server).orElse(null);
		if (offer == null) {
			player.sendSystemMessage(Component.literal("오늘의 무역상품이 없습니다. 관리자에게 알려주세요."));
			return;
		}
		player.openMenu(new SimpleMenuProvider(
				(containerId, inventory, p) -> TraderMenu.create(containerId, inventory, this, offer),
				Component.literal("무역상 - 오늘의 무역상품: ").append(offer.item().getDescription())));
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
