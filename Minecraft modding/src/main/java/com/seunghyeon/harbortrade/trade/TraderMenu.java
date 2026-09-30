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

/**
 * The trader's screen. The rows below list today's goods; click one to pick it (it glows), then click a city in
 * the top row to type how many to ship there.
 */
public class TraderMenu extends ChestMenu {
	private static final int[] CITY_SLOTS = {2, 4, 6};
	private static final MenuType<?>[] TYPES = {MenuType.GENERIC_9x1, MenuType.GENERIC_9x2, MenuType.GENERIC_9x3,
			MenuType.GENERIC_9x4, MenuType.GENERIC_9x5, MenuType.GENERIC_9x6};

	private final MerchantEntity merchant;
	private final List<Offer> offers;
	private final SimpleContainer display;
	private int selected = -1;

	private TraderMenu(int containerId, Inventory inventory, MerchantEntity merchant, List<Offer> offers, SimpleContainer display, int rows) {
		super(TYPES[rows - 1], containerId, inventory, display, rows);
		this.merchant = merchant;
		this.offers = offers;
		this.display = display;
		refresh(inventory.player);
	}

	public static TraderMenu create(int containerId, Inventory inventory, MerchantEntity merchant, List<Offer> offers) {
		int rows = 1 + Math.clamp((offers.size() + 8) / 9, 1, TYPES.length - 1);
		return new TraderMenu(containerId, inventory, merchant, offers, new SimpleContainer(rows * 9), rows);
	}

	private void refresh(Player player) {
		for (int i = 0; i < display.getContainerSize(); i++) {
			display.setItem(i, ItemStack.EMPTY);
		}
		TradeCity[] cities = TradeCity.values();
		for (int i = 0; i < cities.length; i++) {
			display.setItem(CITY_SLOTS[i], cityIcon(cities[i], player));
		}
		for (int i = 0; i < offers.size(); i++) {
			display.setItem(9 + i, goodIcon(offers.get(i), i == selected));
		}
	}

	private ItemStack cityIcon(TradeCity target, Player player) {
		Style plain = Style.EMPTY.withItalic(false);
		List<Component> lore = new ArrayList<>();
		var server = merchant.level().getServer();
		if (server != null) {
			lore.add(Component.literal("내 선적(기준가): " + format(TradeManager.shipped(server, player.getUUID(), target)))
					.withStyle(plain.withColor(0xFFAA00)));
		}
		lore.add(Component.literal(selected >= 0 ? "클릭: 선택한 상품을 이 도시로 선적" : "먼저 아래에서 상품을 고르세요")
				.withStyle(plain.withColor(selected >= 0 ? 0x55FF55 : 0xAAAAAA)));

		ItemStack stack = new ItemStack(target.icon());
		stack.set(DataComponents.CUSTOM_NAME, Component.literal(target.displayName()).withStyle(plain.withColor(0xFFFFFF)));
		stack.set(DataComponents.LORE, new ItemLore(lore));
		return stack;
	}

	private ItemStack goodIcon(Offer offer, boolean isSelected) {
		Style plain = Style.EMPTY.withItalic(false);
		List<Component> lore = List.of(
				Component.literal("무역 기준가: " + format(offer.price())).withStyle(plain.withColor(0xFFAA00)),
				Component.literal(isSelected ? "선택됨 - 위에서 도시를 클릭하세요" : "클릭해서 선택")
						.withStyle(plain.withColor(isSelected ? 0x55FF55 : 0xAAAAAA)));
		ItemStack stack = new ItemStack(offer.item());
		stack.set(DataComponents.LORE, new ItemLore(lore));
		if (isSelected) {
			stack.set(DataComponents.ENCHANTMENT_GLINT_OVERRIDE, true);
		}
		return stack;
	}

	@Override
	public void clicked(int slotId, int button, ClickType clickType, Player player) {
		if (slotId < 0 || slotId >= display.getContainerSize()) {
			super.clicked(slotId, button, clickType, player);
			return;
		}

		if (player instanceof ServerPlayer serverPlayer && (clickType == ClickType.PICKUP || clickType == ClickType.QUICK_MOVE)) {
			int index = slotId - 9;
			if (index >= 0 && index < offers.size()) {
				selected = index;
			}
			for (int i = 0; i < CITY_SLOTS.length; i++) {
				if (CITY_SLOTS[i] == slotId) {
					if (selected < 0) {
						serverPlayer.sendSystemMessage(Component.literal("먼저 아래에서 선적할 상품을 고르세요."));
					} else {
						TradeManager.prompt(serverPlayer, merchant, offers.get(selected), TradeCity.values()[i]);
						return;
					}
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
