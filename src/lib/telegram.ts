// Telegram WebApp helper

export const tg = window.Telegram?.WebApp;

export function getTelegramUser() {
  if (tg?.initDataUnsafe?.user) {
    return tg.initDataUnsafe.user;
  }
  // Stub for development outside Telegram
  return {
    id: 123456789,
    first_name: 'Bena',
    last_name: 'Admin',
    username: 'bena_admin',
    language_code: 'en',
  };
}

export function getTelegramInitData(): string {
  return tg?.initData || '';
}

export function initTelegram() {
  if (tg) {
    tg.ready();
    tg.expand();
  }
}

export function hapticLight() {
  tg?.HapticFeedback?.impactOccurred('light');
}

export function hapticMedium() {
  tg?.HapticFeedback?.impactOccurred('medium');
}

export function hapticSuccess() {
  tg?.HapticFeedback?.notificationOccurred('success');
}

export function hapticError() {
  tg?.HapticFeedback?.notificationOccurred('error');
}
