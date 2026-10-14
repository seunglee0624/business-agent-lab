package com.seunghyeon.harbortrade.ship;

import com.seunghyeon.harbortrade.trade.TradeCity;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.network.chat.Component;
import net.minecraft.network.syncher.EntityDataAccessor;
import net.minecraft.network.syncher.EntityDataSerializers;
import net.minecraft.network.syncher.SynchedEntityData;
import net.minecraft.util.Mth;
import net.minecraft.world.damagesource.DamageSource;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.level.Level;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;

/**
 * A city's trade ship: sails in from the sea to its berth when the trader arrives, waits with the sail furled,
 * then turns around and sails out when the trader leaves. Purely decorative and driven by the server; it is
 * never saved, since {@link ShipManager} puts it back from the round state.
 */
public class TradeShipEntity extends Entity {
	static final int ARRIVE_TICKS = 30 * 20;
	static final int TURN_TICKS = 6 * 20;
	static final int DEPART_TICKS = 30 * 20;
	/** How long a test run waits at the berth before leaving. */
	private static final int TEST_DOCK_TICKS = 5 * 20;

	private static final EntityDataAccessor<Boolean> SAIL_OPEN =
			SynchedEntityData.defineId(TradeShipEntity.class, EntityDataSerializers.BOOLEAN);
	/** The city's ordinal, so the client can pick the sail colour. */
	private static final EntityDataAccessor<Integer> CITY =
			SynchedEntityData.defineId(TradeShipEntity.class, EntityDataSerializers.INT);

	enum Phase { ARRIVING, DOCKED, TURNING, DEPARTING }

	private TradeCity city;
	private Vec3 dock = Vec3.ZERO;
	private Vec3 sea = Vec3.ZERO;
	/** The bow's heading while coming in (towards land). */
	private float inboundYaw;
	private Phase phase = Phase.ARRIVING;
	private int phaseTicks;
	private boolean test;

	public TradeShipEntity(EntityType<? extends TradeShipEntity> type, Level level) {
		super(type, level);
		noPhysics = true;
		setNoGravity(true);
		setInvulnerable(true);
	}

	/**
	 * Places the ship for a berth. {@code seaYaw} is where the sea lies seen from the berth; {@code progress}
	 * (0..1) skips into the arrival, 1 meaning already docked.
	 */
	void setup(TradeCity city, Berth berth, float progress, boolean test) {
		this.city = city;
		this.test = test;
		entityData.set(CITY, city.ordinal());
		dock = berth.position();
		sea = dock.add(Vec3.directionFromRotation(0, berth.seaYaw()).scale(berth.distance()));
		inboundYaw = Mth.wrapDegrees(berth.seaYaw() + 180);
		setCustomName(Component.literal(city.displayName() + " 무역선"));
		setCustomNameVisible(true);
		if (progress >= 1) {
			phase = Phase.DOCKED;
			phaseTicks = 0;
		} else {
			phase = Phase.ARRIVING;
			phaseTicks = (int) (progress * ARRIVE_TICKS);
		}
		place();
		xo = getX();
		yo = getY();
		zo = getZ();
		yRotO = getYRot();
	}

	/** The ship's city on either side (the client only knows it through synced data). */
	public TradeCity city() {
		return TradeCity.values()[Math.floorMod(entityData.get(CITY), TradeCity.values().length)];
	}

	boolean isTest() {
		return test;
	}

	boolean isLeaving() {
		return phase == Phase.TURNING || phase == Phase.DEPARTING;
	}

	/** Starts turning around towards the sea, then sails off and disappears. */
	void depart() {
		if (!isLeaving()) {
			phase = Phase.TURNING;
			phaseTicks = 0;
		}
	}

	public boolean sailOpen() {
		return entityData.get(SAIL_OPEN);
	}

	@Override
	public void tick() {
		super.tick();
		if (level().isClientSide) {
			return;
		}
		if (city == null) {
			// Loaded from somewhere it should not be (ships are never saved); just go away.
			discard();
			return;
		}
		phaseTicks++;
		switch (phase) {
			case ARRIVING -> {
				if (phaseTicks >= ARRIVE_TICKS) {
					phase = Phase.DOCKED;
					phaseTicks = 0;
				}
			}
			case DOCKED -> {
				if (test && phaseTicks >= TEST_DOCK_TICKS) {
					depart();
				}
			}
			case TURNING -> {
				if (phaseTicks >= TURN_TICKS) {
					phase = Phase.DEPARTING;
					phaseTicks = 0;
				}
			}
			case DEPARTING -> {
				if (phaseTicks >= DEPART_TICKS) {
					discard();
					return;
				}
			}
		}
		place();
	}

	/** Sets position, heading and sail for the current phase. */
	private void place() {
		Vec3 pos;
		float yaw;
		boolean sail;
		switch (phase) {
			case ARRIVING -> {
				float t = (float) phaseTicks / ARRIVE_TICKS;
				// Slows down as it comes in.
				pos = sea.lerp(dock, 1 - (1 - t) * (1 - t));
				yaw = inboundYaw;
				sail = true;
			}
			case TURNING -> {
				float t = (float) phaseTicks / TURN_TICKS;
				float eased = t * t * (3 - 2 * t);
				pos = dock;
				yaw = inboundYaw + 180 * eased;
				sail = true;
			}
			case DEPARTING -> {
				float t = (float) phaseTicks / DEPART_TICKS;
				// Picks up speed as it leaves.
				pos = dock.lerp(sea, t * t);
				yaw = inboundYaw + 180;
				sail = true;
			}
			default -> {
				pos = dock;
				yaw = inboundYaw;
				sail = false;
			}
		}
		setPos(pos);
		setYRot(Mth.wrapDegrees(yaw));
		entityData.set(SAIL_OPEN, sail);
	}

	@Override
	protected void defineSynchedData(SynchedEntityData.Builder builder) {
		builder.define(SAIL_OPEN, false);
		builder.define(CITY, 0);
	}

	@Override
	public boolean shouldBeSaved() {
		return false;
	}

	@Override
	protected void readAdditionalSaveData(CompoundTag tag) {
	}

	@Override
	protected void addAdditionalSaveData(CompoundTag tag) {
	}

	@Override
	public boolean hurt(DamageSource source, float amount) {
		return false;
	}

	@Override
	public boolean isPickable() {
		return false;
	}

	@Override
	public boolean isPushable() {
		return false;
	}

	@Override
	public AABB getBoundingBoxForCulling() {
		// The model is far bigger than the small box used for the name tag.
		return getBoundingBox().inflate(8, 2, 8);
	}
}
