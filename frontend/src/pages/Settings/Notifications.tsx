import { useEffect } from "react";
import {
  Bell,
  BellOff,
  Mail,
  MessageSquare,
  Zap,
  type AppIcon,
} from "@/components/icons";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { SettingRow, SettingsCard, SettingsSection } from "./parts";
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch } from "@/redux/store";
import {
  getNotificationPreferences,
  getNotificationTypes,
  selectNotificationPreference,
  updateNotificationPreferences,
  type ChannelToggles,
  type NotificationPreferences,
} from "@/redux/slices/notificationPreferenceSlice";
import type { NotificationType } from "@/redux/slices/notificationSlice";

const CHANNELS: Array<{
  key: keyof ChannelToggles;
  label: string;
  hint: string;
  icon: AppIcon;
}> = [
  {
    key: "IN_APP",
    label: "Trong ứng dụng",
    hint: "Hiện ở chuông thông báo",
    icon: MessageSquare,
  },
  { key: "EMAIL", label: "Email", hint: "Gửi tới hộp thư của bạn", icon: Mail },
  {
    key: "REALTIME",
    label: "Thời gian thực",
    hint: "Báo ngay khi đang mở app",
    icon: Zap,
  },
];

const typeLabels: Record<NotificationType, string> = {
  FRIEND_REQUEST_SENT: "Có lời mời kết bạn",
  FRIEND_REQUEST_ACCEPTED: "Lời mời kết bạn được chấp nhận",
  FRIEND_REQUEST_REJECTED: "Lời mời kết bạn bị từ chối",
  MENTIONED_IN_CONVERSATION: "Có người nhắc đến bạn",
  SYSTEM_NOTIFICATION: "Tóm tắt thông báo chưa đọc",
};

export default function NotificationSettings() {
  const dispatch = useDispatch<AppDispatch>();
  const { data, notificationTypes, isLoading, isSaving } = useSelector(
    selectNotificationPreference,
  );

  // Once per session: both live in redux, and saving a switch updates them
  // there. They used to be fetched again every time this tab was opened.
  const typesLoaded = notificationTypes.length > 0;
  const preferencesLoaded = Boolean(data);
  useEffect(() => {
    if (!typesLoaded) void dispatch(getNotificationTypes());
  }, [dispatch, typesLoaded]);
  useEffect(() => {
    if (!preferencesLoaded) void dispatch(getNotificationPreferences());
  }, [dispatch, preferencesLoaded]);

  // The server's list: a switch shows only for something it can send.
  const typeList = notificationTypes as NotificationType[];

  const handleGlobalChannelChange = async (
    channel: keyof ChannelToggles,
    checked: boolean,
  ) => {
    if (!data) return;

    await dispatch(
      updateNotificationPreferences({
        global: {
          ...data.global,
          channels: {
            ...data.global.channels,
            [channel]: checked,
          },
        },
      } as Partial<NotificationPreferences>),
    );
  };

  const handleTypeChannelChange = async (
    type: string,
    channel: keyof ChannelToggles,
    checked: boolean,
  ) => {
    if (!data) return;

    const currentTypeSetting = data.overrides[type];

    await dispatch(
      updateNotificationPreferences({
        overrides: {
          [type]: {
            ...currentTypeSetting,
            [channel]: checked,
          },
        },
      }),
    );
  };

  const handleGlobalEnabled = async (checked: boolean) => {
    if (!data) return;

    await dispatch(
      updateNotificationPreferences({
        global: {
          ...data.global,
          enabled: checked,
        },
      }),
    );
  };

  const handleDigestEnabled = async (checked: boolean) => {
    if (!data) return;

    await dispatch(
      updateNotificationPreferences({
        digest: {
          ...data.digest,
          enabled: checked,
        },
      }),
    );
  };

  const globalOff = Boolean(data && !data.global.enabled);

  if (!data) {
    return isLoading ? (
      <div aria-busy="true" aria-label="Đang tải cài đặt thông báo">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-2.5 not-first:mt-8">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-32 w-full rounded-xl" />
          </div>
        ))}
      </div>
    ) : null;
  }

  return (
    <>
      <SettingsSection title="Nhận thông báo">
        <SettingsCard>
          <SettingRow
            icon={data.global.enabled ? Bell : BellOff}
            title="Bật thông báo"
            description="Tắt để tạm dừng toàn bộ thông báo bên dưới."
          >
            <Switch
              checked={data.global.enabled}
              disabled={isSaving}
              aria-label="Nhận thông báo"
              onCheckedChange={(value) => void handleGlobalEnabled(value)}
            />
          </SettingRow>
          {/* Channels grey out, but keep their state, while all is off. */}
          <div
            className={cn(
              "divide-y divide-border transition-opacity duration-(--motion-base) ease-(--ease-out)",
              globalOff && "opacity-55",
            )}
          >
            {CHANNELS.map(({ key, label, hint, icon }) => (
              <SettingRow
                key={key}
                icon={icon}
                title={label}
                description={hint}
              >
                <Switch
                  checked={data.global.channels[key]}
                  disabled={globalOff || isSaving}
                  aria-label={`Kênh ${label}`}
                  onCheckedChange={(value) =>
                    void handleGlobalChannelChange(key, value)
                  }
                />
              </SettingRow>
            ))}
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Email tổng hợp" step={1}>
        <SettingsCard className={cn(globalOff && "opacity-55")}>
          <SettingRow
            icon={Mail}
            title="Gửi email tổng hợp"
            description={
              <>
                Khi có từ{" "}
                <span className="font-medium text-foreground">
                  {data.digest.minUnread} tin
                </span>{" "}
                chưa đọc, cách nhau ít nhất{" "}
                <span className="font-medium text-foreground">
                  {data.digest.cooldownMinutes} phút
                </span>
                .
              </>
            }
          >
            <Switch
              checked={data.digest.enabled}
              disabled={globalOff || isSaving}
              aria-label="Email tổng hợp"
              onCheckedChange={(value) => void handleDigestEnabled(value)}
            />
          </SettingRow>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Theo từng loại" step={2}>
        <SettingsCard
          className={cn(
            "@container transition-opacity duration-(--motion-base) ease-(--ease-out)",
            globalOff && "opacity-55",
          )}
        >
          {typeList.map((type) => {
            const channels = data.overrides[type];
            return (
              <div
                key={type}
                className="flex flex-col gap-3 px-4 py-4 sm:px-5 @2xl:flex-row @2xl:items-center @2xl:justify-between"
              >
                <p className="text-sm font-medium text-foreground">
                  {typeLabels[type]}
                </p>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                  {CHANNELS.map(({ key, label }) => (
                    <label
                      key={`${type}-${key}`}
                      className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground"
                    >
                      <Switch
                        checked={channels[key]}
                        disabled={globalOff || isSaving}
                        aria-label={`${typeLabels[type]} — ${label}`}
                        onCheckedChange={(value) =>
                          void handleTypeChannelChange(type, key, value)
                        }
                        className="h-5 w-9"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </SettingsCard>
      </SettingsSection>
    </>
  );
}
