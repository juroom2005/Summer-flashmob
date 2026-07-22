// app/layout.tsx
import type { Metadata } from "next";
import { Jua, Gaegu, Gowun_Dodum, Nanum_Pen_Script } from "next/font/google";
import "./globals.css";
import { PasswordResetProvider } from "@/components/password-reset/PasswordResetProvider";
import GmPasswordResetGate from "@/components/password-reset/GmPasswordResetGate";
import PasswordResetBanner from "@/components/password-reset/PasswordResetBanner";

// Google Fonts는 next/font/google로 로드 — CSS 변수로 노출
const jua = Jua({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-jua",
  display: "swap",
});

const gaegu = Gaegu({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-gaegu",
  display: "swap",
});

const gowunDodum = Gowun_Dodum({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-gowun-dodum",
  display: "swap",
});

// 남겨둠 — 시안 1a에서 사용되던 폰트 (다른 페이지에서 쓸 수 있음)
const nanumPen = Nanum_Pen_Script({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-nanum-pen",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Summer FlashMob",
  description: "춤추지 않으면 손해인 날도 있다.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="ko"
      translate="no"
      className={`${jua.variable} ${gaegu.variable} ${gowunDodum.variable} ${nanumPen.variable}`}
    >
      <body>
        <PasswordResetProvider>
          <PasswordResetBanner />
          {children}
          <GmPasswordResetGate />
        </PasswordResetProvider>
      </body>
    </html>
  );
}