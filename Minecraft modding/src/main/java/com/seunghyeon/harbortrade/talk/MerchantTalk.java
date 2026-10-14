package com.seunghyeon.harbortrade.talk;

import com.seunghyeon.harbortrade.HarborTrade;
import com.seunghyeon.harbortrade.round.RoundManager;
import com.seunghyeon.harbortrade.shop.MerchantEntity;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerEntityEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.fabric.api.message.v1.ServerMessageEvents;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.Display;
import net.minecraft.world.entity.EntityType;

/**
 * Merchant small talk: chat near a merchant and the nearest one answers in a speech bubble over its name tag.
 * Only flavour; it never touches prices or trades.
 */
public final class MerchantTalk {
	private static final String THINKING = "...";
	private static final String BUBBLE_TAG = "harbortrade_bubble";
	/** Above the vanilla name tag, so a named merchant shows both. */
	private static final double BUBBLE_HEIGHT = 0.85;
	private static final int MIN_BUBBLE_TICKS = 80;
	private static final int TICKS_PER_CHAR = 3;
	private static final int MAX_REPLY_LENGTH = 90;

	private static final Map<UUID, Long> COOLDOWNS = new HashMap<>();
	private static final Set<UUID> BUSY = new HashSet<>();
	private static final Map<UUID, Bubble> BUBBLES = new HashMap<>();

	private record Bubble(Display.TextDisplay display, long removeAt) {
	}

	private MerchantTalk() {
	}

	public static void register() {
		ServerMessageEvents.CHAT_MESSAGE.register((message, sender, params) -> onChat(sender, message.signedContent()));
		ServerTickEvents.END_SERVER_TICK.register(MerchantTalk::tick);
		// A bubble saved with its chunk (server stopped or chunk unloaded mid-line) is left over; clear it on load.
		ServerEntityEvents.ENTITY_LOAD.register((entity, level) -> {
			if (entity.getTags().contains(BUBBLE_TAG) && BUBBLES.values().stream().noneMatch(b -> b.display() == entity)) {
				entity.discard();
			}
		});
		ServerLifecycleEvents.SERVER_STOPPING.register(server -> {
			BUBBLES.values().forEach(bubble -> bubble.display().discard());
			BUBBLES.clear();
			BUSY.clear();
			COOLDOWNS.clear();
		});
	}

	private static void onChat(ServerPlayer player, String text) {
		if (!TalkConfig.active()) {
			return;
		}
		ServerLevel level = player.serverLevel();
		MerchantEntity merchant = level.getEntitiesOfClass(MerchantEntity.class, player.getBoundingBox().inflate(TalkConfig.radius))
				.stream().filter(m -> m.distanceTo(player) <= TalkConfig.radius)
				.min(Comparator.comparingDouble(m -> m.distanceToSqr(player))).orElse(null);
		if (merchant == null || BUSY.contains(merchant.getUUID())) {
			return;
		}
		long now = System.currentTimeMillis();
		Long last = COOLDOWNS.get(player.getUUID());
		if (last != null && now - last < TalkConfig.cooldownSeconds * 1000L) {
			return;
		}
		COOLDOWNS.put(player.getUUID(), now);
		BUSY.add(merchant.getUUID());

		String said = text.strip();
		if (said.length() > TalkConfig.maxInputLength) {
			said = said.substring(0, TalkConfig.maxInputLength);
		}
		MinecraftServer server = level.getServer();
		show(merchant, THINKING, 600);
		OpenRouterClient.complete(systemPrompt(server, merchant), player.getName().getString() + ": " + said)
				.whenComplete((reply, error) -> server.execute(() -> {
					BUSY.remove(merchant.getUUID());
					if (!merchant.isAlive()) {
						return;
					}
					if (error != null || clean(reply).isEmpty()) {
						HarborTrade.LOGGER.warn("Merchant talk failed", error);
						show(merchant, "흠, 뭐라고 하셨소?", MIN_BUBBLE_TICKS);
						return;
					}
					String line = clean(reply);
					show(merchant, line, Math.max(MIN_BUBBLE_TICKS, line.length() * TICKS_PER_CHAR));
				}));
	}

	private static String systemPrompt(MinecraftServer server, MerchantEntity merchant) {
		String round = RoundManager.isActive(server)
				? "지금 장이 열려 있고, 오늘 무역상이 사들이는 상품은 " + RoundManager.tradeItemName(server).getString() + "이다."
				: "지금은 장이 열리지 않은 한산한 때다.";
		return "너는 중세 지중해 항구 도시의 상인 NPC다. 이름은 '" + merchant.shopName().getString() + "', 직업은 "
				+ merchant.shopType().displayName() + "이다. 성격은 무난하고 친절하다. " + round
				+ " 손님의 말에 한국어로 한두 문장, 60자 이내로 짧게 대답해라. 중세 상인 말투를 쓰고 캐릭터를 벗어나지 마라. "
				+ "가격, 할인, 거래 약속은 절대 하지 말고 이런 질문은 상점 화면을 보라고 넘겨라. 따옴표나 이름표 없이 대사만 출력해라.";
	}

	/** One line of plain text: drops reasoning tags, quotes and line breaks some free models add. */
	private static String clean(String reply) {
		if (reply == null) {
			return "";
		}
		String text = reply.replaceAll("(?s)<think>.*?</think>", "").replace('\n', ' ').replace("§", "").strip();
		text = text.replaceAll("^[\"'“”]+|[\"'“”]+$", "").strip();
		if (text.length() > MAX_REPLY_LENGTH) {
			text = text.substring(0, MAX_REPLY_LENGTH) + "…";
		}
		return text;
	}

	private static void show(MerchantEntity merchant, String text, int ticks) {
		ServerLevel level = (ServerLevel) merchant.level();
		Bubble old = BUBBLES.remove(merchant.getUUID());
		if (old != null) {
			old.display().discard();
		}
		Display.TextDisplay display = EntityType.TEXT_DISPLAY.create(level);
		if (display == null) {
			return;
		}
		CompoundTag tag = display.saveWithoutId(new CompoundTag());
		tag.putString("text", Component.Serializer.toJson(Component.literal(text), level.registryAccess()));
		tag.putString("billboard", "center");
		tag.putInt("line_width", 150);
		tag.putInt("background", 0xA0000000);
		display.load(tag);
		display.setPos(merchant.getX(), merchant.getY() + merchant.getBbHeight() + BUBBLE_HEIGHT, merchant.getZ());
		display.addTag(BUBBLE_TAG);
		level.addFreshEntity(display);
		BUBBLES.put(merchant.getUUID(), new Bubble(display, level.getGameTime() + ticks));
	}

	private static void tick(MinecraftServer server) {
		if (BUBBLES.isEmpty()) {
			return;
		}
		BUBBLES.entrySet().removeIf(entry -> {
			Display.TextDisplay display = entry.getValue().display();
			if (!display.isAlive() || display.level().getGameTime() >= entry.getValue().removeAt()) {
				display.discard();
				return true;
			}
			return false;
		});
	}
}
