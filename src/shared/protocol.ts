// Wire protocol between browser and server. Every WebSocket frame is one JSON object.
//
// Each part of the office keeps its state types and its messages in ./protocol/<domain>.ts; this
// file puts them back together, so everything is still imported from here, and makes the two
// unions every frame is one of.

import type { AccountsClientMsg, AccountsServerMsg, SignInsClientMsg, TeamClientMsg } from './protocol/accounts.js';
import type { ChangesClientMsg, ChangesServerMsg } from './protocol/changes.js';
import type { FloorClientMsg, FloorServerMsg, PlanClientMsg } from './protocol/floors.js';
import type { GitHubClientMsg, GitHubServerMsg } from './protocol/github.js';
import type { GolfClientMsg, GolfServerMsg } from './protocol/golf.js';
import type { MeetingClientMsg, MeetingServerMsg } from './protocol/meetings.js';
import type { PhoneClientMsg, PhoneServerMsg } from './protocol/phone.js';
import type { PresenceClientMsg, PresenceServerMsg } from './protocol/presence.js';
import type { PushClientMsg, PushServerMsg } from './protocol/push.js';
import type { ProviderAccountsClientMsg, ProviderAccountsServerMsg } from './protocol/provider-accounts.js';
import type { QueueClientMsg, QueueServerMsg } from './protocol/queue.js';
import type { RooftopClientMsg, RooftopServerMsg } from './protocol/rooftop.js';
import type { SettingsClientMsg, SettingsServerMsg } from './protocol/settings.js';
import type { SkeeballClientMsg, SkeeballServerMsg } from './protocol/skeeball.js';
import type { BallClientMsg, CabinetClientMsg, CarClientMsg, DecorClientMsg, DogClientMsg, JukeboxClientMsg, ToysServerMsg, WhiteboardClientMsg } from './protocol/toys.js';
import type { UsageClientMsg, UsageServerMsg } from './protocol/usage.js';
import type { WorkerClientMsg, WorkerServerMsg } from './protocol/workers.js';

export * from './protocol/accounts.js';
export * from './protocol/agents.js';
export * from './protocol/changes.js';
export * from './protocol/floors.js';
export * from './protocol/github.js';
export * from './protocol/golf.js';
export * from './protocol/meetings.js';
export * from './protocol/phone.js';
export * from './protocol/presence.js';
export * from './protocol/push.js';
export * from './protocol/provider-accounts.js';
export * from './protocol/queue.js';
export * from './protocol/rooftop.js';
export * from './protocol/settings.js';
export * from './protocol/skeeball.js';
export * from './protocol/toys.js';
export * from './protocol/usage.js';
export * from './protocol/workers.js';

export type ClientMsg =
  | PresenceClientMsg
  | RooftopClientMsg
  | WorkerClientMsg
  | GitHubClientMsg
  | QueueClientMsg
  | MeetingClientMsg
  | FloorClientMsg
  | PlanClientMsg
  | ChangesClientMsg
  | TeamClientMsg
  | AccountsClientMsg
  | SignInsClientMsg
  | ProviderAccountsClientMsg
  | SettingsClientMsg
  | UsageClientMsg
  | DecorClientMsg
  | JukeboxClientMsg
  | CabinetClientMsg
  | WhiteboardClientMsg
  | BallClientMsg
  | CarClientMsg
  | DogClientMsg
  | PhoneClientMsg
  | PushClientMsg
  | SkeeballClientMsg
  | GolfClientMsg;

export type ServerMsg =
  | PresenceServerMsg
  | RooftopServerMsg
  | WorkerServerMsg
  | GitHubServerMsg
  | QueueServerMsg
  | MeetingServerMsg
  | FloorServerMsg
  | ChangesServerMsg
  | AccountsServerMsg
  | ProviderAccountsServerMsg
  | SettingsServerMsg
  | UsageServerMsg
  | ToysServerMsg
  | PhoneServerMsg
  | PushServerMsg
  | SkeeballServerMsg
  | GolfServerMsg;
