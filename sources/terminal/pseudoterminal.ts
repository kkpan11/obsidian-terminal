import {
	CONTROL_SEQUENCE_INTRODUCER as CSI,
	CursoredText,
	NORMALIZED_LINE_FEED,
	TerminalTextArea,
	normalizeText,
	writePromise as tWritePromise,
} from "./util.js"
import {
	DEFAULT_ENCODING,
	DEFAULT_PYTHONIOENCODING,
	EXIT_SUCCESS,
	MAX_LOCK_PENDING,
	TERMINAL_EXIT_CLEANUP_WAIT,
	TERMINAL_RESIZER_WATCHDOG_WAIT,
	UNDEFINED,
	WINDOWS_CMD_PATH,
	WINDOWS_CONHOST_PATH,
} from "../magic.js"
import { type ExtendNode, parse } from "acorn"
import {
	Functions,
	Platform,
	ResourceComponent,
	SI_PREFIX_SCALE,
	acquireConditionally,
	activeSelf,
	anyToError,
	asyncFunction,
	attachFunctionSourceMap,
	clear,
	consumeEvent,
	deepFreeze,
	deopaque,
	dynamicRequire,
	getKeyModifiers,
	inSet,
	lazyInit,
	logFormat,
	notice2,
	printError,
	promisePromise,
	remove,
	replaceAllRegex,
	sleep2,
	typedKeys,
} from "@polyipseity/obsidian-plugin-library"
import type { IMarker, Terminal } from "xterm"
import inspect, { type Options } from "browser-util-inspect"
import { isEmpty, isNil, isUndefined, noop } from "lodash-es"
import { spawnPromise, writePromise } from "../util.js"
import AsyncLock from "async-lock"
import type { AsyncOrSync } from "ts-essentials"
import { BUNDLE } from "../import.js"
import type { DeveloperConsoleContext } from "obsidian-terminal"
import { DisposerAddon } from "./emulator-addons.js"
import type { FileResult } from "tmp-promise"
import type { Log } from "../patch.js"
import type {
	ChildProcessWithoutNullStreams as PipedChildProcess,
} from "node:child_process"
import type { Position } from "source-map"
import type { Program } from "estree"
import type { TerminalPlugin } from "../main.js"
import ansi from "ansi-escape-sequences"
import unixPseudoterminalPy from "./unix_pseudoterminal.py"
import win32ResizerPy from "./win32_resizer.py"

const
	childProcess = dynamicRequire<typeof import("node:child_process")
	>(BUNDLE, "node:child_process"),
	fsPromises = dynamicRequire<typeof import("node:fs/promises")
	>(BUNDLE, "node:fs/promises"),
	process = dynamicRequire<typeof import("node:process")
	>(BUNDLE, "node:process"),
	stream = dynamicRequire<typeof import("node:stream")
	>(BUNDLE, "node:stream"),
	tmpPromise = dynamicRequire<typeof import("tmp-promise")
	>(BUNDLE, "tmp-promise")

async function clearTerminal(terminal: Terminal, keep = false): Promise<void> {
	const { rows } = terminal
	await tWritePromise(
		terminal,
		`${keep
			? `${NORMALIZED_LINE_FEED.repeat(Math.max(rows - 1, 0))}`
			// eslint-disable-next-line @typescript-eslint/no-magic-numbers
			: ""}${ansi.erase.display(keep ? 2 : 3)}${ansi.cursor.position()}`,
	)
}

export interface Pseudoterminal {
	readonly shell?: Promise<PipedChildProcess> | undefined
	readonly kill: () => AsyncOrSync<void>
	readonly onExit: Promise<NodeJS.Signals | number>
	readonly pipe: (terminal: Terminal) => AsyncOrSync<void>
	readonly resize?: (columns: number, rows: number) => AsyncOrSync<void>
}

