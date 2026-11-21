import type { PushState } from '../../../shared/protocol';
import type { Slice } from '../store';

declare module '../store' {
  interface Store {
    /** 🔔 Notify this phone: the office's key and your devices getting pushes, once you've asked (see push/). */
    push: PushState | null;
  }
  interface Topics {
    push: true;
  }
}

export const push: Slice = {
  init(s) {
    s.push = null;
  },
  on: {
    push(s, m) {
      s.push = m.state;
      return ['push'];
    },
  },
};
