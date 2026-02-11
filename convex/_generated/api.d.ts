/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as actions_parseLabel from "../actions/parseLabel.js";
import type * as actions_uploadImage from "../actions/uploadImage.js";
import type * as audit from "../audit.js";
import type * as auth from "../auth.js";
import type * as crons from "../crons.js";
import type * as exportQueries from "../exportQueries.js";
import type * as files from "../files.js";
import type * as http from "../http.js";
import type * as mutations from "../mutations.js";
import type * as queries from "../queries.js";
import type * as scheduled from "../scheduled.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "actions/parseLabel": typeof actions_parseLabel;
  "actions/uploadImage": typeof actions_uploadImage;
  audit: typeof audit;
  auth: typeof auth;
  crons: typeof crons;
  exportQueries: typeof exportQueries;
  files: typeof files;
  http: typeof http;
  mutations: typeof mutations;
  queries: typeof queries;
  scheduled: typeof scheduled;
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
