import { Menu, Plus, UserRoundPlus } from "lucide-react";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { useState } from "react";
import { MakeFriendModal } from "../MakeFriendModal";
import { NewChatModal } from "../NewChatModal";

const MenuCustome = () => {
  const [showNewChat, setShowNewChat] = useState(false);
  const [showMakeFriend, setShowMakeFriend] = useState(false);
  return (
    <>
      {showMakeFriend && (
        <MakeFriendModal onClose={() => setShowMakeFriend(false)} />
      )}

      {showNewChat && <NewChatModal onClose={() => setShowNewChat(false)} />}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Tạo mới"
            className="text-muted-foreground hover:text-foreground"
          >
            <Menu className="size-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-48" align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => setShowNewChat(true)}>
              <Plus className="size-4" />
              Tạo nhóm mới
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setShowMakeFriend(true)}>
              <UserRoundPlus className="size-4" />
              Thêm bạn bè
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
};

export default MenuCustome;
