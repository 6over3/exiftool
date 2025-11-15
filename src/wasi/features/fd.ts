import { WASIAbi } from "../abi";
import type { WASIFeatureProvider, WASIOptions } from "../options";

interface FdEntry {
  writev(iovs: Uint8Array[]): number;
  readv(iovs: Uint8Array[]): number;
  close(): void;
}

class WritableTextProxy implements FdEntry {
  private decoder = new TextDecoder("utf-8");
  constructor(
    private readonly handler: (lines: string | Uint8Array) => void,
    private readonly outputBuffers: boolean
  ) {}

  writev(iovs: Uint8Array[]): number {
    const totalBufferSize = iovs.reduce((acc, iov) => acc + iov.byteLength, 0);
    let offset = 0;
    const concatBuffer = new Uint8Array(totalBufferSize);
    for (const buffer of iovs) {
      concatBuffer.set(buffer, offset);
      offset += buffer.byteLength;
    }

    if (this.outputBuffers) {
      this.handler(concatBuffer);
    } else {
      const lines = this.decoder.decode(concatBuffer);
      this.handler(lines);
    }

    return concatBuffer.length;
  }
  readv(_iovs: Uint8Array[]): number {
    return 0;
  }
  close(): void {}
}

export class ReadableTextProxy implements FdEntry {
  private encoder = new TextEncoder();
  private pending: Uint8Array | null = null;
  constructor(private readonly consume: () => string | Uint8Array) {}

  writev(_iovs: Uint8Array[]): number {
    return 0;
  }
  consumePending(pending: Uint8Array, requestLength: number): Uint8Array {
    if (pending.byteLength < requestLength) {
      this.pending = null;
      return pending;
    }
      const result = pending.slice(0, requestLength);
      this.pending = pending.slice(requestLength);
      return result;
  }
  readv(iovs: Uint8Array[]): number {
    let read = 0;
    for (const buffer of iovs) {
      let remaining = buffer.byteLength;
      if (this.pending) {
        const consumed = this.consumePending(this.pending, remaining);
        buffer.set(consumed, 0);
        remaining -= consumed.byteLength;
        read += consumed.byteLength;
      }
      while (remaining > 0) {
        const newData = this.consume();
        let bytes: Uint8Array;

        if (newData instanceof Uint8Array) {
          bytes = newData;
        } else {
          bytes = this.encoder.encode(newData);
        }

        if (bytes.length === 0) {
          return read;
        }
        if (bytes.length > remaining) {
          buffer.set(bytes.slice(0, remaining), buffer.byteLength - remaining);
          this.pending = bytes.slice(remaining);
          read += remaining;
          remaining = 0;
        } else {
          buffer.set(bytes, buffer.byteLength - remaining);
          read += bytes.length;
          remaining -= bytes.length;
        }
      }
    }
    return read;
  }
  close(): void {}
}

export type StdIoOptions = {
  stdin?: () => string | Uint8Array;
  stdout?: (lines: string | Uint8Array) => void;
  stderr?: (lines: string | Uint8Array) => void;
  outputBuffers?: boolean;
};

function bindStdio(
  useOptions: StdIoOptions = {}
): (ReadableTextProxy | WritableTextProxy)[] {
  const outputBuffers = useOptions.outputBuffers || false;
  return [
    new ReadableTextProxy(
      useOptions.stdin ||
        (() => {
          return "";
        })
    ),
    new WritableTextProxy(useOptions.stdout || console.log, outputBuffers),
    new WritableTextProxy(useOptions.stderr || console.error, outputBuffers),
  ];
}

