import { useCallback, useEffect, useState } from "react";
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
import { ChangePasswordDialog } from "./ChangePasswordDialog";
import { Switch } from "@/components/ui/switch";
import { logoutAPI, selectUser } from "@/redux/slices/userSlice";
import {
  listSessionsAPI,
  logoutAllAPI,
  revokeSessionAPI,
  type UserSession,
} from "@/apis/user";
import { formatLastActive } from "@/utils/formatDateTime";
import { formatPlace } from "@/utils/geo";
import { SessionRow } from "./SessionRow";
import { toast } from "sonner";
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
  const [changingPassword, setChangingPassword] = useState(false);
  const [confirmLogoutAll, setConfirmLogoutAll] = useState(false);
  const device = describeThisDevice(navigator.userAgent);

  // `null` = chưa tải xong, khác hẳn `[]` = đã tải và không có thiết bị nào
  // khác. Gộp hai trạng thái đó lại sẽ hiện "chỉ có thiết bị này" trong lúc
  // danh sách còn đang về.
  const [sessions, setSessions] = useState<UserSession[] | null>(null);
  const [revokingSid, setRevokingSid] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      setSessions(await listSessionsAPI());
    } catch {
      // Interceptor đã hiện lỗi; ở đây chỉ cần thoát khỏi trạng thái tải.
      setSessions([]);
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const otherDevices = (sessions ?? []).filter((session) => !session.current);
  const currentSession =
    (sessions ?? []).find((session) => session.current) ?? null;

  const revokeOne = async (session: UserSession) => {
    setRevokingSid(session.sid);
    try {
      await revokeSessionAPI(session.sid);
      toast.success("Đã đăng xuất thiết bị đó.");
      await loadSessions();
    } finally {
      setRevokingSid(null);
    }
  };

  const logoutEverywhere = async () => {
    // Endpoint này giết CẢ phiên hiện tại, nên sau đó phải tự dọn state và
    // đưa người dùng về trang đăng nhập — không thì giao diện còn hiện như
    // đang đăng nhập cho tới request kế tiếp.
    await logoutAllAPI();
    await dispatch(logoutAPI());
    navigate("/auth", { replace: true });
  };

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
          >
            <Button
              variant="outline"
              size="sm"
              onClick={() => setChangingPassword(true)}
            >
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
          <SessionRow
            icon={device.mobile ? Smartphone : Monitor}
            title={device.name}
            session={currentSession}
            summary={
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
          </SessionRow>
          {sessions === null && (
            <SettingRow
              icon={MonitorSmartphone}
              title="Các thiết bị khác"
              description="Đang tải danh sách…"
            />
          )}

          {sessions !== null && otherDevices.length === 0 && (
            <SettingRow
              icon={MonitorSmartphone}
              title="Các thiết bị khác"
              description="Không có thiết bị nào khác đang đăng nhập."
            />
          )}

          {otherDevices.map((session) => {
            const other = describeThisDevice(session.userAgent ?? "");
            // Thiết bị đang ở đâu: vị trí của IP gần nhất, không tra được thì
            // chính IP đó. `?? session.ip` giữ trang chạy được với API cũ
            // trong lúc deploy, khi chưa có lastIp.
            const where =
              formatPlace(session.lastLocation) ??
              session.lastIp ??
              session.ip ??
              "IP không rõ";
            return (
              <SessionRow
                key={session.sid}
                icon={other.mobile ? Smartphone : Monitor}
                title={other.name}
                session={session}
                summary={`${where} · hoạt động ${formatLastActive(session.lastSeenAt)}`}
              >
                <Button
                  variant="outline"
                  size="sm"
                  disabled={revokingSid === session.sid}
                  onClick={() => void revokeOne(session)}
                  className="hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive-text"
                >
                  <LogOut aria-hidden="true" />
                  Đăng xuất
                </Button>
              </SessionRow>
            );
          })}

          {otherDevices.length > 0 && (
            <SettingRow
              icon={MonitorSmartphone}
              title="Đăng xuất khỏi mọi thiết bị"
              description="Dùng khi bạn nghi tài khoản bị người khác dùng. Thiết bị này cũng sẽ bị đăng xuất."
            >
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmLogoutAll(true)}
                className="hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive-text"
              >
                <LogOut aria-hidden="true" />
                Đăng xuất tất cả
              </Button>
            </SettingRow>
          )}
        </SettingsCard>
      </SettingsSection>

      <ChangePasswordDialog
        open={changingPassword}
        onOpenChange={setChangingPassword}
        // Tích "đăng xuất thiết bị khác" thì danh sách ngay trên đây vừa đổi.
        onChanged={() => void loadSessions()}
      />

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

      <ConfirmDialog
        open={confirmLogoutAll}
        onOpenChange={setConfirmLogoutAll}
        title="Đăng xuất khỏi mọi thiết bị?"
        description="Mọi phiên đăng nhập sẽ bị thu hồi ngay, kể cả thiết bị này. Dùng khi bạn nghi có người khác đang dùng tài khoản của mình."
        confirmLabel="Đăng xuất tất cả"
        onConfirm={() => {
          setConfirmLogoutAll(false);
          void logoutEverywhere();
        }}
      />
    </>
  );
}
