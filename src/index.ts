import { MemoryFileSystem, ZeroPerl } from "@6over3/zeroperl-ts";
import exiftool from "./exiftool" with { type: "text" };
import { StringBuilder } from "./sb";

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

/**
 * Cached ZeroPerl instance and filesystem using WeakRef
 */
let cachedPerlRef: WeakRef<ZeroPerl> | null = null;
let cachedFileSystemRef: WeakRef<MemoryFileSystem> | null = null;

/**
 * Global output buffers
 */
const stdout = new StringBuilder();
const stderr = new StringBuilder();
const decoder = new TextDecoder();

/**
 * Get or create the shared ZeroPerl instance
 */
async function getZeroPerl(
	fetchFn?: FetchLike,
): Promise<{ perl: ZeroPerl; fileSystem: MemoryFileSystem }> {
	let cachedPerl = cachedPerlRef?.deref();
	let cachedFileSystem = cachedFileSystemRef?.deref();

	if (cachedPerl && cachedFileSystem) {
		return { perl: cachedPerl, fileSystem: cachedFileSystem };
	}

	cachedFileSystem = new MemoryFileSystem({ "/": "" });
	cachedFileSystem.addFile("/exiftool", exiftool);

	cachedPerl = await ZeroPerl.create({
		fileSystem: cachedFileSystem,
		stdout: (data) => {
			const str = typeof data === "string" ? data : decoder.decode(data);
			stdout.append(str);
		},
		stderr: (data) => {
			const str = typeof data === "string" ? data : decoder.decode(data);
			stderr.append(str);
		},
		fetch: fetchFn,
	});

	cachedPerlRef = new WeakRef(cachedPerl);
	cachedFileSystemRef = new WeakRef(cachedFileSystem);

	return { perl: cachedPerl, fileSystem: cachedFileSystem };
}

/**
 * Clean up temporary files from the filesystem
 */
function cleanupTempFiles(fileSystem: MemoryFileSystem, paths: string[]): void {
	for (const path of paths) {
		try {
			fileSystem.removeFile(path);
		} catch {
			// Ignore errors if file doesn't exist
		}
	}
}

/**
 * Transform tags object into ExifTool command-line arguments
 */
function transformTags(tags: ExifTags): string[] {
	return Object.entries(tags).flatMap(([name, value]) =>
		Array.isArray(value)
			? value.map((value) => `-${name}=${value}`)
			: [`-${name}=${value}`],
	);
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
	const { perl, fileSystem } = await getZeroPerl(options.fetch);
	const tempFiles: string[] = [];

	stdout.clear();
	stderr.clear();
	await perl.reset();

	try {
		const inputPath = `/${file.name}`;
		if (file instanceof File) {
			fileSystem.addFile(inputPath, file);
		} else {
			fileSystem.addFile(inputPath, file.data);
		}
		tempFiles.push(inputPath);

		const args = [...(options.args || [])];

		if (options.config) {
			const configPath = `/${options.config.name}`;
			if (options.config instanceof File) {
				fileSystem.addFile(configPath, options.config);
			} else {
				fileSystem.addFile(configPath, options.config.data);
			}
			tempFiles.push(configPath);
			args.push(`-config`, configPath);
		}

		args.push(inputPath);

		const result = await perl.runFile("/exiftool", args);
		perl.flush();

		const stderrContent = stderr.toString();
		const stdoutContent = stdout.toString();

		if (!result.success || result.exitCode !== 0) {
			const perlError = perl.getLastError();

			return {
				success: false,
				data: undefined,
				error: perlError || stderrContent || "Unknown error",
				exitCode: result.exitCode,
			};
		}

		if (stderrContent && stderrContent.trim()) {
			return {
				success: false,
				data: undefined,
				error: stderrContent,
				exitCode: 0,
			};
		}

		if (!stdoutContent || !stdoutContent.trim()) {
			return {
				success: false,
				data: undefined,
				error: "No output data from ExifTool",
				exitCode: 0,
			};
		}

		let data: TReturn;
		if (options.transform) {
			data = options.transform(stdoutContent);
		} else {
			data = stdoutContent as unknown as TReturn;
		}

		return {
			success: true,
			data: data,
			exitCode: 0,
		};
	} finally {
		cleanupTempFiles(fileSystem, tempFiles);
	}
}

/**
 * Write metadata to a file using ExifTool
 *
 * This function modifies an existing file by writing new metadata tags or updating existing ones.
 * The operation runs entirely in the browser using WebAssembly without requiring server uploads.
 *
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
 *     // result.data contains the modified file as ArrayBuffer
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
 * - The returned ArrayBuffer can be converted to a Blob for download or further processing
 *
 * @see {@link https://exiftool.org/TagNames/index.html} for complete tag reference
 * @see {@link parseMetadata} for reading metadata from files
 */
export async function writeMetadata(
	file: Binaryfile | File,
	tags: ExifTags,
	options: ExifToolOptions = {},
): Promise<ExifToolOutput<ArrayBuffer>> {
	const { perl, fileSystem } = await getZeroPerl(options.fetch);
	const tempFiles: string[] = [];

	stdout.clear();
	stderr.clear();
	await perl.reset();

	try {
		const inputPath = `/${file.name}`;
		if (file instanceof File) {
			fileSystem.addFile(inputPath, file);
		} else {
			fileSystem.addFile(inputPath, file.data);
		}
		tempFiles.push(inputPath);

		const args = [...(options.args || [])];

		if (options.config) {
			const configPath = `/${options.config.name}`;
			if (options.config instanceof File) {
				fileSystem.addFile(configPath, options.config);
			} else {
				fileSystem.addFile(configPath, options.config.data);
			}
			tempFiles.push(configPath);
			args.push(`-config`, configPath);
		}

		args.push(...transformTags(tags));

		const tempFile = `/${crypto.randomUUID().replace(/-/g, "")}.tmp`;
		tempFiles.push(tempFile);

		args.push("-o", tempFile);
		args.push(inputPath);

		const result = await perl.runFile("/exiftool", args);
		perl.flush();

		const stderrContent = stderr.toString();

		if (!result.success || result.exitCode !== 0) {
			const perlError = perl.getLastError();

			return {
				success: false,
				data: undefined,
				error: perlError || stderrContent || "Unknown error",
				exitCode: result.exitCode,
			};
		}

		if (stderrContent && stderrContent.trim()) {
			return {
				success: false,
				data: undefined,
				error: stderrContent,
				exitCode: 0,
			};
		}

		const node = fileSystem.lookup(tempFile);
		if (!node || node.type !== "file") {
			return {
				success: false,
				data: undefined,
				error: `Temporary output file not found: ${tempFile}`,
				exitCode: 0,
			};
		}

		const outputData =
			node.content instanceof Blob
				? await node.content.arrayBuffer()
				: (node.content.buffer as ArrayBuffer);

		return {
			success: true,
			data: outputData,
			exitCode: 0,
		};
	} finally {
		cleanupTempFiles(fileSystem, tempFiles);
	}
}

/**
 * Dispose of the cached ZeroPerl instance
 */
export async function dispose(): Promise<void> {
	const cachedPerl = cachedPerlRef?.deref();

	if (cachedPerl) {
		cachedPerl.dispose();
		cachedPerlRef = null;
		cachedFileSystemRef = null;
	}
}
