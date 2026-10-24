"""
Apple's machine data ("anisette") from a Mac anisette service, using the community "v3" protocol
(SideStore/omnisette-server; the approach and server list follow iPASide's anisette_remote.py,
MIT License, Copyright (c) 2026 iPASide Contributors).

Why: since October 2026 Apple refuses the final token step (apptokens, -80046) for machine data
made by Apple's Android libraries (ello's built-in mode), whatever identity is claimed. It wants
data from Apple's real macOS/Windows code. A Mac anisette service runs that code.

What the service learns: this PC provisions its own random 16-byte identity once. Apple's two
provisioning steps go from this PC straight to Apple; only opaque blobs (spim/cpim/ptm/tk) pass
through the service's WebSocket, and it returns an opaque adi_pb kept in ello's data folder. After
that, one HTTPS request per sign-in returns fresh headers. The service never sees the Apple ID,
password, codes or tokens.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import plistlib
import socket
import ssl
import struct
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

# Mac servers, tried in order (the ones iloader, xtool, SideStore and iPASide use).
SERVERS = ("https://mac-ani.jkcoxson.com", "https://new.ani.sidestore.io", "https://ani3.stikstore.app")
START_URL = "https://gsa.apple.com/grandslam/MidService/startMachineProvisioning"
FINISH_URL = "https://gsa.apple.com/grandslam/MidService/finishMachineProvisioning"
TIMEOUT = 20.0


class Unavailable(Exception):
    """This server couldn't be used; the next one is tried."""


class _WebSocket:
    """Just enough of a WebSocket client for the provisioning session: text frames only."""

    def __init__(self, url: str, ssl_context: ssl.SSLContext, timeout: float = TIMEOUT) -> None:
        p = urlparse(url)
        port = p.port or (443 if p.scheme == "wss" else 80)
        try:
            sock = socket.create_connection((p.hostname, port), timeout=timeout)
            if p.scheme == "wss":
                sock = ssl_context.wrap_socket(sock, server_hostname=p.hostname)
        except OSError as e:
            raise Unavailable(f"can't connect ({e})") from e
        self.sock = sock
        self.buf = b""
        key = base64.b64encode(os.urandom(16)).decode()
        path = (p.path or "/") + (f"?{p.query}" if p.query else "")
        self.sock.sendall((f"GET {path} HTTP/1.1\r\nHost: {p.netloc}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                           f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\nUser-Agent: ello\r\n\r\n").encode())
        while b"\r\n\r\n" not in self.buf:
            self._fill()
        head, self.buf = self.buf.split(b"\r\n\r\n", 1)
        if b" 101 " not in head.split(b"\r\n", 1)[0]:
            raise Unavailable("refused the WebSocket")

    def _fill(self) -> None:
        try:
            chunk = self.sock.recv(65536)
        except OSError as e:
            raise Unavailable(f"connection lost ({e})") from e
        if not chunk:
            raise Unavailable("closed the connection")
        self.buf += chunk

    def _take(self, n: int) -> bytes:
        while len(self.buf) < n:
            self._fill()
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def send(self, text: str) -> None:
        data = text.encode()
        mask = os.urandom(4)
        n = len(data)
        head = bytes([0x81]) + (bytes([0x80 | n]) if n < 126 else bytes([0x80 | 126]) + struct.pack(">H", n)
                                if n < 65536 else bytes([0x80 | 127]) + struct.pack(">Q", n))
        self.sock.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def recv(self, deadline: float) -> str:
        message = b""
        while True:
            self.sock.settimeout(max(0.1, deadline - time.monotonic()))
            b0, b1 = self._take(2)
            n = b1 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._take(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._take(8))[0]
            mask = self._take(4) if b1 & 0x80 else b""
            payload = self._take(n)
            if mask:
                payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
            op = b0 & 0x0F
            if op == 0x8:
                raise Unavailable("closed the provisioning session early")
            if op == 0x9:  # ping
                self.sock.sendall(bytes([0x8A, 0x80]) + os.urandom(4))
                continue
            if op in (0x1, 0x0, 0x2):
                message += payload
                if b0 & 0x80:
                    return message.decode("utf-8", "replace")

    def close(self) -> None:
        try:
            self.sock.close()
        except OSError:
            pass


