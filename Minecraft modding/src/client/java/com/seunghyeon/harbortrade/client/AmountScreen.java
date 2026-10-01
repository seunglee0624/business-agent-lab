package com.seunghyeon.harbortrade.client;

import static com.seunghyeon.harbortrade.bank.MoneyFormat.format;

import com.seunghyeon.harbortrade.network.AmountPayload;
import com.seunghyeon.harbortrade.network.AmountPromptPayload;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
import org.lwjgl.glfw.GLFW;

/** Number input screen opened by the server (shipping amounts, shop prices). Closing it any other way cancels. */
public class AmountScreen extends Screen {
	private static final int MAX_DIGITS = 13;

	private final AmountPromptPayload prompt;
	private EditBox amount;
	private boolean sent;

	public AmountScreen(AmountPromptPayload prompt) {
		super(prompt.title());
		this.prompt = prompt;
	}

	public static void register() {
		ClientPlayNetworking.registerGlobalReceiver(AmountPromptPayload.TYPE,
				(payload, context) -> context.client().setScreen(new AmountScreen(payload)));
	}

	@Override
	protected void init() {
		int x = width / 2;
		int y = height / 2;
		boolean hasMax = prompt.max() > 0;
		amount = new EditBox(font, x - 50, y - 10, 100, 20, Component.literal("수량"));
		amount.setMaxLength(hasMax ? String.valueOf(prompt.max()).length() : MAX_DIGITS);
		amount.setFilter(text -> text.chars().allMatch(Character::isDigit));
		addRenderableWidget(amount);
		if (hasMax) {
			addRenderableWidget(Button.builder(Component.literal("최대"), b -> amount.setValue(String.valueOf(prompt.max())))
					.bounds(x + 54, y - 10, 40, 20).build());
		}
		addRenderableWidget(Button.builder(Component.literal("확인"), b -> submit()).bounds(x - 82, y + 20, 80, 20).build());
		addRenderableWidget(Button.builder(Component.literal("취소"), b -> onClose()).bounds(x + 2, y + 20, 80, 20).build());
		setInitialFocus(amount);
	}

	/** The typed number, or -1 if the box is empty. */
	private long value() {
		try {
			return amount.getValue().isEmpty() ? -1 : Long.parseLong(amount.getValue());
		} catch (NumberFormatException e) {
			return -1;
		}
	}

	private boolean tooMany(long value) {
		return prompt.max() > 0 && value > prompt.max();
	}

	private void submit() {
		long value = value();
		if (value < 0 || (value == 0 && !prompt.allowZero()) || tooMany(value)) {
			return;
		}
		send(value);
		super.onClose();
	}

	private void send(long value) {
		if (!sent) {
			sent = true;
			ClientPlayNetworking.send(new AmountPayload(value));
		}
	}

	@Override
	public void onClose() {
		send(AmountPayload.CANCEL);
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
		int x = width / 2;
		int y = height / 2;
		graphics.drawCenteredString(font, title, x, y - 62, 0xFFFFFF);
		graphics.drawCenteredString(font, prompt.info(), x, y - 46, 0xAAAAAA);
		long value = Math.max(value(), 0);
		if (tooMany(value)) {
			graphics.drawCenteredString(font, "보유 수량보다 많습니다.", x, y - 30, 0xFF5555);
		} else if (prompt.unitPrice() > 0) {
			graphics.drawCenteredString(font, "합계: " + format(prompt.unitPrice() * value), x, y - 30, 0xFFAA00);
		}
	}

	@Override
	public boolean isPauseScreen() {
		return false;
	}
}
