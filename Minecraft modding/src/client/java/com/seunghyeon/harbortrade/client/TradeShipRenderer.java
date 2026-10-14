package com.seunghyeon.harbortrade.client;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import com.mojang.math.Axis;
import com.seunghyeon.harbortrade.HarborTrade;
import com.seunghyeon.harbortrade.ship.TradeShipEntity;
import com.seunghyeon.harbortrade.trade.TradeCity;
import java.io.IOException;
import java.io.Reader;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import net.minecraft.client.renderer.MultiBufferSource;
import net.minecraft.client.renderer.RenderType;
import net.minecraft.client.renderer.entity.EntityRenderer;
import net.minecraft.client.renderer.entity.EntityRendererProvider;
import net.minecraft.client.renderer.texture.OverlayTexture;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.util.Mth;
import org.joml.Matrix4f;
import org.joml.Vector3f;

/**
 * Draws the trade ship from models/entity/trade_ship.json, which art/ship/make_ship.py exports from the
 * Blockbench model: plain boxes with per-face UVs, so no model-part code is needed. The sail is swapped between
 * the furled and open groups and coloured by city, and the ship rocks gently on the water.
 */
public class TradeShipRenderer extends EntityRenderer<TradeShipEntity> {
	private static final ResourceLocation MODEL = HarborTrade.id("models/entity/trade_ship.json");
	/** One texture per city: same wood, sail in the city's colour. */
	private static final Map<TradeCity, ResourceLocation> TEXTURES = new EnumMap<>(TradeCity.class);

	static {
		for (TradeCity city : TradeCity.values()) {
			TEXTURES.put(city, HarborTrade.id("textures/entity/trade_ship_" + city.id() + ".png"));
		}
	}
	/** How deep the hull sits below the berth point, in blocks. */
	private static final float DRAFT = 0.5f;

	/** One face: four corners (top-left, top-right, bottom-right, bottom-left), UVs and normal, in model pixels. */
	private record Quad(Vector3f[] corners, float u1, float v1, float u2, float v2, Vector3f normal) {
	}

	private record Part(String group, List<Quad> quads) {
	}

	private final List<Part> parts;

	public TradeShipRenderer(EntityRendererProvider.Context context) {
		super(context);
		shadowRadius = 0;
		parts = load(context);
	}

	private static List<Part> load(EntityRendererProvider.Context context) {
		List<Part> parts = new ArrayList<>();
		try (Reader reader = context.getResourceManager().openAsReader(MODEL)) {
			JsonObject root = JsonParser.parseReader(reader).getAsJsonObject();
			float size = root.get("texture_size").getAsFloat();
			for (JsonElement e : root.getAsJsonArray("elements")) {
				parts.add(part(e.getAsJsonObject(), size));
			}
		} catch (IOException | RuntimeException e) {
			HarborTrade.LOGGER.error("Failed to load trade ship model", e);
		}
		return parts;
	}

