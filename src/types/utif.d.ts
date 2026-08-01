/**
 * UTIF ships no types. Declaring only what the TIFF decode path uses.
 *
 * The three-call shape (decode → decodeImage → toRGBA8) is the library's actual
 * contract: `decode` reads the IFD headers only, `decodeImage` fills in the
 * pixel data for one page, and `toRGBA8` normalises whatever bit depth and
 * colour model that page happened to use into plain 8-bit RGBA.
 */
declare module "utif" {
  interface IFD {
    width: number;
    height: number;
    data?: Uint8Array;
    [tag: string]: unknown;
  }

  const UTIF: {
    /** Parse the TIFF directory structure. Does not decode pixels. */
    decode(buffer: ArrayBuffer | Uint8Array): IFD[];
    /** Decode one page's pixel data in place. */
    decodeImage(buffer: ArrayBuffer | Uint8Array, ifd: IFD, ifds?: IFD[]): void;
    /** Normalise a decoded page to 8-bit RGBA. */
    toRGBA8(ifd: IFD): Uint8Array;
  };

  export default UTIF;
}

/** Vite's `?url` imports return the emitted asset path as a default export. */
declare module "*?url" {
  const url: string;
  export default url;
}
