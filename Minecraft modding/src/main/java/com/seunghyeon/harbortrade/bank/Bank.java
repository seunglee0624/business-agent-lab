package com.seunghyeon.harbortrade.bank;

import java.util.UUID;
import net.minecraft.server.MinecraftServer;

/** The only place balances change. All amounts are in KD. */
public final class Bank {
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
}
