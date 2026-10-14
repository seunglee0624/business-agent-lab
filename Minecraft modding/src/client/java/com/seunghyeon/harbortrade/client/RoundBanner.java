package com.seunghyeon.harbortrade.client;

import com.mojang.blaze3d.systems.RenderSystem;
import com.seunghyeon.harbortrade.HarborTrade;
import com.seunghyeon.harbortrade.network.BannerPayload;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.fabricmc.fabric.api.client.rendering.v1.HudRenderCallback;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.util.Mth;

/** The round start banner: fades in at the centre of the screen, holds, then fades out. */
public final class RoundBanner {
	private static final ResourceLocation TEXTURE = HarborTrade.id("textures/gui/round_start.png");
	private static final int TEXTURE_WIDTH = 764;
	private static final int TEXTURE_HEIGHT = 147;
	/** Share of the screen width the banner takes. */
	private static final float WIDTH_SHARE = 0.26f;
	private static final long FADE_IN = 500;
	private static final long HOLD = 2500;
	private static final long FADE_OUT = 1000;

	private static long shownAt = -1;

	private RoundBanner() {
	}

	public static void register() {
		ClientPlayNetworking.registerGlobalReceiver(BannerPayload.TYPE, (payload, context) -> shownAt = System.currentTimeMillis());
		HudRenderCallback.EVENT.register((graphics, tickCounter) -> render(graphics));
	}

	private static void render(GuiGraphics graphics) {
		if (shownAt < 0) {
			return;
		}
		long age = System.currentTimeMillis() - shownAt;
		if (age >= FADE_IN + HOLD + FADE_OUT) {
			shownAt = -1;
			return;
		}
		float alpha = age < FADE_IN ? (float) age / FADE_IN
				: age < FADE_IN + HOLD ? 1 : 1 - (float) (age - FADE_IN - HOLD) / FADE_OUT;

		int width = Math.round(graphics.guiWidth() * WIDTH_SHARE);
		int height = Math.round(width * (float) TEXTURE_HEIGHT / TEXTURE_WIDTH);
		int x = (graphics.guiWidth() - width) / 2;
		int y = (graphics.guiHeight() - height) / 2;

		RenderSystem.enableBlend();
		RenderSystem.setShaderColor(1, 1, 1, Mth.clamp(alpha, 0, 1));
		graphics.blit(TEXTURE, x, y, width, height, 0, 0, TEXTURE_WIDTH, TEXTURE_HEIGHT, TEXTURE_WIDTH, TEXTURE_HEIGHT);
		RenderSystem.setShaderColor(1, 1, 1, 1);
		RenderSystem.disableBlend();
	}
}
