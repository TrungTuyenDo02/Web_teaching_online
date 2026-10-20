import type { CSSProperties } from "react";

type DecorType = "sparkle" | "star4" | "moon" | "cloud";

const PATHS: Record<DecorType, string> = {
  sparkle: "M12 0 L14 10 L24 12 L14 14 L12 24 L10 14 L0 12 L10 10 Z",
  star4: "M12 2 L13.5 10.5 L22 12 L13.5 13.5 L12 22 L10.5 13.5 L2 12 L10.5 10.5 Z",
  moon: "M15 2 A10 10 0 1 0 22 16 A8 8 0 1 1 15 2 Z",
  cloud: "M6 18 A5 5 0 0 1 7 8 A6 6 0 0 1 18 9 A4.5 4.5 0 0 1 18 18 Z",
};

/** Hình trang trí SVG (DESIGN.md 5.10): không nhận chuột, focus, không được trình đọc màn hình đọc. */
export function Decor({
  type,
  size = 24,
  style,
  twinkle,
}: {
  type: DecorType;
  size?: number;
  style?: CSSProperties;
  twinkle?: boolean;
}) {
  const filled = type === "cloud" || type === "moon";
  return (
    <svg
      className={`decor${twinkle ? " decor--twinkle" : ""}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      style={style}
    >
      <path
        d={PATHS[type]}
        fill={filled ? "var(--bg-window)" : "var(--pink-200)"}
        stroke="var(--ink-900)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Vài hình ở rìa trang (ẩn dưới 1024px để không chiếm chỗ). */
export function DecorLayer() {
  return (
    <div className="decor-layer" aria-hidden="true">
      <Decor type="sparkle" size={28} twinkle style={{ top: 96, left: 24 }} />
      <Decor type="star4" size={20} twinkle style={{ top: 220, right: 32, animationDelay: "1.2s" }} />
      <Decor type="moon" size={30} style={{ bottom: 64, left: 28 }} />
      <Decor type="cloud" size={44} style={{ bottom: 120, right: 20 }} />
    </div>
  );
}
