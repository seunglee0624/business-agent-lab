"use server";

import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const NICKNAME = /^[가-힣A-Za-z0-9]{2,12}$/;

// 한글은 이메일 주소에 쓸 수 없어서 닉네임의 해시를 내부 이메일로 쓴다. 가입 트리거가 같은 식으로 검증한다.
const emailOf = (nickname: string) =>
  `${createHash("sha256").update(nickname).digest("hex").slice(0, 32)}@home.local`;

const fail = (path: string, code: string): never => redirect(`${path}?error=${code}`);

export async function signup(formData: FormData) {
  const nickname = String(formData.get("nickname") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const houseName = String(formData.get("house_name") ?? "").trim();

  if (!NICKNAME.test(nickname)) fail("/signup", "nickname");
  if (password.length < 8) fail("/signup", "password");
  if (houseName.length > 20) fail("/signup", "house");

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: emailOf(nickname),
    password,
    options: { data: { nickname, house_name: houseName } },
  });
  if (error) fail("/signup", error.code === "user_already_exists" ? "taken" : "failed");
  redirect("/");
}

export async function login(formData: FormData) {
  const nickname = String(formData.get("nickname") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: emailOf(nickname), password });
  if (error) fail("/login", "login");
  redirect("/");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
