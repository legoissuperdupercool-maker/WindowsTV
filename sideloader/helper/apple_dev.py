"""
Xcode's developer services with a free Apple ID: the signing certificate, the
App ID and the 7-day provisioning profile for one device. Talks only to
developerservices2.apple.com.
"""

from __future__ import annotations

import plistlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from apple_account import AppleError, Machine, Session, data_dir, http, load_secret, new_request_id, save_secret

BASE = "https://developerservices2.apple.com/services/QH65B2/"
CLIENT_ID = "XABBG36SBA"
MACHINE_NAME = "ello Sideloader"


@dataclass
class Signing:
    team_id: str
    cert_pem: bytes
    key_pem: bytes
    profile: bytes
    bundle_id: str
    entitlements: dict


class DevServices:
    def __init__(self, session: Session, machine: Machine) -> None:
        self.s = session
        self.m = machine

    def call(self, path: str, params: dict[str, Any] | None = None, team: str | None = None, tv: bool = False) -> dict:
        body: dict[str, Any] = {"clientId": CLIENT_ID, "protocolVersion": "QH65B2", "requestId": new_request_id()}
        if team:
            body["teamId"] = team
        if tv:
            body["DTDK_Platform"] = "tvos"
            body["subPlatform"] = "tvOS"
        body.update(params or {})
        headers = {
            "Content-Type": "text/x-xml-plist",
            "User-Agent": "Xcode",
            "Accept": "text/x-xml-plist",
            "Accept-Language": "en-us",
            "X-Apple-App-Info": "com.apple.gs.xcode.auth",
            "X-Xcode-Version": "11.2 (11B41)",
            "X-Apple-I-Identity-Id": self.s.adsid,
            "X-Apple-GS-Token": self.s.token,
            **self.m.headers(),
        }
        r = http("POST", f"{BASE}{path}?clientId={CLIENT_ID}", headers, plistlib.dumps(body))
        try:
            res = plistlib.loads(r.data)
        except Exception as e:
            if r.status in (401, 403):
                raise AppleError("Your Apple sign-in expired. Sign in again.") from e
            raise AppleError(f"Apple sent an unexpected answer (HTTP {r.status}).") from e
        code = res.get("resultCode", 0)
        if code != 0:
            text = res.get("userString") or res.get("resultString") or "Apple refused the request."
            raise AppleError(f"{text} (Apple code {code})")
        return res

    # --- team & device

    def team(self) -> str:
        teams = self.call("listTeams.action").get("teams", [])
        if not teams:
            raise AppleError("This Apple ID has no developer team yet. Sign in once at developer.apple.com and accept the terms, then try again.")
        # A free account has one "Personal Team".
        free = [t for t in teams if t.get("type") in ("Individual", "Company/Organization")] or teams
        return free[0]["teamId"]

    def register_device(self, team: str, udid: str, name: str, tv: bool) -> None:
        devices = self.call("ios/listDevices.action", team=team, tv=tv).get("devices", [])
        if any(d.get("deviceNumber", "").lower() == udid.lower() for d in devices):
            return
        self.call("ios/addDevice.action", {"deviceNumber": udid, "name": name[:50] or "Device"}, team=team, tv=tv)

    # --- certificate

    def certificate(self, team: str) -> tuple[bytes, bytes]:
        """Our development certificate and its private key (made once, kept on this PC)."""
        saved = load_secret(f"cert-{team}")
        certs = self.call("ios/listAllDevelopmentCerts.action", team=team).get("certificates", [])
        if saved:
            for c in certs:
                if c.get("serialNumber") == saved["serial"]:
                    return saved["cert"].encode(), saved["key"].encode()
        # None usable: make a new one, revoking older ones ello made (Apple allows only a couple).
        for c in certs:
            if c.get("machineName") == MACHINE_NAME:
                try:
                    self.call("ios/revokeDevelopmentCert.action", {"serialNumber": c["serialNumber"]}, team=team)
                except AppleError:
                    pass
        key_pem, csr_pem = _make_csr()
        try:
            req = self.call("ios/submitDevelopmentCSR.action", {
                "csrContent": csr_pem.decode(), "machineId": new_request_id(), "machineName": MACHINE_NAME,
            }, team=team)
        except AppleError as e:
            if "7460" in str(e) or "already have" in str(e).lower():
                raise AppleError(
                    "This Apple ID already has its maximum of signing certificates (from another sideloading app). "
                    "Revoke one at developer.apple.com → Certificates, then try again."
                ) from e
            raise
        serial = req.get("certRequest", {}).get("serialNumber")
        for c in self.call("ios/listAllDevelopmentCerts.action", team=team).get("certificates", []):
            if c.get("serialNumber") == serial:
                cert_pem = _der_to_pem(c["certContent"])
                save_secret(f"cert-{team}", {"serial": serial, "cert": cert_pem.decode(), "key": key_pem.decode()})
                return cert_pem, key_pem
        raise AppleError("Apple made the certificate but didn't return it. Try again.")

    # --- app ID & profile

    def app_id(self, team: str, bundle_id: str, name: str, tv: bool) -> str:
        for a in self.call("ios/listAppIds.action", team=team, tv=tv).get("appIds", []):
            if a.get("identifier") == bundle_id:
                return a["appIdId"]
        try:
            res = self.call("ios/addAppId.action", {"identifier": bundle_id, "name": name}, team=team, tv=tv)
        except AppleError as e:
            if "9401" in str(e) or "maximum" in str(e).lower():
                raise AppleError("Free Apple IDs can register only 10 apps per week. Wait a few days, then try again.") from e
            raise
        return res["appId"]["appIdId"]

    def profile(self, team: str, app_id_id: str, tv: bool) -> bytes:
        res = self.call("ios/downloadTeamProvisioningProfile.action", {"appIdId": app_id_id}, team=team, tv=tv)
        return bytes(res["provisioningProfile"]["encodedProfile"])


