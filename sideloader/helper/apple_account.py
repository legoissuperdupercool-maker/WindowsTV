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
# Apple's sign-in server now answers 503 to clients that say they are Xcode
# ("com.apple.dt.Xcode/…"); iCloud for Windows is accepted (checked Oct 2026).
CLIENT_INFO = "<PC> <Windows;6.2(0,0);9200> <com.apple.AuthKit.Win/1.0 (com.apple.iCloud/7.21)>"
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


def _guard_provisioning() -> None:
    """Registering this PC with Apple ("provisioning") happens inside the anisette library,
    which parses Apple's reply without checking it: an error page or an empty answer surfaced
    as a bare "Invalid file". Check the reply, keep it for troubleshooting, and say what happened."""
    from anisette import _session

    if getattr(_session.ProvisioningSession, "_ello_guarded", False):
        return

    def _request(self, method, url, extra_headers, data=None, cache_key=None):
        headers = self._ProvisioningSession__headers | extra_headers
        try:
            r = self._http.request(method, url, body=data, headers=headers, timeout=urllib3.Timeout(connect=15, read=45), retries=False)
        except urllib3.exceptions.HTTPError as e:
            raise AppleError("Couldn't reach Apple to register this PC. Check this PC's internet connection.") from e
        step = url.rsplit("/", 1)[-1]
        if r.status != 200 or not r.data.lstrip().startswith((b"<?xml", b"<plist", b"bplist")):
            _log_failure("provisioning " + step, r)
            raise AppleError(f"Apple didn't accept registering this PC (HTTP {r.status} at “{step}”): {_snippet(r)}")
        return r.data

    _session.ProvisioningSession._request = _request
    _session.ProvisioningSession._ello_guarded = True


class Machine:
    """This PC as Apple sees it (like a Mac running Xcode). Kept between runs so Apple
    doesn't see a new computer every time."""

    def __init__(self) -> None:
        import anisette.anisette as ani_mod
        from anisette import Anisette

        # Never let the library download anything itself: Apple's libraries ship with ello.
        ani_mod.DEFAULT_LIBS_URL = "about:blank"
        _guard_provisioning()
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
        h["X-MMe-Client-Info"] = CLIENT_INFO
        return h

    @property
    def client_info(self) -> str:
        return CLIENT_INFO


