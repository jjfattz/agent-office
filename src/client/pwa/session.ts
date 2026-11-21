// The office opened from a phone's home screen stays signed in: it becomes a device of its own, whose
// session each visit renews (see appSession in server/http/routes/app.ts), signed out from 📱 Your devices.
import { standalone } from '../ui/touch';

export function keepSignedIn() {
  if (!standalone()) return;
  void fetch('/api/app/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => {});
}
