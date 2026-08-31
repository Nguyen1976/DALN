import { Suspense, lazy, useEffect } from "react";
import ProtectedRoute from "./components/ProtectedRoute";
import AuthPage from "./pages/Auth";
import ChatPage from "./pages/Chat";

import { createBrowserRouter, RouterProvider } from "react-router";
import { socket } from "./lib/socket";
import { FriendsPage } from "./pages/Friend/FriendPage";
import ListFriend from "./pages/Friend/ListFriend";
import ListFriendRequests from "./pages/Friend/ListFriendRequests";
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch } from "./redux/store";
import { useSound } from "use-sound";
import notificationSound from "./assets/notification.mp3";
import {
  addConversation,
  type Conversation,
} from "./redux/slices/conversationSlice";
import { selectUser } from "./redux/slices/userSlice";
import {
  addNotification,
  type Notification,
} from "./redux/slices/notificationSlice";
import {
  upsertOnlineFriend,
  updateStatusOffline,
} from "./redux/slices/friendSlice";
import { useChatSocketEvents } from "./hooks/useChatSocketEvents";
import IncomingCallManager from "./components/IncomingCallManager";
import { Spinner } from "@/components/ui/feedback";
import VerifyOtpPage from "./pages/VerifyOtp";

/**
 * Secondary screens are split out of the first bundle.
 *
 * Suggestions, notification settings, the interests step and the group list
 * were all pulled in on the very first load even though most sessions never
 * open them.
 */
const RecommendationPage = lazy(() => import("./pages/Recommendation"));
const NotificationSettingsPage = lazy(
  () => import("./pages/NotificationSettings"),
);
const InterestOnboardingPage = lazy(() => import("./pages/InterestOnboarding"));
const ListGroupCommunity = lazy(() => import("./pages/Friend/ListGroupCommunity"));

/** Placeholder while a split chunk downloads. */
function RouteFallback() {
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center">
      <Spinner label="Đang tải màn hình" />
    </div>
  );
}

const lazyRoute = (element: React.ReactNode) => (
  <Suspense fallback={<RouteFallback />}>{element}</Suspense>
);

const router = createBrowserRouter([
  {
    path: "/auth",
    element: <AuthPage />,
  },
  {
    path: "/verify-otp",
    element: <VerifyOtpPage />,
  },
  {
    path: "/onboarding/interests",
    element: (
      <ProtectedRoute>
        {lazyRoute(<InterestOnboardingPage />)}
      </ProtectedRoute>
    ),
  },
  {
    path: "/",
    element: (
      <ProtectedRoute>
        <ChatPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "/chat/:conversationId",
    element: (
      <ProtectedRoute>
        <ChatPage />
      </ProtectedRoute>
    ),
  },
  {
    path: "/friends",
    element: (
      <ProtectedRoute>
        <FriendsPage>
          <ListFriend />
        </FriendsPage>
      </ProtectedRoute>
    ),
  },
  {
    path: "/groups",
    element: (
      <ProtectedRoute>
        <FriendsPage>
          {lazyRoute(<ListGroupCommunity />)}
        </FriendsPage>
      </ProtectedRoute>
    ),
  },
  {
    path: "/friend_requests",
    element: (
      <ProtectedRoute>
        <FriendsPage>
          <ListFriendRequests />
        </FriendsPage>
      </ProtectedRoute>
    ),
  },
  {
    path: "/settings/notifications",
    element: (
      <ProtectedRoute>
        {lazyRoute(<NotificationSettingsPage />)}
      </ProtectedRoute>
    ),
  },
  {
    path: "/recommendations",
    element: (
      <ProtectedRoute>
        {lazyRoute(<RecommendationPage />)}
      </ProtectedRoute>
    ),
  },
]);

function App() {
  const dispatch = useDispatch<AppDispatch>();
  const user = useSelector(selectUser);
  const [play] = useSound(notificationSound, { volume: 0.5 });

  // Setup chat socket events (typing indicator, seen status)
  useChatSocketEvents();

  useEffect(() => {
    if (!user?.id) return;

    socket.connect();

    return () => {
      socket.disconnect();
    };
  }, [user?.id]);

  useEffect(() => {
    const handler = ({ conversation }: { conversation: Conversation }) => {
      dispatch(addConversation({ conversation }));
    };

    socket.on("chat.new_conversation", handler);

    return () => {
      socket.off("chat.new_conversation", handler);
    };
  }, [dispatch, user.id]);

  useEffect(() => {
    const handler = (data: Notification) => {
      dispatch(addNotification(data));
      // play();
    };

    socket.on("notification.new_notification", handler);

    return () => {
      socket.off("notification.new_notification", handler);
    };
  }, [dispatch, play]);

  useEffect(() => {
    const handleOnlineStatusChanged = (userId: string) => {
      void dispatch(upsertOnlineFriend(userId));
    };

    socket.on("user.online_status_changed", handleOnlineStatusChanged);

    return () => {
      socket.off("user.online_status_changed", handleOnlineStatusChanged);
    };
  }, [dispatch]);

  useEffect(() => {
    const handleOfflineStatusChanged = (data: {
      userId: string;
      lastSeen: string;
    }) => {
      dispatch(
        updateStatusOffline({ friendId: data.userId, lastSeen: data.lastSeen }),
      );
    };

    socket.on("user.offline_status_changed", handleOfflineStatusChanged);

    return () => {
      socket.off("user.offline_status_changed", handleOfflineStatusChanged);
    };
  }, [dispatch]);

  return (
    <>
      <RouterProvider router={router} />
      {user?.id ? <IncomingCallManager /> : null}
    </>
  );
}

export default App;
