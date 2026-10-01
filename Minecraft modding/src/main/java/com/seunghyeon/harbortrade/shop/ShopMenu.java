package com.seunghyeon.harbortrade.shop;

import static com.seunghyeon.harbortrade.bank.MoneyFormat.format;

import com.seunghyeon.harbortrade.network.NoticePayload;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.core.component.DataComponents;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.Style;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.SimpleContainer;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.ChestMenu;
import net.minecraft.world.inventory.ClickType;
import net.minecraft.world.inventory.MenuType;
import net.minecraft.world.inventory.Slot;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.component.ItemLore;

/**
 * A chest-style shop screen that needs no client code. The top rows show the offers; clicking them trades
 * instead of moving items. Server-wide rule: left click buys, right click sells, holding shift makes it 64.
 * Regular shops only buy from players and fame can only be bought; the other click just explains that.
 */
public class ShopMenu extends ChestMenu {
	private static final int BULK = 64;
	private static final MenuType<?>[] TYPES = {MenuType.GENERIC_9x1, MenuType.GENERIC_9x2, MenuType.GENERIC_9x3,
			MenuType.GENERIC_9x4, MenuType.GENERIC_9x5, MenuType.GENERIC_9x6};

	private final MerchantEntity merchant;
	private final List<Offer> offers;
	private final SimpleContainer display;

	private ShopMenu(int containerId, Inventory inventory, MerchantEntity merchant, List<Offer> offers, SimpleContainer display, int rows) {
		super(TYPES[rows - 1], containerId, inventory, display, rows);
		this.merchant = merchant;
		this.offers = offers;
		this.display = display;
		refresh();
	}

	public static ShopMenu create(int containerId, Inventory inventory, MerchantEntity merchant, List<Offer> offers) {
		int rows = Math.clamp((offers.size() + 8) / 9, 1, TYPES.length);
		return new ShopMenu(containerId, inventory, merchant, offers, new SimpleContainer(rows * 9), rows);
	}

	/** Redraws every offer with its current prices. */
	private void refresh() {
		for (int i = 0; i < display.getContainerSize(); i++) {
			display.setItem(i, i < offers.size() ? icon(offers.get(i)) : ItemStack.EMPTY);
		}
	}

	private ItemStack icon(Offer offer) {
		var server = merchant.level().getServer();
		List<Component> lore = new ArrayList<>();
		Style plain = Style.EMPTY.withItalic(false);
		if (offer.isFame()) {
			lore.add(Component.literal("명성 1 = " + format(offer.buyPrice(server))).withStyle(plain.withColor(0x55FF55)));
			lore.add(Component.literal("좌클릭: 명성 1 구매 / 쉬프트+좌클릭: 명성 " + BULK + " 구매").withStyle(plain.withColor(0xAAAAAA)));
		} else if (offer.playerCanBuy()) {
			lore.add(Component.literal("구매가: " + format(offer.buyPrice(server))).withStyle(plain.withColor(0x55FF55)));
			lore.add(Component.literal("판매가: " + format(offer.sellPrice(server))).withStyle(plain.withColor(0xFFAA00)));
			lore.add(Component.literal("좌클릭: 1개 구매 / 쉬프트+좌클릭: " + BULK + "개 구매").withStyle(plain.withColor(0xAAAAAA)));
			lore.add(Component.literal("우클릭: 1개 판매 / 쉬프트+우클릭: " + BULK + "개 판매").withStyle(plain.withColor(0xAAAAAA)));
		} else {
			lore.add(Component.literal("판매가: " + format(offer.sellPrice(server))).withStyle(plain.withColor(0xFFAA00)));
			lore.add(Component.literal("우클릭: 1개 판매 / 쉬프트+우클릭: " + BULK + "개 판매").withStyle(plain.withColor(0xAAAAAA)));
		}

		ItemStack stack = new ItemStack(offer.item());
		stack.set(DataComponents.LORE, new ItemLore(lore));
		return stack;
	}

	@Override
	public void clicked(int slotId, int button, ClickType clickType, Player player) {
		if (slotId < 0 || slotId >= display.getContainerSize()) {
			super.clicked(slotId, button, clickType, player);
			return;
		}

		if (slotId < offers.size() && player instanceof ServerPlayer serverPlayer
				&& (clickType == ClickType.PICKUP || clickType == ClickType.QUICK_MOVE)) {
			Offer offer = offers.get(slotId);
			int count = clickType == ClickType.QUICK_MOVE ? BULK : 1;
			if (button == 0) {
				if (offer.playerCanBuy()) {
					Trade.buy(serverPlayer, offer, count);
				} else {
					NoticePayload.fail(serverPlayer, "이 상점은 물건을 팔지 않습니다. 우클릭으로 판매하세요.");
				}
			} else if (button == 1) {
				if (offer.isFame()) {
					NoticePayload.fail(serverPlayer, "명성은 되팔 수 없습니다.");
				} else {
					Trade.sell(serverPlayer, offer, count);
				}
			}
		}

		// Undo whatever the client predicted for the shop slot and redraw current prices.
		refresh();
		sendAllDataToRemote();
	}

	@Override
	public ItemStack quickMoveStack(Player player, int index) {
		return ItemStack.EMPTY;
	}

	@Override
	public boolean canTakeItemForPickAll(ItemStack stack, Slot slot) {
		return slot.container != display;
	}

	@Override
	public boolean canDragTo(Slot slot) {
		return slot.container != display;
	}

	@Override
	public boolean stillValid(Player player) {
		return merchant.isAlive() && player.distanceToSqr(merchant) < 64;
	}
}
