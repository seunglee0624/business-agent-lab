package com.seunghyeon.harbortrade.network;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import net.fabricmc.fabric.api.networking.v1.ServerPlayNetworking;
import net.minecraft.server.level.ServerPlayer;

/** Asks a player for a number on the client's input screen and runs the callback with the answer. */
public final class AmountPrompt {
	/** Receives the typed value, or {@link AmountPayload#CANCEL}. */
	public interface Callback {
		void accept(ServerPlayer player, long value);
	}

	private record Pending(AmountPromptPayload prompt, Callback callback) {
	}

	private static final Map<UUID, Pending> PENDING = new HashMap<>();

	private AmountPrompt() {
	}

	public static void register() {
		AmountPromptPayload.register();
		AmountPayload.register();
		ServerPlayNetworking.registerGlobalReceiver(AmountPayload.TYPE, (payload, context) -> answer(context.player(), payload.value()));
		ServerPlayConnectionEvents.DISCONNECT.register((handler, server) -> PENDING.remove(handler.getPlayer().getUUID()));
	}

	/** Closes any open container and shows the input screen. */
	public static void open(ServerPlayer player, AmountPromptPayload prompt, Callback callback) {
		PENDING.put(player.getUUID(), new Pending(prompt, callback));
		player.closeContainer();
		ServerPlayNetworking.send(player, prompt);
	}

	private static void answer(ServerPlayer player, long value) {
		Pending pending = PENDING.remove(player.getUUID());
		if (pending == null) {
			return;
		}
		// Never trust the client to have applied the limits.
		AmountPromptPayload prompt = pending.prompt();
		boolean valid = value > 0 || (value == 0 && prompt.allowZero());
		if (!valid || (prompt.max() > 0 && value > prompt.max())) {
			value = AmountPayload.CANCEL;
		}
		pending.callback().accept(player, value);
	}
}
