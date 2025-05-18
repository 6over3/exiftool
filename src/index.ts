import exiftool from "./ex";
import { MemoryFileSystem, useMemoryFS } from "./wasi/features/fd";
import {
  useArgs,
  useClock,
  useEnviron,
  useProc,
  useRandom,
  WASI,
  WASIProcExit,
} from "./wasi";
import { instantiateStreaming } from "./wasi/asyncify";
import { WASIOptions } from "./wasi/options";
import { StringBuilder } from "./sb";

const cdn = "https://perl.objex.ai/zeroperl-1.0.0.wasm";
type FetchLike = (...args: any[]) => Promise<Response>;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Configuration options for parsing file metadata with ExifTool
 * @template TReturn The type of the transformed output data
 */
interface ExifToolOptions<TReturn> {
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
  transform?: (data: string) => TReturn;
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

// Types for supporting JSON object input for tags in writeMetadata
/** Defines possible values for a tag when using `TagsObject`. */
type TagValue = string | number | boolean | (string | number | boolean)[];

/**
 * Represents tags as a JavaScript object for writing metadata.
 * Keys are tag names (e.g., "Comment", "IPTC:Keywords"), and values are the data.
 * @example { "IPTC:Credit": "Photographer", "IPTC:Keywords": ["test", "keyword"] }
 */
type TagsObject = Record<string, TagValue>;

/** Configuration options for writing file metadata with ExifTool. */
interface ExifToolWriteOptions {
  /**
   * Tags to write to the file. Can be provided in two formats:
   * 1. An array of strings, where each string is a complete ExifTool tag assignment argument.
   * Example: `["-Comment=My Description", "-Artist=John Doe"]`
   * 2. A JavaScript object (`TagsObject`) where keys are tag names and values are the data.
   * Example: `{ "Comment": "My Description", "IPTC:Keywords": ["test", "image"] }`
   * This object will be transformed into individual tag assignment arguments.
   *
   * @see https://exiftool.org/exiftool_pod.html#Writing-Meta-Information for tag names and values.
   */
  tags: string[] | TagsObject;
  /** Optional: Custom ExifTool config file for defining custom tags. */
  configFile?: {
    name: string; // Filename for the config file in the virtual FS (e.g., "my.config")
    data: Uint8Array; // Binary content of the config file
  };
  /** Custom fetch implementation. */
  fetch?: FetchLike;
  /**
   * Additional command-line arguments for ExifTool (e.g., `-m` for ignore minor errors).
   * Avoid input/output filenames or tag assignments here.
   * For importing from a JSON file via ExifTool's `-j=JSONFILE`, ensure the file is in
   * the virtual FS and pass `"-j=/path/to/yourfile.json"` here.
   */
  extraArgs?: string[];
}

/**
 * Result of an ExifTool metadata writing operation
 */
type ExifToolWriteResult =
  | {
      /** True when metadata was successfully written */
      success: true;
      /** The binary data of the modified file */
      data: Uint8Array;
      /** Any warnings or info messages from ExifTool (stderr) */
      warnings: string;
      /** Always 0 for success */
      exitCode: 0;
    }
  | {
      /** False when metadata writing failed */
      success: false;
      /** No data available on failure */
      data: undefined;
      /** Error message explaining why the operation failed (stderr) */
      error: string;
      /** Non-zero exit code indicating the type of failure */
      exitCode: number | undefined;
    };

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
async function parseMetadata<TReturn = string>(
  file: Binaryfile | File,
  options: ExifToolOptions<TReturn> = {}
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
  const stdout = new StringBuilder();
  const stderr = new StringBuilder();
  const args = ["zeroperl", "exiftool"].concat(options.args || []);
  args.push(`/${file.name}`);
  const wasiOptions: WASIOptions = {
    env: {
      LC_ALL: "C",
      PERL_UNICODE: "SAD",
    },
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
            if (ArrayBuffer.isView(str)) {
              str = textDecoder.decode(str);
            }
            if (StringBuilder.isMultiline(str)) {
              stdout.append(str);
            } else {
              stdout.appendLine(str);
            }
          },
          stderr: (str) => {
            if (ArrayBuffer.isView(str)) {
              str = textDecoder.decode(str);
            }
            if (StringBuilder.isMultiline(str)) {
              stderr.append(str);
            } else {
              stderr.appendLine(str);
            }
          },
        },
      }),
    ],
  };
  const wasi = new WASI(wasiOptions);
  const f = options.fetch ?? fetch;
  const { instance } = await instantiateStreaming(f(cdn), {
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

/**
 * Transforms a `TagsObject` into an array of ExifTool command-line string arguments.
 * @param tagsObj The object containing tags.
 * @returns An array of ExifTool tag assignment arguments.
 */
function transformTagsObjectToStringArray(tagsObj: TagsObject): string[] {
  const stringArgs: string[] = [];
  for (const tagName in tagsObj) {
    if (Object.prototype.hasOwnProperty.call(tagsObj, tagName)) {
      const tagValue = tagsObj[tagName];
      if (Array.isArray(tagValue)) {
        tagValue.forEach(value => stringArgs.push(`-${tagName}=${String(value)}`));
      } else {
        stringArgs.push(`-${tagName}=${String(tagValue)}`);
      }
    }
  }
  return stringArgs;
}

/**
 * Writes metadata to a file using ExifTool.
 * The operation creates a modified copy of the file in memory.
 *
 * @param file The file (browser `File` or `Binaryfile`) to write metadata to.
 * @param options Configuration for tags, ExifTool config, and other arguments.
 * @returns A promise resolving to the write result, with modified file data on success.
 */
async function writeMetadata(
  file: Binaryfile | File,
  options: ExifToolWriteOptions
): Promise<ExifToolWriteResult> {
  const fileSystem = new MemoryFileSystem({ "/": "" });

  if (typeof exiftool !== 'string') {
    return { success: false, data: undefined, error: "Internal error: ExifTool script data unavailable.", exitCode: undefined };
  }
  fileSystem.addFile("/exiftool", textEncoder.encode(exiftool));

  const originalFilename = file instanceof File ? file.name : file.name;
  const sanitizedBaseFilename = originalFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const inputFilePath = `/source_${sanitizedBaseFilename}`;
  const outputFilePath = `/output_${sanitizedBaseFilename}`;

  const inputFileData = file instanceof File ? new Uint8Array(await file.arrayBuffer()) : file.data;
  if (!(inputFileData instanceof Uint8Array || inputFileData instanceof Blob)) {
    return { success: false, data: undefined, error: "Input file data must be Uint8Array or Blob.", exitCode: undefined };
  }
  fileSystem.addFile(inputFilePath, inputFileData);

  let configFilePathInFS: string | undefined;
  if (options.configFile) {
    if (!(options.configFile.data instanceof Uint8Array)) {
      return { success: false, data: undefined, error: "Config file data (options.configFile.data) must be Uint8Array.", exitCode: undefined };
    }
    const sanitizedConfigName = options.configFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    configFilePathInFS = `/${sanitizedConfigName}`;
    fileSystem.addFile(configFilePathInFS, options.configFile.data);
  }

  let tagArguments: string[];
  if (Array.isArray(options.tags)) {
    tagArguments = options.tags;
  } else if (typeof options.tags === 'object' && options.tags !== null) {
    tagArguments = transformTagsObjectToStringArray(options.tags);
  } else {
    return { success: false, data: undefined, error: "Invalid 'tags' format: must be an array of strings or an object.", exitCode: undefined };
  }

  const exiftoolCommandArgs = [
    "zeroperl", "exiftool",
    ...(options.extraArgs || []),
    ...tagArguments,
    "-o", outputFilePath,
    inputFilePath
  ];

  const stderr = new StringBuilder();
  const wasiEnv: Record<string, string> = { LC_ALL: "C", PERL_UNICODE: "SAD" };
  if (configFilePathInFS) {
    wasiEnv.EXIFTOOL_CONFIG = configFilePathInFS;
  }

  const wasiOptions: WASIOptions = {
    env: wasiEnv,
    args: exiftoolCommandArgs,
    features: [
      useEnviron, useArgs, useRandom, useClock, useProc,
      useMemoryFS({
        withFileSystem: fileSystem,
        withStdIo: {
          stderr: (str) => {
            if (ArrayBuffer.isView(str)) {
              str = textDecoder.decode(str);
            }
            if (StringBuilder.isMultiline(str)) { // Check if already multiline
              stderr.append(str);
            } else {
              stderr.appendLine(str); // Append as a new line otherwise
            }
          },
          stdout: () => {}, // stdout is not typically used for primary output in write operations with -o
        }
      })
    ]
  };
  const wasi = new WASI(wasiOptions);

  const f = options.fetch ?? fetch;
  let instance: WebAssembly.Instance;
  try {
    const result = await instantiateStreaming(f(cdn), { wasi_snapshot_preview1: wasi.wasiImport });
    instance = result.instance;
  } catch (err) {
    return { success: false, data: undefined, error: `WASM instantiation failed: ${err instanceof Error ? err.message : String(err)}`, exitCode: undefined };
  }

  let exitCode: number | undefined;
  let runError: unknown;
  try {
    exitCode = await wasi.start(instance);
  } catch (err) {
    runError = err;
    exitCode = err instanceof WASIProcExit ? err.code : undefined;
  }

  const stderrOutput = stderr.toString();
  if (exitCode !== 0) {
    let errorMsg = stderrOutput;
    if (!errorMsg) {
      if (runError && !(runError instanceof WASIProcExit)) {
        errorMsg = `WASI execution failed: ${runError instanceof Error ? runError.message : String(runError)}`;
      } else {
        errorMsg = `ExifTool process exited with code ${exitCode}.`;
      }
    }
    return { success: false, data: undefined, error: errorMsg, exitCode };
  }

  let modifiedFileData: Uint8Array | undefined;
  try {
    const node = fileSystem.lookup(outputFilePath);
    if (!node) {
        throw new Error(`Output file node not found: ${outputFilePath}`);
    }
    if (node.type !== 'file') {
        throw new Error(`Output node is not a file: ${outputFilePath} (type: ${node.type})`);
    }
    
    const fileContent = node.content;
    if (fileContent instanceof Uint8Array) {
        modifiedFileData = fileContent;
    } else if (fileContent instanceof Blob) {
        modifiedFileData = new Uint8Array(await fileContent.arrayBuffer());
    } else {
        throw new Error(`Unexpected content type for output file: ${outputFilePath}`);
    }

  } catch (lookupError) {
    return { 
        success: false, 
        data: undefined, 
        error: `Internal error retrieving output: ${lookupError instanceof Error ? lookupError.message : String(lookupError)}. Warnings: ${stderrOutput}`, 
        exitCode: 0 
    };
  }

  if (!modifiedFileData) { 
    return { 
        success: false, 
        data: undefined, 
        error: `Internal error: Output data null despite exit 0. Warnings: ${stderrOutput}`, 
        exitCode: 0 
    };
  }

  return { 
    success: true, 
    data: modifiedFileData, 
    warnings: stderrOutput, 
    exitCode: 0 
  };
}

export { parseMetadata, writeMetadata };
export type { ExifToolOptions, ExifToolOutput, ExifToolWriteOptions, ExifToolWriteResult, Binaryfile, TagsObject, TagValue };
