// app/layout.tsx
import type { Metadata } from "next";
import { Jua, Nanum_Pen_Script, Gowun_Dodum } from "next/font/google";
import "./globals.css";

// Google Fonts는 next/font/google로 로드 — CSS 변수로 노출
const jua = Jua({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-jua",
  display: "swap",
});

const nanumPen = Nanum_Pen_Script({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-nanum-pen",
  display: "swap",
});

const gowunDodum = Gowun_Dodum({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-gowun-dodum",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Summer FlashMob",
  description: "여름 정기 플래시몹 커뮤니티",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="ko"
      className={`${jua.variable} ${nanumPen.variable} ${gowunDodum.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}