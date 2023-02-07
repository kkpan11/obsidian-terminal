import {
	type ButtonComponent,
	type ExtraButtonComponent,
	PluginSettingTab,
	Setting,
	type ValueComponent,
} from "obsidian"
import { DEFAULT_SETTINGS, Settings } from "./data"
import {
	type Sized,
	capitalize,
	cloneAsMutable,
	inSet,
} from "../utils/util"
import { LANGUAGES } from "assets/locales"
import type { TerminalPlugin } from "../main"
import { TerminalPty } from "../terminal/pty"

export class SettingTab extends PluginSettingTab {
	public constructor(protected readonly plugin: TerminalPlugin) {
		super(plugin.app, plugin)
		plugin.register(plugin.language.onChangeLanguage
			.listen(() => { this.display() }))
	}

	public display(): void {
		// Avoid <h2/>
		const { containerEl, plugin } = this,
			{ settings, language } = plugin,
			{ i18n } = language
		containerEl.empty()
		containerEl.createEl("h1", { text: i18n.t("name") })

		new Setting(containerEl)
			.setName(i18n.t("settings.language"))
			.setDesc(i18n.t("settings.language-description"))
			.addDropdown(this.#linkSetting(
				(): string => settings.language,
				this.#setTextToEnum(
					Settings.DEFAULTABLE_LANGUAGES,
					async value => plugin
						.mutateSettings(settingsM => { settingsM.language = value }),
				),
				{
					pre: dropdown => {
						dropdown
							.addOption("", i18n.t("settings.language-default"))
							.addOptions(Object
								.fromEntries(Object
									.entries(LANGUAGES)
									.filter(entry => entry
										.every(half => typeof half === "string"))))
					},
				},
			))
			.addExtraButton(this.#resetButton(
				async () => plugin
					.mutateSettings(settingsM => {
						settingsM.language = DEFAULT_SETTINGS.language
					}),
				i18n.t("asset:settings.language-icon"),
			))
		new Setting(containerEl)
			.setName(i18n.t("settings.reset-all"))
			.addButton(this.#resetButton(async () => plugin
				.mutateSettings(settingsM =>
					Object.assign(settingsM, cloneAsMutable(DEFAULT_SETTINGS)))))

		new Setting(containerEl)
			.setName(i18n.t("settings.add-to-command"))
			.addToggle(this.#linkSetting(
				() => settings.addToCommand,
				async value => plugin
					.mutateSettings(settingsM => { settingsM.addToCommand = value }),
			))
			.addExtraButton(this.#resetButton(
				async () => plugin
					.mutateSettings(settingsM => {
						settingsM.addToCommand = DEFAULT_SETTINGS.addToCommand
					}),
				i18n.t("asset:settings.add-to-command-icon"),
			))
		new Setting(containerEl)
			.setName(i18n.t("settings.add-to-context-menu"))
			.addToggle(this.#linkSetting(
				() => settings.addToContextMenu,
				async value => plugin
					.mutateSettings(settingsM => { settingsM.addToContextMenu = value }),
			))
			.addExtraButton(this.#resetButton(
				async () => plugin
					.mutateSettings(settingsM => {
						settingsM.addToContextMenu = DEFAULT_SETTINGS.addToContextMenu
					}),
				i18n.t("asset:settings.add-to-context-menu-icon"),
			))
		new Setting(containerEl)
			.setName(i18n.t("settings.hide-status-bar"))
			.addDropdown(this.#linkSetting(
				(): string => settings.hideStatusBar,
				this.#setTextToEnum(
					Settings.HIDE_STATUS_BAR_OPTIONS,
					async value => plugin.mutateSettings(settingsM => {
						settingsM.hideStatusBar = value
					}),
				),
				{
					pre: dropdown => {
						dropdown
							.addOptions(Object
								.fromEntries(Settings.HIDE_STATUS_BAR_OPTIONS
									.map(value => [
										value,
										i18n.t(`settings.hide-status-bar-options.${value}`),
									])))
					},
				},
			))
			.addExtraButton(this.#resetButton(
				async () => plugin.mutateSettings(settingsM => {
					settingsM.hideStatusBar = DEFAULT_SETTINGS.hideStatusBar
				}),
				i18n.t("asset:settings.hide-status-bar-icon"),
			))
		new Setting(containerEl)
			.setName(i18n.t("settings.notice-timeout"))
			.setDesc(i18n.t("settings.notice-timeout-description"))
			.addText(this.#linkSetting(
				() => settings.noticeTimeout.toString(),
				this.#setTextToNumber(async value => plugin
					.mutateSettings(settingsM => { settingsM.noticeTimeout = value })),
			))
			.addExtraButton(this.#resetButton(
				async () => plugin.mutateSettings(settingsM => {
					settingsM.noticeTimeout = DEFAULT_SETTINGS.noticeTimeout
				}),
				i18n.t("asset:settings.notice-timeout-icon"),
			))
		new Setting(containerEl)
			.setName(i18n.t("settings.error-notice-timeout"))
			.setDesc(i18n.t("settings.error-notice-timeout-description"))
			.addText(this.#linkSetting(
				() => settings.errorNoticeTimeout.toString(),
				this.#setTextToNumber(async value => plugin
					.mutateSettings(settingsM => {
						settingsM.errorNoticeTimeout = value
					})),
			))
			.addExtraButton(this.#resetButton(
				async () => plugin.mutateSettings(settingsM => {
					settingsM.noticeTimeout = DEFAULT_SETTINGS.noticeTimeout
				}),
				i18n.t("asset:settings.error-notice-timeout-icon"),
			))

		containerEl.createEl("h3", { text: i18n.t("settings.executables") })
		new Setting(containerEl)
			.setName(i18n.t("settings.python-executable"))
			.setDesc(i18n.t("settings.python-executable-description"))
			.addText(this.#linkSetting(
				() => settings.pythonExecutable,
				async value => plugin.mutateSettings(settingsM => {
					settingsM.pythonExecutable = value
				}),
				{
					post: component => {
						component
							.setPlaceholder(i18n.t("settings.python-executable-placeholder"))
					},
				},
			))
			.addExtraButton(this.#resetButton(
				async () => plugin.mutateSettings(settingsM => {
					settingsM.pythonExecutable = DEFAULT_SETTINGS.pythonExecutable
				}),
				i18n.t("asset:settings.python-executable-icon"),
			))
		for (const key of TerminalPty.SUPPORTED_PLATFORMS) {
			containerEl.createEl(
				"h4",
				{ text: i18n.t(`types.platforms.${key}`) },
			)
			new Setting(containerEl)
				.setName(i18n.t("types.terminals.external"))
				.addText(this.#linkSetting(
					() => settings.executables[key].extExe,
					async value => plugin.mutateSettings(settingsM => {
						settingsM.executables[key].extExe = value
					}),
				))
				.addExtraButton(this.#resetButton(
					async () => plugin.mutateSettings(settingsM => {
						settingsM.executables[key].extExe =
							DEFAULT_SETTINGS.executables[key].extExe
					}),
					i18n.t("asset:settings.executable-list-external-icon"),
				))
			new Setting(containerEl)
				.setName(i18n.t("types.terminals.integrated"))
				.addText(this.#linkSetting(
					() => settings.executables[key].intExe,
					async value => plugin.mutateSettings(settingsM => {
						settingsM.executables[key].intExe = value
					}),
				))
				.addExtraButton(this.#resetButton(
					async () => plugin.mutateSettings(settingsM => {
						settingsM.executables[key].intExe =
							DEFAULT_SETTINGS.executables[key].intExe
					}),
					i18n.t("asset:settings.executable-list-integrated-icon"),
				))
			if (key === "win32") {
				new Setting(containerEl)
					.setName(i18n.t("settings.enable-Windows-conhost-workaround"))
					.setDesc(i18n
						.t("settings.enable-Windows-conhost-workaround-description"))
					.addToggle(this.#linkSetting(
						() => settings.enableWindowsConhostWorkaround,
						async value => plugin.mutateSettings(settingsM => {
							settingsM.enableWindowsConhostWorkaround = value
						}),
					))
					.addExtraButton(this.#resetButton(
						async () => plugin.mutateSettings(settingsM => {
							settingsM.enableWindowsConhostWorkaround =
								DEFAULT_SETTINGS.enableWindowsConhostWorkaround
						}),
						i18n.t("asset:settings.enable-Windows-conhost-workaround-icon"),
					))
			}
		}

		containerEl.createEl("h3", { text: i18n.t("settings.advanced-settings") })
		new Setting(containerEl)
			.setName(i18n.t("settings.preferred-renderer"))
			.addDropdown(this.#linkSetting(
				(): string => settings.preferredRenderer,
				this.#setTextToEnum(
					Settings.PREFERRED_RENDERER_OPTIONS,
					async value => plugin.mutateSettings(settingsM => {
						settingsM.preferredRenderer = value
					}),
				),
				{
					pre: dropdown => {
						dropdown
							.addOptions(Object
								.fromEntries(Settings.PREFERRED_RENDERER_OPTIONS
									.map(value => [
										value,
										capitalize(
											i18n.t(`types.renderers.${value}`),
											language.language,
										),
									])))
					},
				},
			))
			.addExtraButton(this.#resetButton(
				async () => plugin.mutateSettings(settingsM => {
					settingsM.preferredRenderer = DEFAULT_SETTINGS.preferredRenderer
				}),
				i18n.t("asset:settings.preferred-renderer-icon"),
			))
	}

	#linkSetting<
		V,
		C extends ValueComponent<V> & {
			onChange: (
				callback: (value: V) => unknown) => C
		},
	>(
		getter: () => V,
		setter: (value: V, component: C, getter: () => V) => unknown,
		action: SettingTab.ComponentAction<C, V> = {},
	) {
		return (component: C): void => {
			(action.pre ?? ((): void => { }))(component)
			const activate = async (value: V): Promise<void> => {
				const ret = await setter(value, component, getter)
				if (typeof ret === "boolean" && !ret) {
					component.setValue(getter())
					return
				}
				await Settings.save(this.plugin.settings, this.plugin)
			}
			component.setValue(getter()).onChange(activate);
			(action.post ?? ((): void => { }))(component, activate)
		}
	}

	#setTextToEnum<Es extends readonly V[], V, C extends ValueComponent<V>>(
		enums: Sized<Es>,
		setter: (value: Es[number], component: C, getter: () => V) => unknown,
	) {
		return async (
			value: V,
			component: C,
			getter: () => V,
		): Promise<boolean> => {
			if (!inSet(enums, value)) {
				return false
			}
			const ret = await setter(value, component, getter)
			if (typeof ret === "boolean" && !ret) {
				return false
			}
			return true
		}
	}

	#setTextToNumber<C extends ValueComponent<string>>(
		setter: (value: number, component: C, getter: () => string) => unknown,
		integer = false,
	) {
		return async (
			value: string,
			component: C,
			getter: () => string,
		): Promise<boolean> => {
			const num = Number(value)
			if (!(integer ? Number.isSafeInteger(num) : isFinite(num))) {
				return false
			}
			const ret = await setter(num, component, getter)
			if (typeof ret === "boolean" && !ret) {
				return false
			}
			return true
		}
	}

	#resetButton<C extends ButtonComponent | ExtraButtonComponent>(
		resetter: (component: C) => unknown,
		icon: string = this.plugin.language
			.i18n.t("asset:settings.reset-icon"),
		action: SettingTab.ComponentAction<C, void> = {},
	) {
		return (component: C): void => {
			(action.pre ?? ((): void => { }))(component)
			const activate = async (): Promise<void> => {
				const ret = await resetter(component)
				if (typeof ret === "boolean" && !ret) {
					return
				}
				const save = Settings.save(this.plugin.settings, this.plugin)
				this.display()
				await save
			}
			component
				.setTooltip(this.plugin.language.i18n.t("settings.reset"))
				.setIcon(icon)
				.onClick(activate);
			(action.post ?? ((): void => { }))(component, activate)
		}
	}
}
namespace SettingTab {
	export interface ComponentAction<C, V> {
		readonly pre?: (component: C) => void
		readonly post?: (
			component: C,
			activate: (value: V) => PromiseLike<void>,
		) => void
	}
}