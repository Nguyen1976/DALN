import { useLocation } from "react-router";

import { Bell, KeyRound, Shield, UserRound } from "@/components/icons";
import { TabbedLayout } from "@/layouts/TabbedLayout";

const TABS = [
  {
    path: "/settings",
    label: "Hồ sơ",
    icon: UserRound,
    description: "Ảnh đại diện, tên và phần giới thiệu mọi người thấy về bạn.",
  },
  {
    path: "/settings/account",
    label: "Tài khoản",
    icon: KeyRound,
    description: "Email, mật khẩu, bảo mật và các thiết bị đang đăng nhập.",
  },
  {
    path: "/settings/privacy",
    label: "Riêng tư",
    icon: Shield,
    description: "Chọn ai được thấy gì về bạn.",
  },
  {
    path: "/settings/notifications",
    label: "Thông báo",
    icon: Bell,
    description: "Chọn việc gì đáng báo cho bạn, và báo qua kênh nào.",
  },
];

/**
 * Settings as a screen of its own, laid out like Friends: one tab per area,
 * each at its own URL (so a link can open straight onto notifications).
 */
export function SettingsPage({ children }: { children?: React.ReactNode }) {
  const { pathname } = useLocation();
  const active = TABS.find((tab) => tab.path === pathname) ?? TABS[0];

  return (
    <TabbedLayout
      title="Cài đặt"
      description={active.description}
      tabs={TABS}
      tabsLabel="Mục cài đặt"
    >
      <div className="custom-scrollbar min-h-0 flex-1 scroll-pb-24 overflow-y-auto px-4 py-6 md:px-6 md:py-8">
        {/* One centred column at a readable width. min-h-full lets a tab pin
            a bar to the bottom of the view, and scroll-pb keeps a focused
            field from settling under that bar. */}
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col">
          {children}
        </div>
      </div>
    </TabbedLayout>
  );
}
