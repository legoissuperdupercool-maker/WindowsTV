"""
ello Apple helper — the background program behind ello smartTV's "Apple devices" page.

The app starts it and talks to it with one JSON object per line:
  app → helper   {"id": 1, "cmd": "discover"}            (see COMMANDS below)
                 {"pin": "123456"}                         (answer to a pin_required event)
  helper → app   {"id": 1, "ok": true, "data": ...} / {"id": 1, "ok": false, "error": "..."}
                 {"event": "pin_required", "name": "Living Room"}

Privacy: it only talks to your own Apple devices on your network / USB. Nothing
is sent to the internet. Pairing keys stay in %USERPROFILE%\\.pymobiledevice3;
the device list (names, models, OS versions) in %APPDATA%\\ello-smarttv.
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
from pathlib import Path
from typing import Any, Callable

_out_lock = threading.Lock()
_pins: "queue.Queue[str]" = queue.Queue()


def emit(obj: dict) -> None:
    with _out_lock:
        sys.stdout.write(json.dumps(obj) + "\n")
        sys.stdout.flush()


# ----------------------------------------------------------------------------- device list cache


def _cache_path() -> Path:
    base = Path(os.environ.get("APPDATA") or Path.home() / ".config") / "ello-smarttv"
    base.mkdir(parents=True, exist_ok=True)
    return base / "apple-devices.json"


def load_known() -> dict[str, dict]:
    try:
        return json.loads(_cache_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_known(known: dict[str, dict]) -> None:
    _cache_path().write_text(json.dumps(known, indent=1), encoding="utf-8")


def kind_of(model: str | None) -> str:
    m = model or ""
    return "tv" if m.startswith("AppleTV") else "ipad" if m.startswith("iPad") else "iphone" if m.startswith("iPhone") else "other"


# ----------------------------------------------------------------------------- pymobiledevice3 glue


def _gui_pin_input(prompt: str = "") -> str:
    """Replaces the library's console PIN prompt: ask the app, wait for its answer."""
    while not _pins.empty():
        _pins.get_nowait()
    emit({"event": "pin_required", "name": _pairing_name[0]})
    try:
        return _pins.get(timeout=180)
    except queue.Empty:
        raise TimeoutError("No code was entered in time.") from None


_pairing_name = ["Apple TV"]


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


# ----------------------------------------------------------------------------- commands


