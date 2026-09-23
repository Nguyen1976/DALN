import { useEffect } from "react";
import ProtectedRoute from "./components/ProtectedRoute";
import AuthPage from "./pages/Auth";
import ChatPage from "./pages/Chat";

import { createBrowserRouter, Outlet, RouterProvider } from "react-router";
import MainLayout from "./layouts/MainLayout";
import { socket } from "./lib/socket";
import {
  installSocketAuthRecovery,
  resetSocketAuthRetries,
} from "./lib/socketAuth";
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
  friendCameOnline,
  updateStatusOffline,
} from "./redux/slices/friendSlice";
import type { Friend } from "./apis";
import { useChatSocketEvents } from "./hooks/useChatSocketEvents";
import IncomingCallManager from "./components/IncomingCallManager";
import { CallProvider } from "./contexts/CallProvider";
import { Spinner } from "@/components/ui/feedback";
import VerifyOtpPage from "./pages/VerifyOtp";
import ForgotPasswordPage from "./pages/ForgotPassword";
import ResetPasswordPage from "./pages/ResetPassword";
import { SettingsPage } from "./pages/Settings/SettingsPage";
import ProfileSettings from "./pages/Settings/Profile";
import AccountSettings from "./pages/Settings/Account";
import PrivacySettings from "./pages/Settings/Privacy";

/**
 * Secondary screens are split out of the first bundle.
 *
 * Suggestions, notification settings, the interests step and the group list
 * were all pulled in on the very first load even though most sessions never
 * open them. They load through the route's `lazy`, not React.lazy +
 * Suspense: the router fetches the chunk before it commits the navigation,
 * so the current screen stays up until the next one is ready.
 */
const lazyPage =
  (load: () => Promise<{ default: React.ComponentType }>) => async () => {
    const { default: Page } = await load();
    return { Component: Page };
  };

/** Opening the interests step directly (F5, a link): nothing else to show. */
function ScreenFallback() {
  return (
    <div className="flex min-h-dvh w-full items-center justify-center">
      <Spinner label="Đang tải màn hình" />
    </div>
  );
}

/** Opening a lazy tab directly: the shell is up, the tab's spot waits. */
function ContentFallback() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <Spinner label="Đang tải màn hình" />
    </div>
  );
}

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
    path: "/forgot-password",
    element: <ForgotPasswordPage />,
  },
  {
    path: "/reset-password",
    element: <ResetPasswordPage />,
  },
  {
    path: "/onboarding/interests",
    hydrateFallbackElement: <ScreenFallback />,
    lazy: async () => {
      const { default: Page } = await import("./pages/InterestOnboarding");
      return {
        element: (
          <ProtectedRoute>
            <Page />
          </ProtectedRoute>
        ),
      };
    },
  },
  {
    // The app shell — left rail and content area — is mounted once and kept
    // while moving between sections. Each screen used to render its own
    // copy, so every tab change tore down the rail, replayed the page fade
    // and every list's entrance, and re-ran each screen's fetches.
    element: (
      <ProtectedRoute>
        <MainLayout>
          <Outlet />
        </MainLayout>
      </ProtectedRoute>
    ),
    children: [
      { path: "/", element: <ChatPage /> },
      { path: "/chat/:conversationId", element: <ChatPage /> },
      {
        // Friends: one header and tab row shared by its four tabs.
        element: (
          <FriendsPage>
            <Outlet />
          </FriendsPage>
        ),
        children: [
          { path: "/friends", element: <ListFriend /> },
          {
            path: "/groups",
            hydrateFallbackElement: <ContentFallback />,
            lazy: lazyPage(() => import("./pages/Friend/ListGroupCommunity")),
          },
          { path: "/friend_requests", element: <ListFriendRequests /> },
          {
            path: "/recommendations",
            hydrateFallbackElement: <ContentFallback />,
            lazy: lazyPage(() => import("./pages/Friend/ListRecommendation")),
          },
        ],
      },
      {
        // Settings: one header and tab row shared by its four tabs.
        element: (
          <SettingsPage>
            <Outlet />
          </SettingsPage>
        ),
        children: [
          { path: "/settings", element: <ProfileSettings /> },
          { path: "/settings/account", element: <AccountSettings /> },
          { path: "/settings/privacy", element: <PrivacySettings /> },
          {
            path: "/settings/notifications",
            hydrateFallbackElement: <ContentFallback />,
            lazy: lazyPage(() => import("./pages/Settings/Notifications")),
          },
        ],
      },
    ],
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

    // Gắn cơ chế hồi phục TRƯỚC khi nối: server có thể từ chối ngay ở handshake
    // (access hết hạn) và Socket.IO không tự thử lại sau `io server disconnect`.
    installSocketAuthRecovery();
    resetSocketAuthRetries();
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
    const handleOnlineStatusChanged = ({ friend }: { friend: Friend }) => {
      dispatch(friendCameOnline(friend));
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
    // CallProvider ở cấp app (ngoài router): cuộc gọi ra ngoài sống xuyên trang,
    // "thu nhỏ để tiếp tục nhắn tin" hoạt động. Cuộc gọi đến do IncomingCallManager.
    <CallProvider>
      <RouterProvider router={router} />
      {user?.id ? <IncomingCallManager /> : null}
    </CallProvider>
  );
}

export default App;
