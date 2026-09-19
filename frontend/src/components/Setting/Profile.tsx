import { useEffect, useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useDispatch, useSelector } from "react-redux";
import { zodResolver } from "@hookform/resolvers/zod";
import { Camera, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import z from "zod";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Form } from "../ui/form";
import {
  fetchUserByIdAPI,
  selectUser,
  updateProfileAPI,
} from "@/redux/slices/userSlice";
import type { AppDispatch } from "@/redux/store";

const formProfileScheme = z.object({
  fullName: z.string().min(1),
  email: z.string().email(),
  bio: z.string(),
  avatar: z.instanceof(File).optional(), // cho phép không đổi ảnh
});

type ProfileForm = z.infer<typeof formProfileScheme>;

/** A label above its field, the way every other form in the app lays out. */
function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * Sign-out used to sit here too, as a red button beside "save"; the rail
 * already has it (with a confirmation), so this tab is only about the profile.
 */
const Profile = () => {
  const user = useSelector(selectUser);
  const dispatch = useDispatch<AppDispatch>();
  const fileRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const ids = useId();

  useEffect(() => {
    dispatch(fetchUserByIdAPI(user.id));
  }, [user.id, dispatch]);

  const formProfile = useForm<ProfileForm>({
    resolver: zodResolver(formProfileScheme),
    defaultValues: {
      fullName: user.fullName || "",
      email: user.email || "",
      bio: user.bio || "",
      avatar: undefined,
    },
  });

  const [preview, setPreview] = useState<string>(user.avatar || "");
  const name = user.fullName || user.username;

  const onSubmit = async (data: ProfileForm) => {
    const formData = new FormData();
    if (data.avatar) formData.append("avatar", data.avatar);
    formData.append("fullName", data.fullName);
    formData.append("email", data.email);
    formData.append("bio", data.bio);

    setSaving(true);
    dispatch(updateProfileAPI(formData))
      .unwrap()
      .then(() => {
        toast.success("Cập nhật hồ sơ thành công");
        // The saved values become the new baseline, so "save" greys out again.
        formProfile.reset({ ...data, avatar: undefined });
      })
      .catch(() => {
        toast.error("Cập nhật hồ sơ thất bại");
      })
      .finally(() => setSaving(false));
  };

  return (
    <Form {...formProfile}>
      <form noValidate onSubmit={formProfile.handleSubmit(onSubmit)}>
        <div className="space-y-6 p-5 sm:p-6">
          <div className="flex items-center gap-4">
            <Avatar className="size-20 border border-border/70">
              <AvatarImage src={preview} alt={`Ảnh đại diện ${name}`} />
              <AvatarFallback className="bg-accent text-2xl font-semibold text-accent-foreground">
                {(name || "U")[0].toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 space-y-2">
              <div>
                <p className="truncate font-semibold text-foreground">
                  {name}
                </p>
                <p className="truncate text-sm text-muted-foreground">
                  @{user.username}
                </p>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  formProfile.setValue("avatar", file, { shouldDirty: true });
                  setPreview(URL.createObjectURL(file));
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
              >
                <Camera aria-hidden="true" />
                Đổi ảnh
              </Button>
            </div>
          </div>

          <div className="space-y-4">
            <Field id={`${ids}-name`} label="Họ và tên">
              <Input
                id={`${ids}-name`}
                placeholder="Nhập họ và tên"
                autoComplete="name"
                {...formProfile.register("fullName")}
              />
            </Field>
            <Field id={`${ids}-email`} label="Email">
              <Input
                id={`${ids}-email`}
                type="email"
                placeholder="Nhập email"
                autoComplete="email"
                {...formProfile.register("email")}
              />
            </Field>
            <Field id={`${ids}-bio`} label="Tiểu sử">
              <Textarea
                id={`${ids}-bio`}
                placeholder="Giới thiệu ngắn về bạn"
                rows={4}
                className="resize-none"
                {...formProfile.register("bio")}
              />
            </Field>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-border/60 px-5 py-4 sm:px-6">
          <p className="text-sm text-muted-foreground">
            {formProfile.formState.isDirty
              ? "Bạn có thay đổi chưa lưu."
              : "Mọi thay đổi đã được lưu."}
          </p>
          <Button
            type="submit"
            disabled={!formProfile.formState.isDirty || saving}
          >
            {saving ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <Save aria-hidden="true" />
            )}
            {saving ? "Đang lưu…" : "Lưu thay đổi"}
          </Button>
        </div>
      </form>
    </Form>
  );
};

export default Profile;
