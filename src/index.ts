import exiftool from "./exiftool" with { type: "text" };
import { StringBuilder } from "./sb";
import {
	useArgs,
	useClock,
	useEnviron,
	useProc,
	useRandom,
	WASI,
} from "./wasi";
import { instantiate } from "./wasi/asyncify";
import { MemoryFileSystem, useMemoryFS } from "./wasi/features/fd";
import type { WASIOptions } from "./wasi/options";
import zeroperl from "./zeroperl.wasm" with { type: "wasm" };

type FetchLike = (...args: unknown[]) => Promise<Response>;
export type ExifTags = Record<
	string,
	string | number | boolean | (string | number | boolean)[]
>;

/**
 * Configuration options for parsing file metadata with ExifTool
 * @template TransformReturn The type of the transformed output data
 */
export interface ExifToolOptions<TransformReturn = unknown> {
	/**
	 * Additional command-line arguments to pass to ExifTool
	 *
	 * @example
	 * // Extract specific tags
	 * args: ["-Author", "-CreateDate"]
	 *
	 * @example
	 * // Output as JSON
	 * args: ["-json", "-n"]
	 *
	 * @see https://exiftool.org/exiftool_pod.html for all available options
	 */
	args?: string[];

	/**
	 * Custom fetch implementation for loading the WASM module
	 *
	 * Only needed for environments with custom fetch polyfills
	 */
	fetch?: FetchLike;

	/**
	 * Transform the raw ExifTool output into a different format
	 *
	 * @example
	 * // Parse output as JSON
	 * transform: (data) => JSON.parse(data)
	 */
	transform?: (data: string) => TransformReturn;

	/**
	 * The ExifTool_config
	 */
	config?: Binaryfile | File;
}

const textDecoder = new TextDecoder();

/**
 * Represents a binary file for metadata extraction
 */
type Binaryfile = {
	/** Filename with extension (e.g., "image.jpg") */
	name: string;
	/** The binary content of the file */
	data: Uint8Array | Blob;
};

/**
 * Result of an ExifTool metadata extraction operation
 * @template TOutput The type of the output data after transformation
 */
type ExifToolOutput<TOutput> =
	| {
			/** True when metadata was successfully extracted */
			success: true;
			/** The extracted metadata, transformed if a transform function was provided */
			data: TOutput;
			/** Any warnings or info messages from ExifTool */
			error: string;
			/** Always 0 for success */
			exitCode: 0;
	  }
	| {
			/** False when metadata extraction failed */
			success: false;
			/** No data available on failure */
			data: undefined;
			/** Error message explaining why the operation failed */
			error: string;
			/** Non-zero exit code indicating the type of failure */
			exitCode: number | undefined;
	  };

// Cache for the loaded WASM module using WeakRef
let wasmModuleCache: WeakRef<ArrayBuffer> | null = null;

/**
 * Detect if running in a browser environment
 */
function isBrowser(): boolean {
	return typeof window !== "undefined" && typeof document !== "undefined";
}

/**
 * Load WASM module for the current runtime (with caching)
 */
async function loadWasmModule(
	fetchFn?: FetchLike,
): Promise<ArrayBuffer> {
	// Check cache first
	if (wasmModuleCache) {
		console.log('Checking WASM module cache');
		const cached = wasmModuleCache.deref();
		if (cached) {
			console.log('Using cached WASM module');
			return cached;
		}
	}

	let moduleData: ArrayBuffer;

	if (isBrowser()) {
		console.log('Loading WASM module in browser');
		const f = fetchFn ?? fetch;
		const response = await f(zeroperl);
		moduleData = await response.arrayBuffer();;
	} else {
		// Non-browser: load from filesystem
		const wasmPath = typeof zeroperl === "string" ? zeroperl : "./zeroperl.wasm";

		// Deno
		//@ts-expect-error
		if (typeof Deno !== "undefined") {
			// @ts-expect-error
			moduleData = (await Deno.readFile(wasmPath)).buffer;
		}
		// Bun
		else if (typeof Bun !== "undefined") {
			const file = Bun.file(wasmPath);
			moduleData = await file.arrayBuffer();

		}
		// Node.js
		else {
			const { readFile } = await import("node:fs/promises");
			moduleData = (await readFile(wasmPath)).buffer;
		}
	}

	// Cache the result using WeakRef
	wasmModuleCache = new WeakRef(moduleData);

	return moduleData;
}

/**
 * Instantiate WASM module
 */
async function instantiateWasmModule(
	fetchFn: FetchLike | undefined,
	importObject: WebAssembly.Imports,
) {
	const source = await loadWasmModule(fetchFn);
	return await instantiate(source, importObject);
}

