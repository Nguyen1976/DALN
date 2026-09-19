import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router";

import {
  AtSign,
  KeyRound,
  LogOut,
  Mail,
  Monitor,
  MonitorSmartphone,
  ShieldCheck,
  Smartphone,
} from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Switch } from "@/components/ui/switch";
import { logoutAPI, selectUser } from "@/redux/slices/userSlice";
import type { AppDispatch } from "@/redux/store";
import { SettingRow, SettingsCard, SettingsSection } from "./parts";

/** "Chrome trên macOS" from the user agent; enough to recognise a device. */
function describeThisDevice(ua: string) {
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\/|FxiOS/.test(ua)
        ? "Firefox"
        : /Chrome\/|CriOS/.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Trình duyệt";
  // iOS says "like Mac OS X" and Android says "Linux": test those first.
  const os = /iPhone|iPad|iPod/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return {
    name: os ? `${browser} trên ${os}` : browser,
    mobile: /Mobi|Android|iPhone|iPad/.test(ua),
  };
}

export default function AccountSettings() {
  const user = useSelector(selectUser);
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const device = describeThisDevice(navigator.userAgent);

  return (
    <>
      <SettingsSection title="Thông tin đăng nhập">
        <SettingsCard>
          <SettingRow
            icon={Mail}
            title="Email"
            description={<span className="break-all">{user.email}</span>}
          >
            {/* Accounts only open after the emailed code is entered. */}
            <Badge variant="success" size="sm">
              <ShieldCheck className="size-3" aria-hidden="true" />
              Đã xác thực
            </Badge>
          </SettingRow>
          <SettingRow
            icon={AtSign}
            title="Tên người dùng"
            description={`@${user.username}`}
          />
          <SettingRow
            icon={KeyRound}
            title="Mật khẩu"
            description="Đổi mật khẩu định kỳ giúp tài khoản an toàn hơn."
            soon
          >
            <Button variant="outline" size="sm" disabled>
              Đổi mật khẩu
            </Button>
          </SettingRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Bảo mật" step={1}>
        <SettingsCard>
          <SettingRow
            icon={ShieldCheck}
            title="Xác thực 2 lớp"
            description="Nhập thêm mã gửi qua email khi đăng nhập trên thiết bị mới."
            soon
          >
            <Switch checked={false} disabled aria-label="Xác thực 2 lớp" />
          </SettingRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Phiên đăng nhập" step={2}>
        <SettingsCard>
          <SettingRow
            icon={device.mobile ? Smartphone : Monitor}
            title={device.name}
            description={
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="size-1.5 rounded-full bg-success"
                />
                Thiết bị này · Đang hoạt động
              </span>
            }
          >
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmLogout(true)}
              className="hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive-text"
            >
              <LogOut aria-hidden="true" />
              Đăng xuất
            </Button>
          </SettingRow>
          <SettingRow
            icon={MonitorSmartphone}
            title="Các thiết bị khác"
            description="Xem và đăng xuất từ xa khỏi những thiết bị bạn không dùng nữa."
            soon
          />
        </SettingsCard>
      </SettingsSection>

      <ConfirmDialog
        open={confirmLogout}
        onOpenChange={setConfirmLogout}
        title="Đăng xuất khỏi DALN Chat?"
        description="Bạn sẽ thoát khỏi tài khoản trên thiết bị này. Tin nhắn đang soạn dở chưa gửi sẽ không được giữ lại."
        confirmLabel="Đăng xuất"
        onConfirm={() => {
          setConfirmLogout(false);
          dispatch(logoutAPI());
          navigate("/auth");
        }}
      />
    </>
  );
}
