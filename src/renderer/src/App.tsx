import { IconContext } from "@phosphor-icons/react";
import { useState } from "react";
import styles from "./App.module.css";
import { ToastProvider } from "./components/Toast";
import { TooltipProvider } from "./components/Tooltip";
import { GalleryScreen } from "./screens/GalleryScreen";
import { PlannedScreen } from "./screens/PlannedScreen";
import { NavRail, type ViewId } from "./shell/NavRail";
import { StatusBar } from "./shell/StatusBar";
import { TitleBar } from "./shell/TitleBar";

export function App() {
  const [view, setView] = useState<ViewId>("play");

  return (
    <IconContext.Provider value={{ size: 20, weight: "regular" }}>
      <TooltipProvider>
        <ToastProvider>
          <div className={styles.app}>
            <TitleBar />
            <NavRail active={view} onSelect={setView} />
            <main className={styles.content}>
              {view === "gallery" ? <GalleryScreen /> : <PlannedScreen view={view} />}
            </main>
            <StatusBar />
          </div>
        </ToastProvider>
      </TooltipProvider>
    </IconContext.Provider>
  );
}
