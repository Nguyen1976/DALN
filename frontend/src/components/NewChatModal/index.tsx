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
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <form
        className="bg-bg-voice-call rounded-2xl w-full max-w-md mx-4 overflow-hidden"
        onSubmit={handleSubmit(onSubmit)}
      >
        <div className="flex items-center justify-between p-6 border-b border-button">
          <h2 className="text-xl font-semibold text-text">
            Tạo cuộc trò chuyện mới
          </h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="hover:bg-button text-gray-400 hover:text-text"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="p-6 pb-0">
          <Input
            type="file"
            accept="image/*"
            ref={inputRef}
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) setPreview(URL.createObjectURL(file));

              // set vào react-hook-form
              setValue("groupAvatar", file);
            }}
          />
          <div className="flex items-center gap-2">
            <Avatar
              className="w-12 h-12 mb-4 flex items-center justify-center bg-muted border border-button cursor-pointer hover:bg-button transition-colors"
              onClick={() => inputRef.current?.click()}
            >
              {!preview ? (
                <Camera className="w-6 h-6 text-muted-foreground" />
              ) : (
                <AvatarImage src={preview} alt="Xem trước" />
              )}
            </Avatar>
            <Input
              className="mb-4 bg-background! border border-button text-text outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 focus-visible:border-violet-500"
              type="text"
              placeholder="Tên nhóm"
              {...register("groupName", { required: "Vui lòng nhập tên nhóm" })}
            />
          </div>
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Tìm người dùng..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-background border border-button text-text placeholder:text-muted-foreground rounded-lg pl-10 pr-4 py-3 outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500"
            />
          </div>

          <div className="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar">
            {friends?.map((user) => (
              <div
                key={user.id}
                className="w-full flex items-center gap-3 p-3 hover:bg-button rounded-lg transition-colors"
              >
                <Checkbox
                  id={`${user.id}`}
                  className="size-5 border-2 border-muted-foreground bg-background data-[state=checked]:bg-violet-600 data-[state=checked]:border-violet-600 data-[state=checked]:text-white"
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
                <div className="relative">
                  <Avatar className="w-10 h-10">
                    <AvatarImage src={"/placeholder.svg"} alt={user.username} />
                    <AvatarFallback>{user.username[0]}</AvatarFallback>
                  </Avatar>
                  {/* {user.isOnline && (
                    <div className='absolute bottom-0 right-0 w-3 h-3 bg-red-500 rounded-full border-2 border-bg-voice-call' />
                  )} */}
                </div>
                <span className="text-text font-medium">{user.username}</span>
              </div>
            ))}
          </div>
          <div className="w-full flex items-center justify-center my-4">
            <Button
              type="button"
              variant="ghost"
              className="interceptor-loading text-text hover:bg-button"
              onClick={() => {
                loadMoreFriends();
              }}
            >
              Tải thêm
            </Button>
          </div>
        </div>
        <div className="w-full flex justify-end">
          <Button type="submit" className="m-4 interceptor-loading">
            Bắt đầu chat
          </Button>
        </div>
      </form>
    </div>
  );
}
