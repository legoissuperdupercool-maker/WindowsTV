"""
Re-sign an .ipa for one Apple ID and device, on this PC, with rcodesign
(apple-codesign, MPL-2.0, bundled with ello Sideloader).
"""

from __future__ import annotations

import os
import plistlib
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path
from typing import Callable

from apple_account import AppleError


def rcodesign() -> Path:
    name = "rcodesign.exe" if sys.platform == "win32" else "rcodesign"
    here = Path(__file__).resolve().parent
    for p in (here / name, here.parent / name, here / "bin" / name, here.parent / "bin" / name):
        if p.exists():
            return p
    found = shutil.which("rcodesign")
    if found:
        return Path(found)
    raise AppleError("ello Sideloader is missing its signing tool. Reinstall it.")


def app_info(ipa: Path) -> dict:
    """Name, bundle ID, version and platform of the app inside an .ipa."""
    with zipfile.ZipFile(ipa) as z:
        names = [n for n in z.namelist() if n.startswith("Payload/") and n.count("/") == 2 and n.endswith(".app/Info.plist")]
        if not names:
            raise AppleError("That file isn't an iPhone/iPad/Apple TV app (.ipa).")
        info = plistlib.loads(z.read(names[0]))
    return {
        "name": info.get("CFBundleDisplayName") or info.get("CFBundleName") or "App",
        "bundleId": info.get("CFBundleIdentifier", ""),
        "version": info.get("CFBundleShortVersionString", ""),
        "platforms": info.get("CFBundleSupportedPlatforms", []),
        "minOS": info.get("MinimumOSVersion", ""),
    }


def _run(args: list[str], cwd: Path) -> None:
    flags = 0x08000000 if sys.platform == "win32" else 0  # CREATE_NO_WINDOW
    p = subprocess.run(args, cwd=cwd, capture_output=True, text=True, creationflags=flags)
    if p.returncode != 0:
        tail = (p.stderr or p.stdout).strip().splitlines()[-3:]
        raise AppleError("Signing failed: " + " ".join(tail)[:300])


def sign_ipa(ipa: Path, out: Path, bundle_id: str, profile: bytes, entitlements: dict,
             cert_pem: bytes, key_pem: bytes, progress: Callable[[str], None] = lambda _: None) -> Path:
    tool = str(rcodesign())
    with tempfile.TemporaryDirectory(prefix="ello-sign-") as tmp:
        root = Path(tmp)
        progress("Unpacking the app…")
        with zipfile.ZipFile(ipa) as z:
            for member in z.infolist():
                target = (root / member.filename).resolve()
                if not str(target).startswith(str(root.resolve())):
                    raise AppleError("That .ipa contains unsafe paths.")
            z.extractall(root)
        apps = list((root / "Payload").glob("*.app"))
        if len(apps) != 1:
            raise AppleError("That .ipa doesn't contain exactly one app.")
        app = apps[0]

        # Our bundle ID and profile; old signatures out.
        info_path = app / "Info.plist"
        info = plistlib.loads(info_path.read_bytes())
        old_id = info.get("CFBundleIdentifier", "")
        info["CFBundleIdentifier"] = bundle_id
        info_path.write_bytes(plistlib.dumps(info, fmt=plistlib.FMT_BINARY))
        # App extensions/widgets would need their own App IDs; ello has none, so drop any.
        shutil.rmtree(app / "PlugIns", ignore_errors=True)
        shutil.rmtree(app / "Watch", ignore_errors=True)
        for sig in app.rglob("_CodeSignature"):
            shutil.rmtree(sig, ignore_errors=True)
        (app / "embedded.mobileprovision").write_bytes(profile)

        keys = root / "signing.pem"
        keys.write_bytes(cert_pem + b"\n" + key_pem)
        ents = root / "entitlements.plist"
        ents.write_bytes(plistlib.dumps(entitlements))
        try:
            # Frameworks and libraries first (no entitlements), then the app itself.
            nested = sorted(
                [p for p in (app / "Frameworks").glob("*") if p.suffix in (".framework", ".dylib")]
                if (app / "Frameworks").exists() else []
            )
            for i, item in enumerate(nested, 1):
                progress(f"Signing {item.name} ({i}/{len(nested)})…")
                _run([tool, "sign", "--timestamp-url", "none", "--pem-file", keys.name, str(item.relative_to(root))], root)
            progress("Signing ello smartTV…" if "ello" in old_id else "Signing the app…")
            # Paths relative to the work folder: rcodesign reads "C:\\…" as a "scope:value" pair.
            # No timestamp server: development signatures don't need one.
            _run([tool, "sign", "--shallow", "--timestamp-url", "none", "--pem-file", keys.name,
                  "--entitlements-xml-file", ents.name, str(app.relative_to(root))], root)
        finally:
            keys.unlink(missing_ok=True)  # the private key never stays in temp files

        progress("Packing the signed app…")
        out.parent.mkdir(parents=True, exist_ok=True)
        tmp_out = out.with_suffix(".part")
        with zipfile.ZipFile(tmp_out, "w", zipfile.ZIP_DEFLATED, compresslevel=5) as z:
            for path in sorted((root / "Payload").rglob("*")):
                rel = path.relative_to(root).as_posix()
                if path.is_symlink():
                    zi = zipfile.ZipInfo(rel)
                    zi.create_system = 3
                    zi.external_attr = (0o120777 << 16)
                    z.writestr(zi, os.readlink(path))
                elif path.is_file():
                    z.write(path, rel)
        tmp_out.replace(out)
    return out
