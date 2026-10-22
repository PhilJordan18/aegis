#!/bin/bash
# Prints an xcodebuild destination for an iPhone simulator available on this
# machine, so CI images with other devices still run the recipes:
#
#   IOS_DESTINATION="$(scripts/ios-destination.sh)" scripts/ios-test.sh standalone
#
# Picks the first available name of IOS_SIMULATOR_NAMES (default: iPhone 17,
# iPhone 16, iPhone 15), on its newest iOS runtime. The choice is reported on
# stderr; the destination uses the simulator id so the run is unambiguous.
set -euo pipefail

names=${IOS_SIMULATOR_NAMES:-"iPhone 17,iPhone 16,iPhone 15"}

xcrun simctl list devices available -j | python3 -c '
import json, sys
preferred = [name.strip() for name in sys.argv[1].split(",") if name.strip()]
devices = json.load(sys.stdin)["devices"]

def version(runtime):
    return [int(part) for part in runtime.rsplit("iOS-", 1)[1].split("-")]

candidates = [(runtime, device) for runtime, entries in devices.items() if ".iOS-" in runtime
              for device in entries if device.get("isAvailable", True)]
for name in preferred:
    matches = [(runtime, device) for runtime, device in candidates if device["name"] == name]
    if matches:
        runtime, device = max(matches, key=lambda match: version(match[0]))
        os_version = ".".join(str(part) for part in version(runtime))
        udid = device["udid"]
        print(f"selected: {name}, iOS {os_version} ({udid})", file=sys.stderr)
        print(f"platform=iOS Simulator,id={udid}")
        sys.exit(0)
sys.exit("error: none of these simulators is available: " + ", ".join(preferred))
' "$names"
