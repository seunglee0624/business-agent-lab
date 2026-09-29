package com.seunghyeon.harbortrade.currency;

import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.item.ItemStack;

/** Physical coins in a player's inventory. */
public final class Wallet {
	private Wallet() {
	}

	/** Total value of all coins in the inventory, in copper. */
	public static long total(ServerPlayer player) {
		Inventory inv = player.getInventory();
		long total = 0;
		for (int i = 0; i < inv.getContainerSize(); i++) {
			ItemStack stack = inv.getItem(i);
			Coin coin = Coin.of(stack);
			if (coin != null) {
				total += coin.value() * stack.getCount();
			}
		}
		return total;
	}

	/** Removes every coin from the inventory and returns the count of each type (indexed by ordinal). */
	public static long[] takeAll(ServerPlayer player) {
		Inventory inv = player.getInventory();
		long[] counts = new long[Coin.values().length];
		for (int i = 0; i < inv.getContainerSize(); i++) {
			ItemStack stack = inv.getItem(i);
			Coin coin = Coin.of(stack);
			if (coin != null) {
				counts[coin.ordinal()] += stack.getCount();
				inv.setItem(i, ItemStack.EMPTY);
			}
		}
		return counts;
	}

	/** Gives the given copper value as the fewest coins possible. */
	public static void give(ServerPlayer player, long copper) {
		long[] counts = new long[Coin.values().length];
		for (Coin coin : Coin.values()) {
			counts[coin.ordinal()] = copper / coin.value();
			copper %= coin.value();
		}
		give(player, counts);
	}

	/** Gives coins by count of each type; whatever does not fit is dropped at the player's feet. */
	public static void give(ServerPlayer player, long[] counts) {
		for (Coin coin : Coin.values()) {
			long remaining = counts[coin.ordinal()];
			int maxStack = coin.item().getDefaultMaxStackSize();
			while (remaining > 0) {
				int n = (int) Math.min(remaining, maxStack);
				remaining -= n;
				ItemStack stack = new ItemStack(coin.item(), n);
				if (!player.getInventory().add(stack)) {
					player.drop(stack, false);
				}
			}
		}
	}
}
