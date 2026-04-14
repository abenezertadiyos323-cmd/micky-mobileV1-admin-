import type { ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { getTelegramInitData } from "../lib/telegram";
import { Lock } from "lucide-react";

export default function AuthGuard({ children }: { children: ReactNode }) {
  const initData = getTelegramInitData();
  const isDev = import.meta.env.MODE === 'development';
  
  // Verify access by decoding the telegram initData string securely on the backend
  const isAuthorized = useQuery((api as any).admin.checkAdminAccess, { 
    initData: isDev && !initData ? 'MOCK_INIT_DATA' : initData 
  });

  if (isAuthorized === undefined) {
    return (
      <div 
        className="min-h-screen flex flex-col items-center justify-center p-6 relative overflow-hidden" 
        style={{ 
          background: '#000000',
        }}
      >
        {/* Blurred Background Elements */}
        <div 
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: 'url("/micky-logo.png")',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: 'blur(40px) scale(1.1)',
          }}
        />
        
        {/* Main Logo Container */}
        <div className="relative z-10 flex flex-col items-center animate-in fade-in zoom-in duration-700">
          <div className="w-32 h-32 mb-8 relative">
            {/* Soft Glow */}
            <div className="absolute inset-0 rounded-full bg-yellow-400/20 blur-2xl animate-pulse" />
            
            <img 
              src="/micky-logo.png" 
              alt="Micky Mobile" 
              className="w-full h-full object-contain relative z-10 drop-shadow-[0_0_15px_rgba(255,255,255,0.3)]"
            />
          </div>
          
          {/* Minimal Loading Indicator */}
          <div className="flex gap-1.5 mt-4">
            <div className="w-2 h-2 rounded-full bg-yellow-400 animate-bounce [animation-delay:-0.3s]" />
            <div className="w-2 h-2 rounded-full bg-yellow-400 animate-bounce [animation-delay:-0.15s]" />
            <div className="w-2 h-2 rounded-full bg-yellow-400 animate-bounce" />
          </div>
        </div>
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
