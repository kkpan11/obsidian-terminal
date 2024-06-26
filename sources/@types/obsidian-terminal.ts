/**
 * Public API for `obsidian-terminal`.
 */
declare module "obsidian-terminal" {

	/**
	 * Type of `$$` in the developer console.
	 */
	interface DeveloperConsoleContext {

		/**
		 * Depth to expanded nested objects up to.
		 *
		 * @default 0
		 */
		depth: number

		/**
		 * Terminals connected to the developer console.
		 */
		readonly terminals: readonly Terminal[]
	}
}
import type { } from "obsidian-terminal"
import type { Terminal } from "@xterm/xterm"
