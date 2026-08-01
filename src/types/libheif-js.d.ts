/**
 * libheif-js ships no usable types for the ESM build. Declaring only the surface
 * we actually use, rather than a hand-written full definition that would drift.
 *
 * Note the path: `libheif-js/libheif-wasm/libheif-bundle.mjs`, not the package
 * root and not `wasm-bundle`. Those entries are CommonJS/UMD and fail inside an
 * ES-module worker with `ReferenceError: module is not defined`.
 */
declare module "libheif-js/libheif-wasm/libheif-bundle.mjs" {
  interface HeifImage {
    get_width(): number;
    get_height(): number;
    /**
     * Renders into the supplied RGBA buffer. Calls back with a truthy value on
     * success and a falsy one on failure — it does not throw, and it does not
     * use an error-first signature.
     */
    display(
      target: { data: Uint8ClampedArray; width: number; height: number },
      callback: (result: unknown) => void,
    ): void;
  }

  interface HeifDecoder {
    decode(data: Uint8Array): HeifImage[];
  }

  interface LibHeif {
    HeifDecoder: new () => HeifDecoder;
  }

  /** The bundle default-exports an async factory that instantiates the wasm. */
  const factory: (opts?: Record<string, unknown>) => Promise<LibHeif>;
  export default factory;
}
