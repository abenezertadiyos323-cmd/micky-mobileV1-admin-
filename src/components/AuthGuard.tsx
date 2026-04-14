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
            filter: 'blur(60px) scale(1.2)',
          }}
        />
        
        {/* Main Loading Container */}
        <div className="relative z-10 flex flex-col items-center animate-in fade-in zoom-in duration-1000">
          <h1 
            className="text-4xl md:text-5xl font-black tracking-tighter text-center"
            style={{
              color: '#FFFFFF',
              textShadow: '0 0 10px rgba(255,255,255,0.8), 0 0 20px rgba(253,224,71,0.4)',
              fontFamily: '"Inter", sans-serif'
            }}
          >
            MICKY <span style={{ color: '#FDE047' }}>MOBILE</span>
          </h1>
          
          <div className="mt-8 flex gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-yellow-400/80 animate-ping" />
            <div className="w-1.5 h-1.5 rounded-full bg-yellow-400/80 animate-ping [animation-delay:200ms]" />
            <div className="w-1.5 h-1.5 rounded-full bg-yellow-400/80 animate-ping [animation-delay:400ms]" />
          </div>

          <p className="mt-6 text-[10px] uppercase tracking-[0.3em] font-medium opacity-40 text-white">
            Secure Admin Access
          </p>
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
