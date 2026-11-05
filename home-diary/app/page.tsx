import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { logout } from "./actions";
import styles from "./auth.module.css";

export default function HomePage() {
  return (
    <main className={styles.main}>
      <Suspense fallback={<p className={styles.hint}>집을 불러오는 중…</p>}>
        <MyHouse />
      </Suspense>
    </main>
  );
}

// shortcut: M0 확인용 화면. M1에서 방 캔버스로 바뀐다.
async function MyHouse() {
  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("nickname, house_name, points").single();

  return (
    <form action={logout} className={styles.form}>
      {profile ? (
        <>
          <h1>{profile.house_name}</h1>
          <p className={styles.hint}>
            {profile.nickname} · {profile.points}P
          </p>
        </>
      ) : (
        <p role="alert" className={styles.error}>프로필을 찾지 못했어요.</p>
      )}
      <button>로그아웃</button>
    </form>
  );
}
