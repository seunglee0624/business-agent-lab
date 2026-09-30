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
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.Item;

/**
 * Loads trade categories from config/harbortrade/trade.json, writing the defaults on first run:
 * {"곡물": [{"item": "minecraft:wheat", "price": 750}], ...}. Price is the base value of one item before the
 * city's return rate; it should be higher than the regular shop price.
 */
public final class TradeConfig {
	private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
	private static final Map<String, List<Offer>> CATEGORIES = new LinkedHashMap<>();
	/** One row of the trader screen holds the cities; five rows are left for goods. */
	public static final int MAX_ITEMS = 45;

	private TradeConfig() {
	}

	public static Path path() {
		return FabricLoader.getInstance().getConfigDir().resolve(HarborTrade.MOD_ID).resolve("trade.json");
	}

	public static List<String> categories() {
		return List.copyOf(CATEGORIES.keySet());
	}

	public static List<Offer> items(String category) {
		return CATEGORIES.getOrDefault(category, List.of());
	}

	/** Reads the config file; returns the number of categories loaded. */
	public static int load() throws IOException {
		Path path = path();
		if (Files.notExists(path)) {
			Files.createDirectories(path.getParent());
			Files.writeString(path, GSON.toJson(defaults()), StandardCharsets.UTF_8);
		}

		JsonObject root;
		try (Reader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
			root = GSON.fromJson(reader, JsonObject.class);
		}
		Map<String, List<Offer>> loaded = new LinkedHashMap<>();
		for (String category : root.keySet()) {
			List<Offer> offers = new ArrayList<>();
			for (JsonElement element : root.getAsJsonArray(category)) {
				JsonObject entry = element.getAsJsonObject();
				String itemId = entry.get("item").getAsString();
				Item item = BuiltInRegistries.ITEM.getOptional(ResourceLocation.parse(itemId)).orElse(null);
				if (item == null) {
					HarborTrade.LOGGER.warn("trade.json: unknown item {} in {}", itemId, category);
					continue;
				}
				if (offers.size() >= MAX_ITEMS) {
					HarborTrade.LOGGER.warn("trade.json: {} has more than {} items; the rest are ignored", category, MAX_ITEMS);
					break;
				}
				offers.add(Offer.fixed(item, entry.get("price").getAsLong()));
			}
			loaded.put(category, offers);
		}

		CATEGORIES.clear();
		CATEGORIES.putAll(loaded);
		return CATEGORIES.size();
	}

	/** Adds an empty category and saves; returns false if it already exists. */
	public static boolean addCategory(String category) throws IOException {
		if (CATEGORIES.containsKey(category)) {
			return false;
		}
		CATEGORIES.put(category, new ArrayList<>());
		save();
		return true;
	}

	/** Removes a category and its goods and saves; returns false if there was no such category. */
	public static boolean removeCategory(String category) throws IOException {
		if (CATEGORIES.remove(category) == null) {
			return false;
		}
		save();
		return true;
	}

	/**
	 * Adds a good to an existing category, or changes its base price, and saves.
	 * Returns the previous price, or -1 if the good is new.
	 */
	public static long put(String category, Item item, long price) throws IOException {
		List<Offer> offers = CATEGORIES.get(category);
		long previous = -1;
		for (int i = 0; i < offers.size(); i++) {
			if (offers.get(i).item() == item) {
				previous = offers.get(i).price();
				offers.set(i, Offer.fixed(item, price));
			}
		}
		if (previous == -1) {
			offers.add(Offer.fixed(item, price));
		}
		save();
		return previous;
	}

	/** Removes a good from a category and saves; returns false if the category did not have it. */
	public static boolean remove(String category, Item item) throws IOException {
		List<Offer> offers = CATEGORIES.get(category);
		if (offers == null || !offers.removeIf(offer -> offer.item() == item)) {
			return false;
		}
		save();
		return true;
	}

	private static void save() throws IOException {
		JsonObject root = new JsonObject();
		CATEGORIES.forEach((category, offers) -> {
			JsonArray array = new JsonArray();
			for (Offer offer : offers) {
				JsonObject entry = new JsonObject();
				entry.addProperty("item", BuiltInRegistries.ITEM.getKey(offer.item()).toString());
				entry.addProperty("price", offer.price());
				array.add(entry);
			}
			root.add(category, array);
		});
		Files.createDirectories(path().getParent());
		Files.writeString(path(), GSON.toJson(root), StandardCharsets.UTF_8);
	}

	/** Placeholder categories at 1.5x the regular shop price until the economy is balanced. */
	private static JsonObject defaults() {
		JsonObject root = new JsonObject();
		root.add("곡물", entries(
				"minecraft:wheat", 750,
				"minecraft:potato", 600,
				"minecraft:carrot", 600,
				"minecraft:beetroot", 600,
				"minecraft:apple", 1_125));
		root.add("수산물", entries(
				"minecraft:cod", 1_125,
				"minecraft:salmon", 1_875,
				"minecraft:pufferfish", 4_500,
				"minecraft:tropical_fish", 6_000,
				"minecraft:nautilus_shell", 37_500));
		root.add("광물", entries(
				"minecraft:coal", 1_500,
				"minecraft:copper_ingot", 2_250,
				"minecraft:iron_ingot", 7_500,
				"minecraft:gold_ingot", 22_500));
		root.add("가공식품", entries(
				"minecraft:bread", 2_250,
				"minecraft:cooked_beef", 3_750,
				"minecraft:cooked_cod", 2_250,
				"minecraft:cooked_salmon", 3_375,
				"minecraft:cake", 15_000));
		root.add("철제품", entries(
				"minecraft:iron_pickaxe", 30_000,
				"minecraft:iron_axe", 30_000,
				"minecraft:iron_sword", 22_500,
				"minecraft:shield", 15_000,
				"minecraft:iron_helmet", 45_000,
				"minecraft:iron_chestplate", 75_000,
				"minecraft:iron_leggings", 67_500,
				"minecraft:iron_boots", 37_500));
		return root;
	}

	private static JsonArray entries(Object... itemsAndPrices) {
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
