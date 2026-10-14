package com.seunghyeon.harbortrade.shop;

import static com.seunghyeon.harbortrade.bank.MoneyFormat.format;

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
import net.minecraft.world.item.Items;
import net.minecraft.world.item.component.ItemLore;

/**
 * Admin screen for a general shop (shift+right click on the NPC). The top five rows are the goods: left click
 * changes the price, right click takes it off. Clicking an item in your own inventory adds it. The name tag in
 * the bottom row renames the shop. Nothing is moved; every click is handled on the server.
 */
public class ShopAdminMenu extends ChestMenu {
	private static final int ROWS = 6;
	private static final int HELP_SLOT = 45;
	private static final int NAME_SLOT = 49;

	private final MerchantEntity merchant;
	private final SimpleContainer display;

	private ShopAdminMenu(int containerId, Inventory inventory, MerchantEntity merchant, SimpleContainer display) {
		super(MenuType.GENERIC_9x6, containerId, inventory, display, ROWS);
		this.merchant = merchant;
		this.display = display;
		refresh();
	}

	public static ShopAdminMenu create(int containerId, Inventory inventory, MerchantEntity merchant) {
		return new ShopAdminMenu(containerId, inventory, merchant, new SimpleContainer(ROWS * 9));
	}

	private void refresh() {
		Style plain = Style.EMPTY.withItalic(false);
		List<Offer> goods = merchant.goods();
		for (int i = 0; i < MerchantEntity.MAX_GOODS; i++) {
			if (i < goods.size()) {
				Offer offer = goods.get(i);
				ItemStack stack = new ItemStack(offer.item());
				stack.set(DataComponents.LORE, new ItemLore(List.of(
						Component.literal("판매가: " + format(offer.price())).withStyle(plain.withColor(0xFFAA00)),
						Component.literal("좌클릭: 가격 변경 / 우클릭: 빼기").withStyle(plain.withColor(0xAAAAAA)))));
				display.setItem(i, stack);
			} else {
				display.setItem(i, ItemStack.EMPTY);
			}
		}
		for (int i = MerchantEntity.MAX_GOODS; i < ROWS * 9; i++) {
			display.setItem(i, ItemStack.EMPTY);
		}

		ItemStack help = new ItemStack(Items.BOOK);
		help.set(DataComponents.CUSTOM_NAME, Component.literal("사용법").withStyle(plain.withColor(0xFFFF55)));
		help.set(DataComponents.LORE, new ItemLore(List.of(
				Component.literal("내 인벤토리 아이템 클릭: 상품 추가").withStyle(plain.withColor(0xAAAAAA)),
				Component.literal("상품 좌클릭: 가격 변경").withStyle(plain.withColor(0xAAAAAA)),
				Component.literal("상품 우클릭: 빼기").withStyle(plain.withColor(0xAAAAAA)),
				Component.literal("NPC 우클릭: 손님 화면으로 확인").withStyle(plain.withColor(0xAAAAAA)),
				Component.literal("상품 " + goods.size() + " / " + MerchantEntity.MAX_GOODS).withStyle(plain.withColor(0xFFFFFF)))));
		display.setItem(HELP_SLOT, help);

		ItemStack name = new ItemStack(Items.NAME_TAG);
		name.set(DataComponents.CUSTOM_NAME, Component.literal("이름 변경").withStyle(plain.withColor(0xFFFF55)));
		name.set(DataComponents.LORE, new ItemLore(List.of(
				Component.literal("현재: ").withStyle(plain.withColor(0xAAAAAA)).append(merchant.shopName()))));
		display.setItem(NAME_SLOT, name);
	}

	@Override
	public void clicked(int slotId, int button, ClickType clickType, Player player) {
		if (player instanceof ServerPlayer admin && (clickType == ClickType.PICKUP || clickType == ClickType.QUICK_MOVE)) {
			int size = display.getContainerSize();
			if (slotId >= 0 && slotId < merchant.goods().size()) {
				Offer offer = merchant.goods().get(slotId);
				if (button == 0) {
					merchant.promptPrice(admin, offer.item());
				} else if (button == 1) {
					merchant.removeGood(admin, offer.item());
				}
			} else if (slotId == NAME_SLOT) {
				merchant.promptName(admin);
			} else if (slotId >= size && slotId < slots.size()) {
				ItemStack stack = slots.get(slotId).getItem();
				if (!stack.isEmpty()) {
					merchant.promptPrice(admin, stack.getItem());
				}
			}
		}
		// Nothing moves in this screen; redraw and resync whatever the client predicted.
		refresh();
		sendAllDataToRemote();
	}

	@Override
	public ItemStack quickMoveStack(Player player, int index) {
		return ItemStack.EMPTY;
	}

	@Override
	public boolean canTakeItemForPickAll(ItemStack stack, Slot slot) {
		return false;
	}

	@Override
	public boolean canDragTo(Slot slot) {
		return false;
	}

	@Override
	public boolean stillValid(Player player) {
		return merchant.isAlive() && player.distanceToSqr(merchant) < 64;
	}
}
