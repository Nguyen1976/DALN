import { configureStore } from "@reduxjs/toolkit";
import { combineReducers } from "redux";
import storage from "redux-persist/lib/storage"; //Lưu chữ dữ liệu trong storage
import { persistReducer } from "redux-persist";

import userReducer from "./slices/userSlice";
import friendReducer from "./slices/friendSlice";
import conversationReducer from "./slices/conversationSlice";
import notificationReducer from "./slices/notificationSlice";
import messageReducer from "./slices/messageSlice";
import notificationPreferenceReducer from "./slices/notificationPreferenceSlice";
import typingIndicatorReducer from "./slices/typingIndicatorSlice";
import seenStatusReducer from "./slices/seenStatusSlice";

const rootPersistConfig = {
  key: "root",
  storage: storage,
  whitelist: ["user"], //Mảng những slice được lưu trữ ở storage
  //blacklist ngược lại của whitelist
  blacklist: [
    "friend",
    "conversations",
    "notification",
    "message",
    "typingIndicator",
    "seenStatus",
  ], //những slice k lưu trữ ở storage
};

const reducers = combineReducers({
  user: userReducer,
  friend: friendReducer,
  conversations: conversationReducer,
  notification: notificationReducer,
  message: messageReducer,
  notificationPreference: notificationPreferenceReducer,
  typingIndicator: typingIndicatorReducer,
  seenStatus: seenStatusReducer,
});

const persistedReducer = persistReducer(rootPersistConfig, reducers);

export const store = configureStore({
  reducer: persistedReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false,
    }),
});

// Infer the `RootState` and `AppDispatch` types from the store itself
export type RootState = ReturnType<typeof store.getState>;
// Inferred type: {posts: PostsState, comments: CommentsState, users: UsersState}
export type AppDispatch = typeof store.dispatch;
