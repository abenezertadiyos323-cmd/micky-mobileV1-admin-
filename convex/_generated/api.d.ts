/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as adminSettings from "../adminSettings.js";
import type * as affiliates from "../affiliates.js";
import type * as auth from "../auth.js";
import type * as botWebhooks from "../botWebhooks.js";
import type * as dashboard from "../dashboard.js";
import type * as demand from "../demand.js";
import type * as exchanges from "../exchanges.js";
import type * as favorites from "../favorites.js";
import type * as files from "../files.js";
import type * as http from "../http.js";
import type * as lib_productStorage from "../lib/productStorage.js";
import type * as messages from "../messages.js";
import type * as phoneActions from "../phoneActions.js";
import type * as products from "../products.js";
import type * as search from "../search.js";
import type * as sessions from "../sessions.js";
import type * as threads from "../threads.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  adminSettings: typeof adminSettings;
  affiliates: typeof affiliates;
  auth: typeof auth;
  botWebhooks: typeof botWebhooks;
  dashboard: typeof dashboard;
  demand: typeof demand;
  exchanges: typeof exchanges;
  favorites: typeof favorites;
  files: typeof files;
  http: typeof http;
  "lib/productStorage": typeof lib_productStorage;
  messages: typeof messages;
  phoneActions: typeof phoneActions;
  products: typeof products;
  search: typeof search;
  sessions: typeof sessions;
  threads: typeof threads;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