/**
 * Create a feature provider that provides fd related features only for standard output and standard error
 * It uses JavaScript's `console` APIs as backend by default.
 *
 * ```js
 * const wasi = new WASI({
 *   features: [useStdio()],
 * });
 * ```
 *
 * To use a custom backend, you can pass stdout and stderr handlers.
 *
 * ```js
 * const wasi = new WASI({
 *   features: [
 *     useStdio({
 *       stdout: (lines) => document.write(lines),
 *       stderr: (lines) => document.write(lines),
 *     })
 *   ],
 * });
 * ```
 *
 * This provides `fd_write`, `fd_prestat_get` and `fd_prestat_dir_name` implementations to make libc work with minimal effort.
 */
export function useStdio(useOptions: StdIoOptions = {}): WASIFeatureProvider {
  return (_options, abi, memoryView) => {
    const fdTable = bindStdio(useOptions);
    return {
      fd_fdstat_get: (fd: number, buf: number) => {
        const fdEntry = fdTable[fd];
        if (!fdEntry) return WASIAbi.WASI_ERRNO_BADF;
        const view = memoryView();
        abi.writeFdstat(view, buf, WASIAbi.WASI_FILETYPE_CHARACTER_DEVICE, 0);
        return WASIAbi.WASI_ESUCCESS;
      },
      fd_filestat_get: (fd: number, buf: number) => {
        const fdEntry = fdTable[fd];
        if (!fdEntry) return WASIAbi.WASI_ERRNO_BADF;
        const view = memoryView();
        abi.writeFilestat(view, buf, WASIAbi.WASI_FILETYPE_CHARACTER_DEVICE);
      },
      fd_prestat_get: (_fd: number, _buf: number) => {
        return WASIAbi.WASI_ERRNO_BADF;
      },
      fd_prestat_dir_name: (_fd: number, _buf: number) => {
        return WASIAbi.WASI_ERRNO_BADF;
      },
      fd_write: (
        fd: number,
        iovs: number,
        iovsLen: number,
        nwritten: number
      ) => {
        const fdEntry = fdTable[fd];
        if (!fdEntry) return WASIAbi.WASI_ERRNO_BADF;
        const view = memoryView();
        const iovsBuffers = abi.iovViews(view, iovs, iovsLen);
        const writtenValue = fdEntry.writev(iovsBuffers);
        view.setUint32(nwritten, writtenValue, true);
        return WASIAbi.WASI_ESUCCESS;
      },
      fd_read: (fd: number, iovs: number, iovsLen: number, nread: number) => {
        const fdEntry = fdTable[fd];
        if (!fdEntry) return WASIAbi.WASI_ERRNO_BADF;
        const view = memoryView();
        const iovsBuffers = abi.iovViews(view, iovs, iovsLen);
        const readValue = fdEntry.readv(iovsBuffers);
        view.setUint32(nread, readValue, true);
        return WASIAbi.WASI_ESUCCESS;
      },
    };
  };
}

type FileDescriptor = number;

/**
 * Represents a node in the file system that is a directory.
 */
interface DirectoryNode {
  readonly type: "dir";
  entries: Record<string, FSNode>;
}

/**
 * Represents a node in the file system that is a file.
 */
interface FileNode {
  readonly type: "file";
  content: Uint8Array | Blob;
}

type CharacterDeviceNode =
  | { readonly type: "character"; kind: "stdio"; entry: FdEntry }
  | { readonly type: "character"; kind: "devnull" };

/**
 * Union type representing any node in the file system.
 */
type FSNode = DirectoryNode | FileNode | CharacterDeviceNode;

/**
 * Represents an open file in the file system.
 */
interface OpenFile {
  node: FSNode;
  position: number;
  path: string;
  isPreopen?: boolean;
  preopenPath?: string;
  fd: FileDescriptor;
}

/**
 * Type for file content that can be added to the file system.
 */
type FileContent = string | Uint8Array | Blob;

/**
 * In-memory implementation of a file system.
 */
export class MemoryFileSystem {
  private root: DirectoryNode;
  private preopenPaths: string[] = [];

