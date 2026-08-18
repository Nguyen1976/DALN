import { createRoot } from "react-dom/client";
import "./index.css";
import App from "@/App";
import { store } from "./redux/store";
import { Provider } from "react-redux";
import { injectStore } from "./utils/authorizeAxios";

//Config redux persist
import { PersistGate } from "redux-persist/integration/react";
import { persistStore } from "redux-persist";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/ThemeProvider";

const persistor = persistStore(store);

injectStore(store);

createRoot(document.getElementById("root")!).render(
  // ThemeProvider sits above the router so /auth, /verify-otp and the
  // onboarding routes get the same theme context as the chat shell.
  <ThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
    <Provider store={store}>
      <PersistGate loading={null} persistor={persistor}>
        <App />
        <Toaster position="top-right" richColors closeButton />
      </PersistGate>
    </Provider>
  </ThemeProvider>,
);
