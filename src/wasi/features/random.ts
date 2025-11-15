import { WASIAbi } from "../abi";
import type { WASIOptions } from "../options";

/**
 * Create a feature provider that provides `random_get` with `crypto` APIs as backend by default.
 */
export function useRandom(_options: WASIOptions, _abi: WASIAbi, memoryView: () => DataView): WebAssembly.ModuleImports {
    return {
        random_get: (bufferOffset: number, length: number) => {
            const view = memoryView();
            const buffer = new Uint8Array(view.buffer, bufferOffset, length);
            crypto.getRandomValues(buffer);
            return WASIAbi.WASI_ESUCCESS;
        },
    };
}