package com.seunghyeon.harbortrade.client;

import com.seunghyeon.harbortrade.shop.MerchantEntity;
import net.minecraft.client.model.VillagerModel;
import net.minecraft.client.model.geom.ModelLayers;
import net.minecraft.client.renderer.entity.EntityRendererProvider;
import net.minecraft.client.renderer.entity.MobRenderer;
import net.minecraft.resources.ResourceLocation;

/** Draws merchants with the plain villager look for now. */
public class MerchantRenderer extends MobRenderer<MerchantEntity, VillagerModel<MerchantEntity>> {
	private static final ResourceLocation TEXTURE = ResourceLocation.withDefaultNamespace("textures/entity/villager/villager.png");

	public MerchantRenderer(EntityRendererProvider.Context context) {
		super(context, new VillagerModel<>(context.bakeLayer(ModelLayers.VILLAGER)), 0.5f);
	}

	@Override
	public ResourceLocation getTextureLocation(MerchantEntity entity) {
		return TEXTURE;
	}
}