class ICloudMachine:
    """This PC as Apple's own iCloud for Windows sees it, like AltServer: iCloud's libraries
    make the machine id and one-time password, so Apple gets the real thing instead of an
    imitation. Used when iCloud for Windows 7.x (from apple.com) is installed."""

    # What AltServer sends along with iCloud's values.
    CLIENT_INFO = "<MacBookPro15,1> <Mac OS X;10.15.2;19C57> <com.apple.AuthKit/1 (com.apple.dt.Xcode/3594.4.19)>"

    def __init__(self, python32: Path, script: Path) -> None:
        self._python32 = python32
        self._script = script
        id_file = data_dir() / "icloud-device-id.txt"
        if not id_file.exists():
            id_file.write_text(str(uuid.uuid4()).upper(), encoding="utf-8")
        self._device_id = id_file.read_text(encoding="utf-8").strip()

    @classmethod
    def available(cls) -> "ICloudMachine | None":
        if sys.platform != "win32" or os.environ.get("ELLO_NO_ICLOUD"):
            return None
        here = Path(__file__).resolve().parent
        python32 = here.parent / "python32" / "python.exe"
        script = here / "icloud_anisette.py"
        common = os.environ.get("CommonProgramFiles(x86)") or os.environ.get("CommonProgramFiles") or ""
        if not (python32.exists() and script.exists() and (Path(common) / "Apple" / "Internet Services" / "AOSKit.dll").exists()):
            return None
        machine = cls(python32, script)
        try:
            machine._values()
        except AppleError:
            return None
        return machine

    def _values(self) -> dict[str, str]:
        import subprocess

        try:
            out = subprocess.run([str(self._python32), "-I", str(self._script)], capture_output=True, text=True,
                                 timeout=60, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            data = json.loads((out.stdout or "").strip().splitlines()[-1])
        except (OSError, ValueError, IndexError, subprocess.TimeoutExpired) as e:
            raise AppleError(f"iCloud for Windows didn't answer ({type(e).__name__}).") from e
        if "error" in data:
            raise AppleError(f"iCloud for Windows: {data['error']}")
        return data

    def headers(self) -> dict[str, str]:
        v = self._values()
        return {
            "X-Apple-I-MD-M": v["machineId"],
            "X-Apple-I-MD": v["otp"],
            "X-Apple-I-MD-LU": base64.b64encode(self._device_id.encode()).decode(),
            "X-Apple-I-MD-RINFO": "17106176",
            "X-Mme-Device-Id": self._device_id,
            "X-Apple-I-SRL-NO": "C02LKHBBFD57",
            "X-Apple-I-Client-Time": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "X-Apple-I-TimeZone": "UTC",
            "X-Apple-Locale": "en_US",
            "X-Apple-I-Locale": "en_US",
            "X-MMe-Client-Info": self.CLIENT_INFO,
        }

    @property
    def client_info(self) -> str:
        return self.CLIENT_INFO


class RemoteMachine:
    """Machine data from an anisette server (SideStore's, or one you run yourself, e.g.
    Dadoum's anisette-v3-server in Docker). It answers GET <url> with the headers as JSON,
    the format AltStore and SideStore use."""

    def __init__(self, url: str) -> None:
        self.url = url
        self._client_info = CLIENT_INFO

    def headers(self) -> dict[str, str]:
        try:
            r = _http.request("GET", self.url, headers={"Accept": "application/json"}, timeout=urllib3.Timeout(connect=10, read=20))
            data = json.loads(r.data.decode("utf-8"))
        except Exception as e:
            raise AppleError(f"The anisette server didn't answer ({type(e).__name__}). Check the address.") from e
        if r.status != 200 or not isinstance(data, dict) or not data.get("X-Apple-I-MD") or not data.get("X-Apple-I-MD-M"):
            raise AppleError(f"The anisette server gave no machine data (HTTP {r.status}). Use an address that serves anisette v1 JSON.")
        h = {str(k): str(v) for k, v in data.items() if isinstance(v, (str, int))}
        self._client_info = h.get("X-MMe-Client-Info") or CLIENT_INFO
        h.setdefault("X-MMe-Client-Info", self._client_info)
        h.setdefault("X-Apple-I-Client-Time", datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
        h.setdefault("X-Apple-I-TimeZone", "UTC")
        h.setdefault("X-Apple-Locale", "en_US")
        h.setdefault("X-Apple-I-Locale", "en_US")
        return h

    @property
    def client_info(self) -> str:
        return self._client_info


def anisette_server() -> str:
    """The anisette server set in the app ("" = none)."""
    try:
        return (data_dir() / "anisette-server.txt").read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def set_anisette_server(url: str) -> str:
    url = url.strip()
    if url and not url.lower().startswith(("http://", "https://")):
        url = "https://" + url
    f = data_dir() / "anisette-server.txt"
    if url:
        f.write_text(url, encoding="utf-8")
    else:
        f.unlink(missing_ok=True)
    return url


def pick_machine() -> "Machine | ICloudMachine | RemoteMachine":
    """An anisette server when one is set, else Apple's own iCloud when it's installed (most
    trusted), otherwise ello's built-in one."""
    url = anisette_server()
    machine: "Machine | ICloudMachine | RemoteMachine | None" = RemoteMachine(url) if url else ICloudMachine.available()
    try:
        (data_dir() / "anisette-source.txt").write_text(
            f"anisette server: {url}\n" if url else "iCloud for Windows\n" if machine else "built-in (iCloud for Windows 7.x not found or not answering)\n",
            encoding="utf-8")
    except OSError:
        pass
    return machine or Machine()


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


def _snippet(r: urllib3.BaseHTTPResponse) -> str:
    """Apple's own words from an error page, short."""
    import re

    text = re.sub(r"<[^>]+>", " ", r.data[:4000].decode("utf-8", "replace"))
    text = " ".join(text.split())[:160]
    server = r.headers.get("server") or r.headers.get("Server") or ""
    return (text or "(empty reply)") + (f" [server: {server}]" if server else "")


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


def _log_2fa(step: str, r: urllib3.BaseHTTPResponse) -> None:
    """Apple's answers during the two-factor step (phone list, text request), for troubleshooting.
    Apple only shows the last digits of phone numbers here; no codes or tokens are written."""
    try:
        with open(data_dir() / "last-apple-2fa.txt", "a", encoding="utf-8") as f:
            f.write(f"{datetime.now(timezone.utc).isoformat()} {step} HTTP {r.status}\n{r.data[:3000].decode('utf-8', 'replace')}\n\n")
    except Exception:
        pass


def http(method: str, url: str, headers: dict[str, str], body: bytes | None = None) -> urllib3.BaseHTTPResponse:
    if "gsa.apple.com" in url:
        # GrandSlam answers reused (keep-alive) connections with errors; other clients open a
        # new connection per request (see AltSign PR 52, xtool), so do the same.
        headers = {**headers, "Connection": "close"}
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


_PLIST_HEADER = (b'<?xml version="1.0" encoding="UTF-8"?>\n'
                 b'<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n')


def _decrypted_plist(data: bytes, what: str) -> dict:
    """Apple's encrypted sign-in data is a plist without its XML header (sometimes just
    the <dict>), which Python's plistlib rejects as "Invalid file". Add what's missing."""
    body = data.strip()
    for candidate in (body, _PLIST_HEADER + body, _PLIST_HEADER + b'<plist version="1.0">' + body + b"</plist>"):
        try:
            value = plistlib.loads(candidate)
        except Exception:
            continue
        if isinstance(value, dict):
            return value
    # Only the first bytes (the format, not the tokens) go into the message.
    raise AppleError(f"Apple's {what} came in a format ello doesn't know ({body[:10]!r}…, {len(body)} bytes).")


def _decrypt_gcm(key: bytes, data: bytes) -> bytes:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    version, iv, body = data[:3], data[3:19], data[19:]
    return AESGCM(key).decrypt(iv, body, version)


def _error_text(status: dict) -> str:
    code = status.get("ec")
    msg = status.get("em") or "Apple refused the sign-in."
    if code in (-20101, -22406, -20970):
        return "Wrong Apple ID or password."
    if code == -20755:
        return ("Apple says this Apple ID isn't active (locked or not set up yet). Unlock it at iforgot.apple.com, "
                "sign in once at account.apple.com, then wait a few hours before trying here again.")
    if code == -80045:
        return "Apple isn't allowing this sign-in right now. Wait an hour, then try again."
    if code == -22322:
        return "This Apple ID can't be used here. Use a normal free Apple ID."
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
        self._phone_id: int | None = None
        self._sms_route: str | None = None
        self._idms_session: dict[str, str] = {}
        self._sms_device_id: str | None = None

    def _cpd(self) -> dict:
        h = self.m.headers()
        return {
            "bootstrap": True,
            "icscrec": True,
            "pbe": False,
            "prkgen": True,
            "svct": "iCloud",
            "loc": "en_US",
            "X-Apple-Locale": "en_US",
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
            raise AppleError(f"Apple's sign-in server answered HTTP {r.status} at step “{request.get('o')}”: {_snippet(r)}") from e

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
        self._spd = _decrypted_plist(_decrypt_cbc(usr.get_session_key(), r["spd"]), "account details")
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
        # As current Xcode sends them (same as xtool and isideload).
        return {
            "Content-Type": "application/x-plist",
            "User-Agent": "akd/1.0 CFNetwork/808.1.4",
            "Accept": "application/x-buddyml",
            "Accept-Language": "en-us",
            "X-Apple-Identity-Token": identity,
            "X-Apple-App-Info": XCODE_APP,
            "X-Xcode-Version": "26.5 (17F42)",
            **self.m.headers(),
            **self._idms_session,
        }

    def _request_code(self, mode: str) -> None:
        """Ask Apple to deliver a code. When it won't, still ask for one: a code from
        Settings → Sign-In & Security → Get Verification Code on a trusted device works too."""
        if mode == "device":
            r = http("GET", "https://gsa.apple.com/auth/verify/trusteddevice", self._2fa_headers())
            self._keep_session(r)
            _log_2fa("trusteddevice", r)
            if r.status < 400:
                raise NeedsCode("device")
            mode = "sms"
        try:
            self.request_sms()
        except AppleError:
            raise NeedsCode("manual") from None
        raise NeedsCode("sms")

    def _json_2fa_headers(self) -> dict[str, str]:
        # Apple's two-factor pages tie requests together with scnt / session id (in _2fa_headers).
        return {**self._2fa_headers(), "Content-Type": "application/json", "Accept": "application/json"}

    def _keep_session(self, r: urllib3.BaseHTTPResponse) -> None:
        for name in ("scnt", "X-Apple-ID-Session-Id"):
            value = r.headers.get(name)
            if value:
                self._idms_session[name] = value

    def _trusted_phone_id(self) -> int:
        """The id of the Apple ID's first trusted phone number. Apple's answer varies in
        shape, so search it; when nothing is found, the first number (id 1) is the usual one."""
        try:
            r = http("GET", "https://gsa.apple.com/auth", self._json_2fa_headers())
            self._keep_session(r)
            info = json.loads(r.data or b"{}")
        except (AppleError, ValueError):
            return 1

        def find(node):
            if isinstance(node, dict):
                for key in ("trustedPhoneNumbers", "trustedPhoneNumber"):
                    value = node.get(key)
                    if isinstance(value, list) and value and isinstance(value[0], dict) and "id" in value[0]:
                        return value[0]["id"]
                    if isinstance(value, dict) and "id" in value:
                        return value["id"]
                for value in node.values():
                    found = find(value)
                    if found is not None:
                        return found
            elif isinstance(node, list):
                for value in node:
                    found = find(value)
                    if found is not None:
                        return found
            return None

        _log_2fa("auth", r)
        found = find(info)
        if found is None:
            # Older ("hsa") Apple IDs list the phone under trustedDevices, and texting goes
            # through that device's own endpoint (4-digit codes).
            for dev in info.get("trustedDevices") or []:
                if isinstance(dev, dict) and "id" in dev and (dev.get("type") == "sms" or dev.get("device") is False):
                    self._sms_device_id = str(dev["id"])
                    break
        return found if isinstance(found, int) else 1

    def request_sms(self) -> None:
        """Text a code to the Apple ID's trusted phone number."""
        if self._phone_id is None or not self._idms_session:
            self._phone_id = self._trusted_phone_id()
        if not self._sms_device_id:
            # xtool's way (what Xcode does): a plist POST to the phone "put" page.
            r = http("POST", "https://gsa.apple.com/auth/verify/phone/put?mode=sms", self._2fa_headers(),
                     plistlib.dumps({"serverInfo": {"phoneNumber.id": str(self._phone_id)}}))
            self._keep_session(r)
            _log_2fa("sms put", r)
            if r.status < 400 and b"<alert" not in r.data[:4000]:
                self._sms_route = "put"
                return
            # isideload's way: JSON PUT.
            r = http("PUT", "https://gsa.apple.com/auth/verify/phone", self._json_2fa_headers(),
                     json.dumps({"phoneNumber": {"id": self._phone_id}, "mode": "sms"}).encode())
            self._keep_session(r)
            _log_2fa("sms json", r)
            if r.status < 400:
                self._sms_route = "json"
                return
            if r.status == 423:
                raise AppleError("Apple has sent too many codes to this number. Wait a while, then try again.")
            _log_failure("2fa sms", r)
        if self._sms_device_id:
            # Older Apple IDs: the phone is listed as a trusted device (iloader #787).
            r = http("PUT", f"https://gsa.apple.com/auth/verify/device/{self._sms_device_id}/securitycode", self._json_2fa_headers())
            self._keep_session(r)
            _log_2fa("sms device", r)
            if r.status < 400:
                self._sms_route = "device"
                return
            _log_failure("2fa sms device", r)
        raise AppleError("Apple won't text a code to this Apple ID from here. Sign in again and wait for the "
                         "“Allow” pop-up on an iPhone, iPad or Mac that uses this Apple ID, or get a code there "
                         "under Settings → your name → Sign-In & Security → Get Verification Code.")

    def submit_code(self, mode: str, code: str) -> None:
        code = "".join(ch for ch in code if ch.isdigit())
        if mode in ("device", "manual"):
            h = {**self._2fa_headers(), "security-code": code}
            r = http("GET", "https://gsa.apple.com/grandslam/GsService2/validate", h)
            try:
                ec = plistlib.loads(r.data).get("ec", 0)
            except Exception:
                ec = 0 if r.status == 200 else -1
            if ec != 0:
                raise AppleError("That code isn't right. Check it and try again.")
        elif self._sms_route == "device":
            r = http("POST", f"https://gsa.apple.com/auth/verify/device/{self._sms_device_id}/securitycode",
                     self._json_2fa_headers(), json.dumps({"code": code}).encode())
            if r.status not in (200, 204):
                raise AppleError("That code isn't right. Check it and try again.")
        elif self._sms_route == "put":
            r = http("POST", "https://gsa.apple.com/auth/verify/phone/securitycode?referrer=/auth/verify/phone/put",
                     self._2fa_headers(), plistlib.dumps({
                         "securityCode.code": code,
                         "serverInfo": {"mode": "sms", "phoneNumber.id": str(self._phone_id)},
                     }))
            _log_2fa("sms code", r)
            if r.status >= 400 or b"-21669" in r.data:
                raise AppleError("That code isn't right. Check it and try again.")
        else:
            r = http("POST", "https://gsa.apple.com/auth/verify/phone/securitycode", self._json_2fa_headers(), json.dumps(
                {"phoneNumber": {"id": self._phone_id or 1}, "securityCode": {"code": code}, "mode": "sms"}).encode())
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
        tokens = _decrypted_plist(_decrypt_gcm(sk, r["et"]), "app token")["t"][XCODE_APP]
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
    (data_dir() / "last-apple-2fa.txt").unlink(missing_ok=True)
    machine = pick_machine()
    s = SignIn(machine, apple_id, password)
    try:
        s.login()
    except NeedsCode as need:
        mode = need.mode
        attempt = 0
        while attempt < 3:
            code = ask_code(mode)
            if code.strip() == "sms":
                # "Text me a code instead" / "Send again".
                try:
                    s.request_sms()
                    mode = "sms"
                except AppleError:
                    mode = "manual"
                continue
            attempt += 1
            if not code.strip():
                raise AppleError("Sign-in cancelled.")
            try:
                s.submit_code(mode, code)
                break
            except NeedsCode:
                raise AppleError("Apple asked for another code. Try signing in again.") from None
            except AppleError:
                if attempt >= 3:
                    raise
    return s.xcode_session()


def describe() -> dict[str, Any]:
    acct = load_secret("session")
    return {
        "signedIn": bool(acct),
        "appleId": acct.get("appleId") if acct else None,
        "remember": load_secret("password") is not None,
    }
