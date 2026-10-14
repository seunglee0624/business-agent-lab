package com.seunghyeon.harbortrade.network;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import net.fabricmc.fabric.api.networking.v1.ServerPlayNetworking;
import net.minecraft.server.level.ServerPlayer;

/** Asks a player for a line of text on the client's input screen and runs the callback with the answer. */
public final class TextPrompt {
	/** Receives the trimmed text, or null if the player cancelled or sent something invalid. */
	public interface Callback {
		void accept(ServerPlayer player, String value);
	}

	private record Pending(TextPromptPayload prompt, Callback callback) {
	}

	private static final Map<UUID, Pending> PENDING = new HashMap<>();

	private TextPrompt() {
	}

	public static void register() {
		TextPromptPayload.register();
		TextPayload.register();
		ServerPlayNetworking.registerGlobalReceiver(TextPayload.TYPE, (payload, context) -> answer(context.player(), payload));
		ServerPlayConnectionEvents.DISCONNECT.register((handler, server) -> PENDING.remove(handler.getPlayer().getUUID()));
	}

	/** Closes any open container and shows the input screen. */
	public static void open(ServerPlayer player, TextPromptPayload prompt, Callback callback) {
		PENDING.put(player.getUUID(), new Pending(prompt, callback));
		player.closeContainer();
		ServerPlayNetworking.send(player, prompt);
	}

	private static void answer(ServerPlayer player, TextPayload payload) {
		Pending pending = PENDING.remove(player.getUUID());
		if (pending == null) {
			return;
		}
		// Never trust the client to have applied the limits.
		String value = payload.value().strip();
		boolean valid = !payload.cancelled() && !value.isEmpty() && value.length() <= pending.prompt().maxLength()
				&& value.chars().noneMatch(c -> c == '§' || Character.isISOControl(c));
		pending.callback().accept(player, valid ? value : null);
	}
}
