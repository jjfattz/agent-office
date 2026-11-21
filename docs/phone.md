# Your office on your phone

Running the office on your own computer and want to check on it from your phone when you're away from your desk? Back to the [README](../README.md).

The office listens on `127.0.0.1` only, so nothing but your computer can open it. The way to reach it from your phone, wherever you are, is [Tailscale](https://tailscale.com): a private network of your own devices. Tailscale Serve puts the office on an `https://` address only your devices can open, with a real certificate, and you don't open any ports or change how the office listens. Then open the **2D view**, `/lite`, which is made for a phone.

## Set it up once

1. **Install Tailscale on both.** On the computer that runs the office, [install Tailscale](https://tailscale.com/download) and sign in. On your phone, install the Tailscale app from the App Store or Google Play and sign in with the same account. Both now show up on Tailscale's [Machines](https://login.tailscale.com/admin/machines) page.
2. **Turn on HTTPS.** On Tailscale's [DNS](https://login.tailscale.com/admin/dns) page, turn on **MagicDNS** and **HTTPS Certificates**. The first `tailscale serve` below offers a link that does it too.
3. **Serve the office on your tailnet.** On the computer, with the office's port (4600 unless you started it with `--port`):

   ```bash
   tailscale serve --bg 4600
   ```

   It prints the office's address, `https://<your-computer>.<your-tailnet>.ts.net`, and keeps serving it through restarts and reboots until you run `tailscale serve reset`. With the Mac App Store version of Tailscale, the `tailscale` command isn't on your PATH until you install it from the app's settings (or run `/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg 4600`).
4. **Start the office with `--trust-proxy`:**

   ```bash
   agent-office --trust-proxy
   ```

   Tailscale Serve is a proxy, like Caddy on a server: this flag lets the office believe it when it says the visitor came over https and from which device, so your phone's sign-in cookie is a secure one and a wrong password on the phone doesn't count against the computer's own browser. The office still listens on `127.0.0.1` only. Opening it on the computer at `http://localhost:4600` works as before.

## On your phone

1. With Tailscale connected on the phone, open `https://<your-computer>.<your-tailnet>.ts.net/lite`.
2. Sign in with the office password (the terminal prints it as the office starts), or with your own [account](../README.md#add-users).
3. Add the page to your home screen (**Share → Add to Home Screen** in Safari, **⋮ → Add to Home screen** in Chrome), so the office is one tap away.
4. Open it from the home screen and tap **🔔** to allow notifications: a worker that needs you then buzzes the phone. On an iPhone, a web page can only notify you once it's on the home screen.

From there you have the whole floor: every worker with what it's asking or doing, ones waiting on you first; tap one for its terminal, with **1** **2** **3** for a permission prompt, the arrows, Enter, Esc and Ctrl+C; **✍️** sends a worker a prompt without opening its terminal; **📌 Issues**, **🔀 PRs**, **📋 Queue** and **✨ New task** to hand out work; and the floor switcher at the top for your other projects. Everything the 2D view does is in [Features](features.md) (*The 2D view, for your phone*). The full 3D office opens at the same address without `/lite`, but it's heavy for a phone.

## Keep the computer awake

The office is only there while the computer is. On a Mac, either keep it from sleeping while you're away:

```bash
caffeinate -s    # keeps the Mac awake on power until you press Ctrl-C
```

or turn on **System Settings → Battery → Options → Prevent automatic sleeping on power adapter when the display is off** (on a desktop Mac, **Energy**). A MacBook with its lid shut still sleeps unless it's plugged in with an external display, so leave the lid open. If you want the office there whether or not your computer is on, run it on a server instead: [`deploy/provision.sh --tailscale`](self-hosting.md) does all of the above for you, on any Ubuntu or Debian machine.

## Why not something else

- **`--host 0.0.0.0`** lets other devices on your Wi-Fi in, over plain http, so it only works at home, and anyone else on that network can try the password.
- **A public tunnel** (Tailscale Funnel, Cloudflare Tunnel, ngrok) puts the office on the internet, and whoever signs in can run commands on your computer through its workers. Keep it on your tailnet, where only your own devices can reach it.
- **Remote desktop** to the computer works, but the 3D office on a phone screen through it is hard to use. The 2D view is made for this.

## Turning it off

`tailscale serve reset` stops serving the office on your tailnet. Signing the phone out of Tailscale, or removing it on the Machines page, cuts it off too.
