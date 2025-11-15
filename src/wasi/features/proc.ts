import { WASIAbi, WASIProcExit } from "../abi";
import type { WASIOptions } from "../options";

/**
 * A feature provider that provides `proc_exit` and `proc_raise` by JavaScript's exception.
 */
export function useProc(_options: WASIOptions, _abi: WASIAbi, _memoryView: () => DataView): WebAssembly.ModuleImports {
    return {
        proc_exit: (code: number) => {
            throw new WASIProcExit(code);
        },
        proc_raise: (_signal: number) => {
            // TODO: Implement
            return WASIAbi.WASI_ESUCCESS;
        },
    };
}