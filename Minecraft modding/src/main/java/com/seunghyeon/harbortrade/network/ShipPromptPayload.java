package com.seunghyeon.harbortrade.network;

import com.seunghyeon.harbortrade.HarborTrade;
import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.ComponentSerialization;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;

/** Server → client: open the shipping amount screen for one good and one city. */
public record ShipPromptPayload(Component itemName, String city, int available, long unitPrice) implements CustomPacketPayload {
	public static final Type<ShipPromptPayload> TYPE = new Type<>(HarborTrade.id("ship_prompt"));
	public static final StreamCodec<RegistryFriendlyByteBuf, ShipPromptPayload> CODEC = StreamCodec.composite(
			ComponentSerialization.STREAM_CODEC, ShipPromptPayload::itemName,
			ByteBufCodecs.STRING_UTF8, ShipPromptPayload::city,
			ByteBufCodecs.VAR_INT, ShipPromptPayload::available,
			ByteBufCodecs.VAR_LONG, ShipPromptPayload::unitPrice,
			ShipPromptPayload::new);

	public static void register() {
		PayloadTypeRegistry.playS2C().register(TYPE, CODEC);
	}

	@Override
	public Type<? extends CustomPacketPayload> type() {
		return TYPE;
	}
}
