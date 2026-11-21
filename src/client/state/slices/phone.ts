import type { PhoneState } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** 📱 Use on your phone: what its window shows you, once you've asked (see ui/phone.ts). */
    phone: PhoneState | null;
    /** The last pairing link the office made you, for the QR code. */
    phonePairing: { url: string; expiresAt: number } | null;
  }
  interface Topics {
    phone: true;
    phonePairing: true;
  }
}

export const phone: Slice = {
  init(s) {
    s.phone = null;
    s.phonePairing = null;
  },
  on: {
    phone(s, m) {
      s.phone = m.state;
      // Off again: the link on the screen can't be used any more.
      if (!m.state.url && s.phonePairing) {
        s.phonePairing = null;
        return ['phone', 'phonePairing'];
      }
      return ['phone'];
    },
    'phone.pairing'(s, m) {
      s.phonePairing = { url: m.url, expiresAt: m.expiresAt };
      return ['phonePairing'];
    },
  },
};