  /**
   * Creates a new memory file system.
   * @param preopens Optional list of directories to pre-open
   */
  constructor(preopens?: { [guestPath: string]: string } | undefined) {
    this.root = { type: "dir", entries: {} };

    // Setup essential directories and special files
    this.ensureDir("/dev");
    this.setNode("/dev/null", { type: "character", kind: "devnull" });

    // Setup preopened directories
    if (preopens) {
      for (const guestPath of Object.keys(preopens)) {
        // there are no 'host' paths in a memory file system, so we just use the guest path.
        this.ensureDir(guestPath);
        this.preopenPaths.push(guestPath);
      }
    } else {
      this.preopenPaths.push("/");
    }
  }

  removeFile(path: string) {
    const normalizedPath = this.normalizePath(path);
    const parts = normalizedPath.split("/").filter((p) => p.length > 0);
    const fileName = parts.pop();
    const dirPath = `/${parts.join("/")}`;
    const dir = this.ensureDir(dirPath);
    if (fileName) {
      delete dir.entries[fileName];
    }
  }

  addFile(path: string, content: FileContent): void {
    if (typeof content === "string") {
      const data = new TextEncoder().encode(content);
      this.createFile(path, data);
      return;
    }
      this.createFile(path, content);
  }

  /**
   * Creates a file with the specified content.
   * @param path Path where the file should be created
   * @param content Binary content of the file
   * @returns The created file node
   */
  createFile(path: string, content: Uint8Array | Blob): FileNode {
    const fileNode: FileNode = { type: "file", content };
    this.setNode(path, fileNode);
    return fileNode;
  }

  /**
   * Sets a node at the specified path.
   * @param path Path where the node should be set
   * @param node The node to set
   */
  setNode(path: string, node: FSNode): void {
    const normalizedPath = this.normalizePath(path);
    const parts = normalizedPath.split("/").filter((p) => p.length > 0);

    if (parts.length === 0) {
      if (node.type !== "dir") {
        throw new Error("Root must be a directory");
      }
      this.root = node;
      return;
    }

    const fileName = parts.pop();
    const dirPath = `/${parts.join("/")}`;
    const dir = this.ensureDir(dirPath);
    if (fileName) {
      dir.entries[fileName] = node;
    }
  }

  /**
   * Gets the /dev/null special device.
   * @returns The /dev/null node
   */
  getDevNull(): FSNode {
    const node = this.lookup("/dev/null");
    if (!node) throw new Error("/dev/null not found");
    return node;
  }

  /**
   * Gets the list of pre-opened paths.
   * @returns Array of pre-opened paths
   */
  getPreopenPaths(): string[] {
    return [...this.preopenPaths];
  }

  /**
   * Looks up a node at the specified path.
   * @param path Path to look up
   * @returns The node at the path, or null if not found
   */
  lookup(path: string): FSNode | null {
    const normalizedPath = this.normalizePath(path);
    if (normalizedPath === "/") return this.root;

    const parts = normalizedPath.split("/").filter((p) => p.length > 0);
    let current: FSNode | undefined = this.root;

    for (const part of parts) {
      if (current.type !== "dir") return null;
      current = current.entries[part];
      if (!current) return null;
    }

    return current;
  }

  /**
   * Resolves a relative path from a directory.
   * @param dir Starting directory
   * @param relativePath Relative path to resolve
   * @returns The resolved node, or null if not found
   */
  resolve(dir: DirectoryNode, relativePath: string): FSNode | null {
    const normalizedPath = this.normalizePath(relativePath);
    const parts = normalizedPath.split("/").filter((p) => p.length > 0);
    let current: FSNode | undefined = dir;

    for (const part of parts) {
      if (part === ".") continue;
      if (part === "..") {
        current = this.root; // jump to root
        continue;
      }
      if (current.type !== "dir") return null;
      current = current.entries[part];
      if (!current) return null;
    }

    return current;
  }

