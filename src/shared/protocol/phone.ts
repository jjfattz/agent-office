// 📱 Use on your phone: reaching the office from your phone over Tailscale, pairing a phone with a
// QR code, and the devices signed in that way (see server/phone/).

/** Which OS the office runs on, for the right download and the right words. */
export type PhoneOs = 'mac' | 'windows' | 'linux' | 'other';

/** Tailscale on the office's computer, as the 📱 window shows it (admins only). */
export interface PhoneTailscale {
  /**
   * missing: not installed. down: installed, but not running. off: switched off. login: signed out.
   * approve: waiting on the tailnet's admin to let this computer in. starting, running.
   */
  state: 'missing' | 'down' | 'off' | 'login' | 'approve' | 'starting' | 'running';
  /** The Tailscale account it's signed in as. */
  user?: string;
  /** This computer's name on the tailnet, e.g. my-mac.tail1234.ts.net. */
  host?: string;
  magicDns: boolean;
  /** HTTPS certificates are on for the tailnet. */
  https: boolean;
  /** A sign-in under way: Tailscale's page to open. */
  loginUrl?: string;
  /** Tailscale's own page that turns on HTTPS for the tailnet, once `tailscale serve` has handed it over. */
  enableUrl?: string;
  /** Homebrew is installed (a Mac): `brew install --cask tailscale` works too. */
  brew: boolean;
  /** On Linux, the command to run once so the office may change Serve's settings. */
  operator?: string;
  /** Phones and tablets on the tailnet. */
  phones: { name: string; os: string; online: boolean; lastSeen?: string; user?: string }[];
}

/** A device signed in with a pairing link. */
export interface PhoneDevice {
  id: string;
  name: string;
  /** Whose it is: an account's name, or none for the shared password. */
  owner?: string;
  /** Yours (you can sign it out without being an admin). */
  mine: boolean;
  pairedAt: number;
  lastSeenAt?: number;
}

export interface PhoneState {
  /** You may turn access on and off (an admin). */
  admin: boolean;
  /** On a server set up with `--tailscale`: it's already on the tailnet, so there's nothing to set up. */
  managed: boolean;
  os: PhoneOs;
  /** Phone access is on: an admin turned it on, and it's kept through restarts. */
  on: boolean;
  /** Being turned on or off right now. */
  busy: boolean;
  /** The office's address on the tailnet, while it's served there. */
  url?: string;
  /** What's wrong, in plain words, with what to do about it. */
  problem?: string;
  /** Another app has Tailscale's https://…/ on this computer, so the office took another port. */
  movedPort?: boolean;
  /** Admins only. */
  tailscale?: PhoneTailscale;
  awake: {
    /** Keep the computer awake while phone access is on (an admin's choice). */
    on: boolean;
    /** It's being held awake right now. */
    holding: boolean;
    /** This OS has a way to. */
    supported: boolean;
    /** It's a laptop: what still makes it sleep. */
    laptop?: string;
  };
  /** Yours; an admin sees everyone's. */
  devices: PhoneDevice[];
}

export type PhoneClientMsg =
  /** What the 📱 window shows; `watch` while it's open, so it looks again every few seconds. */
  | { t: 'phone.get'; watch?: boolean }
  | { t: 'phone.unwatch' }
  /** Starts Tailscale's sign-in on the office's computer (admins). */
  | { t: 'phone.login' }
  /** Turns phone access on or off (admins). */
  | { t: 'phone.access'; on: boolean }
  /** Keep the computer awake while phone access is on (admins). */
  | { t: 'phone.awake'; on: boolean }
  /** A pairing link for a QR code, signing a phone in as you. */
  | { t: 'phone.pair' }
  /** A test notification on your phones. */
  | { t: 'phone.test' }
  /** Signs out one of your devices (an admin: anyone's). */
  | { t: 'phone.revoke'; id: string };

export type PhoneServerMsg =
  | { t: 'phone'; state: PhoneState }
  /** The link for the QR code, which works once until `expiresAt`. */
  | { t: 'phone.pairing'; url: string; expiresAt: number }
  /** A notification for this device, from 'phone.test'. */
  | { t: 'phone.buzz'; title: string; body: string };
