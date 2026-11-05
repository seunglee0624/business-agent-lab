import styles from "./auth.module.css";

// 주소창 문구를 그대로 띄우지 않도록 코드만 받아 정해진 문장으로 바꾼다.
const MESSAGES: Record<string, string> = {
  nickname: "닉네임은 2~12자 한글·영문·숫자만 쓸 수 있어요.",
  password: "비밀번호는 8자 이상이어야 해요.",
  house: "집 이름은 20자까지 쓸 수 있어요.",
  taken: "이미 쓰는 닉네임이에요.",
  failed: "가입하지 못했어요. 잠시 후 다시 시도해 주세요.",
  login: "닉네임이나 비밀번호가 맞지 않아요.",
};

export async function ErrorMessage({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  const { error } = await searchParams;
  const message = typeof error === "string" ? MESSAGES[error] : undefined;
  return message ? <p role="alert" className={styles.error}>{message}</p> : null;
}
