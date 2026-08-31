import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { ProfileSettings } from "../Setting";
import { useSelector } from "react-redux";
import { selectUser } from "@/redux/slices/userSlice";

const ProfileSetting = () => {
  const [showSetting, setShowSetting] = useState(false);
  const user = useSelector(selectUser);

  return (
    <>
      {showSetting && <ProfileSettings onClose={() => setShowSetting(false)} />}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Avatar
            aria-label="Mở menu hồ sơ"
            className="size-10 cursor-pointer ring-offset-background transition-shadow hover:ring-2 hover:ring-ring hover:ring-offset-2"
          >
            <AvatarImage
              src={user.avatar || ""}
              alt={user.username}
            />
            <AvatarFallback>{user.username[0]}</AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56" align="start">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => setShowSetting(true)}>
              Hồ sơ
            </DropdownMenuItem>
            <DropdownMenuItem>Thanh toán</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setShowSetting(true)}>
              Cài đặt
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
};

export default ProfileSetting;
