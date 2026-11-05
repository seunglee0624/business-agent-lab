"use server";

import { redirect } from "next/navigation";
import { emailOf, NICKNAME } from "@/lib/auth/nickname";
import { createClient } from "@/lib/supabase/server";

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

const PLACE_ERRORS = ["tile_taken", "outside_room", "not_owned"] as const;

export async function placeFurniture(catalogId: string, x: number, y: number) {
  if (typeof catalogId !== "string" || !Number.isInteger(x) || !Number.isInteger(y)) return { error: "failed" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("place_furniture", { p_catalog_id: catalogId, p_x: x, p_y: y });
  if (!error) return {};
  return { error: PLACE_ERRORS.find((code) => error.message.includes(code)) ?? "failed" };
}
