#!/usr/bin/env sh
#
# Copyright (c) Microsoft Corporation. All rights reserved.
COMMIT=$1
QUALITY=$2
SERVER_APPNAME=$3
DATAFOLDER=$4
VERSION=$5

shift 5

if [ "$VSCODE_WSL_DEBUG_INFO" = true ]; then
	set -x
fi

CODE_PROFILE="$HOME/$DATAFOLDER/server-env-setup"

printf "Setting up server environment: Looking for %s. " "$CODE_PROFILE"
if [ -f "$CODE_PROFILE" ]; then
	echo "Found, executing..."
	# shellcheck disable=SC1090
	. "$CODE_PROFILE"
else
	echo "Not found."
fi


VSCODE_REMOTE_BIN="$HOME/$DATAFOLDER/bin"
WSL_VERSION=$(uname -r)

echo "WSL version: $WSL_VERSION $WSL_DISTRO_NAME"

# If available, show WSL networking mode
if [ -x /usr/bin/wslinfo ]; then
	printf "Network mode: "
	/usr/bin/wslinfo --networking-mode
fi

"$(dirname "$0")/wslDownload.sh" "$COMMIT" "$QUALITY" "$VSCODE_REMOTE_BIN" "$VERSION"
RC=$?;
if [ $RC -ne 0 ]; then 
	exit $RC
fi

echo "WSL-shell-PID: $$"
echo "Node executable: $VSCODE_REMOTE_BIN/$COMMIT/node"

echo "Starting server: $VSCODE_REMOTE_BIN/$COMMIT/bin/$SERVER_APPNAME $*"
if [ -f /etc/alpine-release ]; then
	echo ""
	echo "* Note: Support for Alpine Linux is in preview."
elif [ "$(uname -m)" = "aarch64" ]; then
	echo ""
	echo "* Note: Support for ARM is in preview."
fi

"$VSCODE_REMOTE_BIN/$COMMIT/bin/$SERVER_APPNAME" "$@"
