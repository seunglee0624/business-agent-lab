import { backToFront, boxCorners, iso, WALL, type Placed, type Point, type Room } from "./geometry";
import { KINDS, STYLE_COLORS, type Kind, type Style } from "./kinds";

export type DrawnFurniture = Placed & { kind: Kind; style: Style };

export type RoomColors = {
  floor: string;
  line: string;
  wallLeft: string;
  wallRight: string;
  window: string;
  selected: string;
  cursor: string;
};

function outline(c: CanvasRenderingContext2D, points: Point[], stroke: string, width: number) {
  c.beginPath();
  points.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  c.closePath();
  c.strokeStyle = stroke;
  c.lineWidth = width;
  c.stroke();
}

function polygon(c: CanvasRenderingContext2D, points: Point[], fill: string, stroke: string) {
  outline(c, points, stroke, 1);
  c.fillStyle = fill;
  c.fill();
  c.stroke();
}

function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

/** 벽 → 바닥 → 가구(뒤에서 앞) 순서로 방을 그린다. 가구를 고른 상태면 빈 칸을 강조하고, 키보드 커서가 있으면 그 칸 테두리를 그린다. */
export function drawRoom(
  c: CanvasRenderingContext2D,
  room: Room,
  items: DrawnFurniture[],
  selected: Kind | null,
  colors: RoomColors,
  cursor: Point | null = null,
) {
  const s = room.size;
  const up = ([x, y]: Point): Point => [x, y - WALL];
  const at = (x: number, y: number) => iso(room, x, y);

  // 왼쪽 벽은 x=0 모서리, 오른쪽 벽은 y=0 모서리를 따라 세운다.
  polygon(c, [at(0, 0), at(0, s), up(at(0, s)), up(at(0, 0))], colors.wallLeft, colors.line);
  polygon(c, [at(0, 0), at(s, 0), up(at(s, 0)), up(at(0, 0))], colors.wallRight, colors.line);
  const [w0, w1] = [at(0, s * 0.25), at(0, s * 0.6)];
  polygon(
    c,
    [[w0[0], w0[1] - WALL * 0.8], [w1[0], w1[1] - WALL * 0.8], [w1[0], w1[1] - WALL * 0.3], [w0[0], w0[1] - WALL * 0.3]],
    colors.window,
    colors.line,
  );

  const tile = (x: number, y: number) => [at(x, y), at(x + 1, y), at(x + 1, y + 1), at(x, y + 1)];
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      polygon(c, tile(x, y), colors.floor, colors.line);
    }
  }
  // 옅은 색만으로는 바닥과 대비가 모자라서, 놓을 수 있는 칸은 바닥을 다 그린 뒤 진한 테두리로 표시한다.
  if (selected) {
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        if (!items.some((p) => p.x === x && p.y === y)) outline(c, tile(x, y), colors.selected, 2);
      }
    }
  }

  c.font = "22px system-ui";
  c.textAlign = "center";
  c.textBaseline = "middle";
  for (const p of backToFront(items)) {
    const { base, top } = boxCorners(room, p);
    const color = STYLE_COLORS[p.style];
    polygon(c, [top[3], top[2], base[2], base[3]], shade(color, 0.78), colors.line); // 왼쪽 면
    polygon(c, [top[2], top[1], base[1], base[2]], shade(color, 0.92), colors.line); // 오른쪽 면
    polygon(c, top, p.kind === selected ? colors.selected : shade(color, 1.12), colors.line); // 윗면
    c.fillText(KINDS[p.kind].icon, (top[0][0] + top[2][0]) / 2, (top[0][1] + top[2][1]) / 2);
  }

  if (cursor) outline(c, tile(...cursor), colors.cursor, 3);
}
