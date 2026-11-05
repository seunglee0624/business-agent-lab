import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Kind, Style } from "@/lib/room/kinds";
import { logout } from "./actions";
import styles from "./home.module.css";
import { RoomCanvas, type Placement } from "./room-canvas";

export default function HomePage() {
  return (
    <main className={styles.main}>
      <Suspense fallback={<p className={styles.hint}>집을 불러오는 중…</p>}>
        <MyHouse />
      </Suspense>
    </main>
  );
}

async function MyHouse() {
  const supabase = await createClient();
  const [profile, house, placements] = await Promise.all([
    supabase.from("profiles").select("nickname, house_name, points").single(),
    supabase.from("houses").select("size").single(),
    supabase.from("placements").select("kind, catalog_id, x, y, catalog(style)"),
  ]);

  if (!profile.data || !house.data || !placements.data) {
    return (
      <form action={logout}>
        <p role="alert" className={styles.error}>집을 불러오지 못했어요. 새로고침해 보고, 그래도 안 되면 다시 로그인해 주세요.</p>
        <button className={styles.logout}>로그아웃</button>
      </form>
    );
  }

  const initial: Placement[] = placements.data.map((p) => ({
    kind: p.kind as Kind,
    catalogId: p.catalog_id,
    style: (p.catalog as unknown as { style: Style }).style,
    x: p.x,
    y: p.y,
  }));

  return (
    <>
      <header className={styles.header}>
        <div>
          <h1>{profile.data.house_name}</h1>
          <p>
            {profile.data.nickname} · {profile.data.points}P
          </p>
        </div>
        <form action={logout}>
          <button className={styles.logout}>로그아웃</button>
        </form>
      </header>
      <RoomCanvas size={house.data.size} initial={initial} />
    </>
  );
}
