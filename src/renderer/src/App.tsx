import { IconContext } from "@phosphor-icons/react";
import { useEffect } from "react";
import styles from "./App.module.css";
import { ToastProvider } from "./components/Toast";
import { TooltipProvider } from "./components/Tooltip";
import { AccountsScreen } from "./screens/AccountsScreen";
import { GalleryScreen } from "./screens/GalleryScreen";
import { LibraryScreen } from "./screens/LibraryScreen";
import { ModsScreen } from "./screens/ModsScreen";
import { PlayScreen } from "./screens/play/PlayScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { WelcomeScreen } from "./screens/WelcomeScreen";
import { NavRail } from "./shell/NavRail";
import { StatusBar } from "./shell/StatusBar";
import { TitleBar } from "./shell/TitleBar";
import { useApp, type ViewId } from "./store";

function CurrentScreen({ view }: { view: ViewId }) {
  switch (view) {
    case "welcome":
      return <WelcomeScreen />;
    case "play":
      return <PlayScreen />;
    case "library":
      return <LibraryScreen />;
    case "accounts":
      return <AccountsScreen />;
    case "mods":
      return <ModsScreen />;
    case "settings":
      return <SettingsScreen />;
    case "gallery":
      return <GalleryScreen />;
  }
}

export function App() {
  const view = useApp((state) => state.view);
  const booted = useApp((state) => state.booted);
  const start = useApp((state) => state.start);

  useEffect(() => {
    void start();
  }, [start]);

  return (
    <IconContext.Provider value={{ size: 20, weight: "regular" }}>
      <TooltipProvider>
        <ToastProvider>
          <div className={styles.app}>
            <TitleBar />
            <NavRail />
            <main className={styles.content}>
              {booted && <CurrentScreen view={view} />}
            </main>
            <StatusBar />
          </div>
        </ToastProvider>
      </TooltipProvider>
    </IconContext.Provider>
  );
}
