import { describe, expect, it } from "vitest";
import { iso, pick, roomLayout, tileAt } from "./geometry";

// 기대값은 타일 72×36, 벽 90, 여백 24로 손으로 계산한 값이다.
describe("방 배치", () => {
  it("4×4 방은 336×282 캔버스에 그려지고, 뒤쪽 모서리는 가로 가운데·벽 높이 아래에 온다", () => {
    const room = roomLayout(4);
    expect([room.width, room.height]).toEqual([336, 282]);
    expect(iso(room, 0, 0)).toEqual([168, 114]);
  });
});

describe("화면 좌표 → 타일", () => {
  const room = roomLayout(4);

  it("타일 (2,3)의 한가운데를 누르면 (2,3)이다", () => {
    // 타일 (2,3)의 중심 = iso(2.5, 3.5) = [168 - 36, 114 + 108]
    expect(tileAt(room, 132, 222)).toEqual([2, 3]);
  });

  it("바닥 밖(캔버스 왼쪽 위 구석, 맨 앞 모서리 너머)은 타일이 없다", () => {
    expect(tileAt(room, 0, 0)).toBeNull();
    // 맨 앞 모서리 iso(4,4) = [168, 258] 바로 아래
    expect(tileAt(room, 168, 262)).toBeNull();
  });
});

describe("클릭 판정", () => {
  const room = roomLayout(4);
  const desk = { kind: "desk", x: 1, y: 1, height: 30 };

  it("가구 윗면을 누르면 그 가구다", () => {
    // 타일 (1,1) 중심 iso(1.5,1.5) = [168, 168], 높이 30만큼 위
    expect(pick(room, [desk], 168, 138)).toEqual({ item: desk });
  });

  it("가구가 없는 바닥을 누르면 그 타일이다", () => {
    // 타일 (3,0) 중심 iso(3.5,0.5) = [276, 186]
    expect(pick(room, [desk], 276, 186)).toEqual({ tile: [3, 0] });
  });

  it("두 가구가 겹쳐 보이는 곳은 앞쪽 가구가 잡힌다", () => {
    const bookcase = { kind: "book", x: 1, y: 1, height: 56 };
    const bed = { kind: "bed", x: 2, y: 2, height: 20 };
    // [168,175]는 뒤쪽 책장의 옆면이자 앞쪽 침대의 윗면
    expect(pick(room, [bookcase, bed], 168, 175)).toEqual({ item: bed });
    expect(pick(room, [bed, bookcase], 168, 175)).toEqual({ item: bed });
  });

  it("방 밖을 누르면 아무것도 아니다", () => {
    expect(pick(room, [desk], 0, 0)).toBeNull();
  });
});
