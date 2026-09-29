package com.seunghyeon.harbortrade.client;

import static com.seunghyeon.harbortrade.bank.MoneyFormat.format;

import com.seunghyeon.harbortrade.network.HudPayload;
import com.seunghyeon.harbortrade.round.RoundManager;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;

/** Top-right HUD: round number, round clock, and bank balance, as last sent by the server. */
public final class RoundHud {
	private static final int MARGIN = 4;
	private static final int PADDING = 3;
	private static final int BACKGROUND = 0x80000000;
	private static final int WHITE = 0xFFFFFF;
	private static final int GOLD = 0xFFD700;

	private static HudPayload state;

	private RoundHud() {
	}

	public static void register() {
		ClientPlayNetworking.registerGlobalReceiver(HudPayload.TYPE, (payload, context) -> state = payload);
		ClientPlayConnectionEvents.DISCONNECT.register((handler, client) -> state = null);
		HudRenderCallback.EVENT.register(RoundHud::render);
	}

	private static void render(GuiGraphics graphics, DeltaTracker deltaTracker) {
		Minecraft client = Minecraft.getInstance();
		if (state == null || client.options.hideGui) {
			return;
		}

		String round = state.round() == 0 ? "회차 대기" : state.round() + "회차" + (state.active() ? "" : " 종료");
		String time = state.active()
				? RoundManager.formatTime(state.elapsedMillis()) + " / " + RoundManager.formatTime(state.roundMillis())
				: "-";
		String money = format(state.balance());
		String[] lines = {round, time, money};
		int[] colors = {WHITE, WHITE, GOLD};

		Font font = client.font;
		int width = 0;
		for (String line : lines) {
			width = Math.max(width, font.width(line));
		}
		int lineHeight = font.lineHeight + 1;
		int right = graphics.guiWidth() - MARGIN;
		int top = MARGIN;
		graphics.fill(right - width - PADDING * 2, top, right, top + lines.length * lineHeight + PADDING * 2, BACKGROUND);
		for (int i = 0; i < lines.length; i++) {
			int x = right - PADDING - font.width(lines[i]);
			graphics.drawString(font, lines[i], x, top + PADDING + i * lineHeight, colors[i]);
		}
	}
}
