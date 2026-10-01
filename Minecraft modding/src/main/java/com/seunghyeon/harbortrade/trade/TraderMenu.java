package com.seunghyeon.harbortrade.trade;

import static com.seunghyeon.harbortrade.bank.MoneyFormat.format;

import com.seunghyeon.harbortrade.shop.MerchantEntity;
import com.seunghyeon.harbortrade.shop.Offer;
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

/** The trader's screen: today's trade good on the left, the cities on the right. Click a city to type an amount. */
public class TraderMenu extends ChestMenu {
	private static final int GOOD_SLOT = 1;
	private static final int[] CITY_SLOTS = {4, 6, 8};

	private final MerchantEntity merchant;
	private final Offer offer;
	private final SimpleContainer display;

	private TraderMenu(int containerId, Inventory inventory, MerchantEntity merchant, Offer offer, SimpleContainer display) {
		super(MenuType.GENERIC_9x1, containerId, inventory, display, 1);
		this.merchant = merchant;
		this.offer = offer;
		this.display = display;
		refresh(inventory.player);
	}

	public static TraderMenu create(int containerId, Inventory inventory, MerchantEntity merchant, Offer offer) {
		return new TraderMenu(containerId, inventory, merchant, offer, new SimpleContainer(9));
	}

	private void refresh(Player player) {
		for (int i = 0; i < display.getContainerSize(); i++) {
			display.setItem(i, ItemStack.EMPTY);
		}
		display.setItem(GOOD_SLOT, goodIcon());
		TradeCity[] cities = TradeCity.values();
		for (int i = 0; i < cities.length; i++) {
			display.setItem(CITY_SLOTS[i], cityIcon(cities[i], player));
		}
	}

	private ItemStack goodIcon() {
		Style plain = Style.EMPTY.withItalic(false);
		ItemStack stack = new ItemStack(offer.item());
		stack.set(DataComponents.LORE, new ItemLore(List.of(
				Component.literal("오늘의 무역상품").withStyle(plain.withColor(0x55FF55)),
				Component.literal("무역 기준가: " + format(offer.price())).withStyle(plain.withColor(0xFFAA00)),
				Component.literal("오른쪽 도시를 클릭해서 선적하세요").withStyle(plain.withColor(0xAAAAAA)))));
		return stack;
	}

	private ItemStack cityIcon(TradeCity city, Player player) {
		Style plain = Style.EMPTY.withItalic(false);
		List<Component> lore = new ArrayList<>();
		var server = merchant.level().getServer();
		if (server != null) {
			lore.add(Component.literal("내 선적(기준가): " + format(TradeManager.shipped(server, player.getUUID(), city)))
					.withStyle(plain.withColor(0xFFAA00)));
		}
		lore.add(Component.literal("클릭: 이 도시로 선적").withStyle(plain.withColor(0xAAAAAA)));

		ItemStack stack = new ItemStack(city.icon());
		stack.set(DataComponents.CUSTOM_NAME, Component.literal(city.displayName()).withStyle(plain.withColor(0xFFFFFF)));
		stack.set(DataComponents.LORE, new ItemLore(lore));
		return stack;
	}

	@Override
	public void clicked(int slotId, int button, ClickType clickType, Player player) {
		if (slotId < 0 || slotId >= display.getContainerSize()) {
			super.clicked(slotId, button, clickType, player);
			return;
		}

		if (player instanceof ServerPlayer serverPlayer && (clickType == ClickType.PICKUP || clickType == ClickType.QUICK_MOVE)) {
			for (int i = 0; i < CITY_SLOTS.length; i++) {
				if (CITY_SLOTS[i] == slotId) {
					TradeManager.prompt(serverPlayer, merchant, offer, TradeCity.values()[i]);
					return;
				}
			}
		}

		// Undo whatever the client predicted for the slot and redraw.
		refresh(player);
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
