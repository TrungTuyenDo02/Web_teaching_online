import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env, isSupabaseConfigured } from "./env";

/** null khi chưa điền VITE_SUPABASE_*; giao diện sẽ hiện hướng dẫn thay vì báo lỗi khó hiểu. */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(env.supabaseUrl, env.supabaseAnonKey)
  : null;
