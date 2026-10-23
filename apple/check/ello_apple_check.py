"""
ello Apple device check — step 1 of putting ello smartTV on Apple TV / iPhone / iPad.

Answers one question before anything bigger is built: can this Windows PC talk to
your Apple devices the way the sideloader will need to?

  * Apple TV: pair over Wi-Fi (PIN shown on the TV), then open a secure
    connection and read its model and tvOS version.
  * iPhone / iPad: over USB (Trust prompt), read model, iOS version and whether
    Developer Mode is on, then open the same secure connection.

Privacy: everything here happens between this PC and your devices on your own
network/cable. Nothing is sent to the internet — not to Apple, not to anyone.
Pairing keys are kept only on this PC (in %USERPROFILE%\\.pymobiledevice3).
The report (ello-apple-check.txt, next to this program) contains no serial
numbers or device IDs.
"""

from __future__ import annotations

import asyncio
import logging
import os
import platform
import sys
import traceback
from contextlib import AsyncExitStack
from datetime import datetime
from pathlib import Path

REPORT: list[str] = []


def say(msg: str = "") -> None:
    print(msg, flush=True)
    REPORT.append(msg)


def heading(msg: str) -> None:
    say()
    say(msg)
    say("-" * len(msg))


def short_error(e: BaseException) -> str:
    text = f"{type(e).__name__}: {e}".strip()
    return text if len(text) < 300 else text[:300] + "…"


async def open_secure_connection(provider) -> dict:
    """Open the same no-admin tunnel the sideloader will use and read the device's info."""
    from pymobiledevice3.remote import tunnel_service
    from pymobiledevice3.remote.remote_service_discovery import RemoteServiceDiscoveryService
    from pymobiledevice3.remote.userspace_tunnel import UserspaceDialPlane

    tunnel_service.USE_USERSPACE_TUNNEL = True  # pure-Python network stack: no admin, no driver
    async with AsyncExitStack() as stack:
        tunnel = await stack.enter_async_context(provider.start_tcp_tunnel())
        tunnel.client.tun.set_peer(tunnel.address)
        dial = await stack.enter_async_context(UserspaceDialPlane(tunnel.client.tun, tunnel.address))
        rsd = RemoteServiceDiscoveryService((tunnel.address, tunnel.port), open_connection=dial.dial)
        stack.push_async_callback(rsd.close)
        await rsd.connect()
        props = rsd.peer_info.get("Properties", {})
        services = rsd.peer_info.get("Services", {})
        return {
            "model": props.get("ProductType"),
            "os": props.get("OSVersion"),
            "build": props.get("BuildVersion"),
            "can_install": any("installation_proxy" in s for s in services),
            "service_count": len(services),
        }


# ----------------------------------------------------------------------------- Apple TV


async def check_apple_tv() -> None:
    from pymobiledevice3.bonjour import browse_remotepairing_manual_pairing
    from pymobiledevice3.exceptions import RemotePairingCompletedError
    from pymobiledevice3.remote.tunnel_service import (
        RemotePairingManualPairingService,
        get_remote_pairing_tunnel_services,
    )

    heading("Apple TV (Wi-Fi)")
    paired = await get_remote_pairing_tunnel_services(bonjour_timeout=6)
    if paired:
        say("This PC is already paired with an Apple TV / device over Wi-Fi.")
    else:
        say("On the Apple TV open:  Settings > Remotes and Devices > Remote App and Devices")
        say("Leave that screen open (the Apple TV and this PC must be on the same Wi-Fi).")
        input("Press Enter here when the screen is open... ")
        found = []
        for answer in await browse_remotepairing_manual_pairing(timeout=10):
            name = answer.properties.get("name", "Apple device")
            for address in answer.addresses:
                found.append((name, address.full_ip, answer.port, answer.properties.get("identifier")))
        if not found:
            say("RESULT Apple TV: NOT FOUND on the network.")
            say("  Check: same Wi-Fi network? Is the 'Remote App and Devices' screen still open?")
            say("  Some routers block device discovery (look for 'AP/client isolation' or 'multicast').")
            return
        # Prefer IPv4 addresses when the same TV is listed several times.
        found.sort(key=lambda f: ":" in f[1])
        name, ip, port, identifier = found[0]
        say(f"Found: {name}. A PIN should appear on the TV — type it below.")
        try:
            async with RemotePairingManualPairingService(identifier, ip, port) as service:
                await service.connect(autopair=True)
        except RemotePairingCompletedError:
            pass
        say("Paired.")
        paired = await get_remote_pairing_tunnel_services(bonjour_timeout=8)
        if not paired:
            say("RESULT Apple TV: PAIRED, but it could not be reached afterwards. Run this check once more.")
            return

    for provider in paired:
        try:
            info = await open_secure_connection(provider)
            say(f"RESULT Apple TV: OK — secure connection works ({info['model']}, tvOS {info['os']}, build {info['build']}).")
            say(f"  App installing service available: {'yes' if info['can_install'] else 'NO'} ({info['service_count']} services)")
        except Exception as e:
            say(f"RESULT Apple TV: paired, but the secure connection FAILED: {short_error(e)}")
        finally:
            try:
                await provider.close()
            except Exception:
                pass


