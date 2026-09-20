import { useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Check, RefreshCw, UserPlus } from "@/components/icons";
import { toast } from "sonner";

import {
  makeFriendRequestByUsername,
  type SuggestedFriend,
} from "@/apis";
import {
  fetchRecommendations,
  markRecommendationSent,
  selectRecommendationSentIds,
  selectRecommendations,
  selectRecommendationsLoaded,
  selectRecommendationsStale,
  unmarkRecommendationSent,
} from "@/redux/slices/recommendationSlice";
import { markRequestsStale } from "@/redux/slices/friendRequestSlice";
import type { AppDispatch } from "@/redux/store";
import { useListMotion } from "@/hooks/useListMotion";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AvatarCircles } from "@/components/ui/avatar-circles";
import { EmptyState } from "@/components/ui/feedback";
import { Skeleton } from "@/components/ui/skeleton";
import { showErrorToast } from "@/utils/toastError";
import { cn } from "@/lib/utils";
import { displayNameOf } from "@/utils/displayName";

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
  mutual: SuggestedFriend["mutualFriends"];
}) {
  const count = mutual?.count ?? 0;
  if (count === 0) return <div className="h-6" />;

  const people = (mutual?.preview ?? []).map((person) => ({
    id: person.userId,
    name: displayNameOf(person),
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

/** Refocusing the window refreshes the list only if it is older than this. */
const FOCUS_REFRESH_AFTER_MS = 60_000;

export default function ListRecommendation() {
  const dispatch = useDispatch<AppDispatch>();
  // Kept in redux: coming back to this tab shows the list at once, with no
  // skeleton and no request, along with the "request sent" marks.
  const recommendations = useSelector(selectRecommendations);
  const loaded = useSelector(selectRecommendationsLoaded);
  // Set when one of our requests is accepted (see recommendationSlice).
  const stale = useSelector(selectRecommendationsStale);
  const sentIds = useSelector(selectRecommendationSentIds);

  // Once per session, and again after an accepted request.
  useEffect(() => {
    if (!loaded || stale) void dispatch(fetchRecommendations());
  }, [dispatch, loaded, stale]);

  useEffect(() => {
    const handleWindowFocus = () => {
      void dispatch(
        fetchRecommendations({ ifOlderThan: FOCUS_REFRESH_AFTER_MS }),
      );
    };
    window.addEventListener("focus", handleWindowFocus);
    return () => window.removeEventListener("focus", handleWindowFocus);
  }, [dispatch]);

  const handleMakeFriend = async (candidate: SuggestedFriend) => {
    const candidateId = candidate.userId;
    if (sentIds.includes(candidateId)) return;

    // Flip the button straight away; undo it if the request fails.
    dispatch(markRecommendationSent(candidateId));
    try {
      // Gửi theo username: dữ liệu gợi ý và hồ sơ công khai đều không có email.
      await makeFriendRequestByUsername(candidate.username);
      // The "sent" list on the requests tab gained one.
      dispatch(markRequestsStale("sent"));
      toast.success(
        `Đã gửi lời mời kết bạn đến ${displayNameOf(candidate)}`,
      );
    } catch (error) {
      showErrorToast(error, "Không thể gửi lời mời kết bạn");
      dispatch(unmarkRecommendationSent(candidateId));
    }
  };

  // Refetches (window focus, an accepted request) update the grid in place;
  // skeletons are only for the very first load.
  const firstLoad = !loaded;
  const empty = loaded && recommendations.length === 0;

  // Cards fade in the first time they show this session.
  const gridRef = useRef<HTMLUListElement>(null);
  useListMotion(gridRef, { id: "suggestions" });

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
              onClick={() => void dispatch(fetchRecommendations())}
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Thử lại
            </Button>
          }
        />
      )}

      {recommendations.length > 0 && (
        <ul ref={gridRef} className={cn(GRID, "relative")}>
          {recommendations.map((candidate) => {
            // Username stands in for people who never set a display name.
            const name = displayNameOf(candidate);
            const sent = sentIds.includes(candidate.userId);

            return (
              <li
                key={candidate.userId}
                data-motion-key={candidate.userId}
                className="flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xs"
              >
                <div className="aspect-square bg-muted">
                  <Avatar className="size-full rounded-none">
                    <AvatarImage
                      src={candidate.avatar || ""}
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
