#!/bin/sh
# Baton installer for macOS and Linux.  Usage:  curl -fsSL https://clane.sh/baton/install.sh | sh
# Downloads the standalone `baton` executable from the GitHub release of clane-ai/baton into
# ~/.local/bin (or $BATON_INSTALL_DIR) and tells you if that directory is not on your PATH.
#   BATON_VERSION   pin a version (default: latest release)
#   BATON_GH_TOKEN  optional GitHub token (raises the API rate limit; not needed otherwise)
set -eu

repo="clane-ai/baton"
os="$(uname -s)"; arch="$(uname -m)"
case "$os" in
  Darwin) plat="darwin" ;;
  Linux)  plat="linux" ;;
  *) echo "unsupported OS: $os (use install.ps1 on Windows)"; exit 1 ;;
esac
case "$arch" in
  x86_64|amd64) a="x64" ;;
  arm64|aarch64) a="arm64" ;;
  *) echo "unsupported architecture: $arch"; exit 1 ;;
esac
asset="baton-${plat}-${a}"
dir="${BATON_INSTALL_DIR:-$HOME/.local/bin}"
mkdir -p "$dir"
exe="$dir/baton"

if [ -n "${BATON_VERSION:-}" ]; then tag="cli-v$(printf '%s' "$BATON_VERSION" | sed 's/^v//')"; else tag=""; fi

auth=""
if [ -n "${BATON_GH_TOKEN:-}" ]; then auth="Authorization: Bearer $BATON_GH_TOKEN"; fi

if [ -n "$auth" ]; then
  if [ -n "$tag" ]; then rel_url="https://api.github.com/repos/$repo/releases/tags/$tag"; else rel_url="https://api.github.com/repos/$repo/releases/latest"; fi
  rel="$(curl -fsSL -H "$auth" -H 'User-Agent: baton-installer' "$rel_url")"
  asset_url="$(printf '%s' "$rel" | tr -d '\n' | sed 's/},{/}\n{/g' | grep "\"name\":\"$asset\"" | sed 's/.*"url":"\([^"]*\)".*/\1/' | head -n1)"
  [ -n "$asset_url" ] || { echo "release has no asset named $asset"; exit 1; }
  echo "Downloading baton ($asset) ..."
  curl -fsSL -H "$auth" -H 'Accept: application/octet-stream' -H 'User-Agent: baton-installer' -o "$exe.tmp" "$asset_url"
else
  if [ -n "$tag" ]; then url="https://github.com/$repo/releases/download/$tag/$asset"; else url="https://github.com/$repo/releases/latest/download/$asset"; fi
  echo "Downloading $url ..."
  curl -fsSL -H 'User-Agent: baton-installer' -o "$exe.tmp" "$url"
fi
chmod +x "$exe.tmp"
mv -f "$exe.tmp" "$exe"

if [ "$plat" = "darwin" ]; then xattr -d com.apple.quarantine "$exe" 2>/dev/null || true; fi

echo ""
echo "Installed $("$exe" version) at $exe"
case ":$PATH:" in
  *":$dir:"*) ;;
  *) echo "Add $dir to your PATH, for example:  echo 'export PATH=\"$dir:\$PATH\"' >> ~/.profile" ;;
esac
echo ""
echo "Next, inside your product repository, run the command your operator gave you:"
echo "  baton join <invite-code>"
