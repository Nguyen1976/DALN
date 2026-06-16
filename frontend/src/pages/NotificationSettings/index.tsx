import { useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
import { Link } from "react-router";

function normalizeChannels(data?: Partial<ChannelToggles>): ChannelToggles {
  return {
    IN_APP: data?.IN_APP ?? true,
    EMAIL: data?.EMAIL ?? true,
    REALTIME: data?.REALTIME ?? true,
  };
}

const channelLabels: Record<keyof ChannelToggles, string> = {
  IN_APP: "Trong ứng dụng",
  EMAIL: "Email",
  REALTIME: "Thời gian thực",
};

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

  return (
    <div className="min-h-[100dvh] bg-background">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-foreground">
              Cài đặt thông báo
            </h1>
            <p className="text-sm text-muted-foreground">
              Quản lý kênh nhận thông báo theo nhu cầu của bạn.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link to="/">Quay lại chat</Link>
          </Button>
        </div>

        {isLoading && (
          <p className="text-sm text-muted-foreground">Đang tải cấu hình...</p>
        )}

        {data && (
          <>
            <section className="space-y-4 rounded-xl border border-border bg-card p-5">
              <h2 className="font-semibold text-foreground">Tùy chọn chung</h2>

            <div className="flex items-center gap-3">
              <Checkbox
                id="global-enabled"
                checked={data.global.enabled}
                onCheckedChange={(value) =>
                  void handleGlobalEnabled(Boolean(value))
                }
              />
              <Label htmlFor="global-enabled">
                Bật notification toàn hệ thống
              </Label>
            </div>

            <div className="grid md:grid-cols-3 gap-3">
              {(
                ["IN_APP", "EMAIL", "REALTIME"] as Array<keyof ChannelToggles>
              ).map((channel) => (
                <div
                  key={channel}
                  className="flex items-center gap-3 rounded-md border p-3"
                >
                  <Checkbox
                    id={`global-${channel}`}
                    checked={data.global.channels[channel]}
                    disabled={!data.global.enabled || isSaving}
                    onCheckedChange={(value) =>
                      void handleGlobalChannelChange(channel, Boolean(value))
                    }
                  />
                  <Label htmlFor={`global-${channel}`}>
                    {channelLabels[channel]}
                  </Label>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-4 rounded-xl border border-border bg-card p-5">
            <h2 className="font-semibold text-foreground">Tổng hợp email</h2>
            <div className="flex items-center gap-3">
              <Checkbox
                id="digest-enabled"
                checked={data.digest.enabled}
                disabled={!data.global.enabled || isSaving}
                onCheckedChange={(value) =>
                  void handleDigestEnabled(Boolean(value))
                }
              />
              <Label htmlFor="digest-enabled">Bật email tổng hợp</Label>
            </div>
            <p className="text-xs text-muted-foreground">
              Số tin chưa đọc tối thiểu: {data.digest.minUnread} | thời gian chờ:{" "}
              {data.digest.cooldownMinutes} phút
            </p>
          </section>

          <section className="space-y-4 rounded-xl border border-border bg-card p-5">
            <h2 className="font-semibold text-foreground">
              Theo từng loại thông báo
            </h2>
            <div className="space-y-3">
              {typeList.map((type) => {
                const channels = normalizeChannels(data.overrides?.[type]);
                return (
                  <div
                    key={type}
                    className="flex flex-col gap-3 rounded-lg border border-border p-3 md:flex-row md:items-center md:justify-between"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {typeLabels[type] || type}
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      {(
                        ["IN_APP", "EMAIL", "REALTIME"] as Array<
                          keyof ChannelToggles
                        >
                      ).map((channel) => (
                        <div
                          key={`${type}-${channel}`}
                          className="flex items-center gap-2"
                        >
                          <Checkbox
                            id={`${type}-${channel}`}
                            checked={channels[channel]}
                            disabled={!data.global.enabled || isSaving}
                            onCheckedChange={(value) =>
                              void handleTypeChannelChange(
                                type,
                                channel,
                                Boolean(value),
                              )
                            }
                          />
                          <Label
                            htmlFor={`${type}-${channel}`}
                            className="text-xs"
                          >
                            {channelLabels[channel]}
                          </Label>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
          </>
        )}
      </div>
    </div>
  );
}
