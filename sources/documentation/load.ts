import { DOCUMENTATIONS, type DocumentationKey } from "./documentations"
import {
	addCommand,
	newCollabrativeState,
	printError,
} from "sources/utils/obsidian"
import { DocumentationMarkdownView } from "./view"
import type { TerminalPlugin } from "sources/main"
import { anyToError } from "sources/utils/util"
import { lt } from "semver"

export function loadDocumentation(
	plugin: TerminalPlugin,
	readme = false,
): void {
	const { language, version } = plugin,
		{ i18n } = language
	plugin.registerView(
		DocumentationMarkdownView.type.namespaced(plugin),
		leaf => new DocumentationMarkdownView(plugin, leaf),
	)
	addCommand(plugin, () => i18n.t("commands.open-readme"), {
		callback() { openDocumentation(plugin, "readme") },
		icon: i18n.t("asset:commands.open-readme-icon"),
		id: "open-readme",
	})
	addCommand(plugin, () => i18n.t("commands.open-changelog"), {
		callback() { openDocumentation(plugin, "changelog") },
		icon: i18n.t("asset:commands.open-changelog-icon"),
		id: "open-changelog",
	})
	if (readme) { openDocumentation(plugin, "readme", false) }
	if (version !== null &&
		lt(plugin.settings.lastReadChangelogVersion, version)) {
		openDocumentation(plugin, "changelog", false)
	}
}

export function openDocumentation(
	plugin: TerminalPlugin,
	key: DocumentationKey,
	active = true,
): void {
	const { app, language, version } = plugin,
		{ workspace } = app,
		{ i18n } = language
	workspace.onLayoutReady(async () => {
		try {
			await workspace.getLeaf("tab").setViewState({
				active,
				state: newCollabrativeState(plugin, new Map([
					[
						DocumentationMarkdownView.type, {
							data: DOCUMENTATIONS[key],
							displayTextI18nKey: `documentations.${key}`,
							iconI18nKey: `asset:documentations.${key}-icon`,
						} satisfies DocumentationMarkdownView.State,
					],
				])),
				type: DocumentationMarkdownView.type.namespaced(plugin),
			})
			if (key === "changelog" && version !== null) {
				await plugin.mutateSettings(settings => {
					settings.lastReadChangelogVersion = version
				})
				await plugin.saveSettings()
			}
		} catch (error) {
			printError(
				anyToError(error),
				() => i18n.t("errors.error-opening-documentation"),
				plugin,
			)
		}
	})
}
