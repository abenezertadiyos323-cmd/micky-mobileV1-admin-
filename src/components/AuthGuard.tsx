import type { ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { getTelegramInitData } from "../lib/telegram";
import { Lock } from "lucide-react";

/** Pure-CSS splash that renders instantly — no image files needed */
function SplashScreen() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#000",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {/* Blurred colour blobs — Tech Blue Theme */}
      <div
        style={{
          position: "absolute",
          width: 300,
          height: 300,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(59,130,246,0.15) 0%, transparent 70%)",
          filter: "blur(100px)",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -60%)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 200,
          height: 200,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(6,182,212,0.08) 0%, transparent 70%)",
          filter: "blur(100px)",
          bottom: "20%",
          right: "10%",
          pointerEvents: "none",
        }}
      />

      {/* Brand text */}
      <h1
        style={{
          position: "relative",
          zIndex: 1,
          margin: 0,
          fontSize: "clamp(2.2rem, 10vw, 3.5rem)",
          fontWeight: 900,
          letterSpacing: "-0.02em",
          color: "#fff",
          fontFamily: '"Inter", system-ui, sans-serif',
          textShadow:
            "0 0 12px rgba(255,255,255,0.9), 0 0 30px rgba(59,130,246,0.5)",
          userSelect: "none",
        }}
      >
        TEDYTECH
      </h1>

      {/* Tiny pulsing dots */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          gap: 8,
          marginTop: 28,
        }}
      >
        {[0, 200, 400].map((delay) => (
          <span
            key={delay}
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "#3B82F6",
              opacity: 0.8,
              animation: `ttPing 1.4s ${delay}ms ease-in-out infinite`,
            }}
          />
        ))}
      </div>

      {/* Inline keyframes so no CSS file edit is needed */}
      <style>{`
        @keyframes ttPing {
          0%, 100% { transform: scale(1); opacity: 0.8; }
          50%       { transform: scale(1.8); opacity: 0.2; }
        }
      `}</style>
    </div>
  );
}

export default function AuthGuard({ children }: { children: ReactNode }) {
  const initData = getTelegramInitData();
  const isDev = import.meta.env.MODE === "development";

  const isAuthorized = useQuery((api as any).admin.checkAdminAccess, {
    initData: isDev && !initData ? "MOCK_INIT_DATA" : initData,
  });

  // Show splash while Convex query is loading
  if (isAuthorized === undefined) {
    return <SplashScreen />;
  }

  if (isAuthorized === false && !(isDev && !initData)) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center p-6 text-center"
        style={{ background: "var(--bg)" }}
      >
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
          style={{ background: "rgba(239,68,68,0.15)", color: "#F87171" }}
        >
          <Lock size={32} />
        </div>
        <h1 className="text-xl font-bold mb-2" style={{ color: "var(--text)" }}>
          Access Denied
        </h1>
        <p className="text-sm max-w-sm mb-6" style={{ color: "var(--muted)" }}>
          You are not authorized to view the Micky Mobile Admin Dashboard.
          Please ensure you are accessing this via an authorized Telegram account.
        </p>
      </div>
    );
  }

  if (isDev && !initData && isAuthorized === false) {
    console.warn("Dev mode: Bypassing auth because no initData is present.");
  }

  return <>{children}</>;
}