/**
 * Extract metadata from a file using ExifTool
 *
 * @template TReturn Type of the returned data after transformation (defaults to string)
 * @param file File to extract metadata from
 * @param options Configuration options
 * @returns Promise resolving to the extraction result
 *
 * @example
 * // Basic usage with browser File object
 * const input = document.querySelector('input[type="file"]');
 * input.addEventListener('change', async () => {
 *   const file = input.files[0];
 *   const result = await parseMetadata(file);
 *   if (result.success) {
 *     console.log(result.data); // Raw ExifTool output as string
 *   }
 * });
 *
 * @example
 * // Extract specific tags and transform to JSON
 * const result = await parseMetadata(file, {
 *   args: ["-json"],
 *   transform: (data) => JSON.parse(data)
 * });
 * if (result.success) {
 *   console.log(result.data); // Typed access to specific metadata
 * }
 */
export async function parseMetadata<TReturn = string>(
	file: Binaryfile | File,
	options: ExifToolOptions<TReturn> = {},
): Promise<ExifToolOutput<TReturn>> {
	const fileSystem = new MemoryFileSystem({
		"/": "",
	});

	fileSystem.addFile("/exiftool", exiftool);
	if (file instanceof File) {
		fileSystem.addFile(`/${file.name}`, file);
	} else {
		fileSystem.addFile(`/${file.name}`, file.data);
	}
	if (options.config) {
		if (options.config instanceof File) {
			fileSystem.addFile(`/${options.config.name}`, options.config);
		} else {
			fileSystem.addFile(`/${options.config.name}`, options.config.data);
		}
		options.args = options.args || [];
		options.args.push(`-config=${options.config.name}`);
	}
	const stdout = new StringBuilder();
	const stderr = new StringBuilder();
	const args = ["zeroperl", "exiftool"].concat(options.args || []);
	args.push(`/${file.name}`);
	const wasiOptions: WASIOptions = {
		env: {},
		args: args,
		features: [
			useEnviron,
			useArgs,
			useRandom,
			useClock,
			useProc,
			useMemoryFS({
				withFileSystem: fileSystem,
				withStdIo: {
					stdout: (str) => {
						let data: string;
						if (ArrayBuffer.isView(str)) {
							data = textDecoder.decode(str);
						} else {
							data = str;
						}
						if (StringBuilder.isMultiline(data)) {
							stdout.append(data);
						} else {
							stdout.appendLine(data);
						}
					},
					stderr: (str) => {
						let data: string;
						if (ArrayBuffer.isView(str)) {
							data = textDecoder.decode(str);
						} else {
							data = str;
						}
						if (StringBuilder.isMultiline(data)) {
							stderr.append(data);
						} else {
							stderr.appendLine(data);
						}
					},
				},
			}),
		],
	};
	const wasi = new WASI(wasiOptions);
	const { instance } = await instantiateWasmModule(options.fetch, {
		wasi_snapshot_preview1: wasi.wasiImport,
	});
	const exitCode = await wasi.start(instance);
	if (exitCode !== 0) {
		return {
			success: false,
			data: undefined,
			error: stderr.toString(),
			exitCode,
		};
	}
	let data: TReturn;
	if (options.transform) {
		data = options.transform(stdout.toString());
	} else {
		data = stdout.toString() as unknown as TReturn;
	}
	return {
		success: true,
		data: data,
		error: stderr.toString(),
		exitCode,
	};
}

function transformTags(tags: ExifTags): string[] {
	return Object.entries(tags).flatMap(([name, value]) =>
		Array.isArray(value)
			? value.map((value) => `-${name}=${value}`)
			: [`-${name}=${value}`],
	);
}

