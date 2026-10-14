package com.seunghyeon.harbortrade.client;

import com.seunghyeon.harbortrade.network.TextPayload;
import com.seunghyeon.harbortrade.network.TextPromptPayload;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
import org.lwjgl.glfw.GLFW;

/** Text input screen opened by the server (shop names). Closing it any other way cancels. */
public class TextScreen extends Screen {
	private final TextPromptPayload prompt;
	private EditBox text;
	private boolean sent;

	public TextScreen(TextPromptPayload prompt) {
		super(prompt.title());
		this.prompt = prompt;
	}

	public static void register() {
		ClientPlayNetworking.registerGlobalReceiver(TextPromptPayload.TYPE,
				(payload, context) -> context.client().setScreen(new TextScreen(payload)));
	}

	@Override
	protected void init() {
		int x = width / 2;
		int y = height / 2;
		text = new EditBox(font, x - 80, y - 10, 160, 20, Component.literal("이름"));
		text.setMaxLength(prompt.maxLength());
		text.setValue(prompt.current());
		addRenderableWidget(text);
		addRenderableWidget(Button.builder(Component.literal("확인"), b -> submit()).bounds(x - 82, y + 20, 80, 20).build());
		addRenderableWidget(Button.builder(Component.literal("취소"), b -> onClose()).bounds(x + 2, y + 20, 80, 20).build());
		setInitialFocus(text);
	}

	private void submit() {
		if (text.getValue().isBlank()) {
			return;
		}
		send(text.getValue(), false);
		super.onClose();
	}

	private void send(String value, boolean cancelled) {
		if (!sent) {
			sent = true;
			ClientPlayNetworking.send(new TextPayload(value, cancelled));
		}
	}

	@Override
	public void onClose() {
		send("", true);
		super.onClose();
	}

	@Override
	public boolean keyPressed(int keyCode, int scanCode, int modifiers) {
		if (keyCode == GLFW.GLFW_KEY_ENTER || keyCode == GLFW.GLFW_KEY_KP_ENTER) {
			submit();
			return true;
		}
		return super.keyPressed(keyCode, scanCode, modifiers);
	}

	@Override
	public void render(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
		super.render(graphics, mouseX, mouseY, partialTick);
		graphics.drawCenteredString(font, title, width / 2, height / 2 - 46, 0xFFFFFF);
		graphics.drawCenteredString(font, "최대 " + prompt.maxLength() + "자", width / 2, height / 2 - 30, 0xAAAAAA);
	}

	@Override
	public boolean isPauseScreen() {
		return false;
	}
}
