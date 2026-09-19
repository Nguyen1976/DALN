import { useEffect, useId, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useDispatch, useSelector } from "react-redux";
import { useBlocker } from "react-router";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import z from "zod";

import {
  AtSign,
  Camera,
  Loader2,
  Lock,
  RotateCcw,
  Save,
} from "@/components/icons";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { selectUser, updateProfileAPI } from "@/redux/slices/userSlice";
import type { AppDispatch } from "@/redux/store";
import { SettingsCard, SettingsSection } from "./parts";

// The same limits the server enforces (UpdateProfileDto, the upload interceptor).
const MAX_NAME = 100;
const MAX_BIO = 500;
const MAX_AVATAR_MB = 2;

const schema = z.object({
  fullName: z
    .string()
    .trim()
    .max(MAX_NAME, `Tên hiển thị tối đa ${MAX_NAME} ký tự.`),
  bio: z.string().max(MAX_BIO, `Phần giới thiệu tối đa ${MAX_BIO} ký tự.`),
  avatar: z.instanceof(File).optional(),
});

type ProfileForm = z.infer<typeof schema>;

/** Label on top, then the control, then either its hint or its error. */
function Field({
  id,
  label,
  hint,
  error,
  aside,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </label>
        {aside}
      </div>
      {children}
      {error ? (
        <p
          id={`${id}-note`}
          role="alert"
          className="animate-pop-in text-sm text-destructive-text"
        >
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-note`} className="text-sm text-muted-foreground">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

/**
 * The public profile: photo, display name and bio. Email and password live
 * under "Tài khoản" — the server never took an email from this form anyway.
 *
 * Changes are held until "Lưu thay đổi" in the bar that rises while the form
 * differs from what is saved; leaving the tab with changes asks first.
 */
export default function ProfileSettings() {
  const user = useSelector(selectUser);
  const dispatch = useDispatch<AppDispatch>();
  const ids = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const form = useForm<ProfileForm>({
    resolver: zodResolver(schema),
    mode: "onBlur",
    defaultValues: {
      fullName: user.fullName || "",
      bio: user.bio || "",
      avatar: undefined,
    },
  });
  const { errors, isDirty } = form.formState;
  const [fullName = "", bio = ""] = useWatch({
    control: form.control,
    name: ["fullName", "bio"],
  });

  // Adopt fresh data from the server, unless the person is mid-edit.
  useEffect(() => {
    if (isDirty) return;
    form.reset({
      fullName: user.fullName || "",
      bio: user.bio || "",
      avatar: undefined,
    });
  }, [form, isDirty, user.fullName, user.bio]);

  // The object URL holds the picked file in memory until it is let go.
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  // The bar rises over the bottom of the view, possibly over the very field
  // being typed in; scroll that field clear of it (the scroll container
  // reserves room for the bar with scroll-padding).
  useEffect(() => {
    if (!isDirty) return;
    const frame = requestAnimationFrame(() => {
      const field = document.activeElement;
      if (field instanceof HTMLElement && field.closest("form")) {
        field.scrollIntoView({ block: "nearest" });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [isDirty]);

  // A reload or closed tab would drop the edits too.
  useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      isDirty &&
      !saving &&
      currentLocation.pathname !== nextLocation.pathname &&
      // Signing out wins; the rail already asked about that.
      !nextLocation.pathname.startsWith("/auth"),
  );

  const displayName = fullName.trim() || user.username;
  const initial = (displayName || "U")[0].toUpperCase();
  const avatarSrc = preview ?? user.avatar ?? "";

  const pickAvatar = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setAvatarError("Tệp này không phải ảnh. Hãy chọn JPG, PNG hoặc WebP.");
      return;
    }
    if (file.size > MAX_AVATAR_MB * 1024 * 1024) {
      setAvatarError(
        `Ảnh nặng ${(file.size / 1024 / 1024).toFixed(1)} MB, vượt quá ${MAX_AVATAR_MB} MB. Hãy chọn ảnh nhỏ hơn.`,
      );
      return;
    }
    setAvatarError(null);
    form.setValue("avatar", file, { shouldDirty: true });
    setPreview(URL.createObjectURL(file));
  };

  const keepCurrentAvatar = () => {
    form.setValue("avatar", undefined, { shouldDirty: true });
    setPreview(null);
    setAvatarError(null);
  };

  const discard = () => {
    form.reset();
    setPreview(null);
    setAvatarError(null);
  };

  const onSubmit = async (data: ProfileForm) => {
    const formData = new FormData();
    if (data.avatar) formData.append("avatar", data.avatar);
    formData.append("fullName", data.fullName);
    formData.append("bio", data.bio);

    setSaving(true);
    try {
      await dispatch(updateProfileAPI(formData)).unwrap();
      toast.success("Đã lưu hồ sơ");
      // What was saved becomes the new baseline; the bar sinks away.
      form.reset({ fullName: data.fullName, bio: data.bio, avatar: undefined });
      setPreview(null);
    } catch {
      toast.error("Không lưu được hồ sơ. Kiểm tra kết nối rồi thử lại.");
    } finally {
      setSaving(false);
    }
  };

  const nameId = `${ids}-name`;
  const usernameId = `${ids}-username`;
  const bioId = `${ids}-bio`;
  const avatarNoteId = `${ids}-avatar-note`;

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit(onSubmit)}
      className="flex flex-1 flex-col"
    >
      <SettingsSection title="Ảnh đại diện">
        <SettingsCard>
          <div className="flex items-center gap-4 p-4 sm:gap-5 sm:p-5">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={(event) => {
                pickAvatar(event.target.files?.[0]);
                // Picking the same file again should still fire a change.
                event.target.value = "";
              }}
            />
            {/* The photo itself is a target too, with a camera on hover. */}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              aria-label="Chọn ảnh đại diện mới"
              aria-describedby={avatarNoteId}
              className="group/avatar relative size-20 shrink-0 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:size-24"
            >
              <Avatar
                className={cn(
                  "size-20 border border-border sm:size-24",
                  preview &&
                    "ring-2 ring-primary ring-offset-2 ring-offset-card",
                )}
              >
                <AvatarImage src={avatarSrc} alt="" />
                <AvatarFallback className="text-3xl">{initial}</AvatarFallback>
              </Avatar>
              <span
                aria-hidden="true"
                className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity duration-(--motion-fast) group-hover/avatar:opacity-100 group-focus-visible/avatar:opacity-100"
              >
                <Camera className="size-6" />
              </span>
            </button>

            <div className="min-w-0 space-y-3">
              {/* A small preview: the name updates as it is typed below. */}
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-foreground">
                  {displayName}
                </p>
                <p className="truncate text-sm text-muted-foreground">
                  @{user.username}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileRef.current?.click()}
                >
                  <Camera aria-hidden="true" />
                  {preview ? "Chọn ảnh khác" : "Tải ảnh mới"}
                </Button>
                {preview && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={keepCurrentAvatar}
                    className="animate-pop-in"
                  >
                    <RotateCcw aria-hidden="true" />
                    Giữ ảnh cũ
                  </Button>
                )}
              </div>
              <p
                id={avatarNoteId}
                role={avatarError ? "alert" : undefined}
                className={cn(
                  "text-xs",
                  avatarError
                    ? "text-destructive-text"
                    : "text-muted-foreground",
                )}
              >
                {avatarError ??
                  `JPG, PNG hoặc WebP, tối đa ${MAX_AVATAR_MB} MB. Ảnh vuông hiển thị đẹp nhất.`}
              </p>
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Thông tin cá nhân" step={1}>
        <SettingsCard>
          <div className="space-y-5 p-5">
            <Field
              id={nameId}
              label="Tên hiển thị"
              hint={`Để trống thì mọi người sẽ thấy tên người dùng @${user.username}.`}
              error={errors.fullName?.message}
            >
              <Input
                id={nameId}
                placeholder="VD: Nguyễn Văn An"
                autoComplete="name"
                aria-invalid={Boolean(errors.fullName)}
                aria-describedby={`${nameId}-note`}
                {...form.register("fullName")}
              />
            </Field>

            {/* Read-only, not disabled: it can be selected and copied. */}
            <Field
              id={usernameId}
              label="Tên người dùng"
              hint="Dùng để tìm và kết bạn. Tên người dùng không thể thay đổi."
            >
              <div className="relative">
                <AtSign
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  id={usernameId}
                  value={user.username}
                  readOnly
                  aria-describedby={`${usernameId}-note`}
                  className="bg-muted/60 pl-9 pr-9 text-muted-foreground focus-visible:ring-0"
                />
                <Lock
                  aria-hidden="true"
                  className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                />
              </div>
            </Field>

            <Field
              id={bioId}
              label="Giới thiệu"
              hint="Sở thích, công việc, hay điều bạn muốn mọi người biết."
              error={errors.bio?.message}
              aside={
                <span
                  aria-hidden="true"
                  className={cn(
                    "text-xs tabular-nums",
                    bio.length > MAX_BIO
                      ? "font-medium text-destructive-text"
                      : "text-muted-foreground",
                  )}
                >
                  {bio.length}/{MAX_BIO}
                </span>
              }
            >
              <Textarea
                id={bioId}
                rows={4}
                placeholder="Viết vài dòng về bạn"
                className="resize-none"
                aria-invalid={Boolean(errors.bio)}
                aria-describedby={`${bioId}-note`}
                {...form.register("bio")}
              />
            </Field>
          </div>
        </SettingsCard>
      </SettingsSection>

      {/* Pinned to the bottom of the view while there is something to save. */}
      <div className="sticky bottom-0 z-10 mt-auto pt-6">
        {isDirty && (
          <div
            role="region"
            aria-label="Thay đổi chưa lưu"
            className="flex animate-dialog-in items-center gap-3 rounded-xl border border-border bg-popover p-2.5 pl-4 text-popover-foreground shadow-lg sm:p-3 sm:pl-4"
          >
            <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full bg-warning"
              />
              <span className="sm:hidden">Chưa lưu</span>
              <span className="hidden sm:inline">Bạn có thay đổi chưa lưu</span>
            </p>
            <div className="ml-auto flex shrink-0 gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={discard}
                disabled={saving}
              >
                Hủy
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <Save aria-hidden="true" />
                )}
                {saving ? "Đang lưu…" : "Lưu thay đổi"}
              </Button>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={blocker.state === "blocked"}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
        title="Rời đi mà chưa lưu?"
        description="Những thay đổi trên hồ sơ của bạn sẽ bị bỏ."
        confirmLabel="Bỏ thay đổi"
        cancelLabel="Ở lại"
        onConfirm={() => blocker.proceed?.()}
      />
    </form>
  );
}
