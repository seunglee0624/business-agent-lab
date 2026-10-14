package com.seunghyeon.harbortrade.client;

import com.seunghyeon.harbortrade.ship.ShipManager;
import com.seunghyeon.harbortrade.shop.ModEntities;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.rendering.v1.EntityRendererRegistry;

public class HarborTradeClient implements ClientModInitializer {
	@Override
	public void onInitializeClient() {
		EntityRendererRegistry.register(ModEntities.MERCHANT, MerchantRenderer::new);
		EntityRendererRegistry.register(ShipManager.TRADE_SHIP, TradeShipRenderer::new);
		RoundHud.register();
		AmountScreen.register();
		TextScreen.register();
		NoticeOverlay.register();
		RoundBanner.register();
	}
}
