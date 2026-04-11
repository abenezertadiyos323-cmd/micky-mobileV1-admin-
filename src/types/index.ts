// ============================================================
// TedyTech Admin Mini App — TypeScript Types (DATA V2)
// ============================================================

// ---- Enums ----

export type ProductType = 'phone' | 'accessory';

export type Condition = 'New' | 'Like New' | 'Excellent' | 'Good' | 'Fair' | 'Poor';

export type ThreadStatus = 'new' | 'seen' | 'done';

export type MessageSender = 'customer' | 'admin';

export type ExchangeStatus =
  | 'Pending'
  | 'Quoted'
  | 'Accepted'
  | 'Completed'
  | 'Rejected';

export type InventoryReason =
  | 'Exchange completed'
  | 'Manual adjustment'
  | 'Product created'
  | 'Product restored from archive';

export type ThreadCategory = 'hot' | 'warm' | 'cold';

// ---- Product Image ----

export type ProductImage = string;

// ---- Admin ----

export interface Admin {
  _id: string;
  telegramId: string;
  firstName: string;
  lastName?: string;
  username?: string;
  isActive: boolean;
  addedAt: number;
  addedBy?: string;
}

// ---- Product ----

export interface Product {
  _id: string;
  type: ProductType;
  phoneType: string;
  ram?: string;
  storage?: string;
  storageOptions?: string[];
  condition?: Condition;
  price: number;
  stockQuantity: number;
  exchangeEnabled: boolean;
  description?: string;
  images: ProductImage[];
  screenSize?: string;
  battery?: string;
  mainCamera?: string;
  selfieCamera?: string;
  simType?: string;
  color?: string;
  operatingSystem?: string;
  features?: string;
  archivedAt?: number;
  createdAt: number;
  createdBy: string;
  updatedAt: number;
  updatedBy: string;
}

// ---- Thread ----

export interface Thread {
  _id: string;
  telegramId: string;
  customerFirstName: string;
  customerLastName?: string;
  customerUsername?: string;
  status: ThreadStatus;
  unreadCount: number;
  lastMessageAt: number;
  lastMessagePreview?: string;
  lastCustomerMessageAt?: number;
  lastAdminMessageAt?: number;
  hasCustomerMessaged: boolean;
  hasAdminReplied: boolean;
  lastCustomerMessageHasBudgetKeyword: boolean;
  createdAt: number;
  updatedAt: number;
  // Derived
  category?: ThreadCategory;
}

// ---- Message ----

export interface Message {
  _id: string;
  threadId: string;
  sender: MessageSender;
  senderTelegramId: string;
  text: string;
  exchangeId?: string;
  createdAt: number;
}

// ---- Exchange ----

export interface Exchange {
  _id: string;
  telegramId: string;
  threadId: string;
  desiredPhoneId: string;
  tradeInBrand: string;
  tradeInModel: string;
  tradeInStorage: string;
  tradeInRam: string;
  tradeInCondition: Condition;
  tradeInImei?: string;
  customerNotes?: string;
  budgetMentionedInSubmission: boolean;
  desiredPhonePrice: number;
  calculatedTradeInValue: number;
  calculatedDifference: number;
  adminOverrideTradeInValue?: number;
  adminOverrideDifference?: number;
  finalTradeInValue: number;
  finalDifference: number;
  priorityValueETB: number;
  status: ExchangeStatus;
  clickedContinue: boolean;
  quotedAt?: number;
  quotedBy?: string;
  quoteMessageId?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  completedBy?: string;
  rejectedAt?: number;
  rejectedBy?: string;
  // Derived
  category?: ThreadCategory;
  // Joined
  desiredPhone?: Product;
  thread?: Thread;
}

// ---- Inventory Event ----

export interface InventoryEvent {
  _id: string;
  productId: string;
  oldQty: number;
  newQty: number;
  editedBy: string;
  reason: InventoryReason;
  exchangeId?: string;
  timestamp: number;
}

// ---- Dashboard Stats ----

export interface DashboardStats {
  newExchangesToday: number;
  newMessagesToday: number;
  openThreads: number;
  lowStockCount: number;
}

// ---- Recent Activity ----

export type ActivityType =
  | 'exchange_submitted'
  | 'exchange_quoted'
  | 'exchange_accepted'
  | 'exchange_completed'
  | 'exchange_rejected'
  | 'message_sent'
  | 'stock_changed'
  | 'thread_closed'
  | 'product_added'
  | 'product_archived';

export interface RecentActivity {
  id: string;
  type: ActivityType;
  title: string;
  subtitle: string;
  timestamp: number;
}

// ---- Telegram WebApp ----

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        initData: string;
        initDataUnsafe: {
          user?: TelegramUser;
          start_param?: string;
        };
        version: string;
        platform: string;
        colorScheme: 'light' | 'dark';
        themeParams: {
          bg_color?: string;
          text_color?: string;
          hint_color?: string;
          link_color?: string;
          button_color?: string;
          button_text_color?: string;
          secondary_bg_color?: string;
        };
        isExpanded: boolean;
        viewportHeight: number;
        viewportStableHeight: number;
        ready: () => void;
        expand: () => void;
        close: () => void;
        MainButton: {
          text: string;
          color: string;
          textColor: string;
          isVisible: boolean;
          isActive: boolean;
          show: () => void;
          hide: () => void;
          onClick: (callback: () => void) => void;
        };
        BackButton: {
          isVisible: boolean;
          show: () => void;
          hide: () => void;
          onClick: (callback: () => void) => void;
        };
        HapticFeedback: {
          impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
          notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
          selectionChanged: () => void;
        };
      };
    };
  }
}
