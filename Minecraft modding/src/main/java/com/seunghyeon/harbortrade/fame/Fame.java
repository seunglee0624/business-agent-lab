package com.seunghyeon.harbortrade.fame;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;
import com.seunghyeon.harbortrade.HarborTrade;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;

/** Fame points bought at the fame shop. The player with the most fame wins the game. */
public final class Fame {
	private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
	/** Placeholder until the economy is balanced. */
	private static final long DEFAULT_PRICE = 1_000_000;

	private static long price = DEFAULT_PRICE;

	public record Rank(UUID player, String name, long fame) {
	}

	private Fame() {
	}

	public static long get(MinecraftServer server, UUID player) {
		FameData.Entry entry = FameData.get(server).entries.get(player);
		return entry == null ? 0 : entry.fame();
	}

	public static void set(MinecraftServer server, ServerPlayer player, long fame) {
		FameData data = FameData.get(server);
		data.entries.put(player.getUUID(), new FameData.Entry(fame, data.nextSequence++, player.getGameProfile().getName()));
		data.setDirty();
	}

	public static void add(MinecraftServer server, ServerPlayer player, long amount) {
		set(server, player, Math.addExact(get(server, player.getUUID()), amount));
	}

	/** Players with fame, highest first; ties go to whoever reached their score first. */
	public static List<Rank> ranking(MinecraftServer server) {
		return FameData.get(server).entries.entrySet().stream()
				.filter(e -> e.getValue().fame() > 0)
				.sorted(Comparator.comparingLong((java.util.Map.Entry<UUID, FameData.Entry> e) -> -e.getValue().fame())
						.thenComparingLong(e -> e.getValue().reachedAt()))
				.map(e -> new Rank(e.getKey(), e.getValue().name(), e.getValue().fame()))
				.toList();
	}

	public static Optional<Rank> leader(MinecraftServer server) {
		return ranking(server).stream().findFirst();
	}

	public static long price() {
		return price;
	}

	private static Path path() {
		return FabricLoader.getInstance().getConfigDir().resolve(HarborTrade.MOD_ID).resolve("fame.json");
	}

	/** Reads config/harbortrade/fame.json, writing the default price on first run. */
	public static void load() throws IOException {
		Path path = path();
		if (Files.notExists(path)) {
			savePrice(DEFAULT_PRICE);
			return;
		}
		price = GSON.fromJson(Files.readString(path, StandardCharsets.UTF_8), JsonObject.class).get("price").getAsLong();
	}

	public static void savePrice(long newPrice) throws IOException {
		JsonObject root = new JsonObject();
		root.addProperty("price", newPrice);
		Files.createDirectories(path().getParent());
		Files.writeString(path(), GSON.toJson(root), StandardCharsets.UTF_8);
		price = newPrice;
	}
}
