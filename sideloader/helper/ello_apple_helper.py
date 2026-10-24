"""
ello Sideloader helper: the background program that talks to your Apple devices.

ello Sideloader starts it and exchanges one JSON object per line:
  app → helper   {"id": 1, "cmd": "discover"}            (see COMMANDS below)
                 {"pin": "123456"}                         (answer to a pin_required event)
  helper → app   {"id": 1, "ok": true, "data": ...} / {"id": 1, "ok": false, "error": "..."}
                 {"event": "pin_required", "name": "Living Room"}

Privacy: it talks to your own Apple devices on your network / USB, and, only
when you sign in and install, to Apple (gsa.apple.com for the sign-in,
developerservices2.apple.com for the free signing certificate). Nothing goes
anywhere else. Pairing keys stay in %USERPROFILE%\\.pymobiledevice3; the device
list and the (DPAPI-encrypted) Apple sign-in in %APPDATA%\\ello-sideloader.
"""

from __future__ import annotations

import asyncio
import json
import os
import queue
import sys
import threading
import traceback
from contextlib import AsyncExitStack
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

_out_lock = threading.Lock()
_pins: "queue.Queue[str]" = queue.Queue()
_codes: "queue.Queue[str]" = queue.Queue()
_pairing_name = ["Apple TV"]


def emit(obj: dict) -> None:
    with _out_lock:
        sys.stdout.write(json.dumps(obj) + "\n")
        sys.stdout.flush()


# ----------------------------------------------------------------------------- device list


def _cache_path() -> Path:
    base = Path(os.environ.get("APPDATA") or Path.home() / ".config") / "ello-sideloader"
    base.mkdir(parents=True, exist_ok=True)
    return base / "devices.json"


def load_known() -> dict[str, dict]:
    try:
        return json.loads(_cache_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_known(known: dict[str, dict]) -> None:
    clean = {k: {kk: vv for kk, vv in v.items() if kk not in ("online", "usb")} for k, v in known.items()}
    _cache_path().write_text(json.dumps(clean, indent=1), encoding="utf-8")


def kind_of(model: str | None) -> str:
    m = model or ""
    if m.startswith("AppleTV"):
        return "tv"
    if m.startswith("iPad"):
        return "ipad"
    if m.startswith("iPhone"):
        return "iphone"
    return "other"


# ----------------------------------------------------------------------------- pymobiledevice3 glue


def _gui_pin_input(prompt: str = "") -> str:
    """Replaces the library's console PIN prompt: ask the app and wait for its answer."""
    while not _pins.empty():
        _pins.get_nowait()
    emit({"event": "pin_required", "name": _pairing_name[0]})
    try:
        return _pins.get(timeout=180)
    except queue.Empty:
        raise TimeoutError("No code was entered in time.") from None


async def secure_info(provider) -> dict:
    """Open the no-admin userspace tunnel to a device and read what it reports."""
    from pymobiledevice3.remote import tunnel_service
    from pymobiledevice3.remote.remote_service_discovery import RemoteServiceDiscoveryService
    from pymobiledevice3.remote.userspace_tunnel import UserspaceDialPlane

    tunnel_service.USE_USERSPACE_TUNNEL = True
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
            "canInstall": any("installation_proxy" in s for s in services),
        }


async def _paired_wifi(timeout: float = 5) -> dict[str, Any]:
    from pymobiledevice3.remote.tunnel_service import get_remote_pairing_tunnel_services

    return {s.remote_identifier: s for s in await get_remote_pairing_tunnel_services(bonjour_timeout=timeout)}


async def _close_all(services) -> None:
    for s in services:
        try:
            await s.close()
        except Exception:
            pass


async def _usb_devices():
    from pymobiledevice3 import usbmux

    try:
        return [d for d in await usbmux.list_devices() if d.is_usb]
    except Exception:
        return None  # Apple's device service isn't installed / running


# ----------------------------------------------------------------------------- commands


