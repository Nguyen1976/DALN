"use client";

import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { X, Camera } from "@/components/icons";
import { useEffect, useRef, useState } from "react";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { SearchField } from "../ui/search-field";
import { useDispatch, useSelector } from "react-redux";
import {
  getMoreFriends,
  selectFriend,
  selectFriendHasMore,
} from "@/redux/slices/friendSlice";
import type { AppDispatch } from "@/redux/store";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createConversation } from "@/redux/slices/conversationSlice";
import { toast } from "sonner";
import z from "zod";
import { useModalExit } from "@/hooks/useModalExit";
import { staggerStyle } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { InfiniteListFooter } from "@/components/ui/infinite-list-footer";

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
  const { closing, requestClose, onOverlayAnimationEnd } =
    useModalExit(onClose);
  const friends = useSelector(selectFriend);
  const hasMore = useSelector(selectFriendHasMore);
  const dispatch = useDispatch<AppDispatch>();

  // The search box filters the friends loaded so far; scrolling (or a search
  // with few matches, which leaves the end in view) keeps loading the rest.
  const needle = search.trim().toLocaleLowerCase("vi");
  const shownFriends = needle
    ? friends.filter((friend) =>
        [friend.fullName, friend.username].some((value) =>
          value?.toLocaleLowerCase("vi").includes(needle),
        ),
      )
    : friends;
  const paging = useInfiniteScroll({
    hasMore,
    loadMore: () => dispatch(getMoreFriends()).unwrap(),
  });

  const inputRef = useRef<HTMLInputElement>(null);

  const { register, handleSubmit, setValue } = useForm<
    z.infer<typeof formConversationScheme>
  >({
    resolver: zodResolver(formConversationScheme),
  });

  const onSubmit = (data: z.infer<typeof formConversationScheme>) => {
    const formData = new FormData();
    if (data.groupAvatar) formData.append("groupAvatar", data.groupAvatar);
    formData.append("groupName", data.groupName);
    // Ids only: the server looks up names and avatars (and adds you itself).
    for (const id of slectedFriends) formData.append("memberIds", id);
    dispatch(createConversation(formData))
      .unwrap()
      .then(() => toast.success("Đã tạo cuộc trò chuyện thành công"))
      // A failed request has already been reported by the axios interceptor.
      .catch(() => undefined)
      .finally(requestClose);
  };

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4 backdrop-blur-sm",
        closing ? "animate-overlay-out" : "animate-overlay-in",
      )}
      onAnimationEnd={onOverlayAnimationEnd}
    >
      <form
        className={cn(
          "flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-lg",
          closing ? "animate-dialog-out" : "animate-dialog-in",
        )}
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
            onClick={requestClose}
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
              className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-dashed border-input bg-muted text-muted-foreground transition-colors duration-(--motion-fast) hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
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

          <SearchField
            value={search}
            onValueChange={setSearch}
            placeholder="Tìm bạn bè để thêm"
            label="Tìm bạn bè"
          />

          <div
            className="custom-scrollbar max-h-75 space-y-1 overflow-y-auto"
            aria-busy={paging.status === "loading"}
          >
            {shownFriends.map((user, index) => (
              <label
                key={user.id}
                htmlFor={`${user.id}`}
                style={staggerStyle(index % 20)}
                className="flex w-full animate-stagger-in cursor-pointer items-center gap-3 rounded-lg p-2.5 transition-colors duration-(--motion-fast) hover:bg-accent has-focus-visible:outline has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-ring"
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
            {shownFriends.length === 0 && !hasMore && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {needle
                  ? "Không tìm thấy bạn bè phù hợp"
                  : "Bạn chưa có bạn bè nào để thêm"}
              </p>
            )}
            <InfiniteListFooter
              sentinelRef={paging.sentinelRef}
              status={paging.status}
              hasMore={hasMore}
              onRetry={paging.retry}
            />
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
            <Button type="button" variant="ghost" onClick={requestClose}>
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
