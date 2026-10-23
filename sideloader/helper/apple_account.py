"""
Apple ID sign-in for ello Sideloader, done the way Xcode does it.

Only Apple is contacted: gsa.apple.com (sign-in, two-factor) and, in
apple_dev.py, developerservices2.apple.com (certificates, app IDs). The
"anisette" machine data Apple expects from Xcode is generated on this PC from
Apple's own Android libraries (bundled with the app), never by a third-party
server.

What is kept on this PC (in %APPDATA%\\ello-sideloader\\account, encrypted with
Windows DPAPI so only this Windows user can read it): the Apple ID's email,
the Xcode session token and, only if the person ticks "Keep me signed in",
the password (needed to sign in again for the weekly renewal).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import locale
import os
import plistlib
import ssl
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import certifi
import urllib3

GSA = "https://gsa.apple.com/grandslam/GsService2"
CLIENT_INFO = "<MacBookPro18,3> <Mac OS X;13.4.1;22F8> <com.apple.AOSKit/282 (com.apple.dt.Xcode/3594.4.19)>"
XCODE_APP = "com.apple.gs.xcode.auth"


class AppleError(RuntimeError):
    pass


class NeedsCode(Exception):
    """Two-factor: Apple sent a code to the person's devices (or by SMS)."""

    def __init__(self, mode: str) -> None:
        super().__init__(mode)
        self.mode = mode  # "device" or "sms"


# ----------------------------------------------------------------------------- storage


def data_dir() -> Path:
    base = Path(os.environ.get("APPDATA") or Path.home() / ".config") / "ello-sideloader" / "account"
    base.mkdir(parents=True, exist_ok=True)
    return base


