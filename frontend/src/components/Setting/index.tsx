import { useState } from "react";
import { useNavigate } from "react-router";
import {
  Bell,
  ChevronRight,
  KeyRound,
  Shield,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLiquidUnderline } from "@/hooks/useLiquidUnderline";
import { useModalExit } from "@/hooks/useModalExit";
import { cn } from "@/lib/utils";
import Profile from "./Profile";

const TABS = [
  { value: "profile", label: "Hồ sơ", icon: UserRound },
  { value: "account", label: "Tài khoản", icon: KeyRound },
  { value: "privacy", label: "Riêng tư", icon: Shield },
  { value: "notifications", label: "Thông báo", icon: Bell },
] as const;

type TabValue = (typeof TABS)[number]["value"];

interface ProfileSettingsProps {
  onClose: () => void;
}

/** One settings line: what it is, why it matters, and its control. */
function SettingRow({
  title,
  description,
  soon = false,
  children,
}: {
  title: string;
  description: string;
  soon?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3.5">
      <div className="min-w-0 space-y-0.5">
        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
          {title}
          {soon && (
            <Badge variant="secondary" size="sm">
              Sắp có
            </Badge>
          )}
        </p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}

function SettingGroup({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
        {title}
      </h3>
      <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70">
        {children}
      </div>
    </section>
  );
}

export function ProfileSettings({ onClose }: ProfileSettingsProps) {
  const { closing, requestClose, onOverlayAnimationEnd } =
    useModalExit(onClose);
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabValue>("profile");
  const { listRef, lineRef, tabRefs } = useLiquidUnderline(
    TABS.findIndex((item) => item.value === tab),
  );

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-start justify-center bg-scrim p-4 text-foreground backdrop-blur-sm",
        closing ? "animate-overlay-out" : "animate-overlay-in",
      )}
      onAnimationEnd={onOverlayAnimationEnd}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className={cn(
          "mt-4 flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border/70 bg-card shadow-2xl sm:mt-10",
          closing ? "animate-dialog-out" : "animate-dialog-in",
        )}
      >
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as TabValue)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <header className="shrink-0 border-b border-border/60 px-5 pt-5 sm:px-6">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-0.5">
                <h2
                  id="settings-title"
                  className="text-lg font-semibold tracking-[-0.01em]"
                >
                  Cài đặt
                </h2>
                <p className="text-sm text-muted-foreground">
                  Hồ sơ, tài khoản và quyền riêng tư của bạn.
                </p>
              </div>
              <Button
                variant="ghost-muted"
                size="icon"
                onClick={requestClose}
                aria-label="Đóng"
                className="-mr-2 -mt-1"
              >
                <X className="size-5" />
              </Button>
            </div>

            {/* Same underline tabs as the Friends screen. -mb-px lays the row
                over the header's bottom border, so the bar covers that line
                instead of floating above it (and the scroll box can't clip it). */}
            <TabsList
              ref={listRef}
              className="custom-scrollbar relative -mb-px mt-3 h-auto w-full justify-start gap-1 overflow-x-auto rounded-none bg-transparent p-0"
            >
              {TABS.map(({ value, label, icon: Icon }, index) => (
                <TabsTrigger
                  key={value}
                  value={value}
                  ref={(node) => {
                    tabRefs.current[index] = node;
                  }}
                  className="h-auto flex-none gap-2 rounded-none border-b-2 border-transparent bg-transparent px-3 py-2.5 text-muted-foreground shadow-none hover:text-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {label}
                </TabsTrigger>
              ))}
              <span
                ref={lineRef}
                aria-hidden="true"
                className="pointer-events-none absolute bottom-0 left-0 h-0.5 origin-left rounded-full bg-primary opacity-0"
              />
            </TabsList>
          </header>

          <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
            <TabsContent value="profile">
              <Profile />
            </TabsContent>

            <TabsContent value="account" className="space-y-6 p-5 sm:p-6">
              <SettingGroup icon={KeyRound} title="Mật khẩu & bảo mật">
                <SettingRow
                  title="Đổi mật khẩu"
                  description="Đặt mật khẩu mới cho tài khoản của bạn."
                  soon
                />
                <SettingRow
                  title="Xác thực 2 lớp"
                  description="Thêm một bước xác nhận khi đăng nhập."
                  soon
                />
              </SettingGroup>
              <SettingGroup icon={Shield} title="Phiên đăng nhập">
                <SettingRow
                  title="Thiết bị đang đăng nhập"
                  description="Xem và đăng xuất khỏi các thiết bị khác."
                  soon
                />
              </SettingGroup>
            </TabsContent>

            <TabsContent value="privacy" className="space-y-6 p-5 sm:p-6">
              <SettingGroup icon={Shield} title="Ai thấy gì về bạn">
                <SettingRow
                  title="Hiển thị hồ sơ"
                  description="Chọn ai có thể xem thông tin hồ sơ của bạn."
                  soon
                />
                <SettingRow
                  title="Trạng thái trực tuyến"
                  description="Cho người khác thấy khi bạn đang hoạt động."
                  soon
                >
                  <Switch
                    checked
                    disabled
                    aria-label="Trạng thái trực tuyến"
                  />
                </SettingRow>
                <SettingRow
                  title="Hoạt động gần đây"
                  description="Hiển thị thời điểm bạn hoạt động gần nhất."
                  soon
                >
                  <Switch checked disabled aria-label="Hoạt động gần đây" />
                </SettingRow>
              </SettingGroup>
            </TabsContent>

            <TabsContent value="notifications" className="space-y-6 p-5 sm:p-6">
              <SettingGroup icon={Bell} title="Thông báo">
                <SettingRow
                  title="Cài đặt thông báo"
                  description="Chọn loại thông báo và kênh nhận: trong ứng dụng, email."
                >
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      onClose();
                      navigate("/settings/notifications");
                    }}
                  >
                    Mở
                    <ChevronRight aria-hidden="true" />
                  </Button>
                </SettingRow>
              </SettingGroup>
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}
