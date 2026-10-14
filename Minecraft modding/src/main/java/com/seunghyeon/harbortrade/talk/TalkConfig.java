package com.seunghyeon.harbortrade.talk;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;
import com.seunghyeon.harbortrade.HarborTrade;
import java.io.IOException;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import net.fabricmc.loader.api.FabricLoader;

/**
 * Settings for merchant small talk, in config/harbortrade/talk.json (server only; the API key never goes in the
 * modpack). Talk is off until an OpenRouter key is filled in.
 */
public final class TalkConfig {
	private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();

	static boolean enabled = true;
	static String apiKey = "";
	static String model = "meta-llama/llama-3.3-70b-instruct:free";
	static int maxTokens = 120;
	static double radius = 5;
	static int cooldownSeconds = 10;
	static int maxInputLength = 100;

	private TalkConfig() {
	}

	public static Path path() {
		return FabricLoader.getInstance().getConfigDir().resolve(HarborTrade.MOD_ID).resolve("talk.json");
	}

	/** Talk runs only when switched on and a key is set. */
	public static boolean active() {
		return enabled && !apiKey.isBlank();
	}

	public static boolean hasKey() {
		return !apiKey.isBlank();
	}

	public static String model() {
		return model;
	}

	public static void load() throws IOException {
		Path path = path();
		if (Files.notExists(path)) {
			save();
			return;
		}
		JsonObject root;
		try (Reader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
			root = GSON.fromJson(reader, JsonObject.class);
		}
		if (root == null) {
			return;
		}
		if (root.has("enabled")) enabled = root.get("enabled").getAsBoolean();
		if (root.has("api_key")) apiKey = root.get("api_key").getAsString().strip();
		if (root.has("model")) model = root.get("model").getAsString().strip();
		if (root.has("max_tokens")) maxTokens = root.get("max_tokens").getAsInt();
		if (root.has("radius")) radius = root.get("radius").getAsDouble();
		if (root.has("cooldown_seconds")) cooldownSeconds = root.get("cooldown_seconds").getAsInt();
		if (root.has("max_input_length")) maxInputLength = root.get("max_input_length").getAsInt();
	}

	public static void setEnabled(boolean value) throws IOException {
		enabled = value;
		save();
	}

	private static void save() throws IOException {
		JsonObject root = new JsonObject();
		root.addProperty("enabled", enabled);
		root.addProperty("api_key", apiKey);
		root.addProperty("model", model);
		root.addProperty("max_tokens", maxTokens);
		root.addProperty("radius", radius);
		root.addProperty("cooldown_seconds", cooldownSeconds);
		root.addProperty("max_input_length", maxInputLength);
		Path path = path();
		Files.createDirectories(path.getParent());
		Files.writeString(path, GSON.toJson(root), StandardCharsets.UTF_8);
	}
}
