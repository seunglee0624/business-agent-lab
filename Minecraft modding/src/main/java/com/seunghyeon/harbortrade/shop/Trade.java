package com.seunghyeon.harbortrade.shop;

import static com.seunghyeon.harbortrade.bank.MoneyFormat.format;

import com.seunghyeon.harbortrade.bank.Bank;
import com.seunghyeon.harbortrade.fame.Fame;
import com.seunghyeon.harbortrade.round.RoundManager;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.item.ItemStack;

/** Buying from and selling to a shop. Money always goes through the bank account. */
public final class Trade {
	/** Pass as the count to sell every sellable one the player has. */
	public static final int ALL = -1;

	private Trade() {
	}

	public static void buy(ServerPlayer player, Offer offer, int count) {
		MinecraftServer server = player.server;
		if (offer.isFame()) {
			buyFame(player, count);
			return;
		}
		if (isClosedGem(server, player, offer)) {
			return;
		}
		if (!offer.playerCanBuy()) {
			player.sendSystemMessage(Component.literal("이 상점은 이 물건을 팔지 않습니다."));
			return;
		}
		if (freeSpace(player, offer) < count) {
			player.sendSystemMessage(Component.literal("인벤토리 공간이 부족합니다."));
			return;
		}
		long cost = offer.buyPrice(server) * count;
		if (!Bank.withdraw(server, player.getUUID(), cost)) {
			player.sendSystemMessage(Component.literal("잔액이 부족합니다. 필요 금액: " + format(cost)
					+ ", 은행 잔액: " + format(Bank.balance(server, player.getUUID()))));
			return;
		}

		player.getInventory().add(new ItemStack(offer.item(), count));
		player.sendSystemMessage(Component.empty().append(offer.item().getDescription()).append(" " + count + "개를 "
				+ format(cost) + "에 구매했습니다. 은행 잔액: " + format(Bank.balance(server, player.getUUID()))));
	}

	public static void sell(ServerPlayer player, Offer offer, int count) {
		MinecraftServer server = player.server;
		if (isClosedGem(server, player, offer)) {
			return;
		}
		if (count == ALL) {
			count = countSellable(player, offer);
			if (count == 0) {
				player.sendSystemMessage(Component.literal("판매할 물건이 없습니다. (손상된 물건은 팔 수 없습니다)"));
				return;
			}
		}
		if (countSellable(player, offer) < count) {
			player.sendSystemMessage(Component.literal("판매할 물건이 부족합니다. (손상된 물건은 팔 수 없습니다)"));
			return;
		}

		removeSellable(player, offer, count);
		long income = offer.sellPrice(server) * count;
		Bank.deposit(server, player.getUUID(), income);
		player.sendSystemMessage(Component.empty().append(offer.item().getDescription()).append(" " + count + "개를 "
				+ format(income) + "에 판매했습니다. 은행 잔액: " + format(Bank.balance(server, player.getUUID()))));
	}

	/** Fame is a score, not an item: pay from the bank and add points. Sold only during a round. */
	private static void buyFame(ServerPlayer player, int count) {
		MinecraftServer server = player.server;
		if (!RoundManager.isActive(server)) {
			player.sendSystemMessage(Component.literal("명성상점이 문을 닫았습니다."));
			return;
		}
		long cost = Fame.price() * count;
		if (!Bank.withdraw(server, player.getUUID(), cost)) {
			player.sendSystemMessage(Component.literal("잔액이 부족합니다. 필요 금액: " + format(cost)
					+ ", 은행 잔액: " + format(Bank.balance(server, player.getUUID()))));
			return;
		}
		Fame.add(server, player, count);
		player.sendSystemMessage(Component.literal("명성 " + count + "을(를) " + format(cost) + "에 구매했습니다. 내 명성: "
				+ Fame.get(server, player.getUUID()) + ", 은행 잔액: " + format(Bank.balance(server, player.getUUID()))));
	}

	/** Gems trade only while the jeweler is open; covers a shop screen left open past closing time. */
	private static boolean isClosedGem(MinecraftServer server, ServerPlayer player, Offer offer) {
		if (offer.gem() != null && !RoundManager.isJewelerOpen(server)) {
			player.sendSystemMessage(Component.literal("보석상이 문을 닫았습니다."));
			return true;
		}
		return false;
	}

	/** How many of the offered item still fit in the main inventory. */
	private static int freeSpace(ServerPlayer player, Offer offer) {
		Inventory inv = player.getInventory();
		ItemStack template = new ItemStack(offer.item());
		int space = 0;
		for (int i = 0; i < inv.items.size(); i++) {
			ItemStack stack = inv.items.get(i);
			if (stack.isEmpty()) {
				space += template.getMaxStackSize();
			} else if (ItemStack.isSameItemSameComponents(stack, template)) {
				space += stack.getMaxStackSize() - stack.getCount();
			}
		}
		return space;
	}

	private static boolean isSellable(ItemStack stack, Offer offer) {
		return stack.is(offer.item()) && !stack.isDamaged();
	}

	public static int countSellable(ServerPlayer player, Offer offer) {
		Inventory inv = player.getInventory();
		int count = 0;
		for (int i = 0; i < inv.items.size(); i++) {
			if (isSellable(inv.items.get(i), offer)) {
				count += inv.items.get(i).getCount();
			}
		}
		return count;
	}

	public static void removeSellable(ServerPlayer player, Offer offer, int count) {
		Inventory inv = player.getInventory();
		for (int i = 0; i < inv.items.size() && count > 0; i++) {
			ItemStack stack = inv.items.get(i);
			if (isSellable(stack, offer)) {
				int taken = Math.min(count, stack.getCount());
				stack.shrink(taken);
				count -= taken;
			}
		}
		inv.setChanged();
	}
}
