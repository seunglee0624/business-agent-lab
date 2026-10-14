package com.seunghyeon.harbortrade.network;

import com.seunghyeon.harbortrade.HarborTrade;
import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;

/** Client → server: the text typed into the input screen, or {@code cancelled}. */
public record TextPayload(String value, boolean cancelled) implements CustomPacketPayload {
	public static final Type<TextPayload> TYPE = new Type<>(HarborTrade.id("text"));
	public static final StreamCodec<RegistryFriendlyByteBuf, TextPayload> CODEC = StreamCodec.composite(
			ByteBufCodecs.STRING_UTF8, TextPayload::value,
			ByteBufCodecs.BOOL, TextPayload::cancelled,
			TextPayload::new);

	public static void register() {
		PayloadTypeRegistry.playC2S().register(TYPE, CODEC);
	}

	@Override
	public Type<? extends CustomPacketPayload> type() {
		return TYPE;
	}
}
