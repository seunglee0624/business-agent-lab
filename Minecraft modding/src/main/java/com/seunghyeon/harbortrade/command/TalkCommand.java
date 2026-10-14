package com.seunghyeon.harbortrade.command;

import com.mojang.brigadier.CommandDispatcher;
import com.seunghyeon.harbortrade.HarborTrade;
import com.seunghyeon.harbortrade.talk.TalkConfig;
import java.io.IOException;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;

/** /대화 (admin only): switch merchant small talk on or off, reload talk.json, or check its state. */
public final class TalkCommand {
	private TalkCommand() {
	}

	public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
		dispatcher.register(Commands.literal("대화")
				.requires(source -> source.hasPermission(2))
				.then(Commands.literal("켜기").executes(ctx -> setEnabled(ctx.getSource(), true)))
				.then(Commands.literal("끄기").executes(ctx -> setEnabled(ctx.getSource(), false)))
				.then(Commands.literal("다시읽기").executes(ctx -> reload(ctx.getSource())))
				.then(Commands.literal("상태").executes(ctx -> status(ctx.getSource()))));
	}

	private static int setEnabled(CommandSourceStack source, boolean enabled) {
		try {
			TalkConfig.setEnabled(enabled);
		} catch (IOException e) {
			HarborTrade.LOGGER.error("Failed to save talk.json", e);
			source.sendFailure(Component.literal("talk.json을 저장하지 못했습니다: " + e.getMessage()));
			return 0;
		}
		return status(source);
	}

	private static int reload(CommandSourceStack source) {
		try {
			TalkConfig.load();
		} catch (IOException | RuntimeException e) {
			source.sendFailure(Component.literal("talk.json을 읽지 못했습니다: " + e.getMessage()));
			return 0;
		}
		return status(source);
	}

	private static int status(CommandSourceStack source) {
		String state = TalkConfig.active() ? "켜짐" : TalkConfig.hasKey() ? "꺼짐" : "꺼짐 (API 키 없음)";
		source.sendSuccess(() -> Component.literal("상인 대화: " + state + " · 모델 " + TalkConfig.model()), false);
		return 1;
	}
}
