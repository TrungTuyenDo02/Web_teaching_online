/** Thương hiệu riêng: đổi tên, màu, khẩu hiệu ở đây (và logo trong public/ khi có). */
export const brand = {
  name: import.meta.env.VITE_APP_NAME ?? "Gia sư online",
  tagline: "Học 1-1, theo dõi tiến bộ từng em",
  primaryColor: "#1f4e79",
} as const;
