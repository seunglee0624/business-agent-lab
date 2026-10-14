package com.seunghyeon.harbortrade.network;

import com.seunghyeon.harbortrade.HarborTrade;
import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.ComponentSerialization;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;

/** Server → client: open a text input screen, pre-filled with {@code current}, accepting up to {@code maxLength}. */
public record TextPromptPayload(Component title, String current, int maxLength) implements CustomPacketPayload {
	public static final Type<TextPromptPayload> TYPE = new Type<>(HarborTrade.id("text_prompt"));
	public static final StreamCodec<RegistryFriendlyByteBuf, TextPromptPayload> CODEC = StreamCodec.composite(
			ComponentSerialization.STREAM_CODEC, TextPromptPayload::title,
			ByteBufCodecs.STRING_UTF8, TextPromptPayload::current,
			ByteBufCodecs.VAR_INT, TextPromptPayload::maxLength,
			TextPromptPayload::new);

	public static void register() {
		PayloadTypeRegistry.playS2C().register(TYPE, CODEC);
	}

	@Override
	public Type<? extends CustomPacketPayload> type() {
		return TYPE;
	}
}
