import { WASIAbi } from "../abi";
import type { WASIOptions } from "../options";

/**
 * A feature provider that provides `clock_res_get` and `clock_time_get` by JavaScript's Date.
 */
export function useClock(_options: WASIOptions, _abi: WASIAbi, memoryView: () => DataView): WebAssembly.ModuleImports {
    return {
        clock_res_get: (clockId: number, resolution: number) => {
            let resolutionValue: number;
            switch (clockId) {
                case WASIAbi.WASI_CLOCK_MONOTONIC: {
                    // https://developer.mozilla.org/en-US/docs/Web/API/Performance/now
                    resolutionValue = 5000;
                    break;
                }
                case WASIAbi.WASI_CLOCK_REALTIME: {
                    resolutionValue = 1000;
                    break;
                }
                default: return WASIAbi.WASI_ENOSYS;
            }
            const view = memoryView();
            // 64-bit integer, but only the lower 32 bits are used.
            view.setUint32(resolution, resolutionValue, true);
            return WASIAbi.WASI_ESUCCESS;
        },
        clock_time_get: (clockId: number, _precision: number, time: number) => {
            let nowMs = 0;
            switch (clockId) {
                case WASIAbi.WASI_CLOCK_MONOTONIC: {
                    nowMs = performance.now();
                    break;
                }
                case WASIAbi.WASI_CLOCK_REALTIME: {
                    nowMs = Date.now();
                    break;
                }
                default: return WASIAbi.WASI_ENOSYS;
            }
            const view = memoryView();
            if (BigInt) {
                const msToNs = (ms: number) => {
                    const msInt = Math.trunc(ms);
                    const decimal = BigInt(Math.round((ms - msInt) * 1_000_000));
                    const ns = BigInt(msInt) * BigInt(1_000_000);
                    return ns + decimal;
                };
                const now = BigInt(msToNs(nowMs));
                view.setBigUint64(time, now, true);
            } else {
                // Fallback to two 32-bit numbers losing precision
                const now = Date.now() * 1_000_000;
                view.setUint32(time, now & 0x0000ffff, true);
                view.setUint32(time + 4, now & 0xffff0000, true);
            }
            return WASIAbi.WASI_ESUCCESS;
        },
    };
}