def _make_csr() -> tuple[bytes, bytes]:
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    csr = (
        x509.CertificateSigningRequestBuilder()
        .subject_name(x509.Name([
            x509.NameAttribute(NameOID.COUNTRY_NAME, "US"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "ello"),
            x509.NameAttribute(NameOID.COMMON_NAME, "ello Sideloader"),
        ]))
        .sign(key, hashes.SHA256())
    )
    key_pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL,
                                serialization.NoEncryption())
    return key_pem, csr.public_bytes(serialization.Encoding.PEM)


def _der_to_pem(der: bytes) -> bytes:
    from cryptography import x509
    from cryptography.hazmat.primitives import serialization

    return x509.load_der_x509_certificate(bytes(der)).public_bytes(serialization.Encoding.PEM)


def profile_plist(profile: bytes) -> dict:
    """The plist inside a .mobileprovision (a signed CMS envelope)."""
    start = profile.find(b"<?xml")
    end = profile.find(b"</plist>")
    if start < 0 or end < 0:
        raise AppleError("Apple's provisioning profile couldn't be read.")
    return plistlib.loads(profile[start:end + len(b"</plist>")])


def prepare(session: Session, machine: Machine, udid: str, device_name: str, tv: bool,
            base_bundle_id: str, app_name: str) -> Signing:
    """Everything needed to sign one app for one device with this Apple ID."""
    dev = DevServices(session, machine)
    team = dev.team()
    dev.register_device(team, udid, device_name, tv)
    cert, key = dev.certificate(team)
    # Each Apple ID needs its own unique bundle ID.
    bundle_id = f"{base_bundle_id}.{team}".lower().replace("_", "-")
    app_id = dev.app_id(team, bundle_id, "".join(ch for ch in app_name if ch.isalnum() or ch == " ") or "ello", tv)
    prof = dev.profile(team, app_id, tv)
    ents = profile_plist(prof).get("Entitlements", {})
    keep = {k: v for k, v in ents.items() if k in (
        "application-identifier", "com.apple.developer.team-identifier", "get-task-allow", "keychain-access-groups")}
    keep["application-identifier"] = f"{team}.{bundle_id}"
    keep["com.apple.developer.team-identifier"] = team
    keep.setdefault("get-task-allow", True)
    keep["keychain-access-groups"] = [f"{team}.{bundle_id}"]
    return Signing(team, cert, key, prof, bundle_id, keep)


def cached_dir() -> Path:
    d = data_dir() / "work"
    d.mkdir(parents=True, exist_ok=True)
    return d
