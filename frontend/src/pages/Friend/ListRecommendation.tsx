import { useCallback, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { Check, RefreshCw, UserPlus } from "@/components/icons";
import { toast } from "sonner";

import { selectUser } from "@/redux/slices/userSlice";
import {
  getMyRecommendationsAPI,
  makeFriendRequestByUsername,
  type RecommendationCandidateItem,
} from "@/apis";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AvatarCircles } from "@/components/ui/avatar-circles";
import { EmptyState } from "@/components/ui/feedback";
import { Skeleton } from "@/components/ui/skeleton";
import { socket } from "@/lib/socket";
import { SOCKET_EVENTS } from "@/lib/socket.events";
import { showErrorToast } from "@/utils/toastError";
import { staggerStyle } from "@/lib/motion";

/**
 * Cards are at least 14rem wide and share the row evenly: about five across on
 * a laptop, three on a tablet, always two on phones. Narrower columns made the
 * photo and the text feel cramped next to the full-width button.
 */
const GRID =
  "grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] sm:gap-4";

/** The generic head-and-shoulders placeholder for people without a photo. */
function Silhouette() {
  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden="true"
      className="size-full text-muted-foreground/35"
      fill="currentColor"
    >
      <circle cx="50" cy="40" r="18" />
      <path d="M14 100c0-22 16-35 36-35s36 13 36 35z" />
    </svg>
  );
}

/**
 * "N mutual friends" with up to two of them as overlapping avatars. With no
 * mutual friends the line stays empty but keeps its height, so the buttons of
 * a row still line up.
 */
function MutualFriends({
  mutual,
}: {
  mutual: RecommendationCandidateItem["mutualFriends"];
}) {
  const count = mutual?.count ?? 0;
  if (count === 0) return <div className="h-6" />;

  const people = (mutual?.preview ?? []).map((person) => ({
    id: person.userId,
    name: person.fullName || person.username,
    avatar: person.avatar,
  }));
  const names = people.map((person) => person.name).join(", ");

  return (
    <p
      className="flex h-6 min-w-0 items-center gap-2 text-sm text-muted-foreground"
      title={
        names
          ? `Bạn chung: ${names}${count > people.length ? "…" : ""}`
          : undefined
      }
    >
      <AvatarCircles people={people} />
      <span className="truncate">{count} bạn chung</span>
    </p>
  );
}

function CardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <Skeleton className="aspect-square w-full rounded-none" />
      <div className="space-y-3 p-4">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>
    </div>
  );
}

export default function ListRecommendation() {
  const user = useSelector(selectUser);
  // Starts true so the empty state never flashes before the first answer.
  const [isLoading, setIsLoading] = useState(true);
  const [recommendations, setRecommendations] = useState<
    RecommendationCandidateItem[]
  >([]);
  const [sentIds, setSentIds] = useState<string[]>([]);

  const loadRecommendations = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await getMyRecommendationsAPI();
      setRecommendations(response.candidates || []);
    } catch (error) {
      showErrorToast(error, "Không tải được danh sách gợi ý bạn bè");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    void loadRecommendations();
  }, [user?.id, loadRecommendations]);

  useEffect(() => {
    const handleNotification = (payload: { message?: string } | null) => {
      const message = String(payload?.message ?? "").toLowerCase();
      if (
        message.includes("lời mời kết bạn") &&
        message.includes("chấp nhận")
      ) {
        void loadRecommendations();
      }
    };

    const handleWindowFocus = () => {
      if (!user?.id) return;
      void loadRecommendations();
    };

    socket.on(SOCKET_EVENTS.NOTIFICATION.NEW_NOTIFICATION, handleNotification);
    window.addEventListener("focus", handleWindowFocus);

    return () => {
      socket.off(
        SOCKET_EVENTS.NOTIFICATION.NEW_NOTIFICATION,
        handleNotification,
      );
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [user?.id, loadRecommendations]);

  const handleMakeFriend = async (candidate: RecommendationCandidateItem) => {
    const candidateId = candidate.candidateId;
    if (sentIds.includes(candidateId)) return;

    // Flip the button straight away; undo it if the request fails.
    setSentIds((prev) => [...prev, candidateId]);
    try {
      // Gửi theo username: dữ liệu gợi ý và hồ sơ công khai đều không có email.
      await makeFriendRequestByUsername(candidate.profile.username);
      toast.success(
        `Đã gửi lời mời kết bạn đến ${candidate.profile.fullName || candidate.profile.username}`,
      );
    } catch (error) {
      showErrorToast(error, "Không thể gửi lời mời kết bạn");
      setSentIds((prev) => prev.filter((id) => id !== candidateId));
    }
  };

  // Refetches (window focus, an accepted request) update the grid in place;
  // skeletons are only for the very first load.
  const firstLoad = isLoading && recommendations.length === 0;
  const empty = !isLoading && recommendations.length === 0;

  return (
    <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
      {firstLoad && (
        <div className={GRID} aria-busy="true" aria-label="Đang tải gợi ý">
          {Array.from({ length: 8 }).map((_, index) => (
            <CardSkeleton key={index} />
          ))}
        </div>
      )}

      {empty && (
        <EmptyState
          icon={UserPlus}
          title="Chưa có gợi ý nào"
          description="Khi bạn kết bạn và tham gia nhóm nhiều hơn, hệ thống sẽ tìm được những người phù hợp với bạn."
          action={
            <Button
              variant="outline"
              onClick={() => void loadRecommendations()}
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Thử lại
            </Button>
          }
        />
      )}

      {recommendations.length > 0 && (
        <ul className={GRID}>
          {recommendations.map((candidate, index) => {
            const profile = candidate.profile;
            // Username stands in for people who never set a display name.
            const name = profile.fullName || profile.username;
            const sent = sentIds.includes(candidate.candidateId);

            return (
              <li
                key={candidate.candidateId}
                className="flex animate-stagger-in flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xs"
                style={staggerStyle(index)}
              >
                <div className="aspect-square bg-muted">
                  <Avatar className="size-full rounded-none">
                    <AvatarImage
                      src={profile.avatar || ""}
                      alt={`Ảnh đại diện ${name}`}
                    />
                    <AvatarFallback className="rounded-none bg-muted">
                      <Silhouette />
                    </AvatarFallback>
                  </Avatar>
                </div>

                <div className="flex flex-1 flex-col gap-1.5 p-3 sm:p-4">
                  <h3
                    className="truncate text-base font-semibold leading-snug text-foreground"
                    title={name}
                  >
                    {name}
                  </h3>
                  <MutualFriends mutual={candidate.mutualFriends} />

                  <Button
                    className="mt-2 w-full sm:mt-3"
                    variant={sent ? "secondary" : "default"}
                    onClick={() => void handleMakeFriend(candidate)}
                    disabled={sent}
                    aria-label={
                      sent
                        ? `Đã gửi lời mời đến ${name}`
                        : `Kết bạn với ${name}`
                    }
                  >
                    {sent ? (
                      <>
                        <Check
                          className="size-4 animate-pop-in"
                          aria-hidden="true"
                        />
                        Đã gửi lời mời
                      </>
                    ) : (
                      <>
                        <UserPlus className="size-4" aria-hidden="true" />
                        Kết bạn
                      </>
                    )}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
