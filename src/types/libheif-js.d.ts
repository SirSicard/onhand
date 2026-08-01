/**
 * libheif-js ships no types. Declaring only the surface we actually use, rather
 * than pulling in a hand-written full definition that would drift from upstream.
 */
declare module "libheif-js/wasm-bundle" {
  interface HeifImage {
    get_width(): number;
    get_height(): number;
    /**
     * Renders into the supplied RGBA buffer. Calls back with a truthy value on
     * success and a falsy one on failure — it does not throw and does not use
     * an error-first signature.
     */
    display(
      target: { data: Uint8ClampedArray; width: number; height: number },
      callback: (result: unknown) => void,
    ): void;
  }

  interface HeifDecoder {
    decode(data: Uint8Array): HeifImage[];
  }

  const libheif: {
    HeifDecoder: new () => HeifDecoder;
  };

  export default libheif;
}
