package com.seunghyeon.harbortrade.ship;

import net.minecraft.world.phys.Vec3;

/** Where a city's ship docks, which way the open sea is (yaw), and how far out it starts, in blocks. */
public record Berth(Vec3 position, float seaYaw, int distance) {
	public static final int DEFAULT_DISTANCE = 40;
}