async def cmd_devices(_: dict) -> dict:
    """Known devices with live status: Wi-Fi reachability and USB connection."""
    from pymobiledevice3.lockdown import create_using_usbmux

    known = load_known()
    online = await _paired_wifi()
    await _close_all(online.values())
    for ident, dev in known.items():
        dev["online"] = ident in online
        dev["usb"] = False
    usb = await _usb_devices()
    for d in usb or []:
        try:
            lockdown = await create_using_usbmux(serial=d.serial, autopair=False)
        except Exception:
            continue  # not trusted yet: added through "Add iPhone or iPad"
        try:
            info = lockdown.short_info
            ident = info.get("UniqueDeviceID") or d.serial
            dev = known.setdefault(ident, {"id": ident})
            dev.update({
                "name": info.get("DeviceName") or dev.get("name") or "iPhone",
                "model": info.get("ProductType"),
                "os": info.get("ProductVersion"),
                "kind": kind_of(info.get("ProductType")),
                "usb": True,
                "online": True,
                "developerMode": await lockdown.get_developer_mode_status(),
            })
        finally:
            await lockdown.close()
    save_known(known)
    return {"devices": list(known.values()), "usbService": usb is not None}


async def cmd_discover(_: dict) -> list[dict]:
    """Apple TVs currently showing the 'Remote App and Devices' pairing screen."""
    from pymobiledevice3.bonjour import browse_remotepairing_manual_pairing

    found: dict[str, dict] = {}
    for answer in await browse_remotepairing_manual_pairing(timeout=6):
        ident = answer.properties.get("identifier")
        for address in answer.addresses:
            entry = found.setdefault(ident, {
                "identifier": ident,
                "name": answer.properties.get("name", "Apple TV"),
                "ip": address.full_ip,
                "port": answer.port,
            })
            if ":" in entry["ip"] and ":" not in address.full_ip:
                entry["ip"] = address.full_ip  # prefer IPv4
    return list(found.values())


async def cmd_pair(msg: dict) -> dict:
    from pymobiledevice3.exceptions import RemotePairingCompletedError
    from pymobiledevice3.remote.tunnel_service import RemotePairingManualPairingService

    _pairing_name[0] = msg.get("name") or "Apple TV"
    try:
        async with RemotePairingManualPairingService(msg["identifier"], msg["ip"], int(msg["port"])) as service:
            await service.connect(autopair=True)
    except RemotePairingCompletedError:
        pass
    # Confirm with a real secure connection, then remember the device.
    for _ in range(3):
        online = await _paired_wifi(timeout=6)
        try:
            provider = online.get(msg["identifier"])
            if provider is not None:
                info = await secure_info(provider)
                known = load_known()
                known[msg["identifier"]] = {
                    "id": msg["identifier"],
                    "name": _pairing_name[0],
                    "kind": kind_of(info["model"]) if info["model"] else "tv",
                    **info,
                }
                save_known(known)
                return {**known[msg["identifier"]], "online": True}
        finally:
            await _close_all(online.values())
    raise RuntimeError("Paired, but the Apple TV didn't answer afterwards. Make sure it's awake, then use Check connection.")


async def cmd_check(msg: dict) -> dict:
    known = load_known()
    dev = known.get(msg["id"], {"id": msg["id"]})
    usb = await _usb_devices() or []
    if dev.get("kind") in ("iphone", "ipad") and usb:
        result = await cmd_devices({})
        for d in result["devices"]:
            if d["id"] == msg["id"] and d.get("usb"):
                return d
    online = await _paired_wifi(timeout=6)
    try:
        provider = online.get(msg["id"])
        if provider is None:
            raise RuntimeError("Not reachable. Make sure it's switched on, awake and on the same Wi-Fi as this PC.")
        info = await secure_info(provider)
    finally:
        await _close_all(online.values())
    dev.update(info)
    known[msg["id"]] = dev
    save_known(known)
    return {**dev, "online": True}


async def cmd_trust_usb(_: dict) -> dict:
    """Pair with the iPhone/iPad on the cable (it shows 'Trust this computer?')."""
    from pymobiledevice3.lockdown import create_using_usbmux

    usb = await _usb_devices()
    if usb is None:
        raise RuntimeError("Apple's device service isn't running. Install the 'Apple Devices' app from the Microsoft Store, then try again.")
    if not usb:
        raise RuntimeError("No iPhone or iPad found. Plug it in with a cable and unlock it.")
    emit({"event": "trust_required"})
    lockdown = await create_using_usbmux(serial=usb[0].serial, autopair=True, pair_timeout=120)
    try:
        info = lockdown.short_info
        ident = info.get("UniqueDeviceID") or usb[0].serial
        known = load_known()
        known[ident] = {
            "id": ident,
            "name": info.get("DeviceName") or "iPhone",
            "model": info.get("ProductType"),
            "os": info.get("ProductVersion"),
            "kind": kind_of(info.get("ProductType")),
            "developerMode": await lockdown.get_developer_mode_status(),
        }
        save_known(known)
        return {**known[ident], "online": True, "usb": True}
    finally:
        await lockdown.close()


