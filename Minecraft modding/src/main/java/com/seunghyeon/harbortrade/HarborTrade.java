package com.seunghyeon.harbortrade;

import com.seunghyeon.harbortrade.command.MoneyCommand;
import com.seunghyeon.harbortrade.command.PriceCommand;
import com.seunghyeon.harbortrade.command.RoundCommand;
import com.seunghyeon.harbortrade.command.ShopCommand;
import com.seunghyeon.harbortrade.gem.GemItems;
import com.seunghyeon.harbortrade.network.HudPayload;
import com.seunghyeon.harbortrade.round.RoundManager;
import com.seunghyeon.harbortrade.shop.ModEntities;
import com.seunghyeon.harbortrade.shop.ShopConfig;
import java.io.IOException;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;

import net.minecraft.resources.ResourceLocation;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class HarborTrade implements ModInitializer {
	public static final String MOD_ID = "harbortrade";

	// This logger is used to write text to the console and the log file.
	// It is considered best practice to use your mod id as the logger's name.
	// That way, it's clear which mod wrote info, warnings, and errors.
	public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

	@Override
	public void onInitialize() {
		// This code runs as soon as Minecraft is in a mod-load-ready state.
		// However, some things (like resources) may still be uninitialized.
		// Proceed with mild caution.

		GemItems.register();
		HudPayload.register();
		RoundManager.register();
		ModEntities.register();
		ServerLifecycleEvents.SERVER_STARTING.register(server -> {
			try {
				LOGGER.info("Loaded {} shop offers", ShopConfig.load());
			} catch (IOException | RuntimeException e) {
				LOGGER.error("Failed to load shops.json", e);
			}
		});
		CommandRegistrationCallback.EVENT.register((dispatcher, registryAccess, environment) -> {
			MoneyCommand.register(dispatcher);
			PriceCommand.register(dispatcher);
			ShopCommand.register(dispatcher, registryAccess);
			RoundCommand.register(dispatcher);
		});

		LOGGER.info("Harbor Trade initialized");
	}

	public static ResourceLocation id(String path) {
		return ResourceLocation.fromNamespaceAndPath(MOD_ID, path);
	}
}
