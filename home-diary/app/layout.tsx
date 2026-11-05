import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Home Diary",
  description: "가구로 일상을 기록하고 이웃과 집을 나누는 다이어리",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
