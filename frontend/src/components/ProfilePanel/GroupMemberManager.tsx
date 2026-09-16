import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  ChevronRight,
  LogOut,
  MoreHorizontal,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router";
import { useDispatch, useSelector } from "react-redux";
import { toast } from "sonner";

import {
  addMembersToConversationAPI,
  deleteConversationAPI,
  getConversationByIdAPI,
  getUserProfileByIdAPI,
  leaveConversationAPI,
  promoteMemberAPI,
  removeMemberFromConversationAPI,
} from "@/apis";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SearchField } from "@/components/ui/search-field";
import { getErrorMessage } from "@/utils/getErrorMessage";
import {
  applyConversationUpdate,
  removeConversationById,
  selectConversationById,
  setConversationAccessState,
  type ConversationMember,
} from "@/redux/slices/conversationSlice";
import type { AppDispatch, RootState } from "@/redux/store";
import { getFriends, selectFriend } from "@/redux/slices/friendSlice";
import { selectUser } from "@/redux/slices/userSlice";

type Profile = {
  username?: string;
  fullName?: string;
  avatar?: string;
  email?: string;
  bio?: string;
};
type ActionTarget = { userId: string; name: string };

const displayName = (member: ConversationMember, profile?: Profile) =>
  member.fullName ||
  member.username ||
  profile?.fullName ||
  profile?.username ||
  member.userId;

