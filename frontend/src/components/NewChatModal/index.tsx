"use client";

import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { X, Search, Camera } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { useDispatch, useSelector } from "react-redux";
import {
  getFriends,
  selectFriend,
  selectFriendPage,
} from "@/redux/slices/friendSlice";
import type { AppDispatch } from "@/redux/store";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createConversation } from "@/redux/slices/conversationSlice";
import z from "zod";

interface NewChatModalProps {
  onClose: () => void;
}

const formConversationScheme = z.object({
  groupName: z.string().min(1, "Vui lòng nhập tên nhóm"),
  groupAvatar: z.instanceof(File).optional(), // cho phép không đổi ảnh
});

export function NewChatModal({ onClose }: NewChatModalProps) {
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [slectedFriends, setSelectedFriends] = useState<string[]>([]);
  const friends = useSelector(selectFriend);
  const page = useSelector(selectFriendPage);
  const dispatch = useDispatch<AppDispatch>();

  useEffect(() => {
    //fetch friends từ redux store hoặc API
    if (friends.length === 0) {
      dispatch(getFriends({ limit: 20, page: 1 }));
    }
  }, [dispatch, friends.length]);

  const loadMoreFriends = () => {
    dispatch(getFriends({ limit: 20, page: page + 1 }));
  };

  const inputRef = useRef<HTMLInputElement>(null);

  const { register, handleSubmit, setValue } = useForm<
    z.infer<typeof formConversationScheme>
  >({
    resolver: zodResolver(formConversationScheme),
  });

  const friendsOnStore = useSelector(selectFriend);

  const onSubmit = (data: z.infer<typeof formConversationScheme>) => {
    const formData = new FormData();
    if (data.groupAvatar) formData.append("groupAvatar", data.groupAvatar);
    formData.append("groupName", data.groupName);
    formData.append(
      "members",
      JSON.stringify(
        friendsOnStore
          .filter((friend) => slectedFriends.includes(friend.id))
          .map((friend) => ({
            userId: friend.id,
            username: friend.username,
            avatar: friend.avatar,
            fullName: friend.fullName,
          })),
      ),
    );
    dispatch(createConversation(formData))
      .unwrap()
      .finally(() => {
        onClose();
      });
  };

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/60 p-4 backdrop-blur-sm animate-fade-in">
      <form
        className="flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-lg"
        onSubmit={handleSubmit(onSubmit)}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border p-5">
          <div className="space-y-0.5">
            <h2 className="text-lg font-semibold tracking-[-0.01em] text-foreground">
              Tạo nhóm mới
            </h2>
            <p className="text-sm text-muted-foreground">
              Đặt tên nhóm và chọn những người bạn muốn thêm vào.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost-muted"
            size="icon"
            onClick={onClose}
            aria-label="Đóng"
            className="-mr-1 -mt-1 shrink-0"
          >
            <X className="size-5" />
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
          <Input
            type="file"
            accept="image/*"
            ref={inputRef}
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) setPreview(URL.createObjectURL(file));

              setValue("groupAvatar", file);
            }}
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              aria-label="Chọn ảnh đại diện nhóm"
              className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-dashed border-input bg-muted text-muted-foreground transition-colors duration-[--motion-fast] hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {!preview ? (
                <Camera className="size-5" aria-hidden="true" />
              ) : (
                <img
                  src={preview}
                  alt="Xem trước ảnh nhóm"
                  className="size-full object-cover"
                />
              )}
            </button>
            <div className="flex-1 space-y-1">
              <label
                htmlFor="new-group-name"
                className="text-sm font-medium text-foreground"
              >
                Tên nhóm
              </label>
              <Input
                id="new-group-name"
                type="text"
                placeholder="VD: Nhóm đồ án"
                {...register("groupName", {
                  required: "Vui lòng nhập tên nhóm",
                })}
              />
            </div>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Tìm bạn bè để thêm"
              aria-label="Tìm bạn bè"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>

          <div className="custom-scrollbar max-h-[300px] space-y-1 overflow-y-auto">
            {friends?.map((user) => (
              <label
                key={user.id}
                htmlFor={`${user.id}`}
                className="flex w-full cursor-pointer items-center gap-3 rounded-lg p-2.5 transition-colors duration-[--motion-fast] hover:bg-accent has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-[-2px] has-[:focus-visible]:outline-ring"
              >
                <Checkbox
                  id={`${user.id}`}
                  className="size-5"
                  checked={slectedFriends.includes(user.id)}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      setSelectedFriends((state) => [...state, user.id]);
                    } else {
                      setSelectedFriends((state) =>
                        state.filter((id) => id !== user.id),
                      );
                    }
                  }}
                />
                <Avatar className="size-10 shrink-0">
                  <AvatarImage src={user.avatar || ""} alt={user.username} />
                  <AvatarFallback>{user.username[0]}</AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                  {user.username}
                </span>
              </label>
            ))}
            <div className="my-2 flex items-center justify-center">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="interceptor-loading"
                onClick={() => {
                  loadMoreFriends();
                }}
              >
                Tải thêm
              </Button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border p-4">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            Đã chọn{" "}
            <span className="font-medium text-foreground">
              {slectedFriends.length}
            </span>{" "}
            người
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Huỷ
            </Button>
            <Button
              type="submit"
              className="interceptor-loading"
              disabled={slectedFriends.length === 0}
            >
              Tạo nhóm
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
