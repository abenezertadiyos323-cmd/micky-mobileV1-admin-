/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as affiliates from "../affiliates.js";
import type * as auth from "../auth.js";
import type * as dashboard from "../dashboard.js";
import type * as demand from "../demand.js";
import type * as exchanges from "../exchanges.js";
import type * as favorites from "../favorites.js";
import type * as files from "../files.js";
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
  affiliates: typeof affiliates;
  auth: typeof auth;
  dashboard: typeof dashboard;
  demand: typeof demand;
  exchanges: typeof exchanges;
  favorites: typeof favorites;
  files: typeof files;
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
