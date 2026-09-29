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
 * Each entry is {"item": "minecraft:bread", "price": 3000, "mode": "both" | "buy" | "sell"} where mode says
 * whether players can buy it, sell it, or both (the default).
 */
public final class ShopConfig {
	private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
	private static final Map<ShopType, List<Offer>> OFFERS = new EnumMap<>(ShopType.class);

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

		JsonObject root;
		try (Reader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
			root = GSON.fromJson(reader, JsonObject.class);
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
				String mode = entry.has("mode") ? entry.get("mode").getAsString() : "both";
				offers.add(Offer.fixed(item, entry.get("price").getAsLong(), !mode.equals("sell"), !mode.equals("buy")));
			}
			loaded.put(type, offers);
			count += offers.size();
		}

		OFFERS.clear();
		OFFERS.putAll(loaded);
		return count;
	}

	private static JsonObject defaults() {
		JsonObject root = new JsonObject();
		root.add(ShopType.GROCER.id(), entries(
				"minecraft:bread", 3_000,
				"minecraft:wheat", 1_000,
				"minecraft:wheat_seeds", 300,
				"minecraft:potato", 800,
				"minecraft:carrot", 800,
				"minecraft:beetroot", 800,
				"minecraft:apple", 1_500,
				"minecraft:cooked_beef", 5_000,
				"minecraft:cake", 20_000));
		root.add(ShopType.BLACKSMITH.id(), entries(
				"minecraft:coal", 2_000,
				"minecraft:copper_ingot", 3_000,
				"minecraft:iron_ingot", 10_000,
				"minecraft:gold_ingot", 30_000,
				"minecraft:iron_pickaxe", 40_000,
				"minecraft:iron_axe", 40_000,
				"minecraft:iron_sword", 30_000,
				"minecraft:shield", 20_000,
				"minecraft:iron_helmet", 60_000,
				"minecraft:iron_chestplate", 100_000,
				"minecraft:iron_leggings", 90_000,
				"minecraft:iron_boots", 50_000));
		root.add(ShopType.FISHER.id(), entries(
				"minecraft:fishing_rod", 15_000,
				"minecraft:oak_boat", 10_000,
				"minecraft:cod", 1_500,
				"minecraft:salmon", 2_500,
				"minecraft:pufferfish", 6_000,
				"minecraft:tropical_fish", 8_000,
				"minecraft:cooked_cod", 3_000,
				"minecraft:cooked_salmon", 4_500,
				"minecraft:nautilus_shell", 50_000));
		return root;
	}

	private static JsonArray entries(Object... itemsAndPrices) {
		JsonArray array = new JsonArray();
		for (int i = 0; i < itemsAndPrices.length; i += 2) {
			JsonObject entry = new JsonObject();
			entry.addProperty("item", (String) itemsAndPrices[i]);
			entry.addProperty("price", (Integer) itemsAndPrices[i + 1]);
			entry.addProperty("mode", "both");
			array.add(entry);
		}
		return array;
	}
}
