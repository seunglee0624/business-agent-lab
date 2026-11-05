"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { drawRoom, type DrawnFurniture } from "@/lib/room/draw";
import { pick, roomLayout, type Point } from "@/lib/room/geometry";
import { KINDS, type Kind, type Style } from "@/lib/room/kinds";
import { placeFurniture } from "./actions";
import styles from "./home.module.css";

export type Placement = { kind: Kind; catalogId: string; style: Style; x: number; y: number };

const ERRORS: Record<string, string> = {
  tile_taken: "그 칸에는 이미 가구가 있어요.",
  outside_room: "방 밖으로는 옮길 수 없어요.",
  not_owned: "갖고 있지 않은 가구예요.",
  failed: "옮기지 못했어요. 잠시 후 다시 시도해 주세요.",
};

// 방향키는 격자 축을 따른다: →/←는 x(오른쪽 아래/왼쪽 위), ↓/↑는 y(왼쪽 아래/오른쪽 위).
const ARROWS: Record<string, Point> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] };

const josa = (word: string) => ((word.charCodeAt(word.length - 1) - 0xac00) % 28 ? "을" : "를");

export function RoomCanvas({ size, initial }: { size: number; initial: Placement[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [items, setItems] = useState(initial);
  const [selected, setSelected] = useState<Kind | null>(null);
  const [error, setError] = useState("");
  const [cursor, setCursor] = useState<Point | null>(null);
  const statusId = useId();
  const [, startTransition] = useTransition();
  const room = useMemo(() => roomLayout(size), [size]);
  const drawn: DrawnFurniture[] = useMemo(
    () => items.map((p) => ({ ...p, height: KINDS[p.kind].height })),
    [items],
  );

  useEffect(() => {
    const canvas = canvasRef.current!;
    const paint = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = room.width * dpr;
      canvas.height = room.height * dpr;
      const c = canvas.getContext("2d")!;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      const css = getComputedStyle(canvas);
      const token = (name: string) => css.getPropertyValue(name).trim();
      drawRoom(c, room, drawn, selected, {
        floor: token("--floor"),
        line: token("--floor-line"),
        wallLeft: token("--wall-l"),
        wallRight: token("--wall-r"),
        window: token("--window"),
        selected: token("--sel"),
        cursor: token("--foreground"),
      }, cursor);
    };
    paint();
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", paint);
    return () => scheme.removeEventListener("change", paint);
  }, [room, drawn, selected, cursor]);

  const at = ([x, y]: Point) => items.find((p) => p.x === x && p.y === y);

  function onClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) * room.width) / rect.width;
    const py = ((e.clientY - rect.top) * room.height) / rect.height;
    const hit = pick(room, drawn, px, py);
    setError("");

    if (!hit) return setSelected(null);
    if ("item" in hit) return setSelected(hit.item.kind === selected ? null : hit.item.kind);
    moveTo(hit.tile);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLCanvasElement>) {
    const here = cursor ?? [0, 0];
    const step = ARROWS[e.key];
    if (step) {
      const clamp = (v: number) => Math.max(0, Math.min(size - 1, v));
      setCursor([clamp(here[0] + step[0]), clamp(here[1] + step[1])]);
    } else if (e.key === "Enter" || e.key === " ") {
      setError("");
      const item = at(here);
      if (item) setSelected(item.kind === selected ? null : item.kind);
      else moveTo(here);
    } else if (e.key === "Escape") {
      setSelected(null);
    } else return;
    e.preventDefault();
  }

  function moveTo([x, y]: Point) {
    if (!selected) return;
    if (at([x, y])) return setError(ERRORS.tile_taken);

    const moving = items.find((p) => p.kind === selected)!;
    const before = items;
    setItems(items.map((p) => (p.kind === selected ? { ...p, x, y } : p)));
    setSelected(null);
    startTransition(async () => {
      const result = await placeFurniture(moving.catalogId, x, y);
      if (result.error) {
        setItems(before);
        setError(ERRORS[result.error]);
      }
    });
  }

  const name = selected && KINDS[selected].name;
  const under = cursor && at(cursor);
  const where = cursor ? `(${cursor[0] + 1}, ${cursor[1] + 1}) ${under ? KINDS[under.kind].name : "빈 칸"} · ` : "";
  const hint = name
    ? `${name}${josa(name)} 놓을 빈 칸을 ${cursor ? "고르고 Enter를 누르세요" : "누르세요"}.`
    : cursor
      ? "방향키로 칸을 고르고 Enter로 가구를 집으세요."
      : "가구를 누른 뒤 빈 칸을 누르면 옮겨져요.";
  return (
    <div className={styles.room}>
      <canvas
        ref={canvasRef}
        onClick={onClick}
        onKeyDown={onKeyDown}
        // 마우스로 눌러 생긴 포커스에는 커서를 띄우지 않는다.
        onFocus={(e) => e.currentTarget.matches(":focus-visible") && setCursor((c) => c ?? [0, 0])}
        onBlur={() => setCursor(null)}
        tabIndex={0}
        className={styles.canvas}
        style={{ maxWidth: room.width, aspectRatio: `${room.width} / ${room.height}` }}
        role="application"
        aria-label={`${size}×${size} 방. 놓인 가구: ${items.map((p) => KINDS[p.kind].name).join(", ")}`}
        aria-describedby={statusId}
      />
      <p id={statusId} role="status" className={error ? styles.error : styles.hint}>
        {error || where + hint}
      </p>
    </div>
  );
}
