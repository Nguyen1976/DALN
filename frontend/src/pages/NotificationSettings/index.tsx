import { useEffect, useMemo } from "react";
import { Bell, BellOff, Mail, MessageSquare, Zap } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/ui/feedback";
import MainLayout from "@/layouts/MainLayout";
import { cn } from "@/lib/utils";
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

function normalizeChannels(data?: Partial<ChannelToggles>): ChannelToggles {
  return {
    IN_APP: data?.IN_APP ?? true,
    EMAIL: data?.EMAIL ?? true,
    REALTIME: data?.REALTIME ?? true,
  };
}

const CHANNELS: Array<{
  key: keyof ChannelToggles;
  label: string;
  hint: string;
  icon: typeof Bell;
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

const typeLabels: Record<string, string> = {
  MESSAGE_RECEIVED: "Tin nhắn mới",
  FRIEND_REQUEST_SENT: "Lời mời kết bạn đã gửi",
  FRIEND_REQUEST_ACCEPTED: "Lời mời kết bạn được chấp nhận",
  FRIEND_REQUEST_REJECTED: "Lời mời kết bạn bị từ chối",
  SYSTEM_NOTIFICATION: "Thông báo hệ thống",
  USER_JOINED_GROUP: "Có người tham gia nhóm",
  USER_LEFT_GROUP: "Có người rời nhóm",
  USER_KICKED_FROM_GROUP: "Có người bị mời khỏi nhóm",
  USER_ADDED_TO_GROUP: "Có người được thêm vào nhóm",
};

export default function NotificationSettingsPage() {
  const dispatch = useDispatch<AppDispatch>();
  const { data, notificationTypes, isLoading, isSaving } = useSelector(
    selectNotificationPreference,
  );

  useEffect(() => {
    void dispatch(getNotificationTypes());
    void dispatch(getNotificationPreferences());
  }, [dispatch]);

  const typeList = useMemo(() => {
    if (notificationTypes.length > 0) {
      return notificationTypes;
    }
    return [
      "MESSAGE_RECEIVED",
      "FRIEND_REQUEST_SENT",
      "FRIEND_REQUEST_ACCEPTED",
      "FRIEND_REQUEST_REJECTED",
      "SYSTEM_NOTIFICATION",
      "USER_JOINED_GROUP",
      "USER_LEFT_GROUP",
      "USER_KICKED_FROM_GROUP",
      "USER_ADDED_TO_GROUP",
    ];
  }, [notificationTypes]);

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

    const currentTypeSetting = normalizeChannels(data.overrides?.[type]);

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

  return (
    <MainLayout>
      <div className="flex min-h-0 flex-1 flex-col bg-background">
        <PageHeader
          icon={Bell}
          title="Cài đặt thông báo"
          description="Chọn việc gì đáng báo cho bạn, và báo qua kênh nào."
        />

        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
          <div className="mx-auto max-w-3xl space-y-4">
            {isLoading && !data && (
              <div className="space-y-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-40 w-full rounded-xl" />
                ))}
              </div>
            )}

            {data && (
              <>
                {/* --- Master switch --- */}
                <section className="rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex gap-3">
                      <span
                        aria-hidden="true"
                        className={cn(
                          "flex size-10 shrink-0 items-center justify-center rounded-xl",
                          data.global.enabled
                            ? "bg-accent text-accent-foreground"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {data.global.enabled ? (
                          <Bell className="size-5" />
                        ) : (
                          <BellOff className="size-5" />
                        )}
                      </span>
                      <div className="space-y-0.5">
                        <p className="font-semibold text-foreground">
                          Nhận thông báo
                        </p>
                        <p className="text-sm leading-relaxed text-muted-foreground">
                          Tắt công tắc này sẽ tắt toàn bộ thông báo bên dưới.
                        </p>
                      </div>
                    </div>
                    <Switch
                      checked={data.global.enabled}
                      disabled={isSaving}
                      aria-label="Nhận thông báo"
                      onCheckedChange={(value) =>
                        void handleGlobalEnabled(value)
                      }
                    />
                  </div>

                  <div
                    className={cn(
                      "mt-4 grid gap-2 border-t border-border pt-4 sm:grid-cols-3",
                      globalOff && "opacity-55",
                    )}
                  >
                    {CHANNELS.map(({ key, label, hint, icon: Icon }) => (
                      <div
                        key={key}
                        className="flex items-start justify-between gap-3 rounded-lg border border-border p-3"
                      >
                        <div className="min-w-0 space-y-0.5">
                          <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                            <Icon
                              className="size-3.5 text-muted-foreground"
                              aria-hidden="true"
                            />
                            {label}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {hint}
                          </p>
                        </div>
                        <Switch
                          checked={data.global.channels[key]}
                          disabled={globalOff || isSaving}
                          aria-label={`Kênh ${label}`}
                          onCheckedChange={(value) =>
                            void handleGlobalChannelChange(key, value)
                          }
                        />
                      </div>
                    ))}
                  </div>
                </section>

                {/* --- Digest --- */}
                <section className="rounded-xl border border-border bg-card p-4 shadow-xs sm:p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-0.5">
                      <p className="font-semibold text-foreground">
                        Email tổng hợp
                      </p>
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        Gom tin chưa đọc thành một email thay vì báo từng cái.
                      </p>
                    </div>
                    <Switch
                      checked={data.digest.enabled}
                      disabled={globalOff || isSaving}
                      aria-label="Email tổng hợp"
                      onCheckedChange={(value) =>
                        void handleDigestEnabled(value)
                      }
                    />
                  </div>
                  <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
                    Gửi khi có tối thiểu{" "}
                    <span className="font-medium text-foreground">
                      {data.digest.minUnread}
                    </span>{" "}
                    tin chưa đọc, cách nhau ít nhất{" "}
                    <span className="font-medium text-foreground">
                      {data.digest.cooldownMinutes} phút
                    </span>
                    .
                  </p>
                </section>

                {/* --- Per type --- */}
                <section className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
                  <div className="border-b border-border p-4 sm:p-5">
                    <p className="font-semibold text-foreground">
                      Theo từng loại thông báo
                    </p>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      Tinh chỉnh kênh nhận cho từng sự kiện.
                    </p>
                  </div>

                  <ul className={cn("divide-y divide-border", globalOff && "opacity-55")}>
                    {typeList.map((type) => {
                      const channels = normalizeChannels(data.overrides?.[type]);
                      return (
                        <li
                          key={type}
                          className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
                        >
                          <p className="text-sm font-medium text-foreground">
                            {typeLabels[type] || type}
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
                                  aria-label={`${typeLabels[type] || type} — ${label}`}
                                  onCheckedChange={(value) =>
                                    void handleTypeChannelChange(
                                      type,
                                      key,
                                      value,
                                    )
                                  }
                                  className="h-5 w-9"
                                />
                                {label}
                              </label>
                            ))}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              </>
            )}
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
