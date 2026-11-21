// Web push, written out with node:crypto instead of a package: the office's own VAPID keys (RFC 8292)
// and the aes128gcm message encryption a browser's push service expects (RFC 8291 and RFC 8188).
//
// A push goes from the office to the browser's push service (Apple's, Google's or Mozilla's), which
// hands it to the phone, which wakes the service worker (src/client/public/sw.js) to show it. The push
// service only sees ciphertext: the key is made from the subscription's own p256dh key and auth secret.
import { createECDH, createPrivateKey, generateKeyPairSync, hkdfSync, randomBytes, sign, createCipheriv, type KeyObject } from 'node:crypto';

/** The office's VAPID key pair, as JSON Web Keys (what it keeps on disk). */
export interface VapidKeys {
  publicJwk: { kty: 'EC'; crv: 'P-256'; x: string; y: string };
  privateJwk: { kty: 'EC'; crv: 'P-256'; x: string; y: string; d: string };
}

/** What a browser hands over when it subscribes (PushSubscription.toJSON()). */
export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Who the push services may write to about the office's pushes: the project's page, since there's no admin email. */
export const VAPID_SUBJECT = 'https://github.com/AgentSystemLabs/agent-office';
/** One record is all a notification ever needs. */
const RECORD_SIZE = 4096;

export function makeVapidKeys(): VapidKeys {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pub = publicKey.export({ format: 'jwk' }) as VapidKeys['publicJwk'];
  const priv = privateKey.export({ format: 'jwk' }) as VapidKeys['privateJwk'];
  return { publicJwk: { kty: 'EC', crv: 'P-256', x: pub.x, y: pub.y }, privateJwk: { kty: 'EC', crv: 'P-256', x: priv.x, y: priv.y, d: priv.d } };
}

/** The public key as the browser's applicationServerKey wants it: the uncompressed point, base64url. */
export function vapidPublicKey(keys: VapidKeys): string {
  return Buffer.concat([Buffer.from([4]), Buffer.from(keys.publicJwk.x, 'base64url'), Buffer.from(keys.publicJwk.y, 'base64url')]).toString('base64url');
}

/** Whether `k` looks like a key pair this file made (a broken file on disk makes a new one). */
export function validVapidKeys(k: unknown): k is VapidKeys {
  const o = k as VapidKeys | undefined;
  if (!o?.publicJwk || !o.privateJwk) return false;
  try {
    createPrivateKey({ key: o.privateJwk, format: 'jwk' });
    return Buffer.from(vapidPublicKey(o), 'base64url').length === 65;
  } catch {
    return false;
  }
}

/** The Authorization header for a push to `endpoint`: a JWT for its push service, signed with the office's key. */
export function vapidAuth(keys: VapidKeys, endpoint: string, now = Date.now()): string {
  const aud = new URL(endpoint).origin;
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: VAPID_SUBJECT })}`;
  const key: KeyObject = createPrivateKey({ key: keys.privateJwk, format: 'jwk' });
  const sig = sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `vapid t=${unsigned}.${sig}, k=${vapidPublicKey(keys)}`;
}

/** Whether a subscription's keys are the right shape: a P-256 point and a 16-byte secret. */
export function validTarget(t: PushTarget): boolean {
  try {
    const ua = Buffer.from(t.keys.p256dh, 'base64url');
    const auth = Buffer.from(t.keys.auth, 'base64url');
    return ua.length === 65 && ua[0] === 4 && auth.length === 16;
  } catch {
    return false;
  }
}

/**
 * `payload` encrypted for one subscription (aes128gcm, RFC 8291): the body of the POST to its
 * endpoint. `salt` and `ephemeral` are only given by tests, to check against the RFC's example.
 */
export function encryptPush(target: PushTarget, payload: Buffer, salt = randomBytes(16), ephemeral?: { privateKey: Buffer }): Buffer {
  const uaPublic = Buffer.from(target.keys.p256dh, 'base64url');
  const authSecret = Buffer.from(target.keys.auth, 'base64url');
  const ecdh = createECDH('prime256v1');
  if (ephemeral) ecdh.setPrivateKey(ephemeral.privateKey);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  // The one and last record: the payload and its delimiter (2), no padding.
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body]);
}

/**
 * Push services the office sends to. A subscription's endpoint is a URL the browser hands over, and
 * the office POSTs to it, so anything else is turned away rather than letting a browser point the
 * office at a server on its own network.
 */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/];

export function knownPushService(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && !url.port && !url.username && !url.password && PUSH_HOSTS.some((re) => re.test(url.hostname));
}

/** What a push service said: `gone` means the subscription is over (unsubscribed or expired) and can be dropped. */
export type PushResult = { ok: true } | { ok: false; gone: boolean; error: string };

/** Sends one push. `ttl` is how long the push service keeps trying a phone that's off (seconds). */
export async function sendPush(keys: VapidKeys, target: PushTarget, payload: object, opts: { ttl?: number; urgency?: 'high' | 'normal' } = {}): Promise<PushResult> {
  if (!knownPushService(target.endpoint)) return { ok: false, gone: true, error: 'Not a push service the office knows' };
  const body = encryptPush(target, Buffer.from(JSON.stringify(payload)));
  try {
    const res = await fetch(target.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'content-encoding': 'aes128gcm',
        ttl: String(opts.ttl ?? 3600),
        urgency: opts.urgency ?? 'high',
        authorization: vapidAuth(keys, target.endpoint),
      },
      body: new Uint8Array(body),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return { ok: true };
    const text = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160);
    return { ok: false, gone: res.status === 404 || res.status === 410, error: `${res.status}${text ? ` ${text}` : ''}` };
  } catch (err) {
    const e = err as Error;
    return { ok: false, gone: false, error: e.name === 'TimeoutError' ? 'timed out' : e.message };
  }
}
