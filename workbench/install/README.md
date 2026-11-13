# FireSocks Windows install scripts

Makes a binary-patched `dist/bin` copy a real Windows browser app.

## `install-firesocks.ps1`

Registers (all HKCU, no admin):

- `SOFTWARE\Clients\StartMenuInternet\FireSocks` — makes FireSocks appear in
  **Settings > Apps > Default apps**, with `Capabilities` URLAssociations
  (http/https), FileAssociations (.htm/.html/.shtml/.xht/.xhtml/.webp/.svg/.pdf),
  AppUserModelId, DefaultIcon, InstallInfo, shell open/properties verbs.
- `SOFTWARE\RegisteredApplications` → the Capabilities key.
- `SOFTWARE\Classes\FireSocksHTM` / `FireSocksURL` ProgIDs (`-osint -url "%1"`).
- `OpenWithProgids` entries on each protocol/extension.
- `App Paths\firesocks.exe` (Start > Run / Win+R resolution).
- `Uninstall\FireSocks` entry → shows in **Apps & Features**; the script is
  copied to `<InstallDir>\uninstall-firesocks.ps1` and pointed to by
  `UninstallString`.
- Start Menu + Desktop shortcuts with `System.AppUserModel.ID = FireSocks`
  (proper taskbar grouping / per-app state).

`powershell -ExecutionPolicy Bypass -File install-firesocks.ps1
[-InstallDir <dir>] [-Uninstall] [-RemoveFiles]`

## `patch-version-info.py`

Rewrites the exe's `VS_VERSION_INFO` string table via `UpdateResource`
(CompanyName/FileDescription/ProductName/LegalCopyright → FireSocks),
preserving the existing `VS_FIXEDFILEINFO`. Emits the StringTable under the
`{lang}{cp}` name for the detected translation plus common fallback names.
Verified: Explorer file Properties shows FireSocks branding.

`python patch-version-info.py <path-to-exe>`

## Loose-file update path

To refresh a binary-patched install with newer frontend-only work, copy the
changed files from the `firesocks` branch into these install paths:

| Source | Install path |
|---|---|
| `browser/app/profile/firefox.js` | `browser/defaults/preferences/firefox.js` |
| `browser/components/**.sys.mjs` | `moz-src/browser/components/…` |
| `browser/components/preferences/**` | `browser/chrome/browser/content/browser/preferences/…` |
| `browser/components/tabbrowser/content/tab.mjs` | `browser/chrome/browser/content/browser/tabbrowser/tab.mjs` |
| `browser/themes/shared/tabbrowser/tabs.css` | `browser/chrome/browser/skin/classic/browser/tabbrowser/tabs.css` |
| `browser/locales/en-US/**.ftl` | `browser/localization/en-US/…` |
| `browser/app/distribution/**` | `distribution/…` |

Caveat: `*.inc.xhtml` sources are `#include`d at package time — patch the
installed `preferences.xhtml` directly instead. C++/Rust/StaticPrefList
changes cannot be applied this way; they need a rebuild.
