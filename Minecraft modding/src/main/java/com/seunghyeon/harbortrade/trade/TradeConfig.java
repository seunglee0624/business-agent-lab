package com.seunghyeon.harbortrade.trade;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.seunghyeon.harbortrade.HarborTrade;
import com.seunghyeon.harbortrade.shop.Offer;
import java.io.IOException;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.Item;

/**
 * Loads the trade goods from config/harbortrade/trade.json, writing the defaults on first run:
 * [{"item": "minecraft:wheat", "price": 750}, ...]. Each round one of them is drawn as today's trade good.
 * Price is the base value of one item before the city's return rate; it should be higher than the shop price.
 * A file in the old category format is moved to trade.old.json and replaced with the defaults.
 */
public final class TradeConfig {
	private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
	private static final List<Offer> ITEMS = new ArrayList<>();

	private TradeConfig() {
	}

	public static Path path() {
		return FabricLoader.getInstance().getConfigDir().resolve(HarborTrade.MOD_ID).resolve("trade.json");
	}

	public static List<Offer> items() {
		return List.copyOf(ITEMS);
	}

	public static Optional<Offer> find(Item item) {
		return ITEMS.stream().filter(offer -> offer.item() == item).findFirst();
	}

	/** Finds a good by its registry id, as saved in the round data. */
	public static Optional<Offer> find(String itemId) {
		ResourceLocation id = ResourceLocation.tryParse(itemId);
		return id == null ? Optional.empty() : BuiltInRegistries.ITEM.getOptional(id).flatMap(TradeConfig::find);
	}

	public static String id(Item item) {
		return BuiltInRegistries.ITEM.getKey(item).toString();
	}

	/** Reads the config file; returns the number of goods loaded. */
	public static int load() throws IOException {
		Path path = path();
		if (Files.notExists(path)) {
			Files.createDirectories(path.getParent());
			Files.writeString(path, GSON.toJson(defaults()), StandardCharsets.UTF_8);
		}

		JsonElement root = read(path);
		if (!root.isJsonArray()) {
			Files.move(path, path.resolveSibling("trade.old.json"), StandardCopyOption.REPLACE_EXISTING);
			Files.writeString(path, GSON.toJson(defaults()), StandardCharsets.UTF_8);
			HarborTrade.LOGGER.warn("trade.json was in the old category format; moved it to trade.old.json and wrote new defaults");
			root = read(path);
		}

		List<Offer> loaded = new ArrayList<>();
		for (JsonElement element : root.getAsJsonArray()) {
			JsonObject entry = element.getAsJsonObject();
			String itemId = entry.get("item").getAsString();
			Item item = BuiltInRegistries.ITEM.getOptional(ResourceLocation.parse(itemId)).orElse(null);
			if (item == null) {
				HarborTrade.LOGGER.warn("trade.json: unknown item {}", itemId);
				continue;
			}
			loaded.add(Offer.fixed(item, entry.get("price").getAsLong()));
		}

		ITEMS.clear();
		ITEMS.addAll(loaded);
		return ITEMS.size();
	}

	private static JsonElement read(Path path) throws IOException {
		try (Reader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
			return GSON.fromJson(reader, JsonElement.class);
		}
	}

	/** Placeholder goods at 1.5x the regular shop price until the economy is balanced. */
	private static JsonArray defaults() {
		Object[] itemsAndPrices = {
				"minecraft:wheat", 750,
				"minecraft:potato", 600,
				"minecraft:carrot", 600,
				"minecraft:apple", 1_125,
				"minecraft:bread", 2_250,
				"minecraft:cooked_beef", 3_750,
				"minecraft:cod", 1_125,
				"minecraft:salmon", 1_875,
				"minecraft:coal", 1_500,
				"minecraft:copper_ingot", 2_250,
				"minecraft:iron_ingot", 7_500,
				"minecraft:gold_ingot", 22_500};
		JsonArray array = new JsonArray();
		for (int i = 0; i < itemsAndPrices.length; i += 2) {
			JsonObject entry = new JsonObject();
			entry.addProperty("item", (String) itemsAndPrices[i]);
			entry.addProperty("price", (Integer) itemsAndPrices[i + 1]);
			array.add(entry);
		}
		return array;
	}
}
