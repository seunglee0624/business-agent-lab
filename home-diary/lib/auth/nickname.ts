import { createHash } from "node:crypto";

export const NICKNAME = /^[가-힣A-Za-z0-9]{2,12}$/;

// 한글은 이메일 주소에 쓸 수 없어서 닉네임의 해시를 내부 이메일로 쓴다. 가입 트리거가 같은 식으로 검증한다.
export const emailOf = (nickname: string) =>
  `${createHash("sha256").update(nickname).digest("hex").slice(0, 32)}@home.local`;
