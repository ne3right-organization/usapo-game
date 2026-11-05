import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "フォローのおさそい",
  robots: { index: false, follow: false },
};

export default function FollowLayout({ children }: { children: React.ReactNode }) {
  return children;
}
