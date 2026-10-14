package com.seunghyeon.harbortrade.shop;

import static com.seunghyeon.harbortrade.bank.MoneyFormat.format;

import com.seunghyeon.harbortrade.HarborTrade;
import com.seunghyeon.harbortrade.fame.Fame;
import com.seunghyeon.harbortrade.gem.Gem;
import com.seunghyeon.harbortrade.network.AmountPrompt;
import com.seunghyeon.harbortrade.network.AmountPromptPayload;
import com.seunghyeon.harbortrade.network.NoticePayload;
import com.seunghyeon.harbortrade.round.RoundManager;
import com.seunghyeon.harbortrade.network.TextPrompt;
import com.seunghyeon.harbortrade.network.TextPromptPayload;
import com.seunghyeon.harbortrade.trade.TraderMenu;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.nbt.ListTag;
import net.minecraft.nbt.Tag;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
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
 * A shopkeeper NPC: stands still, cannot be hurt or pushed, and opens its shop on right click. A general shop
 * keeps its own name and goods; an admin shift+right clicks it to open the admin screen, or the fame shop to set
 * the fame price.
 */
public class MerchantEntity extends PathfinderMob {
	public static final int MAX_GOODS = 45;
	private static final int MAX_NAME_LENGTH = 16;
	private static final long MAX_PRICE = 1_000_000_000_000L;

	private ShopType shopType = ShopType.GENERAL;
	/** General shops only: what the shop buys from players, in display order. */
	private final List<Offer> goods = new ArrayList<>();

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

	public Component shopName() {
		return getCustomName() != null ? getCustomName() : Component.literal(shopType.displayName());
	}

	public List<Offer> goods() {
		return goods;
	}

	/** What this shop shows to customers. */
	private List<Offer> offers() {
		return switch (shopType) {
			case GENERAL -> goods;
			case JEWELER -> Arrays.stream(Gem.values()).map(Offer::gem).toList();
			case FAME -> List.of(Offer.fame());
			case TRADER -> List.of();
		};
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
				openAdmin(serverPlayer);
				return InteractionResult.SUCCESS;
			}
			if (shopType == ShopType.TRADER) {
				openTrader(serverPlayer);
				return InteractionResult.SUCCESS;
			}
			List<Offer> offers = offers();
			serverPlayer.openMenu(new SimpleMenuProvider(
					(containerId, inventory, p) -> ShopMenu.create(containerId, inventory, this, offers), shopName()));
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

	private void openAdmin(ServerPlayer player) {
		player.openMenu(new SimpleMenuProvider((containerId, inventory, p) -> ShopAdminMenu.create(containerId, inventory, this),
				Component.literal("[관리] ").append(shopName())));
	}

	/** Back to the admin screen after an input screen, if the admin is still nearby. */
	private void reopenAdmin(ServerPlayer player) {
		if (isAlive() && player.distanceToSqr(this) < 64) {
			openAdmin(player);
		}
	}

	/** Asks for the sell price of the item, adding it to this shop if it is new. */
	void promptPrice(ServerPlayer player, Item item) {
		if (Gem.of(new ItemStack(item)) != null) {
			NoticePayload.fail(player, "보석은 보석상에서만 거래합니다.");
			return;
		}
		long current = goods.stream().filter(offer -> offer.item() == item).mapToLong(Offer::price).findFirst().orElse(-1);
		if (current == -1 && goods.size() >= MAX_GOODS) {
			NoticePayload.fail(player, "상품이 가득 찼습니다. (최대 " + MAX_GOODS + "개)");
			return;
		}
		Component info = Component.empty().append(item.getDescription()).append(current == -1
				? " · 새 상품, 판매가를 입력하세요"
				: " · 현재 판매가 " + format(current));
		AmountPrompt.open(player, new AmountPromptPayload(Component.literal("판매가 설정"), info, 0, 0, false), (p, price) -> {
			NoticePayload result = null;
			if (price > 0) {
				price = Math.min(price, MAX_PRICE);
				Offer offer = Offer.fixed(item, price);
				int index = indexOf(item);
				if (index >= 0) {
					goods.set(index, offer);
				} else if (goods.size() < MAX_GOODS) {
					goods.add(offer);
				}
				result = new NoticePayload(Component.literal(index >= 0 ? "판매가 변경 · " : "상품 추가 · ")
						.append(item.getDescription()).append(" = " + format(price)), true);
			}
			reopenAdmin(p);
			if (result != null) {
				result.send(p);
			}
		});
	}

	void removeGood(ServerPlayer player, Item item) {
		int index = indexOf(item);
		if (index >= 0) {
			goods.remove(index);
			NoticePayload.ok(player, Component.literal("상품 빼기 · ").append(item.getDescription()));
		}
	}

	void promptName(ServerPlayer player) {
		TextPrompt.open(player, new TextPromptPayload(Component.literal("상점 이름 변경"), shopName().getString(), MAX_NAME_LENGTH),
				(p, name) -> {
					if (name != null) {
						setCustomName(Component.literal(name));
					}
					reopenAdmin(p);
					if (name != null) {
						NoticePayload.ok(p, Component.literal("이름 변경 · " + name));
					}
				});
	}

	private int indexOf(Item item) {
		for (int i = 0; i < goods.size(); i++) {
			if (goods.get(i).item() == item) {
				return i;
			}
		}
		return -1;
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
		ListTag list = new ListTag();
		for (Offer offer : goods) {
			CompoundTag entry = new CompoundTag();
			entry.putString("item", BuiltInRegistries.ITEM.getKey(offer.item()).toString());
			entry.putLong("price", offer.price());
			list.add(entry);
		}
		tag.put("Goods", list);
	}

	@Override
	public void readAdditionalSaveData(CompoundTag tag) {
		super.readAdditionalSaveData(tag);
		ShopType type = ShopType.byId(tag.getString("ShopType"));
		if (type != null) {
			shopType = type;
		}
		goods.clear();
		for (Tag entry : tag.getList("Goods", Tag.TAG_COMPOUND)) {
			CompoundTag good = (CompoundTag) entry;
			ResourceLocation id = ResourceLocation.tryParse(good.getString("item"));
			if (id == null) {
				continue;
			}
			BuiltInRegistries.ITEM.getOptional(id).filter(item -> item != Items.AIR)
					.ifPresent(item -> goods.add(Offer.fixed(item, good.getLong("price"))));
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
