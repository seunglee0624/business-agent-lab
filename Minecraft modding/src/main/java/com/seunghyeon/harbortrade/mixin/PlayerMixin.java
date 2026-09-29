package com.seunghyeon.harbortrade.mixin;

import com.seunghyeon.harbortrade.bank.DeathCoins;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.player.Player;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(Player.class)
public abstract class PlayerMixin {
	@Inject(method = "dropEquipment", at = @At("HEAD"))
	private void harbortrade$keepCoins(CallbackInfo ci) {
		if ((Object) this instanceof ServerPlayer player) {
			DeathCoins.onDropEquipment(player);
		}
	}
}
