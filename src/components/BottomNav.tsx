import { NavLink } from 'react-router-dom';
import { useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Home, Package, ArrowLeftRight, MessageCircle } from 'lucide-react';
import { Badge } from './Badge';
import { useBadgePop } from '../hooks/useBadgePop';

export default function BottomNav() {
  const inboxCount    = useQuery(api.threads.getInboxBadgeCount);
  const exchangeCount = useQuery(api.threads.getExchangeBadgeCount);

  // Pop hooks — one per badge, called unconditionally at the top level
  const { shouldPop: inboxPop }    = useBadgePop(inboxCount);
  const { shouldPop: exchangePop } = useBadgePop(exchangeCount);

  const navItems = [
    { to: '/',          label: 'Home',     icon: Home,           badge: undefined,     pop: false },
    { to: '/inventory', label: 'Inventory', icon: Package,        badge: undefined,     pop: false },
    { to: '/exchanges', label: 'Exchange',  icon: ArrowLeftRight, badge: exchangeCount, pop: exchangePop },
    { to: '/inbox',     label: 'Inbox',    icon: MessageCircle,  badge: inboxCount,    pop: inboxPop },
  ];

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 safe-area-pb"
      style={{
        background: 'var(--surface)',
        borderTop: '1px solid var(--border)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-2">
        {navItems.map(({ to, label, icon: Icon, badge, pop }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center flex-1 h-full gap-0.5 transition-colors ${
                isActive ? '' : 'opacity-50 hover:opacity-75'
              }`
            }
            style={({ isActive }) => ({
              color: isActive ? 'var(--primary)' : 'var(--muted)',
            })}
          >
            {({ isActive }) => (
              <>
                {/* Icon wrapper — badge positioned top-right of icon */}
                <span style={{ position: 'relative', display: 'inline-flex' }}>
                  <Icon
                    size={22}
                    strokeWidth={isActive ? 2.5 : 1.8}
                    className="transition-transform active:scale-90"
                  />
                  {badge !== undefined && badge > 0 && (
                    <Badge
                      count={badge}
                      pop={pop}
                      style={{
                        position:      'absolute',
                        top:           '-5px',
                        right:         badge >= 10 ? '-9px' : '-6px',
                        pointerEvents: 'none',
                      }}
                    />
                  )}
                </span>
                <span
                  className="text-[10px] font-medium"
                  style={{ color: isActive ? 'var(--primary)' : 'var(--muted)' }}
                >
                  {label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
