package com.seunghyeon.harbortrade.client;

import static com.seunghyeon.harbortrade.bank.MoneyFormat.format;

import com.seunghyeon.harbortrade.network.ShipAmountPayload;
import com.seunghyeon.harbortrade.network.ShipPromptPayload;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.Button;
import net.minecraft.client.gui.components.EditBox;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.network.chat.Component;
import org.lwjgl.glfw.GLFW;

/** Asks how many of the chosen good to ship to the chosen city. Closing it any other way cancels. */
public class ShipScreen extends Screen {
	private final ShipPromptPayload prompt;
	private EditBox amount;
	private boolean sent;

	public ShipScreen(ShipPromptPayload prompt) {
		super(Component.literal(prompt.city() + "(으)로 선적"));
		this.prompt = prompt;
	}

	public static void register() {
		ClientPlayNetworking.registerGlobalReceiver(ShipPromptPayload.TYPE,
				(payload, context) -> context.client().setScreen(new ShipScreen(payload)));
	}

	@Override
	protected void init() {
		int x = width / 2;
		int y = height / 2;
		amount = new EditBox(font, x - 50, y - 10, 100, 20, Component.literal("수량"));
		amount.setMaxLength(7);
		amount.setFilter(text -> text.chars().allMatch(Character::isDigit));
		addRenderableWidget(amount);
		addRenderableWidget(Button.builder(Component.literal("최대"), b -> amount.setValue(String.valueOf(prompt.available())))
				.bounds(x + 54, y - 10, 40, 20).build());
		addRenderableWidget(Button.builder(Component.literal("선적"), b -> submit()).bounds(x - 82, y + 20, 80, 20).build());
		addRenderableWidget(Button.builder(Component.literal("취소"), b -> onClose()).bounds(x + 2, y + 20, 80, 20).build());
		setInitialFocus(amount);
	}

	private int count() {
		try {
			return amount.getValue().isEmpty() ? 0 : Integer.parseInt(amount.getValue());
		} catch (NumberFormatException e) {
			return 0;
		}
	}

	private void submit() {
		int count = count();
		if (count <= 0 || count > prompt.available()) {
			return;
		}
		send(count);
		super.onClose();
	}

	private void send(int count) {
		if (!sent) {
			sent = true;
			ClientPlayNetworking.send(new ShipAmountPayload(count));
		}
	}

	@Override
	public void onClose() {
		send(0);
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
		graphics.drawCenteredString(font, Component.empty().append(prompt.itemName())
				.append(" · 기준가 " + format(prompt.unitPrice()) + " · 보유 " + prompt.available() + "개"), x, y - 46, 0xAAAAAA);
		int count = count();
		String total = count > prompt.available()
				? "보유 수량보다 많습니다."
				: "기준가 합계: " + format(prompt.unitPrice() * count);
		graphics.drawCenteredString(font, total, x, y - 30, count > prompt.available() ? 0xFF5555 : 0xFFAA00);
	}

	@Override
	public boolean isPauseScreen() {
		return false;
	}
}
