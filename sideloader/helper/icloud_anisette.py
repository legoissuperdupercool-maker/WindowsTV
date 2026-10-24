"""
Asks Apple's own iCloud for Windows for this PC's "anisette" values (machine id and
one-time password), the way AltServer does. iCloud's libraries are 32-bit, so ello
runs this file with a bundled 32-bit Python and reads one line of JSON back.

Needs iCloud for Windows 7.x from apple.com (not the Microsoft Store version).
"""
from __future__ import annotations

import ctypes
import json
import os
import sys
from pathlib import Path


def apple_folder() -> Path:
    for var in ("CommonProgramFiles(x86)", "CommonProgramFiles"):
        base = os.environ.get(var)
        if base and (Path(base) / "Apple" / "Internet Services" / "AOSKit.dll").exists():
            return Path(base) / "Apple"
    raise FileNotFoundError("iCloud for Windows isn't installed")


def main() -> None:
    apple = apple_folder()
    support = apple / "Apple Application Support"
    services = apple / "Internet Services"
    for d in (support, services):
        os.add_dll_directory(str(d))
    os.environ["PATH"] = f"{support};{services};" + os.environ.get("PATH", "")
    os.chdir(support)

    objc = ctypes.CDLL(str(support / "objc.dll"))
    ctypes.CDLL(str(support / "Foundation.dll"))
    ctypes.CDLL(str(services / "AOSKit.dll"))

    objc.objc_getClass.restype = ctypes.c_void_p
    objc.objc_getClass.argtypes = [ctypes.c_char_p]
    objc.sel_registerName.restype = ctypes.c_void_p
    objc.sel_registerName.argtypes = [ctypes.c_char_p]
    send = ctypes.cast(objc.objc_msgSend, ctypes.c_void_p).value

    msg_str = ctypes.CFUNCTYPE(ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_char_p)(send)
    msg_obj = ctypes.CFUNCTYPE(ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p)(send)
    msg_utf8 = ctypes.CFUNCTYPE(ctypes.c_char_p, ctypes.c_void_p, ctypes.c_void_p)(send)

    def sel(name: str) -> int:
        return objc.sel_registerName(name.encode())

    ns_string = objc.objc_getClass(b"NSString")

    def ns(text: str) -> int:
        return msg_str(ns_string, sel("stringWithUTF8String:"), text.encode())

    def text(obj: int | None) -> str | None:
        if not obj:
            return None
        value = msg_utf8(obj, sel("UTF8String"))
        return value.decode() if value else None

    utilities = objc.objc_getClass(b"AOSUtilities")
    if not utilities:
        raise RuntimeError("iCloud's AOSKit didn't load (AOSUtilities missing)")
    headers = msg_obj(utilities, sel("retrieveOTPHeadersForDSID:"), ns("-2"))
    if not headers:
        raise RuntimeError("iCloud returned no anisette data")
    machine_id = text(msg_obj(headers, sel("objectForKey:"), ns("X-Apple-MD-M")))
    otp = text(msg_obj(headers, sel("objectForKey:"), ns("X-Apple-MD")))
    if not machine_id or not otp:
        raise RuntimeError("iCloud returned incomplete anisette data")
    print(json.dumps({"machineId": machine_id, "otp": otp}), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # one line of JSON either way
        print(json.dumps({"error": f"{type(e).__name__}: {e}"}), flush=True)
        sys.exit(1)
