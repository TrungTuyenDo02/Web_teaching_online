/** Thương hiệu riêng: đổi tên, khẩu hiệu ở đây; màu ở src/styles/tokens.css (logo trong public/ khi có). */
export const brand = {
  name: import.meta.env.VITE_APP_NAME ?? "Gia sư online",
  tagline: "Học 1-1, theo dõi tiến bộ từng em",
} as const;
