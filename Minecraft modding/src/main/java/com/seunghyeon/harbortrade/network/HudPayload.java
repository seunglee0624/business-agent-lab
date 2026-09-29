package com.seunghyeon.harbortrade.network;

import com.seunghyeon.harbortrade.HarborTrade;
import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;
import net.minecraft.network.RegistryFriendlyByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;

/** Server → client: what the top-right HUD shows (round, round clock, bank balance, fame). */
public record HudPayload(int round, boolean active, long elapsedMillis, long roundMillis, long balance, long fame) implements CustomPacketPayload {
	public static final Type<HudPayload> TYPE = new Type<>(HarborTrade.id("hud"));
	public static final StreamCodec<RegistryFriendlyByteBuf, HudPayload> CODEC = StreamCodec.composite(
			ByteBufCodecs.VAR_INT, HudPayload::round,
			ByteBufCodecs.BOOL, HudPayload::active,
			ByteBufCodecs.VAR_LONG, HudPayload::elapsedMillis,
			ByteBufCodecs.VAR_LONG, HudPayload::roundMillis,
			ByteBufCodecs.VAR_LONG, HudPayload::balance,
			ByteBufCodecs.VAR_LONG, HudPayload::fame,
			HudPayload::new);

	public static void register() {
		PayloadTypeRegistry.playS2C().register(TYPE, CODEC);
	}

	@Override
	public Type<? extends CustomPacketPayload> type() {
		return TYPE;
	}
}