class V3Machine:
    """This PC as a Mac, with machine data from a v3 anisette service."""

    def __init__(self, data_dir: Path, http: Any, ssl_context: ssl.SSLContext, servers: tuple[str, ...] = SERVERS) -> None:
        self._state_file = data_dir / "anisette-v3.json"
        self._http = http  # urllib3.PoolManager
        self._ssl = ssl_context
        self._servers = servers
        self.server = ""
        self.client_info = ""
        self.user_agent = ""
        state = self._load()
        self._id: bytes = state["id"]
        self._adi: bytes | None = state["adi"]
        self.server = state["server"]
        self._fetch()  # pick a working server now, so a dead one is skipped before sign-in

    # --- state
    def _load(self) -> dict:
        try:
            raw = json.loads(self._state_file.read_text(encoding="utf-8"))
            ident = base64.b64decode(raw["identifier"])
            if len(ident) == 16:
                return {"id": ident, "adi": base64.b64decode(raw["adi_pb"]) if raw.get("adi_pb") else None,
                        "server": str(raw.get("server") or "")}
        except Exception:
            pass
        return {"id": os.urandom(16), "adi": None, "server": ""}

    def _save(self) -> None:
        self._state_file.write_text(json.dumps({
            "identifier": base64.b64encode(self._id).decode(),
            "adi_pb": base64.b64encode(self._adi).decode() if self._adi else None,
            "server": self.server,
        }), encoding="utf-8")

    @property
    def _md_lu(self) -> str:
        return hashlib.sha256(self._id).hexdigest()

    @property
    def _device_id(self) -> str:
        return str(uuid.UUID(bytes=self._id))

    # --- http
    def _json(self, method: str, url: str, body: dict | None = None) -> Any:
        try:
            r = self._http.request(method, url, body=json.dumps(body).encode() if body is not None else None,
                                   headers={"User-Agent": "ello", "Content-Type": "application/json"}, timeout=TIMEOUT, retries=False)
        except Exception as e:
            raise Unavailable(f"can't connect ({type(e).__name__})") from e
        if r.status != 200:
            raise Unavailable(f"answered HTTP {r.status}")
        try:
            return json.loads(r.data)
        except ValueError as e:
            raise Unavailable("didn't answer with JSON") from e

    def _apple(self, url: str, request: dict) -> dict:
        headers = {
            "Content-Type": "text/x-xml-plist", "Accept": "*/*", "Connection": "close",
            "User-Agent": self.user_agent, "X-MMe-Client-Info": self.client_info,
            "X-Apple-I-MD-LU": self._md_lu, "X-Mme-Device-Id": self._device_id,
        }
        r = self._http.request("POST", url, body=plistlib.dumps({"Header": {}, "Request": request}), headers=headers,
                               timeout=TIMEOUT, retries=False)
        try:
            data = plistlib.loads(r.data)
        except Exception as e:
            raise RuntimeError(f"Apple's provisioning answered HTTP {r.status} that couldn't be read") from e
        reply = data.get("Response", data)
        ec = (reply.get("Status") or {}).get("ec", 0)
        if ec:
            raise RuntimeError(f"Apple's provisioning answered error {ec}: {(reply.get('Status') or {}).get('em', '')}")
        return reply

    # --- protocol
    def _provision(self, server: str) -> None:
        ws = _WebSocket(server.replace("https://", "wss://", 1).replace("http://", "ws://", 1) + "/v3/provisioning_session", self._ssl)
        deadline = time.monotonic() + 90
        try:
            while True:
                if time.monotonic() > deadline:
                    raise Unavailable("provisioning took too long")
                try:
                    msg = json.loads(ws.recv(deadline))
                except ValueError as e:
                    raise Unavailable("sent a message that wasn't JSON") from e
                result = msg.get("result")
                if result == "GiveIdentifier":
                    ws.send(json.dumps({"identifier": base64.b64encode(self._id).decode()}))
                elif result == "GiveStartProvisioningData":
                    ws.send(json.dumps({"spim": self._apple(START_URL, {})["spim"]}))
                elif result == "GiveEndProvisioningData":
                    reply = self._apple(FINISH_URL, {"cpim": msg["cpim"]})
                    ws.send(json.dumps({"ptm": reply["ptm"], "tk": reply["tk"]}))
                elif result == "ProvisioningSuccess":
                    self._adi = base64.b64decode(msg["adi_pb"])
                    self.server = server
                    self._save()
                    return
                else:
                    raise Unavailable(f"provisioning stopped ({result}: {str(msg.get('message', ''))[:200]})")
        finally:
            ws.close()

    def _headers_from(self, server: str) -> dict[str, str]:
        info = self._json("GET", f"{server}/v3/client_info")
        if not isinstance(info, dict) or not isinstance(info.get("client_info"), str) or not isinstance(info.get("user_agent"), str):
            raise Unavailable("client_info wasn't in the expected form")
        self.client_info, self.user_agent = info["client_info"], info["user_agent"]
        for attempt in range(2):
            if self._adi is None or self.server != server:
                if self.server != server:
                    self._id, self._adi = os.urandom(16), None  # each server keeps its own identities
                self._provision(server)
            data = self._json("POST", f"{server}/v3/get_headers", {
                "identifier": base64.b64encode(self._id).decode(), "adi_pb": base64.b64encode(self._adi or b"").decode()})
            if isinstance(data, dict) and data.get("result") == "Headers" and data.get("X-Apple-I-MD") and data.get("X-Apple-I-MD-M"):
                self.server = server
                return {
                    "X-Apple-I-MD": str(data["X-Apple-I-MD"]),
                    "X-Apple-I-MD-M": str(data["X-Apple-I-MD-M"]),
                    "X-Apple-I-MD-RINFO": str(data.get("X-Apple-I-MD-RINFO") or "17106176"),
                    "X-Apple-I-MD-LU": self._md_lu,
                    "X-Apple-I-SRL-NO": "0",
                    "X-Mme-Device-Id": self._device_id,
                    "X-Apple-I-Client-Time": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                    "X-Apple-I-TimeZone": "UTC",
                    "X-Apple-Locale": "en_US",
                    "X-Apple-I-Locale": "en_US",
                    "X-MMe-Client-Info": self.client_info,
                }
            if isinstance(data, dict) and "-45061" in str(data.get("message", "")) and attempt == 0:
                self._id, self._adi = os.urandom(16), None  # no longer provisioned: make a new identity
                continue
            raise Unavailable(f"get_headers failed ({str(data)[:200]})")
        raise Unavailable("get_headers failed")

    def _fetch(self) -> dict[str, str]:
        order = sorted(self._servers, key=lambda s: s != self.server) if self.server else list(self._servers)
        failures = []
        for server in order:
            try:
                return self._headers_from(server.rstrip("/"))
            except Unavailable as e:
                failures.append(f"{urlparse(server).hostname}: {e}")
        raise Unavailable("no Mac anisette service answered (" + "; ".join(failures) + ")")

    def headers(self) -> dict[str, str]:
        return self._fetch()


def is_v3(http: Any, url: str) -> bool:
    """Whether a server speaks v3 (has /v3/client_info)."""
    try:
        r = http.request("GET", url.rstrip("/") + "/v3/client_info", timeout=10, retries=False)
        return r.status == 200 and b"client_info" in r.data
    except Exception:
        return False


