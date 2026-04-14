import { ReactNode, useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { getTelegramInitData } from "../lib/telegram";
import { Lock } from "lucide-react";

export default function AuthGuard({ children }: { children: ReactNode }) {
  const initData = getTelegramInitData();
  const isDev = import.meta.env.MODE === 'development';
  
  // Verify access by decoding the telegram initData string securely on the backend
  const isAuthorized = useQuery(api.admin.checkAdminAccess, { 
    initData: isDev && !initData ? 'MOCK_INIT_DATA' : initData 
  });

  if (isAuthorized === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6" style={{ background: 'var(--bg)' }}>
         <div className="animate-pulse" style={{ color: 'var(--text)' }}>Verifying Admin Access...</div>
      </div>
    );
  }

  if (isAuthorized === false && !(isDev && !initData)) {
    return (
       <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center" style={{ background: 'var(--bg)' }}>
         <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4" style={{ background: 'rgba(239,68,68,0.15)', color: '#F87171' }}>
           <Lock size={32} />
         </div>
         <h1 className="text-xl font-bold mb-2" style={{ color: 'var(--text)' }}>Access Denied</h1>
         <p className="text-sm max-w-sm mb-6" style={{ color: 'var(--muted)' }}>
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
