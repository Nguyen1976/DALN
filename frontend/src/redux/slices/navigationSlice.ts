import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "../store";
import { logoutAPI } from "./userSlice";

export type NavSection = "chat" | "friends" | "settings";

/** Which rail section a path belongs to, if any. */
export function sectionOf(path: string): NavSection | null {
  const pathname = path.split("?")[0];
  if (pathname === "/" || pathname.startsWith("/chat")) return "chat";
  if (
    pathname === "/friends" ||
    pathname === "/groups" ||
    pathname === "/friend_requests" ||
    pathname === "/recommendations"
  ) {
    return "friends";
  }
  if (pathname.startsWith("/settings")) return "settings";
  return null;
}

/**
 * Where each rail section was left. Going back to a section reopens that
 * spot — the conversation that was open, the Friends or Settings tab that
 * was showing — instead of the section's first page.
 */
type NavigationState = Record<NavSection, string>;

const initialState: NavigationState = {
  chat: "/",
  friends: "/friends",
  settings: "/settings",
};

export const navigationSlice = createSlice({
  name: "navigation",
  initialState,
  reducers: {
    rememberPath: (state, action: PayloadAction<string>) => {
      const section = sectionOf(action.payload);
      if (section) state[section] = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder.addCase(logoutAPI.fulfilled, () => initialState);
  },
});

export const selectLastPath = (state: RootState, section: NavSection) =>
  state.navigation[section];

export const { rememberPath } = navigationSlice.actions;
export default navigationSlice.reducer;
