import { env } from "./env";
import { supabase } from "./supabase";

export type Role = "teacher" | "student";
export type DeviceMode = "main" | "board";

export interface Credentials {
  url: string;
  token: string;
}

export interface JoinResponse {
  session_id: string;
  room_name: string;
  role: Role;
  mode: DeviceMode;
  livekit: Credentials | null;
  whiteboard: Credentials;
}

export interface EndSessionBody {
  summary?: string;
  homework_note?: string;
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
  const token = data.session?.access_token;
  const resp = await fetch(`${env.apiUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!resp.ok) {
    let detail = `Lỗi ${resp.status}`;
    try {
      const body = (await resp.json()) as { detail?: unknown };
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      /* giữ thông báo mặc định */
    }
    throw new Error(detail);
  }
  return (await resp.json()) as T;
}

export const joinSession = (sessionId: string, mode: DeviceMode) =>
  apiFetch<JoinResponse>(`/api/sessions/${sessionId}/join`, {
    method: "POST",
    body: JSON.stringify({ mode }),
  });

export const endSession = (sessionId: string, body: EndSessionBody) =>
  apiFetch<{ session_id: string; status: string; ended_at: string }>(
    `/api/sessions/${sessionId}/end`,
    { method: "POST", body: JSON.stringify(body) },
  );