/**
 * Write metadata to a file using ExifTool
 *
 * This function modifies an existing file by writing new metadata tags or updating existing ones.
 * The operation runs entirely in the browser using WebAssembly without requiring server uploads.
 *
 * @template TReturn Type of the returned data after transformation (defaults to Uint8Array)
 * @param file File to write metadata to (Browser File object or Binaryfile)
 * @param tags Object containing metadata tags to write, where keys are tag names and values are tag values
 * @param options Configuration options for the write operation
 * @returns Promise resolving to the write operation result containing the modified file data
 *
 * @example
 * // Basic usage with browser File object
 * const input = document.querySelector('input[type="file"]');
 * input.addEventListener('change', async () => {
 *   const file = input.files[0];
 *   const result = await writeMetadata(file, {
 *     'Author': 'John Doe',
 *     'Title': 'My Photo',
 *     'Keywords': 'nature,photography'
 *   });
 *
 *   if (result.success) {
 *     // result.data contains the modified file as Uint8Array
 *     const modifiedBlob = new Blob([result.data]);
 *     // Save or use the modified file
 *   }
 * });
 *
 * @example
 * // Writing multiple tag types
 * const result = await writeMetadata(file, {
 *   'Author': 'Jane Smith',
 *   'Rating': 5,
 *   'Keywords': ['landscape', 'sunset', 'beach'],
 *   'GPS:GPSLatitude': 40.7128,
 *   'GPS:GPSLongitude': -74.0060,
 *   'EXIF:Copyright': '© 2025 Jane Smith'
 * });
 *
 * @example
 * // Using with custom ExifTool config
 * const result = await writeMetadata(file, tags, {
 *   config: configFile,
 *   args: ['-overwrite_original', '-P']
 * });
 *
 * @example
 * // Handle errors properly
 * try {
 *   const result = await writeMetadata(file, tags);
 *   if (result.success) {
 *     console.log('Metadata written successfully');
 *     downloadFile(result.data, `modified_${file.name}`);
 *   } else {
 *     console.error('Write failed:', result.error);
 *   }
 * } catch (error) {
 *   console.error('Operation failed:', error);
 * }
 *
 * @remarks
 * - The function creates a temporary output file internally and returns its contents
 * - Original file is not modified in place; a new file with metadata is generated
 * - Supports all ExifTool-compatible metadata formats (EXIF, IPTC, XMP, etc.)
 * - Tag names should follow ExifTool conventions (e.g., 'EXIF:Artist', 'XMP:Creator')
 * - Array values in tags are automatically converted to multiple ExifTool arguments
 * - The returned Uint8Array can be converted to a Blob for download or further processing
 *
 * @see {@link https://exiftool.org/TagNames/index.html} for complete tag reference
 * @see {@link parseMetadata} for reading metadata from files
 *
 * @since 1.0.4
 */
export async function writeMetadata(
	file: Binaryfile | File,
	tags: ExifTags,
	options: ExifToolOptions = {},
): Promise<ExifToolOutput<ArrayBuffer>> {
	const fileSystem = new MemoryFileSystem({
		"/": "",
	});

	const args = options.args || [];

	fileSystem.addFile("/exiftool", exiftool);
	if (file instanceof File) {
		fileSystem.addFile(`/${file.name}`, file);
	} else {
		fileSystem.addFile(`/${file.name}`, file.data);
	}

	if (options.config) {
		if (options.config instanceof File) {
			fileSystem.addFile(`/${options.config.name}`, options.config);
		} else {
			fileSystem.addFile(`/${options.config.name}`, options.config.data);
		}
		args.push(`-config=${options.config.name}`);
	}

	args.push(...transformTags(tags));
	const tempFile = `/${crypto.randomUUID().replace(/-/g, "")}.tmp`;

	const exiftoolArgs = ["zeroperl", "exiftool"];
	exiftoolArgs.push(...args);
	exiftoolArgs.push("-o", tempFile);
	exiftoolArgs.push(`/${file.name}`);

	const stdout = new StringBuilder();
	const stderr = new StringBuilder();

	const wasiOptions: WASIOptions = {
		env: {},
		args: exiftoolArgs,
		features: [
			useEnviron,
			useArgs,
			useRandom,
			useClock,
			useProc,
			useMemoryFS({
				withFileSystem: fileSystem,
				withStdIo: {
					stdout: (str) => {
						let data: string;
						if (ArrayBuffer.isView(str)) {
							data = textDecoder.decode(str);
						} else {
							data = str;
						}
						if (StringBuilder.isMultiline(data)) {
							stdout.append(data);
						} else {
							stdout.appendLine(data);
						}
					},
					stderr: (str) => {
						let data: string;
						if (ArrayBuffer.isView(str)) {
							data = textDecoder.decode(str);
						} else {
							data = str;
						}
						if (StringBuilder.isMultiline(data)) {
							stderr.append(data);
						} else {
							stderr.appendLine(data);
						}
					},
				},
			}),
		],
	};
	const wasi = new WASI(wasiOptions);
	
	const { instance } = await instantiateWasmModule(options.fetch, {
		wasi_snapshot_preview1: wasi.wasiImport,
	});

	const exitCode = await wasi.start(instance);

	if (exitCode !== 0) {
		return {
			success: false,
			data: undefined,
			error: stderr.toString(),
			exitCode,
		};
	}

	const node = fileSystem.lookup(tempFile);
	if (!node || node.type !== "file") {
		return {
			success: false,
			data: undefined,
			error: `Temporary output file not found: ${tempFile}`,
			exitCode,
		};
	}

	const outputData =
		node.content instanceof Blob
			? await node.content.arrayBuffer()
			: (node.content.buffer as ArrayBuffer);
	return {
		success: true,
		data: outputData,
		error: stderr.toString(),
		exitCode,
	};
}