async def cmd_reveal_dev_mode(msg: dict) -> bool:
    """Make the Developer Mode switch appear in the iPhone/iPad's Settings (Apple hides it
    until a developer connection asks for it). Turning it on stays on the device."""
    from pymobiledevice3.lockdown import create_using_usbmux
    from pymobiledevice3.services.amfi import AmfiService

    usb = await _usb_devices() or []
    serial = next((d.serial for d in usb if d.serial == msg["id"]), None) or (usb[0].serial if len(usb) == 1 else None)
    if serial is None:
        raise RuntimeError("Connect the iPhone or iPad with a cable first, and unlock it.")
    lockdown = await create_using_usbmux(serial=serial, autopair=False)
    try:
        await AmfiService(lockdown).reveal_developer_mode_option_in_ui()
    finally:
        await lockdown.close()
    return True


# ----------------------------------------------------------------------------- Apple ID & installing


def _ask_code(mode: str) -> str:
    """Two-factor: ask the app for the code Apple sent, and wait for it."""
    while not _codes.empty():
        _codes.get_nowait()
    emit({"event": "code_required", "mode": mode})
    try:
        return _codes.get(timeout=300)
    except queue.Empty:
        raise TimeoutError("No code was entered in time. Sign in again.") from None


async def cmd_account(_: dict) -> dict:
    import apple_account

    return apple_account.describe()


async def cmd_get_anisette(msg: dict) -> str:
    import apple_account

    return apple_account.anisette_server()


async def cmd_set_anisette(msg: dict) -> str:
    """Use an anisette server for Apple's machine data ("" = back to iCloud / built-in)."""
    import apple_account

    url = apple_account.set_anisette_server(str(msg.get("url") or ""))
    if url:
        # Check it answers before anyone signs in with it.
        await asyncio.to_thread(apple_account.RemoteMachine(url).headers)
    return url


async def cmd_sign_in(msg: dict) -> dict:
    import apple_account

    apple_id = (msg.get("appleId") or "").strip()
    password = msg.get("password") or ""
    if "@" not in apple_id or not password:
        raise RuntimeError("Enter the Apple ID's email and password.")
    progress("Contacting Apple…")
    session = await asyncio.to_thread(apple_account.sign_in, apple_id, password, _ask_code)
    apple_account.save_secret("session", session.to_dict())
    apple_account.save_secret("password", {"appleId": apple_id, "password": password} if msg.get("remember") else None)
    return apple_account.describe()


async def cmd_sign_out(_: dict) -> dict:
    import apple_account

    apple_account.save_secret("session", None)
    apple_account.save_secret("password", None)
    return apple_account.describe()


def _session():
    """The saved session, signing in again with the saved password if it expired."""
    import apple_account

    saved = apple_account.load_secret("session")
    if saved:
        s = apple_account.Session.from_dict(saved)
        if s.valid:
            return s
    pw = apple_account.load_secret("password")
    if not pw:
        raise RuntimeError("Sign in with your Apple ID first.")
    s = apple_account.sign_in(pw["appleId"], pw["password"], _ask_code)
    apple_account.save_secret("session", s.to_dict())
    return s


def progress(text: str, percent: float | None = None) -> None:
    emit({"event": "progress", "text": text, "percent": percent})


def _bundled_ipa() -> Path:
    here = Path(__file__).resolve().parent
    for p in (here / "ello-smartTV.ipa", here.parent / "ello-smartTV.ipa", here.parent / "apps" / "ello-smartTV.ipa"):
        if p.exists():
            return p
    raise RuntimeError("Choose an .ipa file to install.")


async def cmd_app_info(msg: dict) -> dict:
    from app_signer import app_info

    path = Path(msg["path"]) if msg.get("path") else _bundled_ipa()
    return {**app_info(path), "path": str(path), "size": path.stat().st_size}