# ----------------------------------------------------------------------------- iPhone / iPad


async def check_usb_devices() -> None:
    from pymobiledevice3 import usbmux
    from pymobiledevice3.lockdown import create_using_usbmux
    from pymobiledevice3.remote.tunnel_service import CoreDeviceTunnelProxy

    heading("iPhone / iPad (USB cable)")
    try:
        devices = [d for d in await usbmux.list_devices() if d.is_usb]
    except Exception as e:
        say("RESULT iPhone/iPad: could not talk to Apple's device service on this PC.")
        say("  Install Apple's 'Apple Devices' app (Microsoft Store) or iTunes, then run this again.")
        say(f"  ({short_error(e)})")
        return
    if not devices:
        say("No iPhone or iPad connected by cable — skipped. (Plug one in and run this again to test it.)")
        return

    for d in devices:
        lockdown = None
        try:
            say("Unlock the device and tap 'Trust' if it asks.")
            lockdown = await create_using_usbmux(serial=d.serial, autopair=True, pair_timeout=60)
            info = lockdown.short_info
            name = f"{info.get('ProductType')} ({info.get('DeviceClass')})"
            dev_mode = await lockdown.get_developer_mode_status()
            say(f"{name}: iOS {info.get('ProductVersion')}, Developer Mode {'ON' if dev_mode else 'OFF'}")
            if not dev_mode:
                say("  Developer Mode is needed to run your own apps: Settings > Privacy & Security > Developer Mode.")
                say("  (If you don't see it, it appears after the first app install attempt.)")
            provider = await CoreDeviceTunnelProxy.create(lockdown)
            try:
                tunnel_info = await open_secure_connection(provider)
                say(f"RESULT {name}: OK — secure connection works; installing service available: "
                    f"{'yes' if tunnel_info['can_install'] else 'NO'}.")
            finally:
                await provider.close()
        except Exception as e:
            say(f"RESULT {d.connection_type} device: FAILED — {short_error(e)}")
        finally:
            if lockdown is not None:
                try:
                    await lockdown.close()
                except Exception:
                    pass


# ----------------------------------------------------------------------------- main


async def main() -> None:
    say("ello Apple device check")
    say(f"{datetime.now():%Y-%m-%d %H:%M} · Windows {platform.version()} · Python {platform.python_version()}")
    say("Everything stays between this PC and your devices — nothing is sent to the internet.")
    for step in (check_apple_tv, check_usb_devices):
        try:
            await step()
        except KeyboardInterrupt:
            raise
        except Exception as e:
            say(f"Unexpected problem in {step.__name__}: {short_error(e)}")
            REPORT.append(traceback.format_exc())


def report_path() -> Path:
    base = Path(sys.executable).parent if getattr(sys, "frozen", False) else Path(__file__).parent
    return base / "ello-apple-check.txt"


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING, format="%(message)s")
    if "--selftest" in sys.argv:
        # CI: prove the bundled program and all its parts load (no devices needed).
        import pymobiledevice3.bonjour  # noqa: F401
        import pymobiledevice3.remote.userspace_tunnel  # noqa: F401
        import pymobiledevice3.remote.tunnel_service  # noqa: F401
        import pymobiledevice3.lockdown  # noqa: F401
        print("selftest ok")
        sys.exit(0)
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        say("Stopped.")
    path = report_path()
    try:
        path.write_text("\n".join(REPORT), encoding="utf-8")
        print(f"\nSaved this report to: {path}")
    except OSError:
        pass
    if os.name == "nt":
        input("\nPress Enter to close.")