export function GroupMemberManager() {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const conversationId = useLocation().pathname.split("/").pop() || "";
  const conversation = useSelector((state: RootState) =>
    selectConversationById(state, conversationId),
  );
  const friends = useSelector(selectFriend);
  const user = useSelector(selectUser);
  const members = conversation?.members ?? [];
  const memberCount = conversation?.memberCount ?? members.length;
  const myRole = members.find((member) => member.userId === user.id)?.role;
  const isAdmin = myRole === "ADMIN" || myRole === "OWNER";

  const [membersOpen, setMembersOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [profileMember, setProfileMember] = useState<ConversationMember | null>(
    null,
  );
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [memberSearch, setMemberSearch] = useState("");
  const [friendSearch, setFriendSearch] = useState("");
  const deferredMemberSearch = useDeferredValue(memberSearch);
  const deferredFriendSearch = useDeferredValue(friendSearch);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [removeTarget, setRemoveTarget] = useState<ActionTarget | null>(null);
  const [promoteTarget, setPromoteTarget] = useState<ActionTarget | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [groupActionPending, setGroupActionPending] = useState(false);

  useEffect(() => {
    if (!friends.length) void dispatch(getFriends({ limit: 50, page: 1 }));
  }, [dispatch, friends.length]);

  const filteredMembers = useMemo(() => {
    const query = deferredMemberSearch.trim().toLocaleLowerCase("vi");
    if (!query) return members;
    return members.filter((member) => {
      const profile = profiles[member.userId];
      return [
        member.fullName,
        member.username,
        profile?.fullName,
        profile?.username,
      ].some((value) => value?.toLocaleLowerCase("vi").includes(query));
    });
  }, [deferredMemberSearch, members, profiles]);

  const availableFriends = useMemo(() => {
    const memberIds = new Set(members.map((member) => member.userId));
    const query = deferredFriendSearch.trim().toLocaleLowerCase("vi");
    return friends.filter(
      (friend) =>
        !memberIds.has(friend.id) &&
        (!query ||
          [friend.fullName, friend.username, friend.email].some((value) =>
            value?.toLocaleLowerCase("vi").includes(query),
          )),
    );
  }, [deferredFriendSearch, friends, members]);

  const refresh = async () => {
    const result = await getConversationByIdAPI(conversationId);
    dispatch(applyConversationUpdate({ conversation: result.conversation }));
  };

  const openProfile = async (member: ConversationMember) => {
    setProfileMember(member);
    if (profiles[member.userId]?.email !== undefined) return;
    try {
      const profile = await getUserProfileByIdAPI(member.userId);
      setProfiles((current) => ({ ...current, [member.userId]: profile }));
    } catch (error) {
      toast.error(getErrorMessage(error, "Không thể tải thông tin thành viên"));
    }
  };

  const addSelected = async () => {
    if (!selectedIds.size || adding) return;
    setAdding(true);
    try {
      const selected = friends.filter((friend) => selectedIds.has(friend.id));
      const resolved = await Promise.all(
        selected.map(async (friend) => ({
          friend,
          profile: await getUserProfileByIdAPI(friend.id),
        })),
      );
      await addMembersToConversationAPI({
        conversationId,
        memberIds: resolved.map(({ friend }) => friend.id),
        members: resolved.map(({ friend, profile }) => ({
          userId: friend.id,
          username: profile.username,
          fullName: profile.fullName,
          avatar: profile.avatar,
        })),
      });
      await refresh();
      toast.success(`Đã thêm ${resolved.length} thành viên`);
      setSelectedIds(new Set());
      setFriendSearch("");
      setAddOpen(false);
    } catch (error) {
      toast.error(getErrorMessage(error, "Không thể thêm thành viên"));
    } finally {
      setAdding(false);
    }
  };

  const removeMember = async (target: ActionTarget) => {
    setPendingId(target.userId);
    try {
      await removeMemberFromConversationAPI({
        conversationId,
        targetUserId: target.userId,
      });
      await refresh();
      toast.success(`Đã xoá ${target.name} khỏi nhóm`);
    } catch (error) {
      toast.error(getErrorMessage(error, "Không thể xoá thành viên"));
    } finally {
      setPendingId(null);
      setRemoveTarget(null);
    }
  };

  const promoteMember = async (target: ActionTarget) => {
    setPendingId(target.userId);
    try {
      await promoteMemberAPI({ conversationId, targetUserId: target.userId });
      await refresh();
      toast.success(`${target.name} đã trở thành phó nhóm`);
    } catch (error) {
      toast.error(getErrorMessage(error, "Không thể thêm phó nhóm"));
    } finally {
      setPendingId(null);
      setPromoteTarget(null);
    }
  };

  const selectedProfile = profileMember
    ? profiles[profileMember.userId]
    : undefined;
  const selectedName = profileMember
    ? displayName(profileMember, selectedProfile)
    : "";

  const leaveGroup = async () => {
    setGroupActionPending(true);
    try {
      await leaveConversationAPI({ conversationId });
      dispatch(
        setConversationAccessState({
          conversationId,
          membershipStatus: "LEFT",
          canSendMessage: false,
        }),
      );
      setMembersOpen(false);
      toast.success("Bạn đã rời khỏi nhóm");
    } catch (error) {
      toast.error(getErrorMessage(error, "Không thể rời nhóm"));
    } finally {
      setGroupActionPending(false);
      setLeaveConfirm(false);
    }
  };

  const deleteGroup = async () => {
    setGroupActionPending(true);
    try {
      await deleteConversationAPI({ conversationId });
      dispatch(removeConversationById({ conversationId }));
      toast.success("Đã xoá cuộc trò chuyện");
      navigate("/");
    } catch (error) {
      toast.error(getErrorMessage(error, "Không thể xoá cuộc trò chuyện"));
    } finally {
      setGroupActionPending(false);
      setDeleteConfirm(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setMembersOpen(true)}
        className="group flex min-h-16 w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left shadow-sm transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        aria-label={`Xem ${memberCount} thành viên nhóm`}
        data-testid="group-members-trigger"
      >
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
        >
          <Users className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">
            Thành viên nhóm
          </span>
          <span className="mt-0.5 block text-sm text-muted-foreground">
            {memberCount} thành viên
          </span>
        </span>
        <ChevronRight
          aria-hidden="true"
          className="size-5 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        />
      </button>

      <Dialog open={membersOpen} onOpenChange={setMembersOpen}>
        <DialogContent
          className="flex h-[min(760px,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
          data-testid="members-dialog"
        >
          <DialogHeader className="border-b border-border px-5 py-4">
            <DialogTitle>Thành viên</DialogTitle>
            <DialogDescription>
              {conversation?.groupName} · {memberCount} thành viên
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 border-b border-border p-4">
            {isAdmin && (
              <Button
                className="h-11 w-full gap-2"
                onClick={() => setAddOpen(true)}
                data-testid="open-add-members"
              >
                <UserPlus className="size-5" aria-hidden="true" />
                Thêm thành viên
              </Button>
            )}
            <SearchField
              value={memberSearch}
              onValueChange={setMemberSearch}
              placeholder="Tìm thành viên"
              label="Tìm trong danh sách thành viên"
            />
          </div>
          <div className="flex items-center justify-between px-5 pb-2 pt-4">
            <h3 className="text-sm font-semibold text-foreground">
              Danh sách thành viên ({members.length})
            </h3>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost-muted"
                  size="icon"
                  aria-label="Thao tác với nhóm"
                >
                  <MoreHorizontal className="size-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setLeaveConfirm(true)}
                >
                  <LogOut aria-hidden="true" />
                  Rời nhóm
                </DropdownMenuItem>
                {isAdmin && (
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => setDeleteConfirm(true)}
                  >
                    <Trash2 aria-hidden="true" />
                    Xoá cuộc trò chuyện
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-4">
            {filteredMembers.length ? (
              <div className="space-y-1">
                {filteredMembers.map((member) => {
                  const profile = profiles[member.userId];
                  const name = displayName(member, profile);
                  const isSelf = member.userId === user.id;
                  return (
                    <div
                      key={member.userId}
                      className="flex min-h-16 items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-accent"
                      data-testid={`member-row-${member.userId}`}
                    >
                      <button
                        type="button"
                        onClick={() => void openProfile(member)}
                        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        <Avatar className="size-11 border border-border">
                          <AvatarImage
                            src={member.avatar || profile?.avatar || ""}
                            alt=""
                          />
                          <AvatarFallback className="font-semibold">
                            {name.slice(0, 1).toLocaleUpperCase("vi")}
                          </AvatarFallback>
                        </Avatar>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-foreground">
                            {name}
                            {isSelf ? " (Bạn)" : ""}
                          </span>
                          {(member.role === "OWNER" ||
                            member.role === "ADMIN") && (
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              {member.role === "OWNER"
                                ? "Trưởng nhóm"
                                : "Phó nhóm"}
                            </span>
                          )}
                        </span>
                      </button>
                      {isAdmin && !isSelf && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost-muted"
                              size="icon"
                              disabled={pendingId === member.userId}
                              aria-label={`Quản lý ${name}`}
                              data-testid={`member-menu-${member.userId}`}
                            >
                              <MoreHorizontal className="size-5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            {member.role !== "ADMIN" &&
                              member.role !== "OWNER" && (
                                <DropdownMenuItem
                                  onSelect={() =>
                                    setPromoteTarget({
                                      userId: member.userId,
                                      name,
                                    })
                                  }
                                >
                                  <ShieldCheck aria-hidden="true" />
                                  Thêm phó nhóm
                                </DropdownMenuItem>
                              )}
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() =>
                                setRemoveTarget({ userId: member.userId, name })
                              }
                            >
                              <Trash2 aria-hidden="true" />
                              Xoá khỏi nhóm
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                Không tìm thấy thành viên phù hợp
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent
          className="flex h-[min(680px,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
          data-testid="add-members-dialog"
        >
          <DialogHeader className="border-b border-border px-5 py-4">
            <DialogTitle>Thêm thành viên</DialogTitle>
            <DialogDescription>
              Chọn bạn bè muốn thêm vào {conversation?.groupName}.
            </DialogDescription>
          </DialogHeader>
          <div className="p-4">
            <SearchField
              value={friendSearch}
              onValueChange={setFriendSearch}
              placeholder="Tìm theo tên hoặc username"
              label="Tìm bạn bè để thêm vào nhóm"
              autoFocus
            />
          </div>
          <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            {availableFriends.length ? (
              <div className="space-y-1">
                {availableFriends.map((friend) => {
                  const checked = selectedIds.has(friend.id);
                  const name = friend.fullName || friend.username;
                  return (
                    <label
                      key={friend.id}
                      className="flex min-h-16 cursor-pointer items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSelectedIds((current) => {
                            const next = new Set(current);
                            if (next.has(friend.id)) next.delete(friend.id);
                            else next.add(friend.id);
                            return next;
                          })
                        }
                        className="size-5 shrink-0 accent-primary"
                        aria-label={`Chọn ${name}`}
                      />
                      <Avatar className="size-11 border border-border">
                        <AvatarImage src={friend.avatar || ""} alt="" />
                        <AvatarFallback className="font-semibold">
                          {name.slice(0, 1).toLocaleUpperCase("vi")}
                        </AvatarFallback>
                      </Avatar>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-foreground">
                          {name}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          @{friend.username}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <div className="flex h-40 items-center justify-center px-6 text-center text-sm text-muted-foreground">
                {friendSearch
                  ? "Không tìm thấy bạn bè phù hợp"
                  : "Tất cả bạn bè đã có trong nhóm"}
              </div>
            )}
          </div>
          <DialogFooter className="border-t border-border bg-card px-4 py-3">
            <Button variant="ghost" onClick={() => setAddOpen(false)}>
              Huỷ
            </Button>
            <Button
              onClick={() => void addSelected()}
              disabled={!selectedIds.size || adding}
              data-testid="confirm-add-members"
            >
              {adding
                ? "Đang thêm..."
                : `Thêm${selectedIds.size ? ` (${selectedIds.size})` : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={profileMember !== null}
        onOpenChange={(open) => !open && setProfileMember(null)}
      >
        <DialogContent
          className="sm:max-w-md"
          data-testid="member-profile-dialog"
        >
          <DialogHeader>
            <DialogTitle>Thông tin thành viên</DialogTitle>
            <DialogDescription>
              Thông tin cơ bản trong hồ sơ người dùng.
            </DialogDescription>
          </DialogHeader>
          {profileMember && (
            <div className="space-y-5">
              <div className="flex flex-col items-center rounded-2xl bg-muted/60 p-6 text-center">
                <Avatar className="size-24 border-2 border-background shadow-sm">
                  <AvatarImage
                    src={profileMember.avatar || selectedProfile?.avatar || ""}
                    alt=""
                  />
                  <AvatarFallback className="text-2xl font-semibold">
                    {selectedName.slice(0, 1).toLocaleUpperCase("vi")}
                  </AvatarFallback>
                </Avatar>
                <h3 className="mt-4 text-lg font-semibold text-foreground">
                  {selectedName}
                </h3>
                <p className="text-sm text-muted-foreground">
                  @{selectedProfile?.username || profileMember.username}
                </p>
              </div>
              <dl className="divide-y divide-border rounded-xl border border-border">
                <div className="grid grid-cols-[6rem_1fr] gap-3 px-4 py-3 text-sm">
                  <dt className="text-muted-foreground">Vai trò</dt>
                  <dd className="font-medium text-foreground">
                    {profileMember.role === "OWNER"
                      ? "Trưởng nhóm"
                      : profileMember.role === "ADMIN"
                        ? "Phó nhóm"
                        : "Thành viên"}
                  </dd>
                </div>
                {selectedProfile?.email && (
                  <div className="grid grid-cols-[6rem_1fr] gap-3 px-4 py-3 text-sm">
                    <dt className="text-muted-foreground">Email</dt>
                    <dd className="break-all font-medium text-foreground">
                      {selectedProfile.email}
                    </dd>
                  </div>
                )}
                <div className="grid grid-cols-[6rem_1fr] gap-3 px-4 py-3 text-sm">
                  <dt className="text-muted-foreground">Giới thiệu</dt>
                  <dd className="font-medium text-foreground">
                    {selectedProfile?.bio || "Chưa có thông tin giới thiệu"}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={promoteTarget !== null}
        onOpenChange={(open) => !open && setPromoteTarget(null)}
        title="Thêm phó nhóm?"
        description={`${promoteTarget?.name ?? "Thành viên này"} sẽ có quyền thêm, xoá và quản lý thành viên trong nhóm.`}
        confirmLabel="Thêm phó nhóm"
        pendingLabel="Đang cập nhật..."
        destructive={false}
        isPending={Boolean(promoteTarget && pendingId === promoteTarget.userId)}
        onConfirm={() => promoteTarget && void promoteMember(promoteTarget)}
      />
      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title="Xoá thành viên khỏi nhóm?"
        description={`${removeTarget?.name ?? "Thành viên này"} sẽ không thể xem hoặc nhận tin nhắn mới trong nhóm.`}
        confirmLabel="Xoá khỏi nhóm"
        pendingLabel="Đang xoá..."
        isPending={Boolean(removeTarget && pendingId === removeTarget.userId)}
        onConfirm={() => removeTarget && void removeMember(removeTarget)}
      />
      <ConfirmDialog
        open={leaveConfirm}
        onOpenChange={setLeaveConfirm}
        title="Rời khỏi nhóm?"
        description={`Bạn sẽ không nhận tin nhắn mới từ “${conversation?.groupName || "nhóm"}”.`}
        confirmLabel="Rời nhóm"
        pendingLabel="Đang rời..."
        isPending={groupActionPending}
        onConfirm={() => void leaveGroup()}
      />
      <ConfirmDialog
        open={deleteConfirm}
        onOpenChange={setDeleteConfirm}
        title="Xoá cuộc trò chuyện?"
        description={`Toàn bộ nhóm “${conversation?.groupName || "nhóm"}” và lịch sử trò chuyện sẽ bị xoá. Thao tác này không thể hoàn tác.`}
        confirmLabel="Xoá cuộc trò chuyện"
        pendingLabel="Đang xoá..."
        isPending={groupActionPending}
        onConfirm={() => void deleteGroup()}
      />
    </>
  );
}
