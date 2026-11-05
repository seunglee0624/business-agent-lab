import Link from "next/link";
import { Suspense } from "react";
import { login } from "../actions";
import styles from "../auth.module.css";
import { ErrorMessage } from "../error-message";

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className={styles.main}>
      <form action={login} className={styles.form}>
        <h1>Home Diary</h1>
        <label>
          닉네임
          <input name="nickname" required autoComplete="username" />
        </label>
        <label>
          비밀번호
          <input name="password" type="password" required autoComplete="current-password" />
        </label>
        <Suspense>
          <ErrorMessage searchParams={searchParams} />
        </Suspense>
        <button>들어가기</button>
        <p className={styles.hint}>
          처음이에요? <Link href="/signup">집 만들기</Link>
        </p>
      </form>
    </main>
  );
}
