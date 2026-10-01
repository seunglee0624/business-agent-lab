package com.seunghyeon.harbortrade.network;

import com.seunghyeon.harbortrade.HarborTrade;
import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.ComponentSerialization;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;

/**
 * Server → client: open a number input screen. {@code max} 0 means no upper limit (no 최대 button);
 * {@code unitPrice} above 0 shows the running total; {@code allowZero} lets 0 be submitted.
 */
public record AmountPromptPayload(Component title, Component info, long max, long unitPrice, boolean allowZero)
		implements CustomPacketPayload {
	public static final Type<AmountPromptPayload> TYPE = new Type<>(HarborTrade.id("amount_prompt"));
	public static final StreamCodec<RegistryFriendlyByteBuf, AmountPromptPayload> CODEC = StreamCodec.composite(
			ComponentSerialization.STREAM_CODEC, AmountPromptPayload::title,
			ComponentSerialization.STREAM_CODEC, AmountPromptPayload::info,
			ByteBufCodecs.VAR_LONG, AmountPromptPayload::max,
			ByteBufCodecs.VAR_LONG, AmountPromptPayload::unitPrice,
			ByteBufCodecs.BOOL, AmountPromptPayload::allowZero,
			AmountPromptPayload::new);

	public static void register() {
		PayloadTypeRegistry.playS2C().register(TYPE, CODEC);
	}

	@Override
	public Type<? extends CustomPacketPayload> type() {
		return TYPE;
	}
}
