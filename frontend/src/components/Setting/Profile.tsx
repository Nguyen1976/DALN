import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LogOut, Save } from "lucide-react";
import { useForm } from "react-hook-form";
import z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form } from "../ui/form";
import {
  fetchUserByIdAPI,
  selectUser,
  updateProfileAPI,
} from "@/redux/slices/userSlice";
import { useDispatch, useSelector } from "react-redux";
import { useEffect, useState } from "react";
import type { AppDispatch } from "@/redux/store";
import { toast } from "sonner";

const formProfileScheme = z.object({
  fullName: z.string().min(1),
  email: z.string().email(),
  bio: z.string(),
  avatar: z.instanceof(File).optional(), // cho phép không đổi ảnh
});

const Profile = () => {
  const user = useSelector(selectUser);

  const dispatch = useDispatch<AppDispatch>();

  useEffect(() => {
    dispatch(fetchUserByIdAPI(user.id));
  }, [user.id, dispatch]);

  const formProfile = useForm<z.infer<typeof formProfileScheme>>({
    resolver: zodResolver(formProfileScheme),
    defaultValues: {
      fullName: user.fullName || "",
      email: user.email || "",
      bio: user.bio || "",
      avatar: user.avatar ? undefined : undefined,
    },
  });

  const [preview, setPreview] = useState<string>(
    user.avatar || "/placeholder.svg",
  );

  const onSubmit = async (data: z.infer<typeof formProfileScheme>) => {
    const formData = new FormData();
    if (data.avatar) formData.append("avatar", data.avatar);
    formData.append("fullName", data.fullName);
    formData.append("email", data.email);
    formData.append("bio", data.bio);

    dispatch(updateProfileAPI(formData))
      .unwrap()
      .then(() => {
        toast.success("Cập nhật hồ sơ thành công");
      })
      .catch(() => {
        toast.error("Cập nhật hồ sơ thất bại");
      });
  };
  return (
    <Form {...formProfile}>
      <form onSubmit={formProfile.handleSubmit(onSubmit)}>
        <div>
          <h3 className="text-lg font-semibold mb-4">Thông tin hồ sơ</h3>
          {/* Avatar Section */}
          <div className="flex items-center gap-6 mb-8 p-4 bg-muted rounded-lg">
            <Avatar className="w-24 h-24">
              <AvatarImage src={preview} alt={user.username} />
              <AvatarFallback className="text-2xl">
                {user.username?.[0]}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <h4 className="font-medium mb-2">{user.username}</h4>
              <p className="text-sm text-muted-foreground mb-3">
                Ảnh đại diện của bạn
              </p>
              <input
                type="file"
                accept="image/*"
                hidden
                id="avatar-upload"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;

                  // set vào react-hook-form
                  formProfile.setValue("avatar", file);

                  // preview ảnh
                  const url = URL.createObjectURL(file);
                  setPreview(url);
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  document.getElementById("avatar-upload")?.click()
                }
              >
                Đổi ảnh
              </Button>
            </div>
          </div>

          {/* Form Fields */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">
                Họ và tên
              </label>
              <Input
                placeholder="Nhập họ và tên"
                className="bg-input border-border"
                {...formProfile.register("fullName")}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Email</label>
              <Input
                type="email"
                placeholder="Nhập email"
                className="bg-input border-border"
                {...formProfile.register("email")}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Tiểu sử</label>
              <textarea
                placeholder="Giới thiệu ngắn về bạn"
                className="w-full px-3 py-2 bg-input border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                rows={4}
                {...formProfile.register("bio")}
              />
            </div>
          </div>
        </div>
        <div className="border-t border-border p-6 flex items-center justify-between gap-4">
          <Button variant="destructive" className="gap-2">
            <LogOut className="w-4 h-4" />
            Đăng xuất
          </Button>
          <Button
            className="gap-2 bg-primary hover:bg-primary/90"
            type="submit"
          >
            <Save className="w-4 h-4" />
            Lưu thay đổi
          </Button>
        </div>
      </form>
    </Form>
  );
};

export default Profile;
