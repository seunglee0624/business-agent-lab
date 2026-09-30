package com.seunghyeon.harbortrade.network;

import com.seunghyeon.harbortrade.HarborTrade;
import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;

/**
 * Client → server: the amount typed into the shipping screen; 0 means cancelled. The good and city are kept on
 * the server, so the client only sends a number.
 */
public record ShipAmountPayload(int count) implements CustomPacketPayload {
	public static final Type<ShipAmountPayload> TYPE = new Type<>(HarborTrade.id("ship_amount"));
	public static final StreamCodec<RegistryFriendlyByteBuf, ShipAmountPayload> CODEC = StreamCodec.composite(
			ByteBufCodecs.VAR_INT, ShipAmountPayload::count,
			ShipAmountPayload::new);

	public static void register() {
		PayloadTypeRegistry.playC2S().register(TYPE, CODEC);
	}

	@Override
	public Type<? extends CustomPacketPayload> type() {
		return TYPE;
	}
}