class _Device:
    """A connection to a device that can install apps: USB (lockdown) or Wi-Fi (tunnel)."""

    def __init__(self, dev_id: str) -> None:
        self.dev_id = dev_id
        self.stack = AsyncExitStack()
        self.provider = None
        self.udid: str | None = None

    async def __aenter__(self) -> "_Device":
        from pymobiledevice3.lockdown import create_using_usbmux

        usb = await _usb_devices() or []
        serial = next((d.serial for d in usb if d.serial == self.dev_id), None)
        if serial:
            ld = await create_using_usbmux(serial=serial, autopair=False)
            self.stack.push_async_callback(ld.close)
            self.provider = ld
            self.udid = ld.short_info.get("UniqueDeviceID") or serial
            return self
        from pymobiledevice3.remote import tunnel_service
        from pymobiledevice3.remote.remote_service_discovery import RemoteServiceDiscoveryService
        from pymobiledevice3.remote.userspace_tunnel import UserspaceDialPlane

        online = await _paired_wifi(timeout=6)
        provider = online.pop(self.dev_id, None)
        await _close_all(online.values())
        if provider is None:
            raise RuntimeError("The device isn't reachable. Plug it in with a cable (iPhone/iPad), or make sure it's awake on the same Wi-Fi (Apple TV).")
        tunnel_service.USE_USERSPACE_TUNNEL = True
        self.stack.push_async_callback(provider.close)
        tunnel = await self.stack.enter_async_context(provider.start_tcp_tunnel())
        tunnel.client.tun.set_peer(tunnel.address)
        dial = await self.stack.enter_async_context(UserspaceDialPlane(tunnel.client.tun, tunnel.address))
        rsd = RemoteServiceDiscoveryService((tunnel.address, tunnel.port), open_connection=dial.dial)
        self.stack.push_async_callback(rsd.close)
        await rsd.connect()
        self.provider = rsd
        self.udid = rsd.peer_info.get("Properties", {}).get("UniqueDeviceID")
        if not self.udid:
            raise RuntimeError("The device didn't tell its ID. Try again.")
        return self

    async def __aexit__(self, *exc) -> None:
        await self.stack.aclose()


async def cmd_install(msg: dict) -> dict:
    """Sign the app for this Apple ID + device and install it (also used for the weekly renewal)."""
    import apple_account
    import apple_dev
    from app_signer import app_info, sign_ipa
    from pymobiledevice3.services.installation_proxy import InstallationProxyService

    known = load_known()
    dev = known.get(msg["id"])
    if not dev:
        raise RuntimeError("Add this device first.")
    ipa = Path(msg["path"]) if msg.get("path") else _bundled_ipa()
    info = app_info(ipa)
    tv = dev.get("kind") == "tv"
    if tv and "AppleTVOS" not in info["platforms"]:
        raise RuntimeError(f"{info['name']} is an iPhone/iPad app; it can't run on Apple TV. The Apple TV version of ello comes later.")
    if not tv and info["platforms"] and "iPhoneOS" not in info["platforms"]:
        raise RuntimeError(f"{info['name']} is made for Apple TV, not iPhone/iPad.")

    progress("Connecting to " + (dev.get("name") or "the device") + "…")
    async with _Device(msg["id"]) as conn:
        if conn.udid:
            dev["udid"] = conn.udid
        progress("Signing in to Apple…")
        session = await asyncio.to_thread(_session)
        machine = await asyncio.to_thread(apple_account.pick_machine)
        progress("Getting a signing certificate from Apple…")
        signing = await asyncio.to_thread(
            apple_dev.prepare, session, machine, conn.udid, dev.get("name") or "Device", tv,
            info["bundleId"] or "com.ello.app", info["name"])
        signed = apple_dev.cached_dir() / f"{signing.bundle_id}.ipa"
        await asyncio.to_thread(sign_ipa, ipa, signed, signing.bundle_id, signing.profile, signing.entitlements,
                                signing.cert_pem, signing.key_pem, progress)
        progress("Sending the app to " + (dev.get("name") or "the device") + "…", 0)

        def on_progress(pct, *_):
            progress("Installing…", float(pct))

        try:
            async with InstallationProxyService(lockdown=conn.provider) as ip:
                await ip.install_from_local(signed, handler=on_progress)
        except Exception as e:
            text = str(e)
            if "ApplicationVerificationFailed" in text or "0xe8008015" in text.lower():
                raise RuntimeError("The device rejected the signature. Turn on Developer Mode (Settings → Privacy & Security), restart, and try again.") from e
            if "DeviceNotRegistered" in text or "0xe800801c" in text.lower():
                raise RuntimeError("Apple hasn't registered this device to your Apple ID yet. Try again in a minute.") from e
            raise
        finally:
            signed.unlink(missing_ok=True)

    prof = apple_dev.profile_plist(signing.profile)
    expires = prof.get("ExpirationDate")
    entry = {
        "name": info["name"],
        "bundleId": signing.bundle_id,
        "version": info["version"],
        "source": str(ipa),
        "installedAt": __import__("time").time(),
        "expires": expires.timestamp() if hasattr(expires, "timestamp") else None,
    }
    apps = [a for a in dev.get("apps", []) if a.get("bundleId") != signing.bundle_id]
    dev["apps"] = [entry, *apps]
    known[msg["id"]] = dev
    save_known(known)
    progress("Done", 100)
    return {**dev, "online": True}


