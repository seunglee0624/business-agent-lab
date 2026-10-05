package com.seunghyeon.harbortrade.client;

import com.seunghyeon.harbortrade.network.NoticePayload;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.fabricmc.fabric.api.client.screen.v1.ScreenEvents;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.inventory.ContainerScreen;

/**
 * Shows trade results without using chat. With a shop screen open the action bar is hidden behind the window,
 * so the latest notice is drawn just above (or below) the window for a few seconds instead.
 */
public final class NoticeOverlay {
	private static final long SHOW_MILLIS = 3000;
	private static final int OK_COLOR = 0x55FF55;
	private static final int FAIL_COLOR = 0xFF5555;

	private static NoticePayload notice;
	private static long shownAt;

	private NoticeOverlay() {
	}

	public static void register() {
		ClientPlayNetworking.registerGlobalReceiver(NoticePayload.TYPE, (payload, context) -> {
			// With nothing open the action bar shows it; keeping it would leak onto the next shop opened.
			if (context.client().screen == null) {
				notice = null;
				context.client().gui.setOverlayMessage(payload.message(), false);
				return;
			}
			notice = payload;
			shownAt = System.currentTimeMillis();
		});
		ScreenEvents.AFTER_INIT.register((client, screen, width, height) -> {
			if (screen instanceof ContainerScreen chest) {
				ScreenEvents.afterRender(screen).register((s, graphics, mouseX, mouseY, delta) -> render(chest, graphics));
				// A notice belongs to the shop it came from, not the next one.
				ScreenEvents.remove(screen).register(s -> notice = null);
			}
		});
	}

	private static void render(ContainerScreen screen, GuiGraphics graphics) {
		if (notice == null || System.currentTimeMillis() - shownAt > SHOW_MILLIS) {
			return;
		}
		var font = Minecraft.getInstance().font;
		// Chest windows are 114 + 18 per row tall and centred; use the gap above, or below if there is none.
		int windowHeight = 114 + screen.getMenu().getRowCount() * 18;
		int top = (screen.height - windowHeight) / 2;
		int y = top >= font.lineHeight + 4 ? top - font.lineHeight - 2 : top + windowHeight + 2;
		graphics.drawCenteredString(font, notice.message(), screen.width / 2, y, notice.ok() ? OK_COLOR : FAIL_COLOR);
	}
}