	private static Part part(JsonObject el, float size) {
		float[] from = floats(el.getAsJsonArray("from"));
		float[] to = floats(el.getAsJsonArray("to"));
		float[] origin = floats(el.getAsJsonArray("origin"));
		float[] rotation = floats(el.getAsJsonArray("rotation"));
		float x1 = from[0], y1 = from[1], z1 = from[2], x2 = to[0], y2 = to[1], z2 = to[2];
		// Corners per face as Blockbench lays out the texture: top-left, top-right, bottom-right, bottom-left.
		float[][][] faces = {
				{{x2, y2, z1}, {x1, y2, z1}, {x1, y1, z1}, {x2, y1, z1}, {0, 0, -1}},   // north
				{{x1, y2, z2}, {x2, y2, z2}, {x2, y1, z2}, {x1, y1, z2}, {0, 0, 1}},    // south
				{{x2, y2, z2}, {x2, y2, z1}, {x2, y1, z1}, {x2, y1, z2}, {1, 0, 0}},    // east
				{{x1, y2, z1}, {x1, y2, z2}, {x1, y1, z2}, {x1, y1, z1}, {-1, 0, 0}},   // west
				{{x1, y2, z1}, {x2, y2, z1}, {x2, y2, z2}, {x1, y2, z2}, {0, 1, 0}},    // up
				{{x1, y1, z2}, {x2, y1, z2}, {x2, y1, z1}, {x1, y1, z1}, {0, -1, 0}},   // down
		};
		String[] names = {"north", "south", "east", "west", "up", "down"};
		Matrix4f rotate = new Matrix4f()
				.translate(origin[0], origin[1], origin[2])
				.rotateZ((float) Math.toRadians(rotation[2]))
				.rotateY((float) Math.toRadians(rotation[1]))
				.rotateX((float) Math.toRadians(rotation[0]))
				.translate(-origin[0], -origin[1], -origin[2]);
		JsonObject uvs = el.getAsJsonObject("faces");
		List<Quad> quads = new ArrayList<>();
		for (int f = 0; f < names.length; f++) {
			if (!uvs.has(names[f])) {
				continue;
			}
			float[] uv = floats(uvs.getAsJsonArray(names[f]));
			Vector3f[] corners = new Vector3f[4];
			for (int c = 0; c < 4; c++) {
				corners[c] = rotate.transformPosition(new Vector3f(faces[f][c]));
			}
			Vector3f normal = rotate.transformDirection(new Vector3f(faces[f][4])).normalize();
			quads.add(new Quad(corners, uv[0] / size, uv[1] / size, uv[2] / size, uv[3] / size, normal));
		}
		return new Part(el.get("group").getAsString(), quads);
	}

	private static float[] floats(JsonArray array) {
		float[] out = new float[array.size()];
		for (int i = 0; i < out.length; i++) {
			out[i] = array.get(i).getAsFloat();
		}
		return out;
	}

	@Override
	public void render(TradeShipEntity ship, float entityYaw, float partialTick, PoseStack poseStack, MultiBufferSource buffers, int light) {
		poseStack.pushPose();
		float time = ship.tickCount + partialTick;
		float yaw = Mth.rotLerp(partialTick, ship.yRotO, ship.getYRot());
		poseStack.translate(0, -DRAFT + Mth.sin(time * 0.08f) * 0.06f, 0);
		// The model's bow points north (-Z); entity yaw 0 faces south.
		poseStack.mulPose(Axis.YP.rotationDegrees(180 - yaw));
		poseStack.mulPose(Axis.ZP.rotationDegrees(Mth.sin(time * 0.05f) * 1.5f));
		poseStack.mulPose(Axis.XP.rotationDegrees(Mth.sin(time * 0.037f) * 0.8f));
		poseStack.scale(1 / 16f, 1 / 16f, 1 / 16f);

		String hidden = ship.sailOpen() ? "sail_furled" : "sail_open";
		PoseStack.Pose pose = poseStack.last();
		VertexConsumer buffer = buffers.getBuffer(RenderType.entityCutoutNoCull(getTextureLocation(ship)));
		for (Part part : parts) {
			if (part.group().equals(hidden)) {
				continue;
			}
			for (Quad q : part.quads()) {
				vertex(buffer, pose, q.corners()[0], q.u1(), q.v1(), q.normal(), light);
				vertex(buffer, pose, q.corners()[3], q.u1(), q.v2(), q.normal(), light);
				vertex(buffer, pose, q.corners()[2], q.u2(), q.v2(), q.normal(), light);
				vertex(buffer, pose, q.corners()[1], q.u2(), q.v1(), q.normal(), light);
			}
		}
		poseStack.popPose();
		super.render(ship, entityYaw, partialTick, poseStack, buffers, light);
	}

	private static void vertex(VertexConsumer buffer, PoseStack.Pose pose, Vector3f p, float u, float v, Vector3f n, int light) {
		buffer.addVertex(pose, p.x, p.y, p.z)
				.setColor(-1)
				.setUv(u, v)
				.setOverlay(OverlayTexture.NO_OVERLAY)
				.setLight(light)
				.setNormal(pose, n.x, n.y, n.z);
	}

	@Override
	public ResourceLocation getTextureLocation(TradeShipEntity ship) {
		return TEXTURES.get(ship.city());
	}
}
