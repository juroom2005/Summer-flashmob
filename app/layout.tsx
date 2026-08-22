// app/layout.tsx
import type { Metadata, Viewport } from "next";
import {
  Jua,
  Gaegu,
  Nanum_Pen_Script,
  Limelight,
  Monofett,
  Hachi_Maru_Pop,
} from "next/font/google";
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


const nanumPen = Nanum_Pen_Script({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-nanum-pen",
  display: "swap",
});

// D-day 숫자
const limelight = Limelight({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-limelight",
  display: "swap",
});
// UPDATE / EVENT 타이틀
const monofett = Monofett({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-monofett",
  display: "swap",
});
// 이벤트 배너 날짜
const hachiMaruPop = Hachi_Maru_Pop({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-hachi-maru-pop",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Summer FlashMob",
  description: "춤추지 않으면 손해인 날도 있다.",
};


export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
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
       className={`${jua.variable} ${gaegu.variable} ${nanumPen.variable} ${limelight.variable} ${monofett.variable} ${hachiMaruPop.variable}`}
    >
      <head>
        <link
          rel="preload"
          href="/fonts/NEXONLv2GothicRegular.otf"
          as="font"
          type="font/otf"
          crossOrigin="anonymous"
        />
      </head>
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