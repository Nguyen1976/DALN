import { api } from "@/utils/authorizeAxios";

export interface InterestTagItem {
  id: string;
  slug: string;
  label: string;
  emoji: string;
  category: string;
  order: number;
}

export interface MutualFriendPreview {
  userId: string;
  username: string;
  fullName: string;
  avatar: string | null;
}

/** A suggested friend: just what the card shows. */
export interface SuggestedFriend extends MutualFriendPreview {
  /** Friends you both have; `preview` is the first two, photos first. */
  mutualFriends: { count: number; preview: MutualFriendPreview[] };
}

/** The interest catalog; public, and the onboarding screen shows its own error. */
export const getInterestTagsAPI = () =>
  api.get<InterestTagItem[]>("/recommendation/interest-tags", {
    skipErrorToast: true,
  });

export const getMyRecommendationsAPI = () =>
  api.get<SuggestedFriend[]>("/recommendation/me");