async def cmd_forget(msg: dict) -> bool:
    from pymobiledevice3.common import get_home_folder

    known = load_known()
    known.pop(msg["id"], None)
    save_known(known)
    # Remove this PC's pairing keys for the device as well.
    for record in get_home_folder().glob(f"*{msg['id']}*"):
        try:
            record.unlink()
        except OSError:
            pass
    return True


COMMANDS: dict[str, Callable[[dict], Any]] = {
    "devices": cmd_devices,
    "discover": cmd_discover,
    "pair": cmd_pair,
    "check": cmd_check,
    "trustUsb": cmd_trust_usb,
    "forget": cmd_forget,
    "revealDevMode": cmd_reveal_dev_mode,
    "account": cmd_account,
    "signIn": cmd_sign_in,
    "signOut": cmd_sign_out,
    "getAnisette": cmd_get_anisette,
    "setAnisette": cmd_set_anisette,
    "appInfo": cmd_app_info,
    "install": cmd_install,
}


def friendly(e: BaseException) -> str:
    text = str(e) or type(e).__name__
    low = text.lower()
    if isinstance(e, TimeoutError) or "timed out" in low:
        return text if "code" in low else "The device didn't respond in time."
    if "pairing" in low and any(w in low for w in ("reject", "pin", "proof", "match")):
        return "Pairing was refused. Check the code on the TV and try again."
    return text[:300]


async def run_command(msg: dict) -> None:
    rid = msg.get("id")
    try:
        handler = COMMANDS[msg["cmd"]]
        emit({"id": rid, "ok": True, "data": await handler(msg)})
    except Exception as e:  # report every failure to the app instead of dying
        detail = traceback.format_exc()
        error = friendly(e)
        if type(e).__name__ not in ("AppleError", "RuntimeError", "TimeoutError"):
            # Something ello didn't expect: keep the details (code locations and the
            # error only, never passwords) so the cause can be found.
            error = f"{error} ({type(e).__name__}). Details saved to %APPDATA%\\ello-sideloader\\last-error.txt"
            try:
                base = Path(os.environ.get("APPDATA") or Path.home() / ".config") / "ello-sideloader"
                base.mkdir(parents=True, exist_ok=True)
                (base / "last-error.txt").write_text(
                    f"{datetime.now().isoformat()} {msg.get('cmd')}\n{detail}", encoding="utf-8")
            except OSError:
                pass
        emit({"id": rid, "ok": False, "error": error, "detail": detail})


def main() -> None:
    if "--selftest" in sys.argv:
        import pymobiledevice3.bonjour  # noqa: F401
        import pymobiledevice3.lockdown  # noqa: F401
        if not os.environ.get("ELLO_SELFTEST_WINE"):  # wine lacks the Windows network API the tunnel uses
            import pymobiledevice3.remote.userspace_tunnel  # noqa: F401
        import pymobiledevice3.services.installation_proxy  # noqa: F401
        import apple_account
        import apple_dev  # noqa: F401
        import app_signer

        app_signer.rcodesign()
        apple_account.Machine()  # loads Apple's libraries (no network)
        print("selftest ok")
        return

    # The library asks for the Apple TV code with input(); answer it from the app instead.
    from pymobiledevice3.remote import tunnel_service

    tunnel_service.input = _gui_pin_input  # a module global shadows the builtin

    loop = asyncio.new_event_loop()
    threading.Thread(target=loop.run_forever, daemon=True).start()
    lock = asyncio.Lock()

    async def one_at_a_time(msg: dict) -> None:
        # Pairing and tunnels don't mix well in parallel.
        async with lock:
            await run_command(msg)

    emit({"event": "ready"})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        if "pin" in msg:
            _pins.put(str(msg["pin"]))
        elif "code" in msg:
            _codes.put(str(msg["code"]))
        elif msg.get("cmd") == "quit":
            break
        else:
            asyncio.run_coroutine_threadsafe(one_at_a_time(msg), loop)


if __name__ == "__main__":
    main()
