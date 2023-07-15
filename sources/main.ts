import { type App, Plugin, type PluginManifest } from "obsidian"
import {
	LanguageManager,
	type PluginContext,
	SI_PREFIX_SCALE,
	SettingsManager,
	StatusBarHider,
	createI18n,
	semVerString,
} from "@polyipseity/obsidian-plugin-library"
import { DeveloperConsolePseudoterminal } from "./terminal/pseudoterminal.js"
import { EarlyPatchManager } from "./patches.js"
import { PLUGIN_UNLOAD_DELAY } from "./magic.js"
import { PluginLocales } from "../assets/locales.js"
import { Settings } from "./settings-data.js"
import { isNil } from "lodash-es"
import { loadDocumentations } from "./documentations.js"
import { loadIcons } from "./icons.js"
import { loadSettings } from "./settings.js"
import { loadTerminal } from "./terminal/load.js"

export class TerminalPlugin
	extends Plugin
	implements PluginContext<Settings> {
	public readonly version
	public readonly settings: SettingsManager<Settings>
	public readonly language: LanguageManager
	public readonly statusBarHider = new StatusBarHider(this)
	public readonly earlyPatch
	public readonly developerConsolePTY =
		new DeveloperConsolePseudoterminal.Manager(this)

	public constructor(app: App, manifest: PluginManifest) {
		const earlyPatch = new EarlyPatchManager(app)
		earlyPatch.load()
		super(app, manifest)
		this.earlyPatch = earlyPatch
		try {
			this.version = semVerString(manifest.version)
		} catch (error) {
			self.console.warn(error)
			this.version = null
		}
		this.settings = new SettingsManager(this, Settings.fix)
		this.language = new LanguageManager(
			this,
			async () => createI18n(
				PluginLocales.RESOURCES,
				PluginLocales.FORMATTERS,
				{
					defaultNS: PluginLocales.DEFAULT_NAMESPACE,
					fallbackLng: PluginLocales.FALLBACK_LANGUAGES,
					returnNull: PluginLocales.RETURN_NULL,
				},
			),
		)
	}

	public displayName(unlocalized = false): string {
		return unlocalized
			? this.language.value.t("name", {
				interpolation: { escapeValue: false },
				lng: PluginLocales.DEFAULT_LANGUAGE,
			})
			: this.language.value.t("name")
	}

	public override onload(): void {
		super.onload()
		// Delay unloading as there are Obsidian unload tasks that cannot be awaited
		for (const child of [
			this.settings,
			this.language,
		]) {
			child.unload()
			this.register(() => {
				const id = self.setTimeout(() => {
					child.unload()
				}, PLUGIN_UNLOAD_DELAY * SI_PREFIX_SCALE)
				child.register(() => { self.clearTimeout(id) })
			})
			child.load()
		}
		for (const child of [this.statusBarHider]) {
			this.register(() => { child.unload() })
			child.load()
		}
		(async (): Promise<void> => {
			try {
				const loaded: unknown = await this.loadData(),
					{ language, statusBarHider, settings } = this
				await Promise.all([settings.onLoaded, language.onLoaded])
				await Promise.all([
					Promise.resolve().then(() => { loadIcons(this) }),
					Promise.resolve().then(() => {
						loadSettings(this, loadDocumentations(this, isNil(loaded)))
					}),
					Promise.resolve().then(() => { loadTerminal(this) }),
					Promise.resolve().then(() => {
						this.register(settings.on(
							"mutate-settings",
							settings0 => settings0.hideStatusBar,
							() => { statusBarHider.update() },
						))
						statusBarHider.hide(() =>
							settings.value.hideStatusBar === "always")
					}),
				])
			} catch (error) {
				self.console.error(error)
			}
		})()
	}
}
// Needed for loading
export default TerminalPlugin
