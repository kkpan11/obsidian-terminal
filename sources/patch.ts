import type { App, Workspace } from "obsidian"
import {
	EventEmitterLite,
	Functions,
	ResourceComponent,
	aroundIdentityFactory,
	correctType,
	deepFreeze,
	dynamicRequireSync,
} from "@polyipseity/obsidian-plugin-library"
import { BUNDLE } from "./import.js"
import { around } from "monkey-around"
import { noop } from "ts-essentials"

export class Log {
	public readonly logger = new EventEmitterLite<readonly [Log.Event]>()
	readonly #history: Log.Event[] = []

	public constructor() {
		this.logger.listen(event => this.#history.push(event))
	}

	public get history(): readonly Log.Event[] {
		return this.#history
	}
}
export namespace Log {
	export type Event = { readonly type: Event.Type } & (
		{
			readonly type: "debug" | "error" | "info" | "warn"
			readonly data: readonly unknown[]
		} | {
			readonly type: "unhandledRejection"
			readonly data: PromiseRejectionEvent
		} | {
			readonly type: "windowError"
			readonly data: ErrorEvent
		}
	)
	export namespace Event {
		export const TYPES = deepFreeze([
			"info",
			"error",
			"warn",
			"debug",
			"windowError",
			"unhandledRejection",
		])
		export type Type = typeof TYPES[number]
		export type Typed<T extends Type> = Event & { readonly type: T }
	}
}

function patchLoggingConsole(console: Console, log: Log): () => void {
	const consolePatch = (
		type: "debug" | "error" | "info" | "warn",
		proto: (this: typeof console, ...data: readonly unknown[]) => void,
	): typeof proto => {
		let recursive = false
		return function fn(
			this: typeof console,
			...data: readonly unknown[]
		): void {
			if (recursive) { return }
			recursive = true
			try {
				try {
					log.logger.emit({ data, type }).catch(noop)
				} catch (error) {
					console.error(error)
				} finally {
					Reflect.apply(proto, this, data)
				}
			} finally {
				recursive = false
			}
		}
	}
	return around(console, {
		debug(proto) { return consolePatch("debug", proto) },
		error(proto) { return consolePatch("error", proto) },
		log(proto) { return consolePatch("info", proto) },
		warn(proto) { return consolePatch("warn", proto) },
	})
}

function patchLoggingWindow(self0: Window, log: Log): () => void {
	const
		onWindowError = (error: ErrorEvent): void => {
			log.logger.emit({
				data: error,
				type: "windowError",
			}).catch(noop)
		},
		onUnhandledRejection = (error: PromiseRejectionEvent): void => {
			log.logger.emit({
				data: error,
				type: "unhandledRejection",
			}).catch(noop)
		},
		ret = new Functions(
			{ async: false, settled: true },
			() => {
				self0.removeEventListener("error", onWindowError, { capture: true })
			},
			() => {
				self0.removeEventListener(
					"unhandledrejection",
					onUnhandledRejection,
					{ capture: true },
				)
			},
		)
	try {
		self0.addEventListener("error", onWindowError, {
			capture: true,
			passive: true,
		})
		self0.addEventListener("unhandledrejection", onUnhandledRejection, {
			capture: true,
			passive: true,
		})
		return () => { ret.call() }
	} catch (error) {
		ret.call()
		throw error
	}
}

function patchLogging(
	self0: Window & typeof globalThis,
	log: Log,
): () => void {
	const ret = new Functions({ async: false, settled: true })
	try {
		ret.push(patchLoggingConsole(self0.console, log))
		ret.push(patchLoggingWindow(self0, log))
		return () => { ret.call() }
	} catch (error) {
		ret.call()
		throw error
	}
}

function patchRequire(self0: typeof globalThis): () => void {
	return around(self0, {
		require(proto) {
			return Object.assign(function fn(
				this: typeof self0,
				id: string,
			): unknown {
				try {
					return proto.call(this, id)
				} catch (error) {
					self0.console.debug(error)
					return dynamicRequireSync(BUNDLE, id)
				}
			}, proto)
		},
		toString: aroundIdentityFactory(),
	})
}

function patchWindows(
	workspace: Workspace,
	patcher: (
		self0: Window & typeof globalThis,
	) => (self0: Window & typeof globalThis) => void,
): () => void {
	const ret = new Functions({ async: false, settled: true })
	try {
		const oner = workspace.on("window-open", window => {
			const win0 = correctType(window.win),
				unpatch = patcher(win0)
			try {
				const offer = workspace.on("window-close", window0 => {
					if (window0 !== window) { return }
					try { unpatch(win0) } finally { workspace.offref(offer) }
				})
			} catch (error) {
				unpatch(win0)
				throw error
			}
		})
		ret.push(() => { workspace.offref(oner) })
		const unpatch = patcher(self)
		ret.push(() => { unpatch(self) })
		return () => { ret.call() }
	} catch (error) {
		ret.call()
		throw error
	}
}

export interface EarlyPatch {
	readonly log: Log
}
function patch(app: App): EarlyPatch & {
	readonly unpatch: () => void
} {
	const unpatch = new Functions({ async: false, settled: true })
	try {
		const { workspace } = app,
			log = new Log()
		unpatch.push(patchWindows(workspace, self0 => patchLogging(self0, log)))
		unpatch.push(patchWindows(workspace, patchRequire))
		return Object.freeze({
			log,
			unpatch() { unpatch.call() },
		})
	} catch (error) {
		unpatch.call()
		throw error
	}
}

export class EarlyPatchManager extends ResourceComponent<EarlyPatch> {
	#loaded = false

	public constructor(
		protected readonly app: App,
	) { super() }

	public override load(): void {
		if (this.#loaded) { return }
		super.load()
		this.register(() => { this.#loaded = false })
		this.#loaded = true
	}

	protected override load0(): EarlyPatch {
		const ret = patch(this.app)
		this.register(ret.unpatch)
		return ret
	}
}