  /**
   * Ensures a directory exists at the specified path, creating it if necessary.
   * @param path Path to the directory
   * @returns The directory node
   */
  ensureDir(path: string): DirectoryNode {
    const normalizedPath = this.normalizePath(path);
    const parts = normalizedPath.split("/").filter((p) => p.length > 0);
    let current: DirectoryNode = this.root;

    for (const part of parts) {
      if (!current.entries[part]) {
        current.entries[part] = { type: "dir", entries: {} };
      }

      const next = current.entries[part];
      if (next.type !== "dir") {
        throw new Error(`"${part}" is not a directory`);
      }

      current = next;
    }

    return current;
  }

  /**
   * Creates a file in a directory.
   * @param dir Parent directory
   * @param relativePath Path relative to the directory
   * @returns The created file node
   */
  createFileIn(dir: DirectoryNode, relativePath: string): FileNode {
    const normalizedPath = this.normalizePath(relativePath);
    const parts = normalizedPath.split("/").filter((p) => p.length > 0);

    if (parts.length === 0) {
      throw new Error("Cannot create a file with an empty name");
    }

    const fileName = parts.pop();
    if (!fileName) {
      throw new Error("Cannot create a file with an empty name");
    }
    let current = dir;

    for (const part of parts) {
      if (!current.entries[part]) {
        current.entries[part] = { type: "dir", entries: {} };
      }

      const next = current.entries[part];
      if (next.type !== "dir") {
        throw new Error(`"${part}" is not a directory`);
      }

      current = next;
    }

    const fileNode: FileNode = { type: "file", content: new Uint8Array(0) };
    current.entries[fileName] = fileNode;
    return fileNode;
  }

  /**
   * Normalizes a path by removing duplicate slashes and trailing slashes.
   * @param path Path to normalize
   * @returns Normalized path
   */
  private normalizePath(path: string): string {
    // Handle empty path
    if (!path) return "/";

    // Ensure path starts with a slash
    const withLeadingSlash = path.startsWith("/") ? path : `/${path}`;

    // Remove duplicate slashes and normalize
    const normalized = withLeadingSlash.replace(/\/+/g, "/");

    // Remove trailing slash unless it's the root path
    return normalized === "/" ? normalized : normalized.replace(/\/+$/, "");
  }
}

/**
 * Creates a feature provider that implements a complete in-memory file system.
 *
 * This provides implementations for all file descriptor and path-related WASI
 * functions, including `fd_read`, `fd_write`, `fd_seek`, `fd_tell`, `fd_close`,
 * `path_open`, and more to support a full featured file system environment.
 *
 * ```js
 * const wasi = new WASI({
 *   features: [useMemoryFS()],
 * });
 * ```
 *
 * You can provide a pre-configured file system instance:
 *
 * ```js
 * const fs = new MemoryFileSystem();
 * fs.addFile("/hello.txt", "Hello, world!");
 *
 * const wasi = new WASI({
 *   features: [useMemoryFS({ withFileSystem: fs })],
 * });
 * ```
 *
 * You can also combine it with standard IO:
 *
 * ```js
 * const wasi = new WASI({
 *   features: [
 *     useMemoryFS({
 *       withStdIo: {
 *         stdout: (lines) => document.write(lines),
 *         stderr: (lines) => document.write(lines),
 *       }
 *     })
 *   ],
 * });
 * ```
 *
 * @param useOptions - Configuration options for the memory file system
 * @param useOptions.withFileSystem - Optional pre-configured file system instance
 * @param useOptions.withStdIo - Optional standard I/O configuration
 * @returns A WASI feature provider implementing file system functionality
 */