async def cmd_devices(_: dict) -> list[dict]:
    """Known devices with live status: Wi-Fi reachability and USB connection."""
    from pymobiledevice3 import usbmux
    from pymobiledevice3.lockdown import create_using_usbmux

    known = load_known()
    online = await _paired_wifi()
    await _close_all(online.values())
    for ident, dev in known.items():
        dev["online"] = ident in online
        dev["usb"] = False
    try:
        usb = [d for d in await usbmux.list_devices() if d.is_usb]
    except Exception:
        usb = []
    for d in usb:
        try:
            lockdown = await create_using_usbmux(serial=d.serial, autopair=False)
        except Exception:
            continue  # not trusted yet: shows up via "Add iPhone or iPad"
        try:
            info = lockdown.short_info
            ident = info.get("UniqueDeviceID") or d.serial
            dev = known.setdefault(ident, {})
            dev.update({
                "id": ident,
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
    save_known({k: {kk: vv for kk, vv in v.items() if kk not in ("online", "usb")} for k, v in known.items()})
    return list(known.values())


async def cmd_discover(_: dict) -> list[dict]:
    """Apple TVs currently showing the 'Remote App and Devices' pairing screen."""
    from pymobiledevice3.bonjour import browse_remotepairing_manual_pairing

    found: dict[str, dict] = {}
    for answer in await browse_remotepairing_manual_pairing(timeout=6):
        ident = answer.properties.get("identifier")
        for address in answer.addresses:
            entry = found.setdefault(ident, {
                "identifier": ident, "name": answer.properties.get("name", "Apple TV"),
                "ip": address.full_ip, "port": answer.port,
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
    # Confirm with a real secure connection, and remember the device.
    for _ in range(3):
        online = await _paired_wifi(timeout=6)
        try:
            provider = online.get(msg["identifier"])
            if provider is not None:
                info = await secure_info(provider)
                known = load_known()
                known[msg["identifier"]] = {
                    "id": msg["identifier"], "name": _pairing_name[0], "kind": kind_of(info["model"]) if info["model"] else "tv",
                    **info,
                }
                save_known(known)
                return {**known[msg["identifier"]], "online": True}
        finally:
            await _close_all(online.values())
    raise RuntimeError("Paired, but the Apple TV didn't answer afterwards. Make sure it's awake, then use Check connection.")


async def cmd_check(msg: dict) -> dict:
    online = await _paired_wifi(timeout=6)
    try:
        provider = online.get(msg["id"])
        if provider is None:
            raise RuntimeError("Not reachable. Make sure it's switched on and on the same Wi-Fi as this PC.")
        info = await secure_info(provider)
    finally:
        await _close_all(online.values())
    known = load_known()
    known.setdefault(msg["id"], {"id": msg["id"]}).update(info)
    save_known(known)
    return {**known[msg["id"]], "online": True}


async def cmd_trust_usb(_: dict) -> dict:
    """Pair with the iPhone/iPad on the cable (shows 'Trust this computer?' on it)."""
    from pymobiledevice3 import usbmux
    from pymobiledevice3.lockdown import create_using_usbmux

    try:
        usb = [d for d in await usbmux.list_devices() if d.is_usb]
    except Exception:
        raise RuntimeError("Apple's device service isn't running. Install the 'Apple Devices' app from the Microsoft Store.") from None
    if not usb:
        raise RuntimeError("No iPhone or iPad found. Plug it in with a cable and unlock it.")
    lockdown = await create_using_usbmux(serial=usb[0].serial, autopair=True, pair_timeout=120)
    try:
        info = lockdown.short_info
        ident = info.get("UniqueDeviceID") or usb[0].serial
        known = load_known()
        known[ident] = {
            "id": ident, "name": info.get("DeviceName") or "iPhone", "model": info.get("ProductType"),
            "os": info.get("ProductVersion"), "kind": kind_of(info.get("ProductType")),
            "developerMode": await lockdown.get_developer_mode_status(),
        }
        save_known(known)
        return {**known[ident], "online": True, "usb": True}
    finally:
        await lockdown.close()


async def cmd_forget(msg: dict) -> bool:
    from pymobiledevice3.common import get_home_folder
    from pymobiledevice3.pair_records import get_remote_pairing_record_filename, PAIRING_RECORD_EXT

    known = load_known()
    known.pop(msg["id"], None)
    save_known(known)
    record = get_home_folder() / f"{get_remote_pairing_record_filename(msg['id'])}.{PAIRING_RECORD_EXT}"
    if record.exists():
        record.unlink()
    return True


COMMANDS: dict[str, Callable[[dict], Any]] = {
    "devices": cmd_devices,
    "discover": cmd_discover,
    "pair": cmd_pair,
    "check": cmd_check,
    "trustUsb": cmd_trust_usb,
    "forget": cmd_forget,
}


def friendly(e: BaseException) -> str:
    text = str(e) or type(e).__name__
    low = text.lower()
    if "timed out" in low or isinstance(e, TimeoutError):
        return text if "code" in low else "The device didn't respond in time."
    if "pairing" in low and ("reject" in low or "pin" in low or "proof" in low):
        return "Pairing was refused. Check the code and try again."
    return text[:300]


async def run_command(msg: dict) -> None:
    rid = msg.get("id")
    try:
        handler = COMMANDS[msg["cmd"]]
        emit({"id": rid, "ok": True, "data": await handler(msg)})
    except Exception as e:  # report every failure to the app instead of dying
        emit({"id": rid, "ok": False, "error": friendly(e), "detail": traceback.format_exc(limit=3)})


def main() -> None:
    if "--selftest" in sys.argv:
        import pymobiledevice3.bonjour  # noqa: F401
        import pymobiledevice3.remote.userspace_tunnel  # noqa: F401
        import pymobiledevice3.lockdown  # noqa: F401
        print("selftest ok")
        return

    # The library asks for the Apple TV PIN with input(); answer it from the app instead.
    from pymobiledevice3.remote import tunnel_service

    tunnel_service.input = _gui_pin_input  # module global shadows the builtin

    loop = asyncio.new_event_loop()
    threading.Thread(target=loop.run_forever, daemon=True).start()
    emit({"event": "ready"})
    # Commands run one at a time: pairing and tunnels don't mix well in parallel.
    lock = asyncio.Lock()

    async def serialized(msg: dict) -> None:
        async with lock:
            await run_command(msg)

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
        elif msg.get("cmd") == "quit":
            break
        else:
            asyncio.run_coroutine_threadsafe(serialized(msg), loop)


if __name__ == "__main__":
    main()
