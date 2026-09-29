package com.seunghyeon.harbortrade.client;

import com.seunghyeon.harbortrade.shop.ModEntities;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.rendering.v1.EntityRendererRegistry;

public class HarborTradeClient implements ClientModInitializer {
	@Override
	public void onInitializeClient() {
		EntityRendererRegistry.register(ModEntities.MERCHANT, MerchantRenderer::new);
		RoundHud.register();
	}
}
