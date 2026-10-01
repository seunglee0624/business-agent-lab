package com.seunghyeon.harbortrade.network;

import com.seunghyeon.harbortrade.HarborTrade;
import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;

/**
 * Client → server: the number typed into the input screen, or {@link #CANCEL}. What the number is for is kept on
 * the server, so the client only sends the value.
 */
public record AmountPayload(long value) implements CustomPacketPayload {
	public static final long CANCEL = -1;
	public static final Type<AmountPayload> TYPE = new Type<>(HarborTrade.id("amount"));
	public static final StreamCodec<RegistryFriendlyByteBuf, AmountPayload> CODEC = StreamCodec.composite(
			ByteBufCodecs.VAR_LONG, AmountPayload::value,
			AmountPayload::new);

	public static void register() {
		PayloadTypeRegistry.playC2S().register(TYPE, CODEC);
	}

	@Override
	public Type<? extends CustomPacketPayload> type() {
		return TYPE;
	}
}
