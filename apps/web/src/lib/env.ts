export const env = {
  apiUrl: (import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8000").replace(/\/$/, ""),
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? "",
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? "",
} as const;

export const isSupabaseConfigured = Boolean(env.supabaseUrl && env.supabaseAnonKey);
