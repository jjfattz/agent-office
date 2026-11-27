// Every HTTP route the office answers, in the order they're tried: a new route goes where it has to
// come in that order (see http/router.ts). The public ones are tried first, then the sign-in check,
// then the rest; the last one answers every path left with the client bundle, or a 404.
import type { Route } from '../router.js';
import { agentRoutes } from './agents.js';
import { appRoutes } from './app.js';
import { authRoutes } from './auth.js';
import { fileRoutes } from './files.js';
import { githubRoutes } from './github.js';
import { pageRoutes } from './pages.js';
import { phoneRoutes } from './phone.js';
import { queueRoutes } from './queue.js';
import { retroRoutes } from './retro.js';
import { searchRoutes } from './search.js';
import { serviceRoutes } from './services.js';

export const routes: readonly Route[] = [
  // Anyone.
  authRoutes.login,
  authRoutes.loginOptions,
  authRoutes.join,
  authRoutes.claimable,
  authRoutes.claim,
  authRoutes.link,
  authRoutes.logout,
  phoneRoutes.pair,
  pageRoutes.health,
  pageRoutes.assets,
  pageRoutes.login,
  pageRoutes.claim,
  pageRoutes.join,
  phoneRoutes.page,
  pageRoutes.favicon,
  appRoutes.manifest,
  appRoutes.worker,
  appRoutes.offline,
  appRoutes.icons,
  // Signed in.
  authRoutes.whoami,
  agentRoutes.models,
  phoneRoutes.name,
  appRoutes.answer,
  appRoutes.appSession,
  fileRoutes.image,
  fileRoutes.whiteboardFile,
  fileRoutes.termDrop,
  fileRoutes.changedFile,
  fileRoutes.docs,
  queueRoutes.image,
  searchRoutes.search,
  serviceRoutes.forwards,
  githubRoutes.github,
  retroRoutes.shelf,
  retroRoutes.identify,
  retroRoutes.rom,
  pageRoutes.office,
  pageRoutes.lite,
  pageRoutes.bundle,
];