export function useMemoryFS(
  useOptions: {
    withFileSystem?: MemoryFileSystem;
    withStdIo?: StdIoOptions;
  } = {}
): WASIFeatureProvider {
  return (
    wasiOptions: WASIOptions,
    abi: WASIAbi,
    memoryView: () => DataView
  ) => {
    const fileSystem =
      useOptions.withFileSystem || new MemoryFileSystem(wasiOptions.preopens);
    const files: { [fd: FileDescriptor]: OpenFile } = {};

    bindStdio(useOptions.withStdIo || {}).forEach((entry, fd) => {
      files[fd] = {
        node: { type: "character", kind: "stdio", entry },
        position: 0,
        isPreopen: false,
        path: `/dev/fd/${fd}`,
        fd,
      };
    });

    let nextFd = 3;
    for (const preopenPath of fileSystem.getPreopenPaths()) {
      const node = fileSystem.lookup(preopenPath);
      if (node && node.type === "dir") {
        files[nextFd] = {
          node,
          position: 0,
          isPreopen: true,
          preopenPath,
          path: preopenPath,
          fd: nextFd,
        };
        nextFd++;
      }
    }

    function getFileFromPath(guestPath: string): OpenFile | null {
      for (const fd in files) {
        const file = files[fd];
        if (file?.path === guestPath) return file;
      }
      return null;
    }

    function getFileFromFD(fileDescriptor: FileDescriptor): OpenFile | null {
      const file = files[fileDescriptor];
      return file || null;
    }

    function getFileSize(file: FileNode): number {
      if (file.content instanceof Blob) {
        return file.content.size;
      }
        return file.content.byteLength;
    }

    return {
      fd_read: async (
        fd: number,
        iovs: number,
        iovsLen: number,
        nread: number
      ) => {
        const view = memoryView();

        const iovViews = abi.iovViews(view, iovs, iovsLen);
        const file = getFileFromFD(fd);
        if (!file) {
          return WASIAbi.WASI_ERRNO_BADF;
        }

        if (file.node.type === "character" && file.node.kind === "stdio") {
          const bytesRead = file.node.entry.readv(iovViews);
          view.setUint32(nread, bytesRead, true);
          return WASIAbi.WASI_ESUCCESS;
        }

        if (file.node.type === "dir") {
          return WASIAbi.WASI_ERRNO_ISDIR;
        }

        if (file.node.type === "character" && file.node.kind === "devnull") {
          view.setUint32(nread, 0, true);
          return WASIAbi.WASI_ESUCCESS;
        }

        const fileNode = file.node;
        const data = fileNode.content;
        const available = getFileSize(fileNode) - file.position;
        let totalRead = 0;
        if (available <= 0) {
          view.setUint32(nread, 0, true);
          return WASIAbi.WASI_ESUCCESS;
        }

        if (fileNode.content instanceof Blob) {
          const blob = fileNode.content;
          for (const buf of iovViews) {
            if (file.position >= blob.size) break;
            const bytesToRead = Math.min(
              buf.byteLength,
              blob.size - file.position
            );
            if (bytesToRead <= 0) break;
            const chunk = await blob
              .slice(file.position, file.position + bytesToRead)
              .arrayBuffer();
            buf.set(new Uint8Array(chunk));
            totalRead += chunk.byteLength;
            file.position += chunk.byteLength;
          }
        } else if (ArrayBuffer.isView(data)) {
          for (const buf of iovViews) {
            if (file.position >= data.byteLength) break;
            const bytesToRead = Math.min(
              buf.byteLength,
              data.byteLength - file.position
            );
            if (bytesToRead <= 0) break;
            buf.set(data.slice(file.position, file.position + bytesToRead));
            totalRead += bytesToRead;
            file.position += bytesToRead;
          }
        }
        view.setUint32(nread, totalRead, true);
        return WASIAbi.WASI_ESUCCESS;
      },

      fd_write: (
        fd: number,
        iovs: number,
        iovsLen: number,
        nwritten: number
      ) => {
        const view = memoryView();
        const iovViews = abi.iovViews(view, iovs, iovsLen);
        const file = getFileFromFD(fd);
        if (!file) return WASIAbi.WASI_ERRNO_BADF;
        let totalWritten = 0;

        if (file.node.type === "character" && file.node.kind === "stdio") {
          const bytesWritten = file.node.entry.writev(iovViews);
          view.setUint32(nwritten, bytesWritten, true);
          return WASIAbi.WASI_ESUCCESS;
        }

        if (file.node.type === "dir") return WASIAbi.WASI_ERRNO_ISDIR;

        if (file.node.type === "character" && file.node.kind === "devnull") {
          const total = iovViews.reduce((acc, buf) => acc + buf.byteLength, 0);
          view.setUint32(nwritten, total, true);
          return WASIAbi.WASI_ESUCCESS;
        }

        if (file.node.content instanceof Blob) {
          return WASIAbi.WASI_ERRNO_INVAL;
        }

        let pos = file.position;
        const dataToWrite = iovViews.reduce(
          (acc, buf) => acc + buf.byteLength,
          0
        );
        const requiredLength = pos + dataToWrite;
        let newContent: Uint8Array;

        if (requiredLength > getFileSize(file.node)) {
          newContent = new Uint8Array(requiredLength);
          newContent.set(file.node.content, 0);
        } else {
          newContent = file.node.content;
        }

        for (const buf of iovViews) {
          newContent.set(buf, pos);
          pos += buf.byteLength;
          totalWritten += buf.byteLength;
        }

        file.node.content = newContent;
        file.position = pos;
        view.setUint32(nwritten, totalWritten, true);
        return WASIAbi.WASI_ESUCCESS;
      },

      fd_close: (fd: number) => {
        const file = getFileFromFD(fd);
        if (!file) return WASIAbi.WASI_ERRNO_BADF;

        if (file.node.type === "character" && file.node.kind === "stdio") {
          file.node.entry.close();
          return WASIAbi.WASI_ESUCCESS;
        }

        delete files[fd];
        return WASIAbi.WASI_ESUCCESS;
      },

      fd_seek: (
        fd: number,
        offset: bigint,
        whence: number,
        newOffset: number
      ) => {
        const view = memoryView();
        if (fd < 3) return WASIAbi.WASI_ERRNO_BADF;

        const file = getFileFromFD(fd);
        if (!file || file.node.type !== "file") return WASIAbi.WASI_ERRNO_BADF;

        let pos = file.position;
        const fileLength = getFileSize(file.node);

        switch (whence) {
          case 0:
            pos = Number(offset);
            break;
          case 1:
            pos = pos + Number(offset);
            break;
          case 2:
            pos = fileLength + Number(offset);
            break;
          default:
            return WASIAbi.WASI_ERRNO_INVAL;
        }

        if (pos < 0) pos = 0;
        file.position = pos;
        view.setUint32(newOffset, pos, true);
        return WASIAbi.WASI_ESUCCESS;
      },

      fd_tell: (fd: number, offset_ptr: number) => {
        const view = memoryView();
        if (fd < 3) return WASIAbi.WASI_ERRNO_BADF;

        const file = getFileFromFD(fd);
        if (!file) return WASIAbi.WASI_ERRNO_BADF;

        view.setBigUint64(offset_ptr, BigInt(file.position), true);
        return WASIAbi.WASI_ESUCCESS;
      },

      fd_fdstat_get: (fd: number, buf: number) => {
        const view = memoryView();
        const file = getFileFromFD(fd);
        if (!file) return WASIAbi.WASI_ERRNO_BADF;

        let filetype: number;
        switch (file.node.type) {
          case "character":
            filetype = WASIAbi.WASI_FILETYPE_CHARACTER_DEVICE;
            break;
          case "dir":
            filetype = WASIAbi.WASI_FILETYPE_DIRECTORY;
            break;
          case "file":
            filetype = WASIAbi.WASI_FILETYPE_REGULAR_FILE;
            break;
        }

        abi.writeFdstat(view, buf, filetype, 0);
        return WASIAbi.WASI_ESUCCESS;
      },

      fd_filestat_get: (fd: number, buf: number) => {
        const view = memoryView();
        const entry = getFileFromFD(fd);
        if (!entry) return WASIAbi.WASI_ERRNO_BADF;

        let filetype: number;
        let size = 0;
        switch (entry.node.type) {
          case "character":
            filetype = WASIAbi.WASI_FILETYPE_CHARACTER_DEVICE;
            break;
          case "dir":
            filetype = WASIAbi.WASI_FILETYPE_DIRECTORY;
            break;
          case "file":
            filetype = WASIAbi.WASI_FILETYPE_REGULAR_FILE;
            size = getFileSize(entry.node);
            break;
        }

        abi.writeFilestat(view, buf, filetype);
        view.setBigUint64(buf + 32, BigInt(size), true);
        return WASIAbi.WASI_ESUCCESS;
      },

      fd_prestat_get: (fd: number, buf: number) => {
        const view = memoryView();
        if (fd < 3) return WASIAbi.WASI_ERRNO_BADF;

        const file = getFileFromFD(fd);
        if (!file || !file.isPreopen) return WASIAbi.WASI_ERRNO_BADF;

        view.setUint8(buf, 0);
        const pathStr = file.preopenPath || "";
        view.setUint32(buf + 4, pathStr.length, true);
        return WASIAbi.WASI_ESUCCESS;
      },

      fd_prestat_dir_name: (fd: number, pathPtr: number, pathLen: number) => {
        if (fd < 3) return WASIAbi.WASI_ERRNO_BADF;

        const file = getFileFromFD(fd);
        if (!file || !file.isPreopen) return WASIAbi.WASI_ERRNO_BADF;

        const pathStr = file.preopenPath || "";
        if (pathStr.length !== pathLen) return WASIAbi.WASI_ERRNO_INVAL;

        const view = memoryView();
        for (let i = 0; i < pathStr.length; i++) {
          view.setUint8(pathPtr + i, pathStr.charCodeAt(i));
        }

        return WASIAbi.WASI_ESUCCESS;
      },

      fd_open: (
        dirfd: number,
        pathPtr: number,
        pathLen: number,
        oflags: number,
        _fs_rights_base: bigint,
        _fs_rights_inheriting: bigint,
        _fdflags: number,
        opened_fd: number
      ) => {
        const view = memoryView();

        if (dirfd < 3) return WASIAbi.WASI_ERRNO_NOTDIR;

        const dirEntry = getFileFromFD(dirfd);
        if (!dirEntry || dirEntry.node.type !== "dir")
          return WASIAbi.WASI_ERRNO_NOTDIR;

        const path = abi.readString(view, pathPtr, pathLen);

        const guestPath =
          (dirEntry.path.endsWith("/") ? dirEntry.path : `${dirEntry.path}/`) +
          path;

        const existing = getFileFromPath(guestPath);
        if (existing) {
          view.setUint32(opened_fd, existing.fd, true);
          return WASIAbi.WASI_ESUCCESS;
        }

        let target = fileSystem.resolve(dirEntry.node, path);
        const O_CREAT = 1 << 0;
        const O_EXCL = 1 << 1;
        const O_TRUNC = 1 << 2;

        if (target) {
          if (oflags & O_EXCL) return WASIAbi.WASI_ERRNO_EXIST;
          if (oflags & O_TRUNC) {
            if (target.type !== "file") return WASIAbi.WASI_ERRNO_INVAL;
            target.content = new Uint8Array(0);
          }
        } else {
          if (!(oflags & O_CREAT)) return WASIAbi.WASI_ERRNO_NOENT;
          target = fileSystem.createFileIn(dirEntry.node, path);
        }

        files[nextFd] = {
          node: target,
          position: 0,
          isPreopen: false,
          path: guestPath,
          fd: nextFd,
        };

        view.setUint32(opened_fd, nextFd, true);
        nextFd++;
        return WASIAbi.WASI_ESUCCESS;
      },

      path_open: (
        dirfd: number,
        _dirflags: number,
        pathPtr: number,
        pathLen: number,
        oflags: number,
        _fs_rights_base: bigint,
        _fs_rights_inheriting: bigint,
        _fdflags: number,
        opened_fd: number
      ) => {
        const view = memoryView();

        if (dirfd < 3) return WASIAbi.WASI_ERRNO_NOTDIR;

        const dirEntry = getFileFromFD(dirfd);
        if (!dirEntry || dirEntry.node.type !== "dir")
          return WASIAbi.WASI_ERRNO_NOTDIR;

        const path = abi.readString(view, pathPtr, pathLen);

        const guestPath =
          (dirEntry.path.endsWith("/") ? dirEntry.path : `${dirEntry.path}/`) +
          path;

        const existing = getFileFromPath(guestPath);
        if (existing) {
          view.setUint32(opened_fd, existing.fd, true);
          return WASIAbi.WASI_ESUCCESS;
        }

        let target = fileSystem.resolve(dirEntry.node as DirectoryNode, path);
        const O_CREAT = 1 << 0;
        const O_EXCL = 1 << 1;
        const O_TRUNC = 1 << 2;

        if (target) {
          if (oflags & O_EXCL) return WASIAbi.WASI_ERRNO_EXIST;
          if (oflags & O_TRUNC) {
            if (target.type !== "file") return WASIAbi.WASI_ERRNO_INVAL;
            (target as FileNode).content = new Uint8Array(0);
          }
        } else {
          if (!(oflags & O_CREAT)) return WASIAbi.WASI_ERRNO_NOENT;
          target = fileSystem.createFileIn(
            dirEntry.node as DirectoryNode,
            path
          );
        }

        files[nextFd] = {
          node: target,
          position: 0,
          isPreopen: false,
          path: guestPath,
          fd: nextFd,
        };

        view.setUint32(opened_fd, nextFd, true);
        nextFd++;
        return WASIAbi.WASI_ESUCCESS;
      },

      path_filestat_get: (
        fd: number,
        _flags: number,
        pathPtr: number,
        pathLen: number,
        buf: number
      ) => {
        const view = memoryView();

        // Get the base FD entry; it must be a directory.
        const file = getFileFromFD(fd);
        if (!file) return WASIAbi.WASI_ERRNO_BADF;
        if (file.node.type !== "dir") {
          return WASIAbi.WASI_ERRNO_NOTDIR;
        }

        const guestRelPath = abi.readString(view, pathPtr, pathLen);

        // Compute the full guest path.
        const basePath = file.path;
        const fullGuestPath = basePath.endsWith("/")
          ? basePath + guestRelPath
          : `${basePath}/${guestRelPath}`;

        // Lookup the node in the MemoryFS.
        const node = fileSystem.lookup(fullGuestPath);
        if (!node) return WASIAbi.WASI_ERRNO_NOENT;
        if (node.type === "character" && node.kind === "stdio") {
          return WASIAbi.WASI_ERRNO_INVAL;
        }

        // Determine file type and size.
        let filetype: number;
        let size = 0;
        if (node.type === "dir") {
          filetype = WASIAbi.WASI_FILETYPE_DIRECTORY;
        } else if (node.type === "character" && node.kind === "devnull") {
          filetype = WASIAbi.WASI_FILETYPE_CHARACTER_DEVICE;
        } else {
          filetype = WASIAbi.WASI_FILETYPE_REGULAR_FILE;
          size = getFileSize(node);
        }

        abi.writeFilestat(view, buf, filetype);
        view.setBigUint64(buf + 32, BigInt(size), true);
        return WASIAbi.WASI_ESUCCESS;
      },
    };
  };
}

export function useFS(_useOptions: { fs: unknown }): WASIFeatureProvider {
  return (_options: WASIOptions, _abi: WASIAbi, _memoryView: () => DataView) => {
    // TODO: implement fd_* syscalls using `useOptions.fs`
    return {};
  };
}