export class RefPsuedoterminal<T extends Pseudoterminal,
> implements Pseudoterminal {
	public readonly onExit
	protected readonly delegate: T
	readonly #exit = promisePromise<NodeJS.Signals | number>()
	readonly #ref: [number]

	public constructor(delegate: RefPsuedoterminal<T> | T) {
		this.onExit = this.#exit.then(async ({ promise }) => promise)
		if (delegate instanceof RefPsuedoterminal) {
			this.delegate = delegate.delegate
			this.#ref = delegate.#ref
		} else {
			this.delegate = delegate
			this.#ref = [0]
		}
		this.delegate.onExit.then(
			async ret => { (await this.#exit).resolve(ret) },
			async error => { (await this.#exit).reject(error) },
		)
		++this.#ref[0]
	}

	public get shell(): Promise<PipedChildProcess> | undefined {
		return this.delegate.shell
	}

	public dup(): RefPsuedoterminal<T> {
		return new RefPsuedoterminal(this)
	}

	public async kill(): Promise<void> {
		if (--this.#ref[0] <= 0) {
			await this.delegate.kill()
		} else {
			(await this.#exit).resolve(EXIT_SUCCESS)
		}
	}

	public pipe(terminal: Terminal): AsyncOrSync<void> {
		return this.delegate.pipe(terminal)
	}

	public resize(columns: number, rows: number): AsyncOrSync<void> {
		const { delegate } = this
		if (delegate.resize) {
			return delegate.resize(columns, rows)
		}
		return UNDEFINED
	}
}

abstract class PseudoPseudoterminal implements Pseudoterminal {
	public readonly onExit
	protected readonly terminals: Terminal[] = []
	protected exited = false
	readonly #exit = promisePromise<NodeJS.Signals | number>()

	public constructor() {
		this.onExit = this.#exit
			.then(async ({ promise }) => promise)
			.finally(() => { this.exited = true })
			.finally(() => { clear(this.terminals) })
	}

	public async kill(): Promise<void> {
		(await this.#exit).resolve(EXIT_SUCCESS)
	}

	public pipe(terminal: Terminal): AsyncOrSync<void> {
		if (this.exited) { throw new Error() }
		terminal.loadAddon(new DisposerAddon(
			() => { remove(this.terminals, terminal) },
		))
		this.terminals.push(terminal)
	}
}

export class TextPseudoterminal
	extends PseudoPseudoterminal
	implements Pseudoterminal {
	protected static readonly syncLock = "sync"
	protected readonly lock = new AsyncLock({ maxPending: MAX_LOCK_PENDING })
	#text: string

	public constructor(text = "") {
		super()
		this.#text = text
	}

	public get text(): string {
		return this.#text
	}

	public set text(value: string) {
		this.rewrite(normalizeText(this.#text = value)).catch(error => {
			self.console.error(error)
		})
	}

	public override async pipe(terminal: Terminal): Promise<void> {
		await super.pipe(terminal)
		await this.rewrite(normalizeText(this.text), [terminal])
	}

	protected async rewrite(
		text: string,
		terminals: readonly Terminal[] = this.terminals,
	): Promise<void> {
		const terminals0 = [...terminals]
		return new Promise((resolve, reject) => {
			this.lock.acquire(TextPseudoterminal.syncLock, async () => {
				const writers = terminals0.map(async terminal => {
					await clearTerminal(terminal)
					await tWritePromise(terminal, text)
				})
				resolve(Promise.all(writers).then(noop))
				await Promise.allSettled(writers)
			}).catch(reject)
		})
	}
}

export class DeveloperConsolePseudoterminal
	extends PseudoPseudoterminal
	implements Pseudoterminal {
	public static readonly colors = deepFreeze({
		debug: "blue",
		error: "red",
		info: "white",
		warn: "yellow",
	}) satisfies Record<string, ansi.Style>

	protected static readonly syncLock = "sync"
	protected static readonly contextVar = "$$"
	protected readonly context: DeveloperConsoleContext

	protected readonly lock = new AsyncLock({ maxPending: MAX_LOCK_PENDING })
	protected readonly buffer = new TerminalTextArea()
	readonly #formatCache = new WeakMap<Log.Event, string>()
	readonly #history = [""]
	#historyIndex = 0
	readonly #editors =
		new Map<Terminal, DeveloperConsolePseudoterminal.$Editor>()

	public constructor(
		protected readonly self0: () => Window & typeof globalThis,
		protected readonly log: Log,
	) {
		super()
		const { terminals } = this
		this.context = Object.seal({
			depth: 0,
			get terminals() { return terminals },
		})
		this.onExit.catch(() => { })
			.finally(log.logger.listen(async event => this.write([event])))
			.finally(() => {
				new Functions(
					{ async: false, settled: true },
					...[...this.#editors.keys()]
						.map(terminal => (): void => { this.#setEditor(terminal) }),
				).call()
			})
			.finally(() => { this.buffer.dispose() })
	}

	public override async pipe(terminal: Terminal): Promise<void> {
		await super.pipe(terminal)
		terminal.loadAddon(new DisposerAddon(
			() => { this.#setEditor(terminal) },
		))
		const { buffer, lock, terminals } = this
		let block = false,
			resizing = false
		const disposer = new Functions(
			{ async: false, settled: true },
			...[
				terminal.onData(async data => {
					if (block) {
						block = false
						return
					}
					await lock.acquire(
						DeveloperConsolePseudoterminal.syncLock,
						async () => {
							let writing = true
							const write = buffer.write(data)
								.finally(() => { writing = false })
								.then(async () => {
									this.#history[this.#history.length - 1] = buffer.value.string
									await this.syncBuffer(terminals, false)
								})
							// eslint-disable-next-line no-unmodified-loop-condition
							while (writing) {
								// eslint-disable-next-line no-await-in-loop
								await this.syncBuffer(terminals, false)
							}
							await write
						},
					)
				}),
				terminal.onKey(({ domEvent }) => {
					if (!isEmpty(getKeyModifiers(domEvent))) { return }
					function logError(error: unknown): void {
						activeSelf(domEvent).console.error(error)
					}
					const { key } = domEvent
					switch (key) {
						case "Enter":
							this.eval().catch(logError)
							break
						case "ArrowUp":
						case "ArrowDown":
							if ((this.#history.at(-1) ?? "").includes("\n")) { return }
							lock.acquire(
								DeveloperConsolePseudoterminal.syncLock,
								async () => {
									if ((this.#history.at(-1) ?? "").includes("\n")) { return }
									const { length } = this.#history
									if (length <= 0) { return }
									const text = this.#history.at(this.#historyIndex =
										(this.#historyIndex + (key === "ArrowDown"
											? 1
											: -1)) % length)
									if (isUndefined(text)) { return }
									let writing = true
									const write = buffer.setValue(text)
										.finally(() => { writing = false })
										.then(async () => this.syncBuffer(terminals, false))
									// eslint-disable-next-line no-unmodified-loop-condition
									while (writing) {
										// eslint-disable-next-line no-await-in-loop
										await this.syncBuffer(terminals, false)
									}
									await write
								},
							).catch(logError)
							break
						default:
							return
					}
					block = true
					consumeEvent(domEvent)
				}),
				terminal.onResize(() => {
					if (resizing) { return }
					resizing = true
					this.syncBuffer([terminal])
						.finally(() => { resizing = false })
						.catch(error => {
							activeSelf(terminal.element).console.error(error)
						})
				}),
			].map(disposer0 => () => { disposer0.dispose() }),
		)
		this.onExit.catch(() => { }).finally(() => { disposer.call() })
		await this.write(this.log.history, [terminal])
	}

	protected format(event: Log.Event): string {
		let ret = this.#formatCache.get(event)
		if (isUndefined(ret)) {
			const { colors } = DeveloperConsolePseudoterminal,
				{ data, type } = event,
				styles: ansi.Style[] = []
			switch (type) {
				case "debug":
				case "error":
				case "info":
				case "warn":
					styles.push(colors[type])
					ret = logFormat(this.options(styles), ...data)
					break
				case "windowError":
					styles.push(colors.error)
					ret = logFormat(this.options(styles), data.message, data)
					break
				case "unhandledRejection":
					styles.push(colors.error)
					ret = logFormat(this.options(styles), data.reason, data)
					break
				// No default
			}
			this.#formatCache.set(event, ret =
				`${ansi.styles(styles)}${ret}${ansi.style.reset}`)
		}
		return ret
	}

	protected options(styles: readonly ansi.Style[]): Options {
		const { context: { depth } } = this
		return deepFreeze({
			customInspect: false,
			depth,
			showHidden: true,
			stylize(str, styleType) {
				const { [styleType]: style } = inspect.styles
				if (style) {
					const { [style]: [apply, undo] } = inspect.colors
					return `${CSI}${apply}m${str}${CSI}${undo}m${ansi.styles(styles)}`
				}
				return str
			},
		})
	}

	protected async eval(): Promise<void> {
		const { buffer, context, lock, self0, terminals } = this,
			self1 = self0(),
			code = await lock.acquire(
				DeveloperConsolePseudoterminal.syncLock,
				async () => {
					const { string: ret } = await buffer.clear(),
						{ length } = this.#history
					this.#history.splice(length - 1, 1, ret, "")
					this.#historyIndex = length
					await this.syncBuffer(terminals, false)
					return ret
				},
			)
		self1.console.log(code)
		const ast = ((): ExtendNode<Program> | null => {
			try {
				return parse(code, {
					allowAwaitOutsideFunction: true,
					allowHashBang: true,
					allowImportExportEverywhere: false,
					allowReserved: true,
					allowReturnOutsideFunction: false,
					allowSuperOutsideMethod: false,
					ecmaVersion: "latest",
					locations: true,
					preserveParens: true,
					ranges: false,
					sourceType: "module",
				})
			} catch (error) {
				self1.console.error(error)
				return null
			}
		})()
		if (!ast) { return }
		const lastStmt = ast.body.at(-1),
			codeRet = lastStmt
				? `${code.slice(0, lastStmt.start)}return [(${code
					.slice(lastStmt.start)})]`
				: "",
			lastStmtLoc = lastStmt?.loc,
			codeRetDeletions: Position[] = []
		if (lastStmtLoc) {
			const { start, end } = lastStmtLoc
			let column = 0
			// eslint-disable-next-line no-empty-pattern
			for (const { } of "return [(") {
				codeRetDeletions.push({
					column: start.column + column,
					line: start.line,
				})
				++column
			}
			if (start.line !== end.line) {
				column = 0
			}
			// eslint-disable-next-line no-empty-pattern
			for (const { } of ")]") {
				codeRetDeletions.push({
					column: end.column + column,
					line: end.line,
				})
				++column
			}
		}
		async function evaluate(
			script: string,
			deletions: readonly Position[] = [],
		): Promise<unknown> {
			const ctor = asyncFunction(self1)
			// eslint-disable-next-line new-cap
			return new ctor(
				DeveloperConsolePseudoterminal.contextVar,
				attachFunctionSourceMap(ctor, script, {
					deletions,
					source: "<stdin>",
				}),
			)(context)
		}
		const ret = await (
			async (): Promise<[] | [unknown] | null> => {
				if (codeRet) {
					try {
						const ret2: unknown = await evaluate(codeRet, codeRetDeletions)
						if (!Array.isArray(ret2) || ret2.length !== 1) {
							throw new Error(String(ret2))
						}
						return [ret2[0]]
					} catch (error) {
						if (!(error instanceof SyntaxError)) {
							self1.console.error(error)
							return null
						}
						self1.console.debug(error)
					}
				}
				try {
					await evaluate(code)
					return []
				} catch (error) {
					self1.console.error(error)
					return null
				}
			})()
		if (!ret) { return }
		self1.console.log(ret[0])
	}

	protected async syncBuffer(
		terminals: readonly Terminal[] = this.terminals,
		lock = true,
	): Promise<void> {
		const terminals0 = [...terminals]
		return new Promise((resolve, reject) => {
			acquireConditionally(
				this.lock,
				DeveloperConsolePseudoterminal.syncLock,
				lock,
				async () => {
					const writers = terminals0.map(async terminal => {
						const editor = this.#editors.get(terminal),
							info = await CursoredText.info(
								terminal,
								this.buffer.value,
								editor?.startX,
							),
							{ rows, buffer: { active } } = terminal,
							{ baseY } = active,
							startBaseY = editor?.startYMarker?.line ?? baseY,
							lastRenderEndY = editor?.renderEndY ?? 0,
							renderRows = Math.min(info.rows, rows),
							renderStartY = info.rows - renderRows,
							prerenderStartY = startBaseY + lastRenderEndY - baseY,
							skipPreRenderRows = Math.max(-prerenderStartY, 0),
							firstUp = renderRows - 1,
							secondUp = info.rows - 1 - info.cursor[1]
						await tWritePromise(
							terminal,
							`${ansi.cursor.position(
								1 + prerenderStartY + skipPreRenderRows,
								1 + (lastRenderEndY > 0 ? 0 : info.startX),
							)}${ansi.erase.display()}${info.lines.slice(
								lastRenderEndY + skipPreRenderRows,
								info.rows,
							).join(NORMALIZED_LINE_FEED)}${ansi.cursor.horizontalAbsolute(
								1 + (renderStartY > 0 ? 0 : info.startX),
							)}${firstUp > 0 ? ansi.cursor.up(firstUp) : ""
							}${ansi.erase.display()}${info.lines.slice(
								renderStartY,
								info.rows,
							).join(NORMALIZED_LINE_FEED)}${ansi.cursor.horizontalAbsolute(
								1 + (info.cursor[1] < renderStartY ? 0 : info.cursor[0]),
							)}${secondUp > 0 ? ansi.cursor.up(secondUp) : ""}`,
						)
						if (editor) { editor.renderEndY = info.rows - 1 }
					})
					resolve(Promise.all(writers).then(noop))
					await Promise.allSettled(writers)
				},
			).catch(reject)
		})
	}

	protected async write(
		events: readonly Log.Event[],
		terminals: readonly Terminal[] = this.terminals,
		lock = true,
	): Promise<void> {
		const terminals0 = [...terminals],
			text = `${ansi.erase.inLine() + normalizeText(events
				.map(event => this.format(event)).join("\n"))
				.replace(
					replaceAllRegex(NORMALIZED_LINE_FEED),
					`${NORMALIZED_LINE_FEED}${ansi.erase.inLine()}`,
				)}${NORMALIZED_LINE_FEED}`
		await acquireConditionally(
			this.lock,
			DeveloperConsolePseudoterminal.syncLock,
			lock,
			async () => {
				await Promise.allSettled(terminals0.map(async terminal => {
					const { buffer: { active } } = terminal,
						editor = this.#editors.get(terminal),
						{ baseY } = active,
						startBaseY = editor?.startYMarker?.line ?? baseY + active.cursorY
					await tWritePromise(terminal, `${ansi.cursor.position(
						1 + (startBaseY - baseY),
						1,
					)}${ansi.erase.display()}${text}`)
					this.#setEditor(terminal, {
						close() { this.startYMarker?.dispose() },
						renderEndY: 0,
						startX: active.cursorX,
						startYMarker: terminal.registerMarker(),
					})
				}))
				await this.syncBuffer(terminals0, false)
			},
		)
	}

	#setEditor(
		terminal: Terminal,
		editor?: DeveloperConsolePseudoterminal.$Editor,
	): void {
		this.#editors.get(terminal)?.close()
		if (editor) {
			this.#editors.set(terminal, editor)
		} else {
			this.#editors.delete(terminal)
		}
	}
}
export namespace DeveloperConsolePseudoterminal {
	export interface $Editor {
		readonly startX: number
		readonly startYMarker: IMarker | undefined
		renderEndY: number
		readonly close: () => void
	}
	export class Manager extends ResourceComponent<Manager.Type> {
		public constructor(protected readonly context: TerminalPlugin) { super() }

		protected override async load0(): Promise<Manager.Type> {
			const { context: { earlyPatch: { onLoaded } } } = this,
				{ log } = await onLoaded,
				ret = lazyInit(() => new RefPsuedoterminal(
					new DeveloperConsolePseudoterminal(activeSelf, log),
				))
			this.register(async () => ret().kill())
			// Cannot use `lazyProxy`, the below `return` accesses `ret.then`
			return ret
		}
	}
	export namespace Manager {
		export type Type = () => RefPsuedoterminal<DeveloperConsolePseudoterminal>
	}
}

export interface ShellPseudoterminalArguments {
	readonly executable: string
	readonly cwd?: URL | string | null
	readonly args?: readonly string[] | null
	readonly terminal?: string | null
	readonly pythonExecutable?: string | null
	readonly useWin32Conhost?: boolean | null
}

class WindowsPseudoterminal implements Pseudoterminal {
	public readonly shell
	public readonly conhost
	public readonly onExit
	protected readonly resizer

	public constructor(
		protected readonly context: TerminalPlugin,
		{
			args,
			cwd,
			executable,
			useWin32Conhost,
			pythonExecutable,
		}: ShellPseudoterminalArguments,
	) {
		this.conhost = useWin32Conhost ?? false
		const { conhost } = this,
			{ language: { value: i18n }, settings } = context,
			resizerInitial = (async (): Promise<PipedChildProcess | null> => {
				if (isNil(pythonExecutable)) { return null }
				const ret = await spawnPromise(async () =>
					(await childProcess).spawn(
						pythonExecutable,
						["-c", await win32ResizerPy],
						{
							env: {
								...(await process).env,
								// eslint-disable-next-line @typescript-eslint/naming-convention
								PYTHONIOENCODING: DEFAULT_PYTHONIOENCODING,
							},
							stdio: ["pipe", "pipe", "pipe"],
							windowsHide: true,
						},
					))
				try {
					ret.once("exit", (code, signal) => {
						if (code !== 0) {
							notice2(
								() => i18n.t(
									"errors.resizer-exited-unexpectedly",
									{
										code: code ?? signal,
										interpolation: { escapeValue: false },
									},
								),
								settings.value.errorNoticeTimeout,
								context,
							)
						}
					}).stderr.on("data", (chunk: Buffer | string) => {
						self.console.error(chunk.toString(DEFAULT_ENCODING))
					})
				} catch (error) { self.console.warn(error) }
				return ret
			})(),
			shell = (async (): Promise<readonly [
				PipedChildProcess,
				FileResult,
				typeof resizerInitial,
			]> => {
				const resizer = await resizerInitial.catch(() => null)
				try {
					const codeTmp = await (await tmpPromise)
						.file({ discardDescriptor: true })
					try {
						const
							cmd = deepFreeze([
								...conhost
									? [WINDOWS_CONHOST_PATH] as const
									: [] as const,
								WINDOWS_CMD_PATH,
								"/C",
								`${WindowsPseudoterminal.escapeArgument(executable)} ${(
									args ?? [])
									.map(arg => WindowsPseudoterminal.escapeArgument(arg))
									.join(" ")
								} & call echo %^ERRORLEVEL% >${WindowsPseudoterminal
									.escapeArgument(codeTmp.path)}`,
							]),
							ret = await spawnPromise(async () => (await childProcess).spawn(
								cmd[0],
								cmd.slice(1),
								{
									cwd: cwd ?? UNDEFINED,
									stdio: ["pipe", "pipe", "pipe"],
									windowsHide: !resizer,
									windowsVerbatimArguments: true,
								},
							))
						return [
							ret, codeTmp, resizerInitial.then(async resizer0 => {
								if (resizer0) {
									try {
										await writePromise(resizer0.stdin, `${ret.pid ?? -1}\n`)
										const watchdog = self.setInterval(
											() => {
												writePromise(resizer0.stdin, "\n")
													.catch(error => { self.console.debug(error) })
											},
											TERMINAL_RESIZER_WATCHDOG_WAIT * SI_PREFIX_SCALE,
										)
										resizer0.once(
											"exit",
											() => { self.clearInterval(watchdog) },
										)
									} catch (error) {
										resizer0.kill()
										throw error
									}
								}
								return resizer0
							}).catch(error => {
								const error0 = anyToError(error)
								printError(
									error0,
									() => i18n.t("errors.error-spawning-resizer"),
									context,
								)
								throw error0
							}),
						]
					} catch (error) {
						await codeTmp.cleanup()
						throw error
					}
				} catch (error) {
					resizer?.kill()
					throw error
				}
			})()
		this.resizer = shell.then(async ([, , resizer]) => resizer)
		this.shell = shell.then(([shell0]) => shell0)
		this.onExit = shell
			.then(async ([shell0, codeTmp]) =>
				new Promise<NodeJS.Signals | number>(resolve => {
					shell0.once("exit", (conCode, signal) => {
						resolve((async (): Promise<NodeJS.Signals | number> => {
							try {
								const termCode = parseInt(
									(await (await fsPromises).readFile(
										codeTmp.path,
										{ encoding: DEFAULT_ENCODING, flag: "r" },
									)).trim(),
									10,
								)
								return isNaN(termCode) ? conCode ?? signal ?? NaN : termCode
							} catch (error) {
								self.console.debug(error)
								return conCode ?? signal ?? NaN
							} finally {
								(async (): Promise<void> => {
									try {
										await sleep2(self, TERMINAL_EXIT_CLEANUP_WAIT)
										await codeTmp.cleanup()
									} catch (error) { self.console.warn(error) }
								})()
							}
						})())
					})
				}))
	}

	protected static escapeArgument(arg: string, shell = false): string {
		const ret = `"${arg.replace(replaceAllRegex("\""), "\\\"")}"`
		return shell ? ret.replace(/(?<meta>[()%!^"<>&|])/ug, "^$<meta>") : ret

		/*
		 * Replace 1: quote argument
		 * Replace 2: escape cmd.exe metacharacters
		 */
	}

	public async kill(): Promise<void> {
		if (!(await this.shell).kill()) {
			throw new Error(this.context.language
				.value.t("errors.error-killing-pseudoterminal"))
		}
	}

	public async resize(columns: number, rows: number): Promise<void> {
		const { resizer, context: plugin } = this,
			resizer0 = await resizer
		if (!resizer0) {
			throw new Error(plugin.language.value.t("errors.resizer-disabled"))
		}
		await writePromise(resizer0.stdin, `${columns}x${rows}\n`)
	}

	public async pipe(terminal: Terminal): Promise<void> {
		let init = !this.conhost
		const shell = await this.shell,
			reader = (chunk: Buffer | string): void => {
				if (!init) {
					init = true
					return
				}
				tWritePromise(terminal, chunk).catch(error => {
					activeSelf(terminal.element).console.error(error)
				})
			}
		await clearTerminal(terminal, true)
		terminal.loadAddon(new DisposerAddon(
			() => { shell.stdout.removeListener("data", reader) },
			() => { shell.stderr.removeListener("data", reader) },
		))
		shell.stdout.on("data", reader)
		shell.stderr.on("data", reader)
		const writer =
			terminal.onData(async data => writePromise(shell.stdin, data))
		this.onExit.catch(() => { }).finally(() => { writer.dispose() })
	}
}

class UnixPseudoterminal implements Pseudoterminal {
	static readonly #cmdio = 3
	public readonly shell
	public readonly onExit

	public constructor(
		protected readonly context: TerminalPlugin,
		{
			args,
			cwd,
			executable,
			terminal,
			pythonExecutable,
		}: ShellPseudoterminalArguments,
	) {
		const { language } = context
		this.shell = spawnPromise(async () => {
			if (isNil(pythonExecutable)) {
				throw new Error(language
					.value.t("errors.no-Python-to-spawn-Unix-pseudoterminal"))
			}
			const env: NodeJS.ProcessEnv = {
				...(await process).env,
				// eslint-disable-next-line @typescript-eslint/naming-convention
				PYTHONIOENCODING: DEFAULT_PYTHONIOENCODING,
			}
			if (!isNil(terminal)) { env["TERM"] = terminal }
			return (await childProcess).spawn(
				pythonExecutable,
				["-c", await unixPseudoterminalPy, executable].concat(args ?? []),
				{
					cwd: cwd ?? UNDEFINED,
					env,
					stdio: ["pipe", "pipe", "pipe", "pipe"],
					windowsHide: true,
				},
			)
		}).then(ret => {
			try {
				ret.stderr.on("data", (chunk: Buffer | string) => {
					self.console.error(chunk.toString(DEFAULT_ENCODING))
				})
			} catch (error) { self.console.warn(error) }
			return ret
		})
		this.onExit = this.shell
			.then(async shell =>
				new Promise<NodeJS.Signals | number>(resolve => {
					shell.once("exit", (code, signal) => {
						resolve(code ?? signal ?? NaN)
					})
				}))
	}

	public async kill(): Promise<void> {
		if (!(await this.shell).kill()) {
			throw new Error(this.context.language
				.value.t("errors.error-killing-pseudoterminal"))
		}
	}

	public async pipe(terminal: Terminal): Promise<void> {
		const shell = await this.shell,
			reader = (chunk: Buffer | string): void => {
				tWritePromise(terminal, chunk).catch(error => {
					activeSelf(terminal.element).console.error(error)
				})
			}
		await clearTerminal(terminal, true)
		terminal.loadAddon(new DisposerAddon(
			() => { shell.stdout.removeListener("data", reader) },
			() => { shell.stderr.removeListener("data", reader) },
		))
		shell.stdout.on("data", reader)
		shell.stderr.on("data", reader)
		const writer =
			terminal.onData(async data => writePromise(shell.stdin, data))
		this.onExit.catch(() => { }).finally(() => { writer.dispose() })
	}

	public async resize(columns: number, rows: number): Promise<void> {
		const cmdio = (await this.shell).stdio[UnixPseudoterminal.#cmdio]
		if (!(cmdio instanceof (await stream).Writable)) {
			throw new TypeError(String(cmdio))
		}
		await writePromise(cmdio, `${columns}x${rows}\n`)
	}
}

export namespace Pseudoterminal {
	export const PLATFORM_PSEUDOTERMINALS = deepFreeze({
		darwin: UnixPseudoterminal,
		linux: UnixPseudoterminal,
		win32: WindowsPseudoterminal,
	})
	export type SupportedPlatforms = readonly ["darwin", "linux", "win32"]
	export const SUPPORTED_PLATFORMS =
		typedKeys<SupportedPlatforms>()(PLATFORM_PSEUDOTERMINALS)
	export const PLATFORM_PSEUDOTERMINAL =
		inSet(SUPPORTED_PLATFORMS, Platform.CURRENT)
			? PLATFORM_PSEUDOTERMINALS[deopaque(Platform.CURRENT)]
			: null
}
