"""Rewrite the VS_VERSION_INFO strings of a Windows exe.

Keeps the existing VS_FIXEDFILEINFO and translation pair, replaces the
StringFileInfo table with FireSocks branding. Works via the WinAPI
resource-update path, same mechanism as the icon patch.

Usage: python patch-version-info.py <exe>
"""
import ctypes
import struct
import sys
from ctypes import wintypes

STRINGS = {
    "CompanyName": "FireSocks",
    "FileDescription": "FireSocks Web Browser",
    "ProductName": "FireSocks",
    "LegalCopyright": "FireSocks and Mozilla Contributors, available under the MPL 2 license.",
}


def align4(buf, base=0):
    pad = (-(len(buf) + base)) % 4
    return buf + b"\x00" * pad


def wstr(s):
    return s.encode("utf-16-le") + b"\x00\x00"


def build_string_block(name, value):
    hdr = struct.pack("<HHH", 0, len(value) + 1, 1) + wstr(name)
    hdr = align4(hdr)
    blk = hdr + wstr(value)
    blk = align4(blk)
    return struct.pack("<H", len(blk)) + blk[2:]


def build_string_table(lang_cp, pairs):
    body = b""
    for k, v in pairs:
        body += build_string_block(k, v)
    inner = struct.pack("<HHH", 0, 0, 1) + wstr(lang_cp)
    inner = align4(inner) + body
    return struct.pack("<H", len(inner)) + inner[2:]


def build_string_file_info(lang_cps, pairs):
    body = b"".join(build_string_table(k, pairs) for k in lang_cps)
    inner = struct.pack("<HHH", 0, 0, 1) + wstr("StringFileInfo")
    inner = align4(inner) + body
    return struct.pack("<H", len(inner)) + inner[2:]


def build_var_file_info(lang, cp):
    var = struct.pack("<HHH", 0, 4, 0) + wstr("Translation")
    var = align4(var) + struct.pack("<HH", lang, cp)
    var = struct.pack("<H", len(var)) + var[2:]
    inner = struct.pack("<HHH", 0, 0, 1) + wstr("VarFileInfo")
    inner = align4(inner) + var
    return struct.pack("<H", len(inner)) + inner[2:]


def ver_query(buf, subblock):
    version = ctypes.windll.version
    ptr = wintypes.LPVOID()
    size = wintypes.UINT()
    if not version.VerQueryValueW(
            buf, wintypes.LPCWSTR(subblock),
            ctypes.byref(ptr), ctypes.byref(size)):
        return None, 0
    return ptr.value, size.value


def read_version_info(path):
    version = ctypes.windll.version
    size = version.GetFileVersionInfoSizeW(wintypes.LPCWSTR(path), None)
    if not size:
        raise OSError("GetFileVersionInfoSizeW failed")
    buf = ctypes.create_string_buffer(size)
    if not version.GetFileVersionInfoW(
            wintypes.LPCWSTR(path), 0, size, buf):
        raise OSError("GetFileVersionInfoW failed")
    ffi_ptr, ffi_len = ver_query(buf, "\\")
    if not ffi_ptr:
        raise ValueError("VS_FIXEDFILEINFO not found")
    fixed = ctypes.string_at(ffi_ptr, ffi_len)
    tr_ptr, tr_len = ver_query(buf, "\\VarFileInfo\\Translation")
    if tr_ptr and tr_len >= 4:
        lang, cp = struct.unpack("<HH", ctypes.string_at(tr_ptr, 4))
    else:
        lang, cp = 0x0409, 0x04B0
    if lang == 0:
        lang = 0x0409
    return fixed, lang, cp


def build_resource(fixed, lang, cp):
    table_keys = {
        f"{lang:04x}{cp:04x}",
        f"{(cp << 16) | lang:08x}",
        "040904b0",
    }
    pairs = list(STRINGS.items())
    body = build_string_file_info(sorted(table_keys), pairs)
    body += build_var_file_info(lang, cp)
    inner = struct.pack("<HHH", 0, 52, 0) + wstr("VS_VERSION_INFO")
    inner = align4(inner) + fixed + body
    return struct.pack("<H", len(inner)) + inner[2:]


def write_version_resource(path, data, lang):
    kernel32 = ctypes.windll.kernel32
    kernel32.BeginUpdateResourceW.restype = wintypes.HANDLE
    kernel32.UpdateResourceW.argtypes = [
        wintypes.HANDLE, wintypes.LPCWSTR, wintypes.LPCWSTR,
        wintypes.WORD, wintypes.LPVOID, wintypes.DWORD]
    kernel32.EndUpdateResourceW.argtypes = [wintypes.HANDLE, wintypes.BOOL]
    h = kernel32.BeginUpdateResourceW(wintypes.LPCWSTR(path), False)
    if not h:
        raise OSError("BeginUpdateResourceW failed")
    buf = ctypes.create_string_buffer(data, len(data))
    ok = True
    for wl in dict.fromkeys([0, lang]):
        ok = ok and kernel32.UpdateResourceW(
            h, wintypes.LPCWSTR(16), wintypes.LPCWSTR(1),
            wl, buf, len(data))
    if not ok or not kernel32.EndUpdateResourceW(h, False):
        kernel32.EndUpdateResourceW(h, True)
        raise OSError("UpdateResource/EndUpdateResource failed")


def main():
    exe = sys.argv[1]
    fixed, lang, cp = read_version_info(exe)
    new = build_resource(fixed, lang, cp)
    write_version_resource(exe, new, lang)
    print(f"version info patched ({len(new)} bytes, "
          f"lang {lang:04x}/cp {cp:04x})")


if __name__ == "__main__":
    main()
