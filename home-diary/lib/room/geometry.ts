// 아이소메트릭: 화면 x=(x-y)*TW/2, y=(x+y)*TH/2. 타일 (0,0)이 두 벽이 만나는 뒤쪽 모서리다.
export const TILE_W = 72;
export const TILE_H = 36;
export const WALL = 90;
const PAD = 24;

export type Point = [number, number];
export type Room = { size: number; width: number; height: number; ox: number; oy: number };

export function roomLayout(size: number): Room {
  return {
    size,
    width: size * TILE_W + PAD * 2,
    height: size * TILE_H + WALL + PAD * 2,
    ox: PAD + (size * TILE_W) / 2,
    oy: PAD + WALL,
  };
}

export function iso(room: Room, x: number, y: number): Point {
  return [room.ox + ((x - y) * TILE_W) / 2, room.oy + ((x + y) * TILE_H) / 2];
}

/** 화면 좌표가 놓인 바닥 타일. 방 밖이면 null. */
export function tileAt(room: Room, px: number, py: number): Point | null {
  const a = (px - room.ox) / (TILE_W / 2);
  const b = (py - room.oy) / (TILE_H / 2);
  const x = Math.floor((a + b) / 2);
  const y = Math.floor((b - a) / 2);
  return x >= 0 && y >= 0 && x < room.size && y < room.size ? [x, y] : null;
}

const INSET = 0.12; // 가구 상자를 타일보다 살짝 작게 그려 바닥 줄이 보이게 한다

export type Placed = { x: number; y: number; height: number };

/** 가구 상자의 꼭짓점. 바닥 네 점 A·B·C·D와 높이 h만큼 올린 윗면. */
export function boxCorners(room: Room, p: Placed) {
  const [x0, y0, x1, y1] = [p.x + INSET, p.y + INSET, p.x + 1 - INSET, p.y + 1 - INSET];
  const base = [iso(room, x0, y0), iso(room, x1, y0), iso(room, x1, y1), iso(room, x0, y1)];
  const top = base.map(([sx, sy]): Point => [sx, sy - p.height]);
  return { base, top };
}

/** 화면에서 가구 상자가 차지하는 육각형 윤곽. */
export function silhouette(room: Room, p: Placed): Point[] {
  const { base, top } = boxCorners(room, p);
  return [top[0], top[1], base[1], base[2], base[3], top[3]];
}

function inPolygon([px, py]: Point, poly: Point[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 뒤(x+y 작음)에서 앞 순서. 이 순서로 그리면 앞 가구가 뒤 가구를 가린다. */
export const backToFront = <T extends Placed>(items: T[]) => [...items].sort((a, b) => a.x + a.y - (b.x + b.y));

/** 클릭한 곳의 가구(앞쪽 우선) 또는 바닥 타일. 방 밖이면 null. */
export function pick<T extends Placed>(
  room: Room,
  items: T[],
  px: number,
  py: number,
): { item: T } | { tile: Point } | null {
  const item = backToFront(items)
    .reverse()
    .find((p) => inPolygon([px, py], silhouette(room, p)));
  if (item) return { item };
  const tile = tileAt(room, px, py);
  return tile ? { tile } : null;
}
