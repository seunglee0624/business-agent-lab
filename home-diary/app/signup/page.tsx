import Link from "next/link";
import { Suspense } from "react";
import { signup } from "../actions";
import styles from "../auth.module.css";
import { ErrorMessage } from "../error-message";

export default function SignupPage({ searchParams }: PageProps<"/signup">) {
  return (
    <main className={styles.main}>
      <form action={signup} className={styles.form}>
        <h1>집 만들기</h1>
        <label>
          닉네임
          <input name="nickname" required minLength={2} maxLength={12} pattern="[가-힣A-Za-z0-9]{2,12}" autoComplete="username" />
          <small>2~12자 한글·영문·숫자. 나중에 바꿀 수 없어요.</small>
        </label>
        <label>
          비밀번호
          <input name="password" type="password" required minLength={8} autoComplete="new-password" />
          <small>8자 이상. 찾기 기능이 없으니 잊지 마세요.</small>
        </label>
        <label>
          집 이름
          <input name="house_name" maxLength={20} placeholder="비워 두면 '닉네임의 집'" />
        </label>
        <Suspense>
          <ErrorMessage searchParams={searchParams} />
        </Suspense>
        <button>시작하기</button>
        <p className={styles.hint}>
          이미 집이 있어요? <Link href="/login">들어가기</Link>
        </p>
      </form>
    </main>
  );
}
