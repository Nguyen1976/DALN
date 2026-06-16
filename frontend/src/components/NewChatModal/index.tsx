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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-fade-in">
      <form
        className="flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
        onSubmit={handleSubmit(onSubmit)}
      >
        <div className="flex items-center justify-between border-b border-border p-5">
          <h2 className="text-lg font-semibold text-foreground">
            Tạo cuộc trò chuyện mới
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Đóng"
            className="text-muted-foreground hover:text-foreground"
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
            <Avatar
              className="flex size-12 shrink-0 cursor-pointer items-center justify-center border border-border bg-muted transition-colors hover:bg-accent"
              onClick={() => inputRef.current?.click()}
            >
              {!preview ? (
                <Camera className="size-5 text-muted-foreground" />
              ) : (
                <AvatarImage src={preview} alt="Xem trước" />
              )}
            </Avatar>
            <Input
              type="text"
              placeholder="Tên nhóm"
              {...register("groupName", { required: "Vui lòng nhập tên nhóm" })}
            />
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Tìm người dùng..."
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
                className="flex w-full cursor-pointer items-center gap-3 rounded-lg p-3 transition-colors hover:bg-accent"
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
                  <AvatarImage src={user.avatar || "/placeholder.svg"} alt={user.username} />
                  <AvatarFallback>{user.username[0]}</AvatarFallback>
                </Avatar>
                <span className="font-medium text-foreground">
                  {user.username}
                </span>
              </label>
            ))}
            <div className="my-2 flex items-center justify-center">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="interceptor-loading text-muted-foreground"
                onClick={() => {
                  loadMoreFriends();
                }}
              >
                Tải thêm
              </Button>
            </div>
          </div>
        </div>

        <div className="flex justify-end border-t border-border p-4">
          <Button type="submit" className="interceptor-loading">
            Bắt đầu chat
          </Button>
        </div>
      </form>
    </div>
  );
}
