"""
ello Sideloader helper: the background program that talks to your Apple devices.

ello Sideloader starts it and exchanges one JSON object per line:
  app → helper   {"id": 1, "cmd": "discover"}            (see COMMANDS below)
                 {"pin": "123456"}                         (answer to a pin_required event)
  helper → app   {"id": 1, "ok": true, "data": ...} / {"id": 1, "ok": false, "error": "..."}
                 {"event": "pin_required", "name": "Living Room"}

Privacy: it only talks to your own Apple devices on your network / USB. Nothing
is sent to the internet. Pairing keys stay in %USERPROFILE%\\.pymobiledevice3;
the device list (names, models, OS versions) in %APPDATA%\\ello-sideloader.
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
        emit({"id": rid, "ok": False, "error": friendly(e), "detail": traceback.format_exc(limit=3)})


def main() -> None:
    if "--selftest" in sys.argv:
        import pymobiledevice3.bonjour  # noqa: F401
        import pymobiledevice3.lockdown  # noqa: F401
        import pymobiledevice3.remote.userspace_tunnel  # noqa: F401
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
        elif msg.get("cmd") == "quit":
            break
        else:
            asyncio.run_coroutine_threadsafe(one_at_a_time(msg), loop)


if __name__ == "__main__":
    main()
