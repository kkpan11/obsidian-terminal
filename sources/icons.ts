import { type Plugin, addIcon } from "obsidian"
import { siLinux, siMacos, siWindows } from "simple-icons"
import { UnnamespacedID } from "./utils/util"

export function registerIcons(plugin: Plugin): void {
	for (const [key, value] of Object.entries({
		linux: siLinux,
		macos: siMacos,
		windows: siWindows,
	})) {
		addIcon(new UnnamespacedID(key).namespaced(plugin), value.svg)
	}
}
