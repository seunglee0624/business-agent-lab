import { describe, expect, it } from "vitest";
import { applyMigrations, as, signUp, testDb } from "./db";

const PLACEMENTS = "select kind, catalog_id, x, y from public.placements order by kind";

describe("새 집", () => {
  it("가입하면 4×4 방에 우드 옷장·식탁·책상·TV가 놓인다", async () => {
    const db = await testDb();
    const me = await signUp(db, "민수");

    expect(await as(db, me, "select size from public.houses")).toEqual([{ size: 4 }]);
    expect(await as(db, me, PLACEMENTS)).toEqual([
      { kind: "closet", catalog_id: "closet-wood", x: 0, y: 0 },
      { kind: "desk", catalog_id: "desk-wood", x: 2, y: 0 },
      { kind: "table", catalog_id: "table-wood", x: 2, y: 2 },
      { kind: "tv", catalog_id: "tv-wood", x: 0, y: 2 },
    ]);
  });

  it("M1 이전에 가입한 사람도 마이그레이션 후 같은 집을 받는다", async () => {
    const M1 = "20261105100000_house.sql";
    const db = await testDb(M1);
    const early = await signUp(db, "지은");
    await applyMigrations(db, (file) => file >= M1);

    expect(await as(db, early, "select size from public.houses")).toEqual([{ size: 4 }]);
    expect(await as(db, early, "select count(*)::int as n from public.placements")).toEqual([{ n: 4 }]);
  });
});

describe("카탈로그", () => {
  it("8종 × 3스타일 = 24개이고, 기본 4종 우드만 무료다", async () => {
    const db = await testDb();
    const rows = await db.query<{ id: string; price: number }>("select id, price from public.catalog");
    const price = Object.fromEntries(rows.rows.map((r) => [r.id, r.price]));

    expect(rows.rows).toHaveLength(24);
    expect(rows.rows.filter((r) => r.price === 0).map((r) => r.id).sort()).toEqual([
      "closet-wood", "desk-wood", "table-wood", "tv-wood",
    ]);
    // README 가격표: 화분 50 · 피아노 300, 모던·빈티지는 +50, 무료 종류의 모던은 100
    expect([price["plant-wood"], price["piano-vintage"], price["tv-modern"]]).toEqual([50, 350, 100]);
  });
});

describe("가구 놓기", () => {
  const place = "select public.place_furniture($1, $2, $3)";
  const where = "select x, y from public.placements where kind = $1";

  it("빈 칸으로 옮기면 위치가 바뀐다", async () => {
    const db = await testDb();
    const me = await signUp(db, "민수");
    await as(db, me, place, ["desk-wood", 3, 3]);
    expect(await as(db, me, where, ["desk"])).toEqual([{ x: 3, y: 3 }]);
  });

  it("다른 가구가 있는 칸, 방 밖, 보유하지 않은 가구는 거절하고 그대로 둔다", async () => {
    const db = await testDb();
    const me = await signUp(db, "민수");

    await expect(as(db, me, place, ["desk-wood", 0, 0])).rejects.toThrow("tile_taken");
    await expect(as(db, me, place, ["desk-wood", 4, 0])).rejects.toThrow("outside_room");
    await expect(as(db, me, place, ["piano-wood", 3, 3])).rejects.toThrow("not_owned");
    expect(await as(db, me, where, ["desk"])).toEqual([{ x: 2, y: 0 }]);
  });

  it("다른 사람의 방에는 영향이 없다", async () => {
    const db = await testDb();
    const me = await signUp(db, "민수");
    const other = await signUp(db, "지은");
    await as(db, me, place, ["desk-wood", 3, 3]);
    expect(await as(db, other, where, ["desk"])).toEqual([{ x: 2, y: 0 }]);
  });
});

describe("직접 쓰기 차단", () => {
  it("로그인 사용자도 배치·방·포인트를 표에 직접 고칠 수 없다", async () => {
    const db = await testDb();
    const me = await signUp(db, "민수");

    await as(db, me, "update public.placements set x = 3, y = 3 where kind = 'desk'");
    await as(db, me, "update public.houses set size = 8");
    await as(db, me, "update public.profiles set points = 99999");
    await expect(
      as(db, me, "insert into public.owned_furniture (profile_id, catalog_id) values (auth.uid(), 'piano-wood')"),
    ).rejects.toThrow("row-level security");

    expect(await as(db, me, "select x, y from public.placements where kind = 'desk'")).toEqual([{ x: 2, y: 0 }]);
    expect(await as(db, me, "select size from public.houses")).toEqual([{ size: 4 }]);
    expect(await as(db, me, "select points from public.profiles")).toEqual([{ points: 0 }]);
  });
});
