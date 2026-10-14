package com.seunghyeon.harbortrade.talk;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;

/** One-shot chat completions against OpenRouter, off the server thread. */
final class OpenRouterClient {
	private static final URI ENDPOINT = URI.create("https://openrouter.ai/api/v1/chat/completions");
	private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

	private OpenRouterClient() {
	}

	static CompletableFuture<String> complete(String system, String user) {
		JsonArray messages = new JsonArray();
		messages.add(message("system", system));
		messages.add(message("user", user));
		JsonObject body = new JsonObject();
		body.addProperty("model", TalkConfig.model);
		body.addProperty("max_tokens", TalkConfig.maxTokens);
		body.add("messages", messages);

		HttpRequest request = HttpRequest.newBuilder(ENDPOINT)
				.timeout(Duration.ofSeconds(30))
				.header("Authorization", "Bearer " + TalkConfig.apiKey)
				.header("Content-Type", "application/json")
				.header("X-Title", "Harbor Trade")
				.POST(HttpRequest.BodyPublishers.ofString(body.toString(), StandardCharsets.UTF_8))
				.build();
		return HTTP.sendAsync(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)).thenApply(response -> {
			if (response.statusCode() != 200) {
				throw new IllegalStateException("HTTP " + response.statusCode() + ": " + response.body());
			}
			JsonObject root = JsonParser.parseString(response.body()).getAsJsonObject();
			return root.getAsJsonArray("choices").get(0).getAsJsonObject()
					.getAsJsonObject("message").get("content").getAsString();
		});
	}

	private static JsonObject message(String role, String content) {
		JsonObject message = new JsonObject();
		message.addProperty("role", role);
		message.addProperty("content", content);
		return message;
	}
}
