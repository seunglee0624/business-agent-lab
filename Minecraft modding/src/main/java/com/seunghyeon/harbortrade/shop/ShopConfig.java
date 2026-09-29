package com.seunghyeon.harbortrade.shop;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.seunghyeon.harbortrade.HarborTrade;
import com.seunghyeon.harbortrade.gem.Gem;
import java.io.IOException;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.Item;

/**
 * Loads shop item lists from config/harbortrade/shops.json, writing the defaults on first run.
 * Each entry is {"item": "minecraft:bread", "price": 1500}: shops only buy from players, and price is what
 * the player receives for one. A file in the old buy/sell format ("mode" entries) is moved to shops.old.json
 * and replaced with the defaults.
 */
public final class ShopConfig {
	private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
	private static final Map<ShopType, List<Offer>> OFFERS = new EnumMap<>(ShopType.class);
	/** A shop screen shows at most six rows of nine. */
	public static final int MAX_OFFERS = 54;

	private ShopConfig() {
	}

	public static Path path() {
		return FabricLoader.getInstance().getConfigDir().resolve(HarborTrade.MOD_ID).resolve("shops.json");
	}

	public static List<Offer> offers(ShopType type) {
		if (type == ShopType.JEWELER) {
			List<Offer> gems = new ArrayList<>();
			for (Gem gem : Gem.values()) {
				gems.add(Offer.gem(gem));
			}
			return gems;
		}
		return OFFERS.getOrDefault(type, List.of());
	}

	/** Reads the config file; returns the number of offers loaded. Keeps the previous lists if the file is broken. */
	public static int load() throws IOException {
		Path path = path();
		if (Files.notExists(path)) {
			Files.createDirectories(path.getParent());
			Files.writeString(path, GSON.toJson(defaults()), StandardCharsets.UTF_8);
		}

		JsonObject root = read(path);
		if (isOldFormat(root)) {
			Files.move(path, path.resolveSibling("shops.old.json"), StandardCopyOption.REPLACE_EXISTING);
			Files.writeString(path, GSON.toJson(defaults()), StandardCharsets.UTF_8);
			HarborTrade.LOGGER.warn("shops.json was in the old buy/sell format; moved it to shops.old.json and wrote new defaults");
			root = read(path);
		}

		Map<ShopType, List<Offer>> loaded = new EnumMap<>(ShopType.class);
		int count = 0;
		for (ShopType type : ShopType.values()) {
			if (type == ShopType.JEWELER || !root.has(type.id())) {
				continue;
			}
			List<Offer> offers = new ArrayList<>();
			for (JsonElement element : root.getAsJsonArray(type.id())) {
				JsonObject entry = element.getAsJsonObject();
				String itemId = entry.get("item").getAsString();
				Item item = BuiltInRegistries.ITEM.getOptional(ResourceLocation.parse(itemId)).orElse(null);
				if (item == null) {
					HarborTrade.LOGGER.warn("shops.json: unknown item {} in {}", itemId, type.id());
					continue;
				}
				offers.add(Offer.fixed(item, entry.get("price").getAsLong()));
			}
			loaded.put(type, offers);
			count += offers.size();
		}

		OFFERS.clear();
		OFFERS.putAll(loaded);
		return count;
	}

	/**
	 * Adds the item to a regular shop, or changes its price if it is already there, and saves the file.
	 * Returns the previous price, or -1 if the item is new.
	 */
	public static long put(ShopType type, Item item, long price) throws IOException {
		List<Offer> offers = OFFERS.computeIfAbsent(type, t -> new ArrayList<>());
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

	/** Removes the item from a regular shop and saves the file; returns false if the shop did not have it. */
	public static boolean remove(ShopType type, Item item) throws IOException {
		List<Offer> offers = OFFERS.get(type);
		if (offers == null || !offers.removeIf(offer -> offer.item() == item)) {
			return false;
		}
		save();
		return true;
	}

	/** Writes the current regular-shop lists back to shops.json. */
	private static void save() throws IOException {
		JsonObject root = new JsonObject();
		for (ShopType type : ShopType.values()) {
			if (type == ShopType.JEWELER) {
				continue;
			}
			JsonArray array = new JsonArray();
			for (Offer offer : OFFERS.getOrDefault(type, List.of())) {
				JsonObject entry = new JsonObject();
				entry.addProperty("item", BuiltInRegistries.ITEM.getKey(offer.item()).toString());
				entry.addProperty("price", offer.price());
				array.add(entry);
			}
			root.add(type.id(), array);
		}
		Files.createDirectories(path().getParent());
		Files.writeString(path(), GSON.toJson(root), StandardCharsets.UTF_8);
	}

	private static JsonObject read(Path path) throws IOException {
		try (Reader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
			return GSON.fromJson(reader, JsonObject.class);
		}
	}

	private static boolean isOldFormat(JsonObject root) {
		for (String key : root.keySet()) {
			for (JsonElement element : root.getAsJsonArray(key)) {
				if (element.getAsJsonObject().has("mode")) {
					return true;
				}
			}
		}
		return false;
	}

	/** Placeholder sell prices until the economy is balanced. */
	private static JsonObject defaults() {
		JsonObject root = new JsonObject();
		root.add(ShopType.GROCER.id(), entries(
				"minecraft:bread", 1_500,
				"minecraft:wheat", 500,
				"minecraft:wheat_seeds", 150,
				"minecraft:potato", 400,
				"minecraft:carrot", 400,
				"minecraft:beetroot", 400,
				"minecraft:apple", 750,
				"minecraft:cooked_beef", 2_500,
				"minecraft:cake", 10_000));
		root.add(ShopType.BLACKSMITH.id(), entries(
				"minecraft:coal", 1_000,
				"minecraft:copper_ingot", 1_500,
				"minecraft:iron_ingot", 5_000,
				"minecraft:gold_ingot", 15_000,
				"minecraft:iron_pickaxe", 20_000,
				"minecraft:iron_axe", 20_000,
				"minecraft:iron_sword", 15_000,
				"minecraft:shield", 10_000,
				"minecraft:iron_helmet", 30_000,
				"minecraft:iron_chestplate", 50_000,
				"minecraft:iron_leggings", 45_000,
				"minecraft:iron_boots", 25_000));
		root.add(ShopType.FISHER.id(), entries(
				"minecraft:fishing_rod", 7_500,
				"minecraft:oak_boat", 5_000,
				"minecraft:cod", 750,
				"minecraft:salmon", 1_250,
				"minecraft:pufferfish", 3_000,
				"minecraft:tropical_fish", 4_000,
				"minecraft:cooked_cod", 1_500,
				"minecraft:cooked_salmon", 2_250,
				"minecraft:nautilus_shell", 25_000));
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
