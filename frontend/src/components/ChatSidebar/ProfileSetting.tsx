import { useState } from "react";
import { useSelector } from "react-redux";
import { Mail, PencilLine, Quote } from "@/components/icons";
import { useMediaQuery } from "usehooks-ts";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  AvatarWithPresence,
} from "../ui/avatar";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { ProfileSettings } from "../Setting";
import { selectUser } from "@/redux/slices/userSlice";

/**
 * The rail's avatar opens a card with who you are (name, handle, email, bio)
 * instead of a menu; editing is one click further, in the settings dialog.
 */
const ProfileSetting = () => {
  const [open, setOpen] = useState(false);
  const [showSetting, setShowSetting] = useState(false);
  const user = useSelector(selectUser);
  const name = user.fullName || user.username;
  const initial = (name || "U")[0].toUpperCase();
  // Desktop: the avatar sits in the left rail, so the card opens beside it.
  // Phones: it sits in the bottom bar, so the card opens above the bar.
  const onRail = useMediaQuery("(min-width: 768px)");

  return (
    <>
      {showSetting && <ProfileSettings onClose={() => setShowSetting(false)} />}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Xem hồ sơ của bạn"
            className="rounded-full outline-none ring-offset-background transition-shadow duration-(--motion-fast) hover:ring-2 hover:ring-ring hover:ring-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[state=open]:ring-2 data-[state=open]:ring-ring data-[state=open]:ring-offset-2"
          >
            <Avatar className="size-10">
              <AvatarImage src={user.avatar || ""} alt="" />
              <AvatarFallback>{initial}</AvatarFallback>
            </Avatar>
          </button>
        </PopoverTrigger>

        <PopoverContent
          side={onRail ? "right" : "top"}
          align="start"
          // Clears the 76px rail (or the bottom bar) instead of overlapping it.
          sideOffset={onRail ? 26 : 14}
          className="w-72 overflow-hidden p-0"
        >
          <div className="flex items-center gap-3 p-4">
            <AvatarWithPresence status="online" dotSize="lg">
              <Avatar className="size-14 border border-border">
                <AvatarImage
                  src={user.avatar || ""}
                  alt={`Ảnh đại diện ${name}`}
                />
                <AvatarFallback className="text-lg">{initial}</AvatarFallback>
              </Avatar>
            </AvatarWithPresence>
            <div className="min-w-0">
              <p className="truncate font-semibold leading-tight text-foreground">
                {name}
              </p>
              <p className="truncate text-sm text-muted-foreground">
                @{user.username}
              </p>
              {/* The presence dot already announces this to screen readers. */}
              <p
                aria-hidden="true"
                className="mt-1 text-xs font-medium text-success-text"
              >
                Đang hoạt động
              </p>
            </div>
          </div>

          <div className="space-y-2.5 border-t border-border px-4 py-3 text-sm">
            <p className="flex items-center gap-2.5 text-foreground">
              <Mail
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="sr-only">Email: </span>
              <span className="truncate">{user.email}</span>
            </p>
            <p className="flex items-start gap-2.5">
              <Quote
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="sr-only">Giới thiệu: </span>
              <span
                className={
                  user.bio
                    ? "text-ellipsis-2 text-foreground"
                    : "text-muted-foreground"
                }
              >
                {user.bio || "Chưa có giới thiệu"}
              </span>
            </p>
          </div>

          <div className="border-t border-border p-3">
            <Button
              className="w-full"
              onClick={() => {
                setOpen(false);
                setShowSetting(true);
              }}
            >
              <PencilLine aria-hidden="true" />
              Chỉnh sửa hồ sơ
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
};

export default ProfileSetting;
