// wasm-text-imports.d.ts

/**
 * Type declarations for WASM module imports
 * Supports import assertions with { type: "wasm" }
 */
declare module "*.wasm" {
	/**
	 * WASM module import - resolves to a URL string in browsers
	 * or the file path in Node.js/Deno/Bun environments
	 */
	const content: string;
	export default content;
}

/**
 * Type declarations for text file imports
 * Supports import assertions with { type: "text" }
 */
declare module "*.txt" {
	/**
	 * Text file content as a string
	 */
	const content: string;
	export default content;
}

/**
 * Generic text import support for files imported with { type: "text" }
 */
declare module "*" {
	/**
	 * Any file imported with { type: "text" } assertion
	 */
	const content: string;
	export default content;
}