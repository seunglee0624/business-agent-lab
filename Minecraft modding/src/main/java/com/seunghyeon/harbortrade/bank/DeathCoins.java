package com.seunghyeon.harbortrade.bank;

import com.seunghyeon.harbortrade.currency.Wallet;
import net.fabricmc.fabric.api.entity.event.v1.ServerPlayerEvents;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.GameRules;

/** Players keep their coins on death: coins are held on death and returned on respawn. */
public final class DeathCoins {
	private DeathCoins() {
	}

	public static void register() {
		ServerPlayerEvents.AFTER_RESPAWN.register((oldPlayer, newPlayer, alive) -> {
			BankData data = BankData.get(newPlayer.server);
			long[] counts = data.deathStash.remove(newPlayer.getUUID());
			if (counts != null) {
				data.setDirty();
				Wallet.give(newPlayer, counts);
			}
		});
	}

	/** Called right before the player's inventory is dropped on death. */
	public static void onDropEquipment(ServerPlayer player) {
		if (player.serverLevel().getGameRules().getBoolean(GameRules.RULE_KEEPINVENTORY)) {
			return;
		}
		long[] counts = Wallet.takeAll(player);
		BankData data = BankData.get(player.server);
		long[] previous = data.deathStash.get(player.getUUID());
		if (previous != null) {
			for (int i = 0; i < counts.length; i++) {
				counts[i] += previous[i];
			}
		}
		data.deathStash.put(player.getUUID(), counts);
		data.setDirty();
	}
}
