// 테스트용 Postgres. Supabase가 미리 만들어 두는 auth 스키마·역할만 흉내 내고, 마이그레이션은 실제 파일을 그대로 돌린다.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { emailOf } from "../../lib/auth/nickname";

const MIGRATIONS = join(import.meta.dirname, "../migrations");

const SUPABASE_STUB = `
  create schema extensions;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role anon;
  create role authenticated;
  grant usage on schema public, auth, extensions to anon, authenticated;
  -- Supabase는 public 테이블 권한을 기본으로 열어 두고, 실제 차단은 RLS가 맡는다.
  alter default privileges in schema public grant all on tables to anon, authenticated;
`;

/** 마이그레이션을 순서대로 적용한 DB. until을 주면 그 파일 직전까지만 적용한다. */
export async function testDb(until?: string) {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_STUB);
  await applyMigrations(db, (file) => !until || file < until);
  return db;
}

export async function applyMigrations(db: PGlite, include: (file: string) => boolean = () => true) {
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    if (include(file)) await db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }
}

/** 앱과 같은 방식으로 가입시키고 사용자 id를 돌려준다. */
export async function signUp(db: PGlite, nickname: string) {
  const { rows } = await db.query<{ id: string }>(
    "insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id",
    [emailOf(nickname), { nickname }],
  );
  return rows[0].id;
}

/** 해당 사용자로 로그인한 상태(authenticated 역할, RLS 적용)에서 SQL을 실행한다. */
export async function as<T>(db: PGlite, userId: string, sql: string, params: unknown[] = []) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec("set role authenticated");
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec("reset role");
  }
}
