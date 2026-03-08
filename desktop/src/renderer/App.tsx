import React, { useState, useEffect } from "react";
import { Wizard } from "./wizard/Wizard";
import { Splash } from "./Splash";
import "./types";

export function App() {
  const [view, setView] = useState<"loading" | "wizard" | "splash">("loading");

  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (hash === "wizard") {
      setView("wizard");
    } else if (hash === "splash") {
      setView("splash");
    } else {
      // Determine from config
      window.proqDesktop.getConfig().then((config) => {
        setView(config.setupComplete ? "splash" : "wizard");
      });
    }
  }, []);

  if (view === "loading") {
    return (
      <div className="splash-container">
        <div className="spinner" />
      </div>
    );
  }

  if (view === "wizard") {
    return <Wizard onComplete={() => setView("splash")} />;
  }

  return <Splash />;
}
