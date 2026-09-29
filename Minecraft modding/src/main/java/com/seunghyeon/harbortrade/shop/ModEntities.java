package com.seunghyeon.harbortrade.shop;

import com.seunghyeon.harbortrade.HarborTrade;
import net.fabricmc.fabric.api.object.builder.v1.entity.FabricDefaultAttributeRegistry;
import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.MobCategory;

public final class ModEntities {
	public static final EntityType<MerchantEntity> MERCHANT = Registry.register(BuiltInRegistries.ENTITY_TYPE, HarborTrade.id("merchant"),
			EntityType.Builder.of(MerchantEntity::new, MobCategory.MISC).sized(0.6f, 1.95f).clientTrackingRange(10).build("merchant"));

	private ModEntities() {
	}

	public static void register() {
		FabricDefaultAttributeRegistry.register(MERCHANT, Mob.createMobAttributes());
	}
}
