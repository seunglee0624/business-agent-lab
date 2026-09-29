package com.seunghyeon.harbortrade.bank;

import java.util.UUID;
import net.minecraft.server.MinecraftServer;

/** The only place balances change. All amounts are in copper. */
public final class Bank {
	/** Transfer fee, in percent, charged to the sender on top of the amount. */
	public static final int TRANSFER_FEE_PERCENT = 10;

	private Bank() {
	}

	public static long balance(MinecraftServer server, UUID player) {
		return BankData.get(server).balances.getOrDefault(player, 0L);
	}

	public static void set(MinecraftServer server, UUID player, long amount) {
		BankData data = BankData.get(server);
		data.balances.put(player, amount);
		data.setDirty();
	}

	public static void deposit(MinecraftServer server, UUID player, long amount) {
		set(server, player, Math.addExact(balance(server, player), amount));
	}

	/** Takes the amount out of the account; returns false and changes nothing if the balance is too low. */
	public static boolean withdraw(MinecraftServer server, UUID player, long amount) {
		long balance = balance(server, player);
		if (balance < amount) {
			return false;
		}
		set(server, player, balance - amount);
		return true;
	}

	/** Fee for sending the amount, rounded up. */
	public static long transferFee(long amount) {
		return (amount * TRANSFER_FEE_PERCENT + 99) / 100;
	}

	/** Moves the amount to the receiver and burns the fee; returns false if the sender cannot cover both. */
	public static boolean transfer(MinecraftServer server, UUID from, UUID to, long amount) {
		if (!withdraw(server, from, amount + transferFee(amount))) {
			return false;
		}
		deposit(server, to, amount);
		return true;
	}
}
