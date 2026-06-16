import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Bell, Lock, Shield, X } from "lucide-react";
import Profile from "./Profile";

interface ProfileSettingsProps {
  onClose: () => void;
}

export function ProfileSettings({ onClose }: ProfileSettingsProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 p-4 text-foreground backdrop-blur-sm animate-fade-in">
      <div className="mt-4 flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl sm:mt-8">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border p-4">
          <h2 className="text-lg font-semibold sm:text-xl">
            Cài đặt &amp; Quyền riêng tư
          </h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Đóng"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-5" />
          </Button>
        </div>

        {/* Content */}
        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
          <Tabs defaultValue="profile" className="w-full">
            <TabsList className="custom-scrollbar w-full justify-start overflow-x-auto rounded-none border-b border-border bg-transparent p-0">
              <TabsTrigger
                value="profile"
                className="rounded-none border-b-2 border-transparent px-4 py-3 text-sm font-medium data-[state=active]:border-primary"
              >
                Hồ sơ
              </TabsTrigger>
              <TabsTrigger
                value="account"
                className="rounded-none border-b-2 border-transparent px-4 py-3 text-sm font-medium data-[state=active]:border-primary"
              >
                Tài khoản
              </TabsTrigger>
              <TabsTrigger
                value="privacy"
                className="rounded-none border-b-2 border-transparent px-4 py-3 text-sm font-medium data-[state=active]:border-primary"
              >
                Riêng tư
              </TabsTrigger>
              <TabsTrigger
                value="notifications"
                className="rounded-none border-b-2 border-transparent px-4 py-3 text-sm font-medium data-[state=active]:border-primary"
              >
                Thông báo
              </TabsTrigger>
            </TabsList>

            {/* Profile Tab */}
            <TabsContent value="profile" className="p-6 space-y-6">
              <Profile />
            </TabsContent>

            {/* Account Tab */}
            <TabsContent value="account" className="p-6 space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-4">
                  Cài đặt tài khoản
                </h3>

                <Card className="bg-muted border-border">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Lock className="w-4 h-4" />
                      Mật khẩu & Bảo mật
                    </CardTitle>
                    <CardDescription>
                      Quản lý mật khẩu và các tùy chọn bảo mật
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Button variant="outline" className="w-full bg-transparent">
                      Đổi mật khẩu
                    </Button>
                    <Button variant="outline" className="w-full bg-transparent">
                      Xác thực 2 lớp
                    </Button>
                  </CardContent>
                </Card>

                <Card className="bg-muted border-border mt-4">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Shield className="w-4 h-4" />
                      Phiên đăng nhập
                    </CardTitle>
                    <CardDescription>
                      Quản lý các phiên đang hoạt động
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button variant="outline" className="w-full bg-transparent">
                      Xem tất cả phiên
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Privacy Tab */}
            <TabsContent value="privacy" className="p-6 space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-4">
                  Cài đặt quyền riêng tư
                </h3>

                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-muted rounded-lg border border-border">
                    <div>
                      <h4 className="font-medium">Ai có thể xem hồ sơ của bạn</h4>
                      <p className="text-sm text-muted-foreground">
                        Kiểm soát ai có thể xem thông tin hồ sơ của bạn
                      </p>
                    </div>
                    <select className="px-3 py-1 bg-input border border-border rounded-md text-foreground focus:outline-none focus:ring-2 focus:ring-primary">
                      <option>Mọi người</option>
                      <option>Chỉ bạn bè</option>
                      <option>Riêng tư</option>
                    </select>
                  </div>

                  <div className="flex items-center justify-between p-4 bg-muted rounded-lg border border-border">
                    <div>
                      <h4 className="font-medium">
                        Trạng thái hoạt động gần đây
                      </h4>
                      <p className="text-sm text-muted-foreground">
                        Hiển thị thời điểm bạn hoạt động gần nhất
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label="Bật/tắt tùy chọn"
                      className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-input transition-colors"
                    >
                      <span className="inline-block size-4 translate-x-1 rounded-full bg-background shadow-sm transition-transform" />
                    </button>
                  </div>

                  <div className="flex items-center justify-between p-4 bg-muted rounded-lg border border-border">
                    <div>
                      <h4 className="font-medium">Trạng thái trực tuyến</h4>
                      <p className="text-sm text-muted-foreground">
                        Hiển thị trạng thái trực tuyến cho người khác
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label="Bật/tắt tùy chọn"
                      className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-input transition-colors"
                    >
                      <span className="inline-block size-4 translate-x-1 rounded-full bg-background shadow-sm transition-transform" />
                    </button>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Notifications Tab */}
            <TabsContent value="notifications" className="p-6 space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Bell className="w-5 h-5" />
                  Tùy chọn thông báo
                </h3>

                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-muted rounded-lg border border-border">
                    <div>
                      <h4 className="font-medium">Tin nhắn</h4>
                      <p className="text-sm text-muted-foreground">
                        Nhận thông báo khi có tin nhắn mới
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label="Bật/tắt tùy chọn"
                      className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-input transition-colors"
                    >
                      <span className="inline-block size-4 translate-x-1 rounded-full bg-background shadow-sm transition-transform" />
                    </button>
                  </div>

                  <div className="flex items-center justify-between p-4 bg-muted rounded-lg border border-border">
                    <div>
                      <h4 className="font-medium">Lời mời kết bạn</h4>
                      <p className="text-sm text-muted-foreground">
                        Nhận thông báo khi có lời mời kết bạn mới
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label="Bật/tắt tùy chọn"
                      className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-input transition-colors"
                    >
                      <span className="inline-block size-4 translate-x-1 rounded-full bg-background shadow-sm transition-transform" />
                    </button>
                  </div>

                  <div className="flex items-center justify-between p-4 bg-muted rounded-lg border border-border">
                    <div>
                      <h4 className="font-medium">Thông báo cuộc gọi</h4>
                      <p className="text-sm text-muted-foreground">
                        Nhận thông báo khi có người gọi cho bạn
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label="Bật/tắt tùy chọn"
                      className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-input transition-colors"
                    >
                      <span className="inline-block size-4 translate-x-1 rounded-full bg-background shadow-sm transition-transform" />
                    </button>
                  </div>

                  <div className="flex items-center justify-between p-4 bg-muted rounded-lg border border-border">
                    <div>
                      <h4 className="font-medium">Âm thanh</h4>
                      <p className="text-sm text-muted-foreground">
                        Phát âm thanh khi có thông báo
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label="Bật/tắt tùy chọn"
                      className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full bg-input transition-colors"
                    >
                      <span className="inline-block size-4 translate-x-1 rounded-full bg-background shadow-sm transition-transform" />
                    </button>
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
