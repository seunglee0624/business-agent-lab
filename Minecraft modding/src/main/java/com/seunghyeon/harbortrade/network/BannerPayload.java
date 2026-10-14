package com.seunghyeon.harbortrade.network;

import com.seunghyeon.harbortrade.HarborTrade;
import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;
import net.fabricmc.fabric.api.networking.v1.ServerPlayNetworking;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;

/** Server → client: flash the round start banner in the middle of the screen. */
public record BannerPayload() implements CustomPacketPayload {
	public static final Type<BannerPayload> TYPE = new Type<>(HarborTrade.id("banner"));
	public static final StreamCodec<RegistryFriendlyByteBuf, BannerPayload> CODEC = StreamCodec.unit(new BannerPayload());

	public static void register() {
		PayloadTypeRegistry.playS2C().register(TYPE, CODEC);
	}

	public static void sendAll(MinecraftServer server) {
		for (ServerPlayer player : server.getPlayerList().getPlayers()) {
			if (ServerPlayNetworking.canSend(player, TYPE)) {
				ServerPlayNetworking.send(player, new BannerPayload());
			}
		}
	}

	@Override
	public Type<? extends CustomPacketPayload> type() {
		return TYPE;
	}
}
