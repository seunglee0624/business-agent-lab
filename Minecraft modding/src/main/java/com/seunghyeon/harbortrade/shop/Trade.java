package com.seunghyeon.harbortrade.shop;

import static com.seunghyeon.harbortrade.bank.MoneyFormat.format;

import com.seunghyeon.harbortrade.bank.Bank;
import com.seunghyeon.harbortrade.fame.Fame;
import com.seunghyeon.harbortrade.network.NoticePayload;
import com.seunghyeon.harbortrade.round.RoundManager;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.item.ItemStack;

/** Buying from and selling to a shop. Money always goes through the bank account. */
public final class Trade {
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
			NoticePayload.fail(player, "이 상점은 이 물건을 팔지 않습니다.");
			return;
		}
		if (freeSpace(player, offer) < count) {
			NoticePayload.fail(player, "인벤토리 공간 부족");
			return;
		}
		long cost = offer.buyPrice(server) * count;
		if (!Bank.withdraw(server, player.getUUID(), cost)) {
			notEnoughMoney(player, cost);
			return;
		}

		player.getInventory().add(new ItemStack(offer.item(), count));
		NoticePayload.ok(player, Component.literal("구매 · ").append(offer.item().getDescription())
				.append(" ×" + count + "  -" + format(cost) + "  (잔액 " + format(Bank.balance(server, player.getUUID())) + ")"));
	}

	public static void sell(ServerPlayer player, Offer offer, int count) {
		MinecraftServer server = player.server;
		if (isClosedGem(server, player, offer)) {
			return;
		}
		if (countSellable(player, offer) < count) {
			NoticePayload.fail(player, "판매할 물건 부족 (손상된 물건 제외)");
			return;
		}

		removeSellable(player, offer, count);
		long income = offer.sellPrice(server) * count;
		Bank.deposit(server, player.getUUID(), income);
		NoticePayload.ok(player, Component.literal("판매 · ").append(offer.item().getDescription())
				.append(" ×" + count + "  +" + format(income) + "  (잔액 " + format(Bank.balance(server, player.getUUID())) + ")"));
	}

	/** Fame is a score, not an item: pay from the bank and add points. Sold only during a round. */
	private static void buyFame(ServerPlayer player, int count) {
		MinecraftServer server = player.server;
		if (!RoundManager.isActive(server)) {
			NoticePayload.fail(player, "명성상점 영업 종료");
			return;
		}
		long cost = Fame.price() * count;
		if (!Bank.withdraw(server, player.getUUID(), cost)) {
			notEnoughMoney(player, cost);
			return;
		}
		Fame.add(server, player, count);
		NoticePayload.ok(player, Component.literal("구매 · 명성 +" + count + "  -" + format(cost)
				+ "  (명성 " + Fame.get(server, player.getUUID()) + ", 잔액 " + format(Bank.balance(server, player.getUUID())) + ")"));
	}

	private static void notEnoughMoney(ServerPlayer player, long cost) {
		NoticePayload.fail(player, "잔액 부족 · 필요 " + format(cost) + " / 잔액 " + format(Bank.balance(player.server, player.getUUID())));
	}

	/** Gems trade only while the jeweler is open; covers a shop screen left open past closing time. */
	private static boolean isClosedGem(MinecraftServer server, ServerPlayer player, Offer offer) {
		if (offer.gem() != null && !RoundManager.isJewelerOpen(server)) {
			NoticePayload.fail(player, "보석상 영업 종료");
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