def _dpapi(data: bytes, protect: bool) -> bytes:
    """Windows DPAPI: encrypt/decrypt for the current Windows user only."""
    if sys.platform != "win32":
        return data  # development on other systems
    import ctypes
    from ctypes import wintypes

    class Blob(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]

    buf = ctypes.create_string_buffer(data, len(data))
    blob_in = Blob(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))
    blob_out = Blob()
    crypt32 = ctypes.windll.crypt32
    fn = crypt32.CryptProtectData if protect else crypt32.CryptUnprotectData
    if not fn(ctypes.byref(blob_in), None, None, None, None, 0x1, ctypes.byref(blob_out)):  # UI_FORBIDDEN
        raise AppleError("Windows couldn't unlock the saved sign-in. Sign in again.")
    try:
        return ctypes.string_at(blob_out.pbData, blob_out.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(blob_out.pbData)


def save_secret(name: str, value: dict | None) -> None:
    path = data_dir() / f"{name}.bin"
    if value is None:
        path.unlink(missing_ok=True)
        return
    path.write_bytes(_dpapi(json.dumps(value).encode(), True))


def load_secret(name: str) -> dict | None:
    path = data_dir() / f"{name}.bin"
    try:
        return json.loads(_dpapi(path.read_bytes(), False))
    except (OSError, ValueError, AppleError):
        return None


# ----------------------------------------------------------------------------- anisette


def _resource(name: str) -> Path:
    here = Path(getattr(sys, "_MEIPASS", Path(__file__).parent))
    for p in (here / name, here.parent / name, here / "resources" / name):
        if p.exists():
            return p
    raise AppleError(f"ello Sideloader is missing {name}. Reinstall it.")


class Machine:
    """This PC as Apple sees it (like a Mac running Xcode). Kept between runs so Apple
    doesn't see a new computer every time."""

    def __init__(self) -> None:
        import anisette.anisette as ani_mod
        from anisette import Anisette

        # Never let the library download anything itself: Apple's libraries ship with ello.
        ani_mod.DEFAULT_LIBS_URL = "about:blank"
        libs = _resource("anisette-libs.bin")
        prov = data_dir() / "machine.bin"
        files = [str(libs)] + ([str(prov)] if prov.exists() else [])
        try:
            self.ani = Anisette.load(*files)
        except Exception:
            prov.unlink(missing_ok=True)
            self.ani = Anisette.load(str(libs))
        self._prov = prov

    def headers(self) -> dict[str, str]:
        h = dict(self.ani.get_data())
        try:
            self.ani.save_provisioning(str(self._prov))
        except Exception:
            pass
        # The library writes these from the PC's own settings, which on Windows outside
        # UTC gives values Apple rejects (HTTP 503): "2026-10-23T22:00:00+02:00Z",
        # "W. Europe Daylight Time", "Dutch_Netherlands". Send them the way a Mac does.
        h["X-Apple-I-Client-Time"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        h["X-Apple-I-TimeZone"] = "UTC"
        h["X-Apple-Locale"] = "en_US"
        h["X-Apple-I-Locale"] = "en_US"
        return h

    @property
    def client_info(self) -> str:
        # Must match the device the anisette data was made for.
        return _client_info(self)


def _client_info(m: "Machine") -> str:
    try:
        return m.ani._ani_provider.device.server_friendly_description
    except Exception:
        return CLIENT_INFO


# ----------------------------------------------------------------------------- http


def _ssl_context() -> ssl.SSLContext:
    """Public CAs plus Apple's own root (gsa.apple.com uses Apple's private CA)."""
    ctx = ssl.create_default_context(cafile=certifi.where())
    try:
        import anisette

        ctx.load_verify_locations(str(Path(anisette.__file__).parent / "apple-root.pem"))
    except Exception:
        pass
    return ctx


_http = urllib3.PoolManager(ssl_context=_ssl_context(), timeout=urllib3.Timeout(connect=15, read=60), retries=False)


def _log_failure(step: str, r: urllib3.BaseHTTPResponse) -> None:
    """Keep the last odd answer from Apple (status, headers, start of the body) for troubleshooting.
    Requests (with the password proof and tokens) are never written."""
    try:
        keep = {k: v for k, v in r.headers.items() if k.lower() not in ("set-cookie",)}
        text = r.data[:1500].decode("utf-8", "replace")
        (data_dir() / "last-apple-error.txt").write_text(
            f"{datetime.now(timezone.utc).isoformat()} {step}\nHTTP {r.status}\n{json.dumps(keep, indent=1)}\n\n{text}\n",
            encoding="utf-8")
    except Exception:
        pass


def http(method: str, url: str, headers: dict[str, str], body: bytes | None = None) -> urllib3.BaseHTTPResponse:
    try:
        return _http.request(method, url, headers=headers, body=body)
    except urllib3.exceptions.HTTPError as e:
        raise AppleError("Couldn't reach Apple. Check this PC's internet connection.") from e


# ----------------------------------------------------------------------------- sign-in


def _encrypt_password(password: str, salt: bytes, iterations: int, protocol: str) -> bytes:
    p = hashlib.sha256(password.encode()).digest()
    if protocol == "s2k_fo":
        p = p.hex().encode()
    return hashlib.pbkdf2_hmac("sha256", p, salt, iterations, 32)


def _decrypt_cbc(session_key: bytes, data: bytes) -> bytes:
    from cryptography.hazmat.primitives import padding
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

    key = hmac.new(session_key, b"extra data key:", hashlib.sha256).digest()
    iv = hmac.new(session_key, b"extra data iv:", hashlib.sha256).digest()[:16]
    dec = Cipher(algorithms.AES(key), modes.CBC(iv)).decryptor()
    padded = dec.update(data) + dec.finalize()
    unpad = padding.PKCS7(128).unpadder()
    return unpad.update(padded) + unpad.finalize()


def _decrypt_gcm(key: bytes, data: bytes) -> bytes:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    version, iv, body = data[:3], data[3:19], data[19:]
    return AESGCM(key).decrypt(iv, body, version)


def _error_text(status: dict) -> str:
    code = status.get("ec")
    msg = status.get("em") or "Apple refused the sign-in."
    if code in (-20101, -22406):
        return "Wrong Apple ID or password."
    if code == -20209:
        return "This Apple ID is locked. Unlock it at iforgot.apple.com, then try again."
    if code == -20751:
        return "Apple wants this Apple ID to be set up in a browser first: sign in once at appleid.apple.com."
    return f"{msg} (Apple error {code})"


class Session:
    """A signed-in Apple ID: what developer services need."""

    def __init__(self, apple_id: str, adsid: str, token: str, expiry: float) -> None:
        self.apple_id = apple_id
        self.adsid = adsid
        self.token = token
        self.expiry = expiry

    @property
    def valid(self) -> bool:
        return datetime.now(timezone.utc).timestamp() < self.expiry - 3600

    def to_dict(self) -> dict:
        return {"appleId": self.apple_id, "adsid": self.adsid, "token": self.token, "expiry": self.expiry}

    @classmethod
    def from_dict(cls, d: dict) -> "Session":
        return cls(d["appleId"], d["adsid"], d["token"], float(d["expiry"]))


class SignIn:
    """GrandSlam (GSA) sign-in with SRP, two-factor, then an Xcode app token."""

    def __init__(self, machine: Machine, apple_id: str, password: str) -> None:
        self.m = machine
        self.apple_id = apple_id.strip()
        self.password = password
        self._spd: dict | None = None

    def _cpd(self) -> dict:
        h = self.m.headers()
        return {
            "bootstrap": True,
            "icscrec": True,
            "pbe": False,
            "prkgen": True,
            "svct": "iCloud",
            "loc": "en_US",
            **{k: v for k, v in h.items() if k.startswith("X-Apple-I") or k in ("X-Mme-Device-Id",)},
        }

    def _gsa(self, request: dict) -> dict:
        body = plistlib.dumps({"Header": {"Version": "1.0.1"}, "Request": request})
        r = http("POST", GSA, {
            "Content-Type": "text/x-xml-plist",
            "Accept": "*/*",
            "User-Agent": "akd/1.0 CFNetwork/978.0.7 Darwin/18.7.0",
            "X-MMe-Client-Info": self.m.client_info,
        }, body)
        try:
            return plistlib.loads(r.data)["Response"]
        except Exception as e:
            _log_failure("gsa " + str(request.get("o")), r)
            raise AppleError(f"Apple's sign-in server answered HTTP {r.status} at step “{request.get('o')}”.") from e

    def login(self) -> None:
        """SRP sign-in. Raises NeedsCode when Apple wants a two-factor code."""
        import srp._pysrp as srp

        srp.rfc5054_enable()
        srp.no_username_in_x()
        usr = srp.User(self.apple_id, b"", hash_alg=srp.SHA256, ng_type=srp.NG_2048)
        _, a = usr.start_authentication()
        r = self._gsa({"A2k": a, "cpd": self._cpd(), "o": "init", "ps": ["s2k", "s2k_fo"], "u": self.apple_id})
        status = r.get("Status", {})
        if status.get("ec", 0) != 0:
            raise AppleError(_error_text(status))
        if r.get("sp") not in ("s2k", "s2k_fo"):
            raise AppleError("Apple asked for a sign-in method ello doesn't support.")
        usr.p = _encrypt_password(self.password, r["s"], r["i"], r["sp"])
        m1 = usr.process_challenge(r["s"], r["B"])
        if m1 is None:
            raise AppleError("Sign-in failed (bad challenge from Apple).")
        r = self._gsa({"c": r["c"], "M1": m1, "cpd": self._cpd(), "o": "complete", "u": self.apple_id})
        status = r.get("Status", {})
        if status.get("ec", 0) != 0:
            raise AppleError(_error_text(status))
        usr.verify_session(r["M2"])
        if not usr.authenticated():
            raise AppleError("Wrong Apple ID or password.")
        self._spd = plistlib.loads(_decrypt_cbc(usr.get_session_key(), r["spd"]))
        au = status.get("au")
        if au == "trustedDeviceSecondaryAuth":
            self._request_code("device")
        elif au == "secondaryAuth":
            self._request_code("sms")
        elif au:
            raise AppleError(f"Apple asked for an extra step ello doesn't support yet ({au}).")

    # --- two-factor

    def _2fa_headers(self) -> dict[str, str]:
        assert self._spd
        identity = base64.b64encode(f"{self._spd['adsid']}:{self._spd['GsIdmsToken']}".encode()).decode()
        return {
            "Content-Type": "text/x-xml-plist",
            "User-Agent": "Xcode",
            "Accept": "text/x-xml-plist",
            "Accept-Language": "en-us",
            "X-Apple-Identity-Token": identity,
            "X-Apple-App-Info": XCODE_APP,
            "X-Xcode-Version": "11.2 (11B41)",
            **self.m.headers(),
        }

    def _request_code(self, mode: str) -> None:
        if mode == "device":
            http("GET", "https://gsa.apple.com/auth/verify/trusteddevice", self._2fa_headers())
        else:
            h = {**self._2fa_headers(), "Content-Type": "application/json", "Accept": "application/json"}
            http("PUT", "https://gsa.apple.com/auth/verify/phone", h,
                 json.dumps({"phoneNumber": {"id": 1}, "mode": "sms"}).encode())
        raise NeedsCode(mode)

    def submit_code(self, mode: str, code: str) -> None:
        code = "".join(ch for ch in code if ch.isdigit())
        if mode == "device":
            h = {**self._2fa_headers(), "security-code": code}
            r = http("GET", "https://gsa.apple.com/grandslam/GsService2/validate", h)
            try:
                ec = plistlib.loads(r.data).get("ec", 0)
            except Exception:
                ec = 0 if r.status == 200 else -1
            if ec != 0:
                raise AppleError("That code isn't right. Check it and try again.")
        else:
            h = {**self._2fa_headers(), "Content-Type": "application/json", "Accept": "application/json"}
            r = http("POST", "https://gsa.apple.com/auth/verify/phone/securitycode", h, json.dumps(
                {"phoneNumber": {"id": 1}, "securityCode": {"code": code}, "mode": "sms"}).encode())
            if r.status != 200:
                raise AppleError("That code isn't right. Check it and try again.")
        # Signed in for real now: start over to get full tokens.
        self.login()

    # --- token for Xcode's services

    def xcode_session(self) -> Session:
        assert self._spd
        spd = self._spd
        adsid = spd["adsid"]
        sk = spd["sk"]
        checksum = hmac.new(sk, b"apptokens" + adsid.encode() + XCODE_APP.encode(), hashlib.sha256).digest()
        r = self._gsa({
            "app": [XCODE_APP],
            "c": spd["c"],
            "checksum": checksum,
            "cpd": self._cpd(),
            "o": "apptokens",
            "t": spd["GsIdmsToken"],
            "u": adsid,
        })
        status = r.get("Status", {})
        if status.get("ec", 0) != 0:
            raise AppleError(_error_text(status))
        tokens = plistlib.loads(_decrypt_gcm(sk, r["et"]))["t"][XCODE_APP]
        expiry = tokens.get("expiry")
        if expiry:
            expiry = float(expiry) / (1000 if float(expiry) > 1e11 else 1)
        else:
            expiry = datetime.now(timezone.utc).timestamp() + float(tokens.get("duration", 3600 * 24))
        return Session(self.apple_id, adsid, tokens["token"], expiry)


def new_request_id() -> str:
    return str(uuid.uuid4()).upper()


def sign_in(apple_id: str, password: str, ask_code: Callable[[str], str]) -> Session:
    """Full sign-in; `ask_code(mode)` returns the two-factor code the person typed."""
    machine = Machine()
    s = SignIn(machine, apple_id, password)
    try:
        s.login()
    except NeedsCode as need:
        for attempt in range(3):
            code = ask_code(need.mode)
            if not code.strip():
                raise AppleError("Sign-in cancelled.")
            try:
                s.submit_code(need.mode, code)
                break
            except NeedsCode:
                raise AppleError("Apple asked for another code. Try signing in again.") from None
            except AppleError:
                if attempt == 2:
                    raise
    return s.xcode_session()


def describe() -> dict[str, Any]:
    acct = load_secret("session")
    return {
        "signedIn": bool(acct),
        "appleId": acct.get("appleId") if acct else None,
        "remember": load_secret("password") is not None,
    }
