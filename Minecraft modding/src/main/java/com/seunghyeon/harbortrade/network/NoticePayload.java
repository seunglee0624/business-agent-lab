package com.seunghyeon.harbortrade.network;

import com.seunghyeon.harbortrade.HarborTrade;
import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;
import net.fabricmc.fabric.api.networking.v1.ServerPlayNetworking;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.ComponentSerialization;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.server.level.ServerPlayer;

/**
 * Server → client: a short trade result that should not clutter chat. The client shows it above the shop screen,
 * or in the action bar when no screen is open.
 */
public record NoticePayload(Component message, boolean ok) implements CustomPacketPayload {
	public static final Type<NoticePayload> TYPE = new Type<>(HarborTrade.id("notice"));
	public static final StreamCodec<RegistryFriendlyByteBuf, NoticePayload> CODEC = StreamCodec.composite(
			ComponentSerialization.STREAM_CODEC, NoticePayload::message,
			ByteBufCodecs.BOOL, NoticePayload::ok,
			NoticePayload::new);

	public static void register() {
		PayloadTypeRegistry.playS2C().register(TYPE, CODEC);
	}

	public static void ok(ServerPlayer player, Component message) {
		send(player, message, true);
	}

	public static void fail(ServerPlayer player, Component message) {
		send(player, message, false);
	}

	public static void fail(ServerPlayer player, String message) {
		send(player, Component.literal(message), false);
	}

	private static void send(ServerPlayer player, Component message, boolean ok) {
		if (ServerPlayNetworking.canSend(player, TYPE)) {
			ServerPlayNetworking.send(player, new NoticePayload(message, ok));
		} else {
			player.displayClientMessage(message, true);
		}
	}

	@Override
	public Type<? extends CustomPacketPayload> type() {
		return TYPE;
	}
}
