package com.seunghyeon.harbortrade;

import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.MutableComponent;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;

/** Server announcements, framed by divider lines so they stand apart from player chat. */
public final class Chat {
	private static final String DIVIDER = "----------------------------------------";

	private static boolean muted;

	private Chat() {
	}

	/** Runs the action without broadcasting its announcements, e.g. events an admin skips past. */
	public static void silently(Runnable action) {
		muted = true;
		try {
			action.run();
		} finally {
			muted = false;
		}
	}

	/** One framed block; each line gets the tag, e.g. "[회차] ". */
	public static Component block(String tag, Component... lines) {
		MutableComponent block = Component.literal(DIVIDER).withStyle(ChatFormatting.DARK_GRAY);
		for (Component line : lines) {
			block.append(Component.literal("\n").withStyle(ChatFormatting.RESET))
					.append(Component.literal("[" + tag + "] ").withStyle(ChatFormatting.GOLD))
					.append(Component.empty().withStyle(ChatFormatting.WHITE).append(line));
		}
		return block.append(Component.literal("\n" + DIVIDER).withStyle(ChatFormatting.DARK_GRAY));
	}

	public static void announce(MinecraftServer server, String tag, Component... lines) {
		if (muted) {
			return;
		}
		server.getPlayerList().broadcastSystemMessage(block(tag, lines), false);
	}

	public static void announce(MinecraftServer server, String tag, String line) {
		announce(server, tag, Component.literal(line));
	}

	public static void send(ServerPlayer player, String tag, Component... lines) {
		if (muted) {
			return;
		}
		player.sendSystemMessage(block(tag, lines));
	}